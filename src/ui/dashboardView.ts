import type { AnalyticsDashboardData } from '../types/index.ts';
import { parseTicketDate } from '../utils/pdfParser.ts';
import { round2 } from '../utils/sheetUtils.ts';

export interface TicketStatusSummary {
  ok: number;
  review: number;
  error: number;
}

type SheetCell = string | number | Date;

/**
 * Renderiza el Dashboard completo en la pestaña 'Análisis' de Google Sheets.
 * Diseño de posiciones fijas en la parte superior para que el crecimiento del histórico
 * de tickets nunca desplace los gráficos ni las tablas de Top 10 / Top 40.
 */
export function renderAnalyticsDashboard(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  data: AnalyticsDashboardData,
  statusSummary?: TicketStatusSummary
): void {
  // 1. Limpiar hoja, reglas condicionales y gráficos previos
  sheet.clear();
  sheet.clearConditionalFormatRules();
  for (const c of sheet.getCharts()) {
    sheet.removeChart(c);
  }
  sheet.setFrozenRows(0);

  const BRAND_GREEN = '#007A3D';
  const ACCENT_GREEN = '#2E7D32';
  const HEADER_GRAY = '#F4F6F8';
  const BORDER_COLOR = '#D0D7DE';
  const ALERT_RED_BG = '#FFEBEE';
  const WARN_AMBER_BG = '#FFF8E1';
  const OK_GREEN_BG = '#E8F5E9';

  const conditionalRules: GoogleAppsScript.Spreadsheet.ConditionalFormatRule[] = [];

  // -------------------------------------------------------------
  // SECCIÓN 1: CABECERA Y TARJETAS MÉTRICAS (KPIs) — Filas 2 a 5
  // -------------------------------------------------------------
  sheet
    .getRange('B2:L2')
    .merge()
    .setValue('🛒 DASHBOARD DE COMPRAS E INFLACIÓN · MERCADONA')
    .setFontSize(15)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground(BRAND_GREEN)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 36);

  // Tarjeta 1: Gasto Total
  sheet
    .getRange('B4:C4')
    .merge()
    .setValue('GASTO TOTAL ACUMULADO')
    .setFontSize(9)
    .setFontWeight('bold')
    .setFontColor('#555555')
    .setBackground(HEADER_GRAY)
    .setHorizontalAlignment('center');
  sheet
    .getRange('B5:C5')
    .merge()
    .setValue(data.totalSpend)
    .setNumberFormat('#,##0.00 €')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(BRAND_GREEN)
    .setBackground('#FFFFFF')
    .setHorizontalAlignment('center');

  // Tarjeta 2: Nº Tickets
  sheet
    .getRange('D4:E4')
    .merge()
    .setValue('Nº DE COMPRAS')
    .setFontSize(9)
    .setFontWeight('bold')
    .setFontColor('#555555')
    .setBackground(HEADER_GRAY)
    .setHorizontalAlignment('center');
  sheet
    .getRange('D5:E5')
    .merge()
    .setValue(data.totalTickets)
    .setNumberFormat('#,##0')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor('#1F2937')
    .setBackground('#FFFFFF')
    .setHorizontalAlignment('center');

  // Tarjeta 3: Precio Medio por Ticket
  sheet
    .getRange('F4:G4')
    .merge()
    .setValue('PRECIO MEDIO / TICKET')
    .setFontSize(9)
    .setFontWeight('bold')
    .setFontColor('#555555')
    .setBackground(HEADER_GRAY)
    .setHorizontalAlignment('center');
  sheet
    .getRange('F5:G5')
    .merge()
    .setValue(data.averageTicket)
    .setNumberFormat('#,##0.00 €')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(ACCENT_GREEN)
    .setBackground('#FFFFFF')
    .setHorizontalAlignment('center');

  // Tarjeta 4: Gasto Medio Mensual
  sheet
    .getRange('H4:I4')
    .merge()
    .setValue('GASTO MEDIO MENSUAL')
    .setFontSize(9)
    .setFontWeight('bold')
    .setFontColor('#555555')
    .setBackground(HEADER_GRAY)
    .setHorizontalAlignment('center');
  sheet
    .getRange('H5:I5')
    .merge()
    .setValue(data.averageMonthlySpend)
    .setNumberFormat('#,##0.00 €')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor('#1F2937')
    .setBackground('#FFFFFF')
    .setHorizontalAlignment('center');

  // Tarjeta 5: Estado de Verificación (conciliación en hoja 'Tickets')
  const issuesCount = (statusSummary?.review ?? 0) + (statusSummary?.error ?? 0);
  const statusText = statusSummary
    ? issuesCount === 0
      ? `✅ ${statusSummary.ok} OK (100% cuadrados)`
      : `⚠️ ${issuesCount} a revisar (ver 'Tickets')`
    : `${data.totalTickets} tickets`;
  const statusBg = statusSummary && issuesCount > 0 ? WARN_AMBER_BG : OK_GREEN_BG;

  sheet
    .getRange('J4:L4')
    .merge()
    .setValue('AUDITORÍA DE IMPORTES')
    .setFontSize(9)
    .setFontWeight('bold')
    .setFontColor('#555555')
    .setBackground(HEADER_GRAY)
    .setHorizontalAlignment('center');
  sheet
    .getRange('J5:L5')
    .merge()
    .setValue(statusText)
    .setFontSize(11)
    .setFontWeight('bold')
    .setFontColor(issuesCount > 0 ? '#B45309' : BRAND_GREEN)
    .setBackground(statusBg)
    .setHorizontalAlignment('center');

  for (const cardRange of ['B4:C5', 'D4:E5', 'F4:G5', 'H4:I5', 'J4:L5']) {
    sheet
      .getRange(cardRange)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  // -------------------------------------------------------------
  // SECCIÓN 2: ZONA RESERVADA PARA LOS 2 GRÁFICOS SUPERIORES (Filas 7 a 24)
  // Se construyen e insertan tras volcar las tablas inferiores de respaldo.
  // -------------------------------------------------------------
  const chartsTopRow = 7;

  // -------------------------------------------------------------
  // SECCIÓN 3: TOP 10 MÁS COMPRADOS (Izq) y TOP 10 ABANDONADOS (Der) — Fila 26
  // -------------------------------------------------------------
  const top10StartRow = data.tickets.length > 0 ? 26 : 8;

  // Izquierda (Col B a F): Top 10 más comprados
  sheet
    .getRange(top10StartRow, 2, 1, 5)
    .merge()
    .setValue('⭐ TOP 10 PRODUCTOS MÁS COMPRADOS (sin bolsas)')
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground(BRAND_GREEN);

  const top10Headers = ['Producto', 'Unidad', 'Compras', 'Cantidad Total', 'Gasto Total (€)'];
  sheet
    .getRange(top10StartRow + 1, 2, 1, 5)
    .setValues([top10Headers])
    .setFontWeight('bold')
    .setBackground(HEADER_GRAY);

  const top10Rows: SheetCell[][] = data.top10MostPurchased.map((p) => [
    p.productName,
    p.unit,
    p.timesPurchased,
    p.totalQuantity,
    p.totalAmountSpent,
  ]);

  if (top10Rows.length > 0) {
    sheet.getRange(top10StartRow + 2, 2, top10Rows.length, 5).setValues(top10Rows);
    sheet.getRange(top10StartRow + 2, 5, top10Rows.length, 1).setNumberFormat('#,##0.###');
    sheet.getRange(top10StartRow + 2, 6, top10Rows.length, 1).setNumberFormat('#,##0.00 €');
    sheet
      .getRange(top10StartRow + 1, 2, top10Rows.length + 1, 5)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  } else {
    sheet
      .getRange(top10StartRow + 2, 2, 1, 5)
      .merge()
      .setValue('Aún no hay productos importados')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
  }

  // Derecha (Col H a L): Top 10 productos recurrentes abandonados
  sheet
    .getRange(top10StartRow, 8, 1, 5)
    .merge()
    .setValue('⚠️ TOP 10 PRODUCTOS RECURRENTES QUE DEJASTE DE COMPRAR')
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#C62828');

  const abandonedHeaders = [
    'Producto',
    'Compras previas',
    'Ritmo habitual',
    'Última compra',
    'Días sin comprar',
  ];
  sheet
    .getRange(top10StartRow + 1, 8, 1, 5)
    .setValues([abandonedHeaders])
    .setFontWeight('bold')
    .setBackground(HEADER_GRAY);

  const abandonedRows: SheetCell[][] = data.top10Abandoned.map((a) => [
    a.productName,
    a.timesPurchased,
    `cada ~${a.usualIntervalDays} días`,
    parseTicketDate(a.lastPurchasedDate) ?? a.lastPurchasedDate,
    a.daysSinceLastPurchase,
  ]);

  if (abandonedRows.length > 0) {
    sheet
      .getRange(top10StartRow + 2, 8, abandonedRows.length, 5)
      .setValues(abandonedRows)
      .setBackground(ALERT_RED_BG);
    sheet.getRange(top10StartRow + 2, 11, abandonedRows.length, 1).setNumberFormat('dd/mm/yyyy');
    sheet
      .getRange(top10StartRow + 1, 8, abandonedRows.length + 1, 5)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  } else {
    sheet
      .getRange(top10StartRow + 2, 8, 1, 5)
      .merge()
      .setValue('No se detectan productos recurrentes abandonados actualmente')
      .setFontStyle('italic')
      .setHorizontalAlignment('center');
  }

  // -------------------------------------------------------------
  // SECCIÓN 4: 40 PRODUCTOS MÁS COMPRADOS E INFLACIÓN (Col B a K)
  // -------------------------------------------------------------
  const top40StartRow = top10StartRow + Math.max(top10Rows.length, abandonedRows.length, 1) + 4;

  sheet
    .getRange(top40StartRow, 2, 1, 10)
    .merge()
    .setValue('📈 HISTÓRICO DE PRECIOS E INFLACIÓN · 40 PRODUCTOS MÁS COMPRADOS')
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground(BRAND_GREEN);

  const top40Headers = [
    'Producto',
    'Unidad',
    'Compras',
    'Precio Último',
    'Fecha Último',
    'Precio Máximo',
    'Fecha Máximo',
    'Precio Mínimo',
    'Fecha Mínimo',
    '% Variación',
  ];
  sheet
    .getRange(top40StartRow + 1, 2, 1, 10)
    .setValues([top40Headers])
    .setFontWeight('bold')
    .setBackground(HEADER_GRAY);

  const top40Rows: SheetCell[][] = data.top40ProductsInflation.map((p) => [
    p.productName,
    p.unit === 'kg' ? '€/kg' : '€/ud',
    p.timesPurchased,
    p.lastPrice,
    parseTicketDate(p.lastDate) ?? p.lastDate,
    p.maxPrice,
    parseTicketDate(p.maxDate) ?? p.maxDate,
    p.minPrice,
    parseTicketDate(p.minDate) ?? p.minDate,
    p.priceChangePct / 100,
  ]);

  if (top40Rows.length > 0) {
    sheet.getRange(top40StartRow + 2, 2, top40Rows.length, 10).setValues(top40Rows);
    sheet.getRange(top40StartRow + 2, 5, top40Rows.length, 1).setNumberFormat('#,##0.00 €');
    sheet.getRange(top40StartRow + 2, 6, top40Rows.length, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(top40StartRow + 2, 7, top40Rows.length, 1).setNumberFormat('#,##0.00 €');
    sheet.getRange(top40StartRow + 2, 8, top40Rows.length, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(top40StartRow + 2, 9, top40Rows.length, 1).setNumberFormat('#,##0.00 €');
    sheet.getRange(top40StartRow + 2, 10, top40Rows.length, 1).setNumberFormat('dd/mm/yyyy');

    const pctRange = sheet.getRange(top40StartRow + 2, 11, top40Rows.length, 1);
    pctRange.setNumberFormat('+0.0%;-0.0%;0.0%');

    // Colorear subidas (>0%) en rojo suave y bajadas (<0%) en verde suave
    conditionalRules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0.001)
        .setBackground(ALERT_RED_BG)
        .setFontColor('#B71C1C')
        .setRanges([pctRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(-0.001)
        .setBackground(OK_GREEN_BG)
        .setFontColor('#1B5E20')
        .setRanges([pctRange])
        .build()
    );

    sheet
      .getRange(top40StartRow + 1, 2, top40Rows.length + 1, 10)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  // -------------------------------------------------------------
  // SECCIÓN 5: HISTÓRICO DE TICKETS POR FECHA (Izq) y RESUMEN MENSUAL (Der)
  // Ubicados al final para crecer sin límite sin desplazar el Dashboard superior
  // -------------------------------------------------------------
  const historyStartRow = top40StartRow + Math.max(top40Rows.length, 1) + 4;

  // Izquierda (Col B a F): Tabla completa de tickets (más reciente arriba)
  sheet
    .getRange(historyStartRow, 2, 1, 5)
    .merge()
    .setValue('📋 HISTÓRICO DE TICKETS POR FECHA')
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground(ACCENT_GREEN);

  const ticketHeaders = ['Fecha y Hora', 'Nº Factura', 'Tienda', 'Importe (€)', 'Comprobante PDF'];
  sheet
    .getRange(historyStartRow + 1, 2, 1, 5)
    .setValues([ticketHeaders])
    .setFontWeight('bold')
    .setBackground(HEADER_GRAY);

  const ticketRows: SheetCell[][] = data.tickets.map((t) => {
    const rawLabel = t.pdfFileName && t.pdfFileName !== 'RichTextValue' ? t.pdfFileName : 'PDF';
    return [
      parseTicketDate(t.dateTime) ?? t.dateTime,
      t.invoiceNumber,
      t.storeName,
      t.totalAmount,
      t.pdfFileUrl ? 'Ver PDF' : rawLabel,
    ];
  });

  if (ticketRows.length > 0) {
    sheet.getRange(historyStartRow + 2, 2, ticketRows.length, 5).setValues(ticketRows);
    sheet.getRange(historyStartRow + 2, 2, ticketRows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(historyStartRow + 2, 5, ticketRows.length, 1).setNumberFormat('#,##0.00 €');

    // Enlaces nativos de Google Sheets (inmunes al idioma y sin fórmulas #ERROR!)
    const linkRtvs: GoogleAppsScript.Spreadsheet.RichTextValue[][] = data.tickets.map((t) => {
      if (t.pdfFileUrl) {
        return [SpreadsheetApp.newRichTextValue().setText('Ver PDF').setLinkUrl(t.pdfFileUrl).build()];
      }
      const rawLabel = t.pdfFileName && t.pdfFileName !== 'RichTextValue' ? t.pdfFileName : 'PDF';
      return [SpreadsheetApp.newRichTextValue().setText(rawLabel).build()];
    });
    sheet.getRange(historyStartRow + 2, 6, linkRtvs.length, 1).setRichTextValues(linkRtvs);

    sheet
      .getRange(historyStartRow + 1, 2, ticketRows.length + 1, 5)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  // Derecha (Col H a K): Resumen mensual en orden cronológico (antiguo -> reciente)
  sheet
    .getRange(historyStartRow, 8, 1, 4)
    .merge()
    .setValue('📅 EVOLUCIÓN DE GASTO POR MES')
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground(ACCENT_GREEN);

  const monthlyHeaders = ['Mes', 'Compras', 'Gasto Mensual (€)', 'Ticket Medio (€)'];
  sheet
    .getRange(historyStartRow + 1, 8, 1, 4)
    .setValues([monthlyHeaders])
    .setFontWeight('bold')
    .setBackground(HEADER_GRAY);

  const monthlyRows: SheetCell[][] = data.monthlySpend.map((m) => [
    m.label,
    m.ticketCount,
    m.totalAmount,
    m.ticketCount > 0 ? round2(m.totalAmount / m.ticketCount) : 0,
  ]);

  if (monthlyRows.length > 0) {
    sheet.getRange(historyStartRow + 2, 8, monthlyRows.length, 4).setValues(monthlyRows);
    sheet.getRange(historyStartRow + 2, 10, monthlyRows.length, 2).setNumberFormat('#,##0.00 €');
    sheet
      .getRange(historyStartRow + 1, 8, monthlyRows.length + 1, 4)
      .setBorder(true, true, true, true, true, true, BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  }

  // -------------------------------------------------------------
  // CONSTRUCCIÓN DE LOS 2 GRÁFICOS EN LA PARTE SUPERIOR (Filas 7 a 24)
  // -------------------------------------------------------------
  if (ticketRows.length > 0) {
    // Gráfico 1: Evolución por ticket sobre eje temporal real (Fechas reales -> orden cronológico automático)
    const ticketChart = sheet
      .newChart()
      .asLineChart()
      .addRange(sheet.getRange(historyStartRow + 1, 2, ticketRows.length + 1, 1))
      .addRange(sheet.getRange(historyStartRow + 1, 5, ticketRows.length + 1, 1))
      .setPosition(chartsTopRow, 2, 0, 0)
      .setOption('title', 'Importe de cada Compra por Fecha (€)')
      .setOption('colors', [BRAND_GREEN])
      .setOption('legend', { position: 'none' })
      .setOption('pointSize', 5)
      .setOption('lineWidth', 2)
      .setOption('vAxis', { title: 'Importe (€)', minValue: 0 })
      .setOption('hAxis', { title: 'Fecha', format: 'dd/MM/yy' })
      .setOption('width', 540)
      .setOption('height', 320)
      .build();

    sheet.insertChart(ticketChart);
  }

  if (monthlyRows.length > 0) {
    // Gráfico 2: Gasto mensual acumulado en orden cronológico (antiguo -> reciente)
    const monthlyChart = sheet
      .newChart()
      .asColumnChart()
      .addRange(sheet.getRange(historyStartRow + 1, 8, monthlyRows.length + 1, 1))
      .addRange(sheet.getRange(historyStartRow + 1, 10, monthlyRows.length + 1, 1))
      .setPosition(chartsTopRow, 8, 0, 0)
      .setOption('title', 'Gasto Total por Mes (€)')
      .setOption('colors', [ACCENT_GREEN])
      .setOption('legend', { position: 'none' })
      .setOption('vAxis', { title: 'Total Mes (€)', minValue: 0 })
      .setOption('hAxis', { title: 'Mes' })
      .setOption('width', 540)
      .setOption('height', 320)
      .build();

    sheet.insertChart(monthlyChart);
  }

  if (conditionalRules.length > 0) {
    sheet.setConditionalFormatRules(conditionalRules);
  }

  // Ajustar anchuras de columnas para lectura cómoda en escritorio y móvil
  sheet.autoResizeColumns(2, 11);
  sheet.setColumnWidth(1, 24);
  sheet.setColumnWidth(7, 28);
}
