import type {
  AbandonedProduct,
  AnalyticsDashboardData,
  MonthlySpend,
  ProductStats,
  ProductUnit,
  TicketSummary,
} from '../types/index.ts';
import { parseTicketDate } from '../utils/pdfParser.ts';
import { round2 } from '../utils/sheetUtils.ts';

export interface RawRowData {
  pdfFileUrl: string;
  pdfFileName: string;
  dateTime: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  unit: ProductUnit;
  invoiceNumber: string;
  storeName: string;
}

/**
 * Productos accesorios excluidos por defecto de los rankings de consumo (Top 10, Abandonados y Top 40)
 * para que bolsas o parking no distorsionen tus hábitos reales de compra.
 * Sí se suman siempre al importe total de cada ticket.
 */
export const DEFAULT_EXCLUDED_PRODUCTS: readonly string[] = [
  'BOLSA PLASTICO',
  'BOLSA PLÁSTICO',
  'BOLSA RAFIA',
  'BOLSA PAPEL',
  'PARKING',
  'SERVICIO DOMICILIO',
  'TELECOMPRA',
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Parsea una fecha en formato "DD/MM/YYYY HH:mm" o ISO a timestamp numérico para ordenar.
 */
export function parseDateToTimestamp(dateStr: string): number {
  if (!dateStr) return 0;
  const parsed = parseTicketDate(dateStr);
  if (parsed) return parsed.getTime();
  const fallback = Date.parse(dateStr);
  return isNaN(fallback) ? 0 : fallback;
}

function isAccessoryOrDiscount(productName: string, amount: number, excludedSet: Set<string>): boolean {
  if (amount <= 0) return true;
  const upper = productName.trim().toUpperCase();
  if (excludedSet.has(upper)) return true;
  if (/^(?:DESCUENTO|BAJADA\s+DE\s+PRECIO|PROMO\b)/i.test(upper)) return true;
  return false;
}

/**
 * Calcula todas las métricas del Dashboard a partir de las filas de la hoja 'Lista'.
 */
export function computeAnalyticsFromRows(
  rows: RawRowData[],
  options: {
    minPurchasesForAbandoned?: number;
    /** Mínimo absoluto de días sin comprar para considerar un producto abandonado. */
    minDaysInactiveForAbandoned?: number;
    /** Multiplicador sobre el intervalo habitual de compra (por defecto 3x). */
    abandonedIntervalMultiplier?: number;
    /** Compatibilidad: umbral fijo si todas las compras ocurrieron el mismo día. */
    daysInactiveForAbandoned?: number;
    excludedProducts?: readonly string[];
    referenceTimestamp?: number;
  } = {}
): AnalyticsDashboardData {
  const minPurchases = options.minPurchasesForAbandoned ?? 3;
  const minDaysInactive = options.minDaysInactiveForAbandoned ?? 30;
  const intervalMultiplier = options.abandonedIntervalMultiplier ?? 3;
  const fallbackInactiveDays = options.daysInactiveForAbandoned ?? 60;
  const refTime = options.referenceTimestamp ?? Date.now();
  const excludedSet = new Set(
    (options.excludedProducts ?? DEFAULT_EXCLUDED_PRODUCTS).map((p) => p.trim().toUpperCase())
  );

  // 1. Agrupar por ticket (Factura) para totales y lista de tickets
  const ticketsMap = new Map<string, TicketSummary>();

  // 2. Agrupar por producto para estadísticas de hábitos e inflación
  const productsMap = new Map<
    string,
    {
      productName: string;
      unit: ProductUnit;
      purchases: {
        timestamp: number;
        dateTime: string;
        invoiceNumber: string;
        unitPrice: number;
        quantity: number;
        amount: number;
      }[];
    }
  >();

  for (const r of rows) {
    if (!r.productName || !r.invoiceNumber) continue;

    // El importe total del ticket SIEMPRE incluye todas las líneas (incluidas bolsas y descuentos)
    const existingTicket = ticketsMap.get(r.invoiceNumber);
    if (!existingTicket) {
      ticketsMap.set(r.invoiceNumber, {
        invoiceNumber: r.invoiceNumber,
        dateTime: r.dateTime,
        storeName: r.storeName,
        totalAmount: round2(r.amount),
        pdfFileUrl: r.pdfFileUrl,
        pdfFileName: r.pdfFileName,
      });
    } else {
      existingTicket.totalAmount = round2(existingTicket.totalAmount + r.amount);
      if (!existingTicket.pdfFileUrl && r.pdfFileUrl) {
        existingTicket.pdfFileUrl = r.pdfFileUrl;
        existingTicket.pdfFileName = r.pdfFileName;
      }
      if (!existingTicket.dateTime && r.dateTime) {
        existingTicket.dateTime = r.dateTime;
      }
    }

    // Excluir bolsas, parking y descuentos negativos de los rankings de productos
    if (isAccessoryOrDiscount(r.productName, r.amount, excludedSet)) {
      continue;
    }

    const prodKey = `${r.productName}___${r.unit}`;
    let prodEntry = productsMap.get(prodKey);
    if (!prodEntry) {
      prodEntry = {
        productName: r.productName,
        unit: r.unit,
        purchases: [],
      };
      productsMap.set(prodKey, prodEntry);
    }

    prodEntry.purchases.push({
      timestamp: parseDateToTimestamp(r.dateTime),
      dateTime: r.dateTime,
      invoiceNumber: r.invoiceNumber,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      amount: r.amount,
    });
  }

  // Ordenar tickets por fecha más reciente primero (para la tabla histórica)
  const ticketsList = Array.from(ticketsMap.values()).sort(
    (a, b) => parseDateToTimestamp(b.dateTime) - parseDateToTimestamp(a.dateTime)
  );

  const totalSpend = round2(ticketsList.reduce((acc, t) => acc + t.totalAmount, 0));
  const totalTickets = ticketsList.length;
  const averageTicket = totalTickets > 0 ? round2(totalSpend / totalTickets) : 0;

  // 3. Gasto mensual agrupado en orden cronológico (antiguo -> reciente)
  const monthlyMap = new Map<string, MonthlySpend>();
  for (const t of ticketsList) {
    const d = parseTicketDate(t.dateTime);
    if (!d) continue;
    const year = d.getFullYear();
    const monthNum = d.getMonth() + 1;
    const padMonth = String(monthNum).padStart(2, '0');
    const monthKey = `${year}-${padMonth}`;
    const label = `${padMonth}/${year}`;

    const current = monthlyMap.get(monthKey);
    if (!current) {
      monthlyMap.set(monthKey, {
        monthKey,
        label,
        totalAmount: round2(t.totalAmount),
        ticketCount: 1,
      });
    } else {
      current.totalAmount = round2(current.totalAmount + t.totalAmount);
      current.ticketCount += 1;
    }
  }

  const monthlySpend = Array.from(monthlyMap.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey)
  );
  const averageMonthlySpend =
    monthlySpend.length > 0 ? round2(totalSpend / monthlySpend.length) : 0;

  // 4. Estadísticas por producto
  const allProductStats: ProductStats[] = [];
  const abandonedList: AbandonedProduct[] = [];

  for (const entry of productsMap.values()) {
    entry.purchases.sort((a, b) => a.timestamp - b.timestamp);

    // Número de tickets distintos en los que se compró (o líneas si hay varias compras)
    const distinctTicketTimestamps = new Map<string, number>();
    for (const p of entry.purchases) {
      if (!distinctTicketTimestamps.has(p.invoiceNumber)) {
        distinctTicketTimestamps.set(p.invoiceNumber, p.timestamp);
      }
    }

    const timesPurchased = distinctTicketTimestamps.size;
    const totalAmountSpent = round2(entry.purchases.reduce((acc, p) => acc + p.amount, 0));
    const totalQuantity = Math.round(entry.purchases.reduce((acc, p) => acc + p.quantity, 0) * 1000) / 1000;

    let maxPrice = -Infinity;
    let maxDate = '';
    let minPrice = Infinity;
    let minDate = '';

    for (const p of entry.purchases) {
      if (p.unitPrice <= 0) continue;
      if (p.unitPrice > maxPrice) {
        maxPrice = p.unitPrice;
        maxDate = p.dateTime;
      }
      if (p.unitPrice < minPrice) {
        minPrice = p.unitPrice;
        minDate = p.dateTime;
      }
    }

    const lastPurchase = entry.purchases[entry.purchases.length - 1]!;
    const lastPrice = lastPurchase.unitPrice;
    const lastDate = lastPurchase.dateTime;

    if (maxPrice === -Infinity) {
      maxPrice = lastPrice;
      maxDate = lastDate;
    }
    if (minPrice === Infinity) {
      minPrice = lastPrice;
      minDate = lastDate;
    }

    const firstPurchase = entry.purchases[0]!;
    const firstPrice = firstPurchase.unitPrice;
    const priceChangePct =
      firstPrice > 0 ? Math.round(((lastPrice - firstPrice) / firstPrice) * 1000) / 10 : 0;

    allProductStats.push({
      productName: entry.productName,
      unit: entry.unit,
      timesPurchased,
      totalAmountSpent,
      totalQuantity,
      lastPrice,
      lastDate,
      maxPrice,
      maxDate,
      minPrice,
      minDate,
      priceChangePct,
    });

    // Detección adaptativa de producto recurrente abandonado según su propio ritmo
    if (timesPurchased >= minPurchases && lastPurchase.timestamp > 0) {
      const sortedTicketTs = Array.from(distinctTicketTimestamps.values())
        .filter((ts) => ts > 0)
        .sort((a, b) => a - b);

      let usualIntervalDays = 0;
      if (sortedTicketTs.length >= 2) {
        const spanDays =
          (sortedTicketTs[sortedTicketTs.length - 1]! - sortedTicketTs[0]!) / MS_PER_DAY;
        usualIntervalDays = Math.round(spanDays / (sortedTicketTs.length - 1));
      }

      const daysSinceLast = Math.floor((refTime - lastPurchase.timestamp) / MS_PER_DAY);
      const dynamicThreshold =
        usualIntervalDays > 0
          ? Math.max(minDaysInactive, Math.round(usualIntervalDays * intervalMultiplier))
          : fallbackInactiveDays;

      if (daysSinceLast >= dynamicThreshold) {
        abandonedList.push({
          productName: entry.productName,
          timesPurchased,
          lastPurchasedDate: lastDate,
          daysSinceLastPurchase: daysSinceLast,
          usualIntervalDays: usualIntervalDays || fallbackInactiveDays,
        });
      }
    }
  }

  // Top 10 más comprados: por nº de compras y desempate por gasto
  const top10MostPurchased = [...allProductStats]
    .sort((a, b) => b.timesPurchased - a.timesPurchased || b.totalAmountSpent - a.totalAmountSpent)
    .slice(0, 10);

  // Top 10 abandonados: por recurrencia previa y días sin comprar
  const top10Abandoned = abandonedList
    .sort((a, b) => b.timesPurchased - a.timesPurchased || b.daysSinceLastPurchase - a.daysSinceLastPurchase)
    .slice(0, 10);

  // Top 40 productos más comprados con histórico completo de precios
  const top40ProductsInflation = [...allProductStats]
    .sort((a, b) => b.timesPurchased - a.timesPurchased || b.totalAmountSpent - a.totalAmountSpent)
    .slice(0, 40);

  return {
    totalSpend,
    totalTickets,
    averageTicket,
    averageMonthlySpend,
    tickets: ticketsList,
    monthlySpend,
    top10MostPurchased,
    top10Abandoned,
    top40ProductsInflation,
  };
}
