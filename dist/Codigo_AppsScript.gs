/**
 * ============================================================================
 * SISTEMA DE AUTOMATIZACIÓN Y ANALÍTICA DE TICKETS DE MERCADONA
 * Generado automáticamente para Google Apps Script (V8).
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Archivo fuente: utils/sheetUtils.ts
// ----------------------------------------------------------------------------
/**
 * Utilidades puras (sin dependencias de Google) reutilizadas por servicios y vistas.
 */
/** Redondea a 2 decimales evitando errores de coma flotante. */
function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
/**
 * Construye una fórmula HYPERLINK con separador de coma (sintaxis que exige Apps Script
 * independientemente de la configuración regional de la hoja).
 */
function buildHyperlinkFormula(url, label) {
    const esc = (s) => s.replace(/"/g, '""');
    return `=HYPERLINK("${esc(url)}","${esc(label)}")`;
}
/**
 * Extrae URL y texto de una fórmula HYPERLINK, aceptando separador ',' o ';'.
 */
function parseHyperlinkFormula(formula) {
    const match = formula.match(/^=HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[;,]\s*"((?:[^"]|"")*)"\s*\)$/i);
    if (!match || match[1] === undefined || match[2] === undefined)
        return null;
    const unesc = (s) => s.replace(/""/g, '"');
    return { url: unesc(match[1]), label: unesc(match[2]) };
}
/** Formatea una fecha como 'dd/mm/aaaa hh:mm' usando la hora local. */
function formatDateEs(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ----------------------------------------------------------------------------
// Archivo fuente: utils/pdfParser.ts
// ----------------------------------------------------------------------------
/**
 * Convierte un número escrito en formato español ("1,30" / "1.234,56") o con punto decimal
 * ("1.300" que devuelve el OCR) a número de JavaScript.
 */
function parseSpanishNumber(val) {
    if (!val)
        return 0;
    let s = val.trim();
    // Si hay coma, la coma es el decimal y los puntos son separadores de miles.
    // Si no hay coma, el punto es el decimal (formato que a veces devuelve el OCR).
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : Math.round(num * 1000) / 1000;
}
/**
 * Normaliza nombres de productos para comparaciones fiables:
 * Quita espacios redundantes y pasa a mayúsculas.
 */
function normalizeProductName(name) {
    return name.replace(/\s+/g, ' ').trim().toUpperCase();
}
/**
 * Convierte 'dd/mm/aaaa hh:mm' en un objeto Date (hora local). Devuelve null si no es válido.
 */
function parseTicketDate(dateTime) {
    const m = dateTime.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!m || !m[1] || !m[2] || !m[3])
        return null;
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0);
    return isNaN(d.getTime()) ? null : d;
}
// Cabecera de la tabla de productos (también se repite en tickets de varias páginas).
const HEADER_SOURCE = '(?:Cnt\\.?\\s*)?Descripci[oó]n\\s+(?:P\\.\\s*Unit\\.?\\s+)?Importe';
const NUM2 = '-?\\d+[,.]\\d{2}';
const NUM3 = '\\d+[,.]\\d{3}';
/**
 * Expresión que reconoce cada artículo dentro del bloque de productos (texto continuo):
 *  - Grupo 1: cantidad (opcional; los descuentos no la llevan).
 *  - Grupo 2: nombre del producto (cualquier carácter).
 *  - Grupos 3-5: artículo al peso → kg, €/kg, importe.
 *  - Grupos 6-7: varias unidades → precio unitario, importe.
 *  - Grupo 8: una unidad o descuento → importe.
 */
const ITEM_SOURCE = `(?:(-?\\d+)\\s+)?(\\S.*?)\\s+` +
    `(?:(${NUM3})\\s*kg\\s+(${NUM2})\\s*(?:€|EUR|E)?\\s*\\/\\s*kg\\s+(${NUM2})` +
    `|(${NUM2})\\s+(${NUM2})` +
    `|(${NUM2}))` +
    `(?=\\s+\\S|\\s*$)`;
/**
 * Parsea el texto extraído de un ticket PDF de Mercadona.
 * Funciona tanto con texto línea a línea como con el texto continuo que devuelve el OCR de Drive.
 */
function parseMercadonaTicketText(rawText, fileName = '') {
    const text = rawText.replace(/\u00a0/g, ' ');
    const warnings = [];
    // 1. Fecha y hora (ej: 03/11/2026 19:19)
    let dateTime = '';
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
    if (dateMatch && dateMatch[1] && dateMatch[2]) {
        dateTime = `${dateMatch[1]} ${dateMatch[2]}`;
    }
    else {
        warnings.push('No se encontró la fecha del ticket');
    }
    // 2. Factura simplificada (ej: 3826-011-665994)
    let invoiceNumber = '';
    const invoiceMatch = text.match(/FACTURA\s+SIMPLIFICADA:?\s*([0-9A-Za-z\-_]+)/i);
    if (invoiceMatch && invoiceMatch[1]) {
        invoiceNumber = invoiceMatch[1].trim();
    }
    else {
        warnings.push('No se encontró el número de factura');
    }
    // 3. Tienda (dirección + ciudad)
    // Restringir la búsqueda estrictamente a la cabecera (antes de la factura simplificada o lista de productos)
    // para evitar capturar nombres de artículos que contengan abreviaturas de calle (ej. 'C/ 4,00 1 FILETE...')
    let storeName = 'Mercadona';
    const headerCutoff = Math.min(invoiceMatch?.index ?? text.length, dateMatch?.index ?? text.length, 450);
    const headerSection = text.substring(0, headerCutoff > 0 ? headerCutoff : 450);
    const cityMatch = headerSection.match(/\b(\d{5})\s+([A-Za-zÁÉÍÓÚÜáéíóúüÑñ\- ]{2,30})/);
    const city = cityMatch && cityMatch[2] ? cityMatch[2].trim().replace(/\s+/g, ' ') : '';
    const addressMatch = headerSection.match(/(?:AVDA\.?|AV\.?|AVENIDA|C\/|C\.|CALLE|PLAZA|PZA\.?|CTRA\.?|CARRETERA|PASEO|P\.º|RONDA|CAMINO|GRAN VIA|TRAVESIA)\s+[^\r\n]{3,60}/i);
    let address = addressMatch ? addressMatch[0].trim().replace(/\s+/g, ' ') : '';
    // Si no tiene prefijo conocido pero hay una línea entre el CIF de Mercadona y el código postal:
    if (!address) {
        const fallbackMatch = headerSection.match(/(?:A-\d{8}|MERCADONA[^\r\n]*)\s*\r?\n\s*([^\r\n]{3,60})\s*\r?\n\s*\d{5}/i);
        if (fallbackMatch && fallbackMatch[1]) {
            address = fallbackMatch[1].trim().replace(/\s+/g, ' ');
        }
    }
    if (address && city) {
        storeName = `${address} (${city})`;
    }
    else if (address) {
        storeName = address;
    }
    else if (city) {
        storeName = `Mercadona (${city})`;
    }
    // 4. Bloque de productos: desde la cabecera hasta el primer TOTAL posterior
    let totalAmount = 0;
    const items = [];
    const headerMatch = new RegExp(HEADER_SOURCE, 'i').exec(text);
    if (!headerMatch) {
        warnings.push('No se encontró la cabecera de la lista de productos');
    }
    else {
        const afterHeader = text.substring(headerMatch.index + headerMatch[0].length);
        const totalMatch = /TOTAL\s*(?:\(€\))?\s*(-?\d+[,.]\d{2})/i.exec(afterHeader);
        let blockRaw = afterHeader;
        if (totalMatch && totalMatch[1]) {
            totalAmount = parseSpanishNumber(totalMatch[1]);
            blockRaw = afterHeader.substring(0, totalMatch.index);
        }
        else {
            warnings.push('No se encontró el TOTAL del ticket');
        }
        // Quitar cabeceras repetidas (tickets de varias páginas) y normalizar espacios
        const block = blockRaw
            .replace(new RegExp(HEADER_SOURCE, 'gi'), ' ')
            .replace(/\s+/g, ' ')
            .trim();
        for (const m of block.matchAll(new RegExp(ITEM_SOURCE, 'gi'))) {
            const qty = m[1] ? parseInt(m[1], 10) : 1;
            const name = normalizeProductName(m[2] ?? '');
            if (!name)
                continue;
            if (m[3] && m[4] && m[5]) {
                // Producto al peso
                items.push({
                    productName: name,
                    quantity: parseSpanishNumber(m[3]),
                    unitPrice: parseSpanishNumber(m[4]),
                    amount: parseSpanishNumber(m[5]),
                    unit: 'kg',
                    isWeighted: true,
                });
            }
            else if (m[6] && m[7]) {
                // Varias unidades con precio unitario impreso
                items.push({
                    productName: name,
                    quantity: qty,
                    unitPrice: parseSpanishNumber(m[6]),
                    amount: parseSpanishNumber(m[7]),
                    unit: 'ud',
                    isWeighted: false,
                });
            }
            else if (m[8]) {
                // Una unidad, o línea de descuento/devolución (importe negativo)
                const amount = parseSpanishNumber(m[8]);
                items.push({
                    productName: name,
                    quantity: qty,
                    unitPrice: qty !== 0 ? round2(amount / qty) : amount,
                    amount,
                    unit: 'ud',
                    isWeighted: false,
                });
            }
        }
    }
    if (items.length === 0) {
        warnings.push('No se ha podido leer ningún producto');
    }
    // Si no aparece el total impreso, usamos la suma de productos (y queda avisado)
    if (totalAmount === 0 && items.length > 0) {
        totalAmount = round2(items.reduce((acc, it) => acc + it.amount, 0));
    }
    return {
        invoiceNumber: invoiceNumber || (fileName ? fileName.replace(/\.pdf$/i, '') : 'TICKET-DESCONOCIDO'),
        dateTime,
        storeName,
        totalAmount,
        items,
        warnings,
        rawPdfFileName: fileName,
    };
}
/**
 * Verifica que lo leído cuadra: la suma de los productos debe coincidir al céntimo
 * con el total impreso en el ticket y no debe haber avisos de lectura.
 */
function validateTicket(ticket) {
    const itemsSum = round2(ticket.items.reduce((acc, it) => acc + it.amount, 0));
    const difference = round2(ticket.totalAmount - itemsSum);
    const observations = [...ticket.warnings];
    if (Math.abs(difference) >= 0.01) {
        observations.push(`La suma de productos (${itemsSum.toFixed(2)} €) no coincide con el total (${ticket.totalAmount.toFixed(2)} €)`);
    }
    return {
        status: observations.length === 0 ? 'OK' : 'REVISAR',
        itemsSum,
        difference,
        itemCount: ticket.items.length,
        observations: observations.join('. '),
    };
}

// ----------------------------------------------------------------------------
// Archivo fuente: services/statusService.ts
// ----------------------------------------------------------------------------
const STATUS_KEYS = {
    state: 'STATUS_STATE',
    action: 'STATUS_ACTION',
    progress: 'STATUS_PROGRESS',
    lastUpdate: 'STATUS_LAST_UPDATE',
    lastRun: 'STATUS_LAST_RUN',
    logs: 'STATUS_LOGS',
};
const MAX_LOGS = 15;
/**
 * Registra un evento en el histórico de actividad reciente del sistema.
 */
function logActivity(event, detail, status = 'INFO') {
    const props = PropertiesService.getScriptProperties();
    const now = new Date();
    const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Europe/Madrid', 'dd/MM/yyyy HH:mm:ss');
    const rawLogs = props.getProperty(STATUS_KEYS.logs);
    let logs = [];
    if (rawLogs) {
        try {
            logs = JSON.parse(rawLogs);
        }
        catch {
            logs = [];
        }
    }
    logs.unshift({
        timestamp: timeStr,
        event,
        detail,
        status,
    });
    if (logs.length > MAX_LOGS) {
        logs = logs.slice(0, MAX_LOGS);
    }
    props.setProperty(STATUS_KEYS.logs, JSON.stringify(logs));
}
/**
 * Actualiza el estado de ejecución global (consultable en tiempo real).
 */
function setExecutionStatus(state, action, progressMsg) {
    const props = PropertiesService.getScriptProperties();
    const now = new Date();
    const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Europe/Madrid', 'dd/MM/yyyy HH:mm:ss');
    props.setProperties({
        [STATUS_KEYS.state]: state,
        [STATUS_KEYS.action]: action,
        [STATUS_KEYS.progress]: progressMsg,
        [STATUS_KEYS.lastUpdate]: timeStr,
        ...(state === 'EN_REPOSO' ? { [STATUS_KEYS.lastRun]: timeStr } : {}),
    });
}
/**
 * Obtiene el estado actual de ejecución y los últimos registros de actividad.
 */
function getExecutionStatus() {
    const props = PropertiesService.getScriptProperties();
    const state = props.getProperty(STATUS_KEYS.state) || 'EN_REPOSO';
    const currentAction = props.getProperty(STATUS_KEYS.action) || 'Sistema en espera';
    const progressMsg = props.getProperty(STATUS_KEYS.progress) || 'Sin operaciones en curso';
    const lastUpdate = props.getProperty(STATUS_KEYS.lastUpdate) || 'Sin registrar';
    const lastExecutionDate = props.getProperty(STATUS_KEYS.lastRun) || 'Sin registrar';
    const rawLogs = props.getProperty(STATUS_KEYS.logs);
    let logs = [];
    if (rawLogs) {
        try {
            logs = JSON.parse(rawLogs);
        }
        catch {
            logs = [];
        }
    }
    return {
        state,
        currentAction,
        progressMsg,
        lastUpdate,
        lastExecutionDate,
        logs,
    };
}
/**
 * Muestra una notificación emergente nativa (toast) en la esquina inferior derecha de Google Sheets.
 */
function showFloatingToast(message, title = '🛒 Mercadona', timeoutSec = 5) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (ss) {
            ss.toast(message, title, timeoutSec);
        }
    }
    catch {
        // Si corre en segundo plano sin ventana activa, se ignora silenciosamente
    }
}

// ----------------------------------------------------------------------------
// Archivo fuente: services/analyticsService.ts
// ----------------------------------------------------------------------------
/**
 * Productos accesorios excluidos por defecto de los rankings de consumo (Top 10, Abandonados y Top 40)
 * para que bolsas o parking no distorsionen tus hábitos reales de compra.
 * Sí se suman siempre al importe total de cada ticket.
 */
const DEFAULT_EXCLUDED_PRODUCTS = [
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
function parseDateToTimestamp(dateStr) {
    if (!dateStr)
        return 0;
    const parsed = parseTicketDate(dateStr);
    if (parsed)
        return parsed.getTime();
    const fallback = Date.parse(dateStr);
    return isNaN(fallback) ? 0 : fallback;
}
function isAccessoryOrDiscount(productName, amount, excludedSet) {
    if (amount <= 0)
        return true;
    const upper = productName.trim().toUpperCase();
    if (excludedSet.has(upper))
        return true;
    if (/^(?:DESCUENTO|BAJADA\s+DE\s+PRECIO|PROMO\b)/i.test(upper))
        return true;
    return false;
}
/**
 * Calcula todas las métricas del Dashboard a partir de las filas de la hoja 'Lista'.
 */
function computeAnalyticsFromRows(rows, options = {}) {
    const minPurchases = options.minPurchasesForAbandoned ?? 3;
    const minDaysInactive = options.minDaysInactiveForAbandoned ?? 30;
    const intervalMultiplier = options.abandonedIntervalMultiplier ?? 3;
    const fallbackInactiveDays = options.daysInactiveForAbandoned ?? 60;
    const refTime = options.referenceTimestamp ?? Date.now();
    const excludedSet = new Set((options.excludedProducts ?? DEFAULT_EXCLUDED_PRODUCTS).map((p) => p.trim().toUpperCase()));
    // 1. Agrupar por ticket (Factura) para totales y lista de tickets
    const ticketsMap = new Map();
    // 2. Agrupar por producto para estadísticas de hábitos e inflación
    const productsMap = new Map();
    for (const r of rows) {
        if (!r.productName || !r.invoiceNumber)
            continue;
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
        }
        else {
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
    const ticketsList = Array.from(ticketsMap.values()).sort((a, b) => parseDateToTimestamp(b.dateTime) - parseDateToTimestamp(a.dateTime));
    const totalSpend = round2(ticketsList.reduce((acc, t) => acc + t.totalAmount, 0));
    const totalTickets = ticketsList.length;
    const averageTicket = totalTickets > 0 ? round2(totalSpend / totalTickets) : 0;
    // 3. Gasto mensual agrupado en orden cronológico (antiguo -> reciente)
    const monthlyMap = new Map();
    for (const t of ticketsList) {
        const d = parseTicketDate(t.dateTime);
        if (!d)
            continue;
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
        }
        else {
            current.totalAmount = round2(current.totalAmount + t.totalAmount);
            current.ticketCount += 1;
        }
    }
    const monthlySpend = Array.from(monthlyMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const averageMonthlySpend = monthlySpend.length > 0 ? round2(totalSpend / monthlySpend.length) : 0;
    // 4. Estadísticas por producto
    const allProductStats = [];
    const abandonedList = [];
    for (const entry of productsMap.values()) {
        entry.purchases.sort((a, b) => a.timestamp - b.timestamp);
        // Número de tickets distintos en los que se compró (o líneas si hay varias compras)
        const distinctTicketTimestamps = new Map();
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
            if (p.unitPrice <= 0)
                continue;
            if (p.unitPrice > maxPrice) {
                maxPrice = p.unitPrice;
                maxDate = p.dateTime;
            }
            if (p.unitPrice < minPrice) {
                minPrice = p.unitPrice;
                minDate = p.dateTime;
            }
        }
        const lastPurchase = entry.purchases[entry.purchases.length - 1];
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
        const firstPurchase = entry.purchases[0];
        const firstPrice = firstPurchase.unitPrice;
        const priceChangePct = firstPrice > 0 ? Math.round(((lastPrice - firstPrice) / firstPrice) * 1000) / 10 : 0;
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
                const spanDays = (sortedTicketTs[sortedTicketTs.length - 1] - sortedTicketTs[0]) / MS_PER_DAY;
                usualIntervalDays = Math.round(spanDays / (sortedTicketTs.length - 1));
            }
            const daysSinceLast = Math.floor((refTime - lastPurchase.timestamp) / MS_PER_DAY);
            const dynamicThreshold = usualIntervalDays > 0
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

// ----------------------------------------------------------------------------
// Archivo fuente: services/googleService.ts
// ----------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const SENDER = 'ticket_digital@mail.mercadona.com';
const LABEL_OK = 'Mercadona/Procesado';
const LABEL_ERROR = 'Mercadona/Error';
const SHEET_LISTA = 'Lista';
const SHEET_TICKETS = 'Tickets';
const SHEET_CORREOS = '_Correos';
const TICKETS_FOLDER_NAME = 'Archivos_tickets';
/** Ventana de días en la que se revisan también conversaciones ya etiquetadas. */
const RECENT_WINDOW_DAYS = 45;
const STATUS_LABELS = {
    OK: '✅ OK',
    REVISAR: '⚠️ REVISAR',
    ERROR: '❌ ERROR',
};
const LISTA_HEADERS = [
    'Archivo_PDF',
    'Fecha_ticket',
    'Producto',
    'Precio_Kg_o_Ud',
    'Cantidad',
    'Importe',
    'Unidad',
    'Num_Factura',
    'Tienda',
];
const TICKETS_HEADERS = [
    'Fecha',
    'Nº Factura',
    'Tienda',
    'Total ticket (€)',
    'Suma productos (€)',
    'Diferencia (€)',
    'Nº artículos',
    'Estado',
    'Observaciones',
    'PDF',
    'Id correo',
    'Importado el',
];
const CORREOS_HEADERS = ['Id correo', 'Fecha correo', 'Resultado', 'Procesado el'];
// ---------------------------------------------------------------------------
// Hojas, carpeta y etiquetas
// ---------------------------------------------------------------------------
/** Obtiene una hoja (creándola si no existe) y garantiza que tiene las cabeceras indicadas. */
function getOrCreateSheet(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    let created = false;
    if (!sheet) {
        sheet = ss.insertSheet(name);
        created = true;
    }
    // Añade solo las cabeceras que falten (operación aditiva, nunca borra columnas existentes)
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0] ?? [];
    headers.forEach((h, i) => {
        if (!current[i])
            sheet.getRange(1, i + 1).setValue(h);
    });
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (name === SHEET_CORREOS && !sheet.isSheetHidden()) {
        sheet.hideSheet();
    }
    if (name === SHEET_TICKETS && (created || sheet.getConditionalFormatRules().length === 0)) {
        applyTicketsSheetFormat(sheet);
    }
    return sheet;
}
/** Formato visual de la hoja de control 'Tickets' (colores por estado). */
function applyTicketsSheetFormat(sheet) {
    const maxRows = sheet.getMaxRows();
    const statusRange = sheet.getRange(2, 8, maxRows - 1, 1);
    const rules = [
        SpreadsheetApp.newConditionalFormatRule().whenTextContains('OK').setBackground('#E8F5E9').setRanges([statusRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains('REVISAR').setBackground('#FFF3CD').setRanges([statusRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains('ERROR').setBackground('#FFEBEE').setRanges([statusRange]).build(),
    ];
    sheet.setConditionalFormatRules(rules);
    sheet.setColumnWidth(3, 260);
    sheet.setColumnWidth(9, 380);
}
/** Obtiene la subcarpeta 'Archivos_tickets' situada junto al Google Sheets. */
function getOrCreateTicketsFolder() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    const subfolders = parentFolder.getFoldersByName(TICKETS_FOLDER_NAME);
    return subfolders.hasNext() ? subfolders.next() : parentFolder.createFolder(TICKETS_FOLDER_NAME);
}
/** Obtiene o crea una etiqueta de Gmail. */
function getOrCreateLabel(labelName) {
    return GmailApp.getUserLabelByName(labelName) ?? GmailApp.createLabel(labelName);
}
/** Lee los valores no vacíos de una columna (desde la fila 2) como conjunto de textos. */
function readColumnSet(sheet, column) {
    const result = new Set();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1)
        return result;
    for (const row of sheet.getRange(2, column, lastRow - 1, 1).getValues()) {
        const v = String(row[0] ?? '').trim();
        if (v)
            result.add(v);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Lectura del PDF (OCR de Google Drive)
// ---------------------------------------------------------------------------
function executeSingleOcr(blob) {
    const anyGlobal = globalThis;
    let docId = '';
    if (typeof anyGlobal['Drive'] !== 'undefined') {
        const driveService = anyGlobal['Drive'];
        if (typeof driveService.Files.create === 'function') {
            docId = driveService.Files.create({ name: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' }, blob, { fields: 'id', ocrLanguage: 'es' }).id;
        }
        else if (typeof driveService.Files.insert === 'function') {
            docId = driveService.Files.insert({ title: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocr: true, ocrLanguage: 'es' }).id;
        }
    }
    else {
        const boundary = '-------314159265358979323846';
        const body = `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
            JSON.stringify({ title: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' }) +
            `\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
            Utilities.base64Encode(blob.getBytes()) +
            `\r\n--${boundary}--`;
        const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&ocr=true&ocrLanguage=es', {
            method: 'post',
            contentType: 'multipart/related; boundary=' + boundary,
            payload: body,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true,
        });
        if (response.getResponseCode() !== 200) {
            throw new Error(`Fallo en el OCR de Google Drive (código ${response.getResponseCode()}). Activa el servicio 'Drive API' en Apps Script (Servicios + > Drive API > Añadir).`);
        }
        docId = JSON.parse(response.getContentText()).id;
    }
    if (!docId)
        throw new Error('No se pudo crear el documento temporal de OCR.');
    try {
        return DocumentApp.openById(docId).getBody().getText();
    }
    finally {
        DriveApp.getFileById(docId).setTrashed(true);
    }
}
/**
 * Extrae el texto de un PDF convirtiéndolo temporalmente a Google Docs con OCR.
 * Incluye reintento automático de hasta 3 intentos con pausa progresiva para absorber
 * microcortes temporales de Google Drive ('Internal Error').
 */
function extractTextFromPdfBlob(blob) {
    const MAX_RETRIES = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return executeSingleOcr(blob);
        }
        catch (err) {
            lastError = err;
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`Intento de OCR ${attempt}/${MAX_RETRIES} falló: ${errMsg}`);
            if (attempt < MAX_RETRIES) {
                Utilities.sleep(1500 * attempt);
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
// ---------------------------------------------------------------------------
// Escritura en hojas
// ---------------------------------------------------------------------------
/** Añade las líneas de producto de un ticket a la hoja 'Lista' con enlaces nativos (sin fórmulas que den #ERROR!). */
function appendTicketToListaSheet(sheet, ticket, fileUrl, fileName) {
    if (ticket.items.length === 0)
        return;
    const date = parseTicketDate(ticket.dateTime) ?? ticket.dateTime;
    const rows = ticket.items.map((item) => [
        fileName,
        date,
        item.productName,
        item.unitPrice,
        item.quantity,
        item.amount,
        item.unit,
        ticket.invoiceNumber,
        ticket.storeName,
    ]);
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, LISTA_HEADERS.length).setValues(rows);
    // Enlace directo nativo al archivo PDF (inmune al idioma español y separadores)
    if (fileUrl) {
        const rtv = SpreadsheetApp.newRichTextValue().setText(fileName).setLinkUrl(fileUrl).build();
        const rtvs = Array(rows.length).fill(null).map(() => [rtv]);
        sheet.getRange(startRow, 1, rows.length, 1).setRichTextValues(rtvs);
    }
    sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(startRow, 4, rows.length, 1).setNumberFormat('#,##0.00');
    sheet.getRange(startRow, 5, rows.length, 1).setNumberFormat('#,##0.###');
    sheet.getRange(startRow, 6, rows.length, 1).setNumberFormat('#,##0.00');
}
/** Añade una fila de control a la hoja 'Tickets'. */
function appendTicketsRow(sheet, row) {
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, TICKETS_HEADERS.length).setValues([row]);
    sheet.getRange(r, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(r, 4, 1, 3).setNumberFormat('#,##0.00 €');
    sheet.getRange(r, 12).setNumberFormat('dd/mm/yyyy hh:mm');
}
function appendTicketControlRow(sheet, ticket, validation, fileUrl, fileName, messageId) {
    const r = sheet.getLastRow() + 1;
    appendTicketsRow(sheet, [
        parseTicketDate(ticket.dateTime) ?? ticket.dateTime,
        ticket.invoiceNumber,
        ticket.storeName,
        ticket.totalAmount,
        validation.itemsSum,
        validation.difference,
        validation.itemCount,
        STATUS_LABELS[validation.status],
        validation.observations,
        fileName,
        messageId,
        new Date(),
    ]);
    if (fileUrl) {
        const rtv = SpreadsheetApp.newRichTextValue().setText(fileName).setLinkUrl(fileUrl).build();
        sheet.getRange(r, 10).setRichTextValue(rtv);
    }
}
function appendErrorControlRow(sheet, messageDate, fileName, error, messageId) {
    appendTicketsRow(sheet, [
        new Date(messageDate.getTime()),
        '',
        '',
        '',
        '',
        '',
        '',
        STATUS_LABELS.ERROR,
        `${fileName}: ${error}`,
        fileName,
        messageId,
        new Date(),
    ]);
}
function isStopRequested() {
    return PropertiesService.getScriptProperties().getProperty('STOP_REQUESTED') === 'true';
}
function isPdf(att) {
    return att.getContentType() === 'application/pdf' || att.getName().toLowerCase().endsWith('.pdf');
}
/**
 * Busca los correos de Mercadona pendientes. El control se hace correo a correo
 * (por su identificador), no por conversación, para no perder tickets que Gmail
 * agrupe en una conversación ya etiquetada.
 */
function findPendingMessages(knownMessageIds, threadMessageIds, okLabel, options) {
    const candidates = [];
    const seenThreads = new Set();
    const queries = [
        // Recientes: incluye conversaciones ya etiquetadas por si ha llegado un correo nuevo a ellas
        `from:${SENDER} has:attachment newer_than:${RECENT_WINDOW_DAYS}d`,
        // Histórico pendiente: sin etiqueta de procesado ni de error
        `from:${SENDER} has:attachment -label:${LABEL_OK} -label:${LABEL_ERROR}`,
    ];
    const PAGE = 50;
    let searchExhausted = true;
    outer: for (const query of queries) {
        for (let start = 0; start < 2000; start += PAGE) {
            const threads = GmailApp.search(query, start, PAGE);
            if (threads.length === 0)
                break;
            const messagesPerThread = GmailApp.getMessagesForThreads(threads);
            threads.forEach((thread, i) => {
                const threadId = thread.getId();
                if (seenThreads.has(threadId))
                    return;
                seenThreads.add(threadId);
                const messages = messagesPerThread[i] ?? [];
                threadMessageIds.set(threadId, messages.map((m) => m.getId()));
                const pending = messages.filter((m) => !knownMessageIds.has(m.getId()));
                if (pending.length === 0) {
                    // Conversación ya procesada por completo: se etiqueta para que no vuelva a salir
                    thread.addLabel(okLabel);
                    return;
                }
                pending.forEach((message) => candidates.push({ thread, message }));
            });
            if (candidates.length >= options.maxMessages || Date.now() > options.deadline) {
                searchExhausted = false;
                break outer;
            }
            if (threads.length < PAGE)
                break;
        }
    }
    return { candidates, searchExhausted };
}
/**
 * Procesa los correos de tickets pendientes respetando el límite de tiempo y la parada de emergencia.
 */
function processPendingTickets(options) {
    const result = {
        processedCount: 0,
        skippedCount: 0,
        errorsCount: 0,
        reviewCount: 0,
        importedTickets: [],
        remaining: false,
        stoppedByUser: false,
        busy: false,
        messages: [],
    };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const listaSheet = getOrCreateSheet(ss, SHEET_LISTA, LISTA_HEADERS);
    const ticketsSheet = getOrCreateSheet(ss, SHEET_TICKETS, TICKETS_HEADERS);
    const correosSheet = getOrCreateSheet(ss, SHEET_CORREOS, CORREOS_HEADERS);
    const folder = getOrCreateTicketsFolder();
    const okLabel = getOrCreateLabel(LABEL_OK);
    const errorLabel = getOrCreateLabel(LABEL_ERROR);
    const knownMessageIds = readColumnSet(correosSheet, 1);
    const knownInvoices = readColumnSet(ticketsSheet, 2);
    readColumnSet(listaSheet, 8).forEach((inv) => knownInvoices.add(inv));
    const threadMessageIds = new Map();
    const { candidates, searchExhausted } = findPendingMessages(knownMessageIds, threadMessageIds, okLabel, options);
    console.log(`Correos pendientes encontrados en esta vuelta: ${candidates.length}`);
    let handled = 0;
    for (const { thread, message } of candidates) {
        if (handled >= options.maxMessages)
            break;
        if (isStopRequested()) {
            result.stoppedByUser = true;
            result.messages.push('Ejecución detenida por orden del usuario.');
            break;
        }
        if (Date.now() > options.deadline) {
            result.messages.push('Tiempo de ejecución agotado: se continuará en la siguiente vuelta.');
            break;
        }
        const messageId = message.getId();
        const pdfs = message.getAttachments().filter(isPdf);
        let messageResult = pdfs.length === 0 ? 'SIN PDF' : 'OK';
        for (const att of pdfs) {
            const attName = att.getName();
            setExecutionStatus('EJECUTANDO', 'Importando tickets', `Procesando ticket ${handled + 1} de ${candidates.length} (${attName})...`);
            showFloatingToast(`Leyendo ticket ${handled + 1}/${candidates.length}...`, '🛒 Mercadona', 3);
            try {
                const blob = att.copyBlob();
                const ticket = parseMercadonaTicketText(extractTextFromPdfBlob(blob), attName);
                const validation = validateTicket(ticket);
                console.log(`Ticket ${ticket.invoiceNumber}: ${ticket.items.length} artículos, total ${ticket.totalAmount} €, estado ${validation.status}`);
                if (knownInvoices.has(ticket.invoiceNumber)) {
                    result.skippedCount++;
                    messageResult = 'DUPLICADO';
                    continue;
                }
                // Guardar el PDF en Drive sin duplicarlo (y enviar copias duplicadas previas a la papelera de Drive)
                const fileName = `${ticket.invoiceNumber}_${attName}`;
                const existing = folder.getFilesByName(fileName);
                const driveFile = existing.hasNext() ? existing.next() : folder.createFile(blob).setName(fileName);
                while (existing.hasNext()) {
                    existing.next().setTrashed(true);
                }
                appendTicketToListaSheet(listaSheet, ticket, driveFile.getUrl(), fileName);
                appendTicketControlRow(ticketsSheet, ticket, validation, driveFile.getUrl(), fileName, messageId);
                knownInvoices.add(ticket.invoiceNumber);
                result.processedCount++;
                result.importedTickets.push({
                    invoiceNumber: ticket.invoiceNumber,
                    dateTime: ticket.dateTime,
                    totalAmount: ticket.totalAmount,
                    itemCount: validation.itemCount,
                    status: validation.status,
                    observations: validation.observations,
                });
                if (validation.status === 'REVISAR') {
                    result.reviewCount++;
                    messageResult = 'REVISAR';
                }
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.error(`Error procesando ${attName}: ${errMsg}`);
                result.errorsCount++;
                result.messages.push(`Error en ${attName}: ${errMsg}`);
                result.importedTickets.push({
                    invoiceNumber: attName,
                    dateTime: '',
                    totalAmount: 0,
                    itemCount: 0,
                    status: 'ERROR',
                    observations: errMsg,
                });
                appendErrorControlRow(ticketsSheet, message.getDate(), attName, errMsg, messageId);
                messageResult = 'ERROR';
            }
        }
        // Registrar el correo como procesado (sea cual sea el resultado) para no repetirlo nunca
        correosSheet.appendRow([messageId, message.getDate(), messageResult, new Date()]);
        knownMessageIds.add(messageId);
        handled++;
        if (messageResult === 'ERROR') {
            thread.addLabel(errorLabel);
        }
        // Etiquetar la conversación como procesada solo si ya no le queda ningún correo pendiente
        const ids = threadMessageIds.get(thread.getId()) ?? [];
        if (ids.every((id) => knownMessageIds.has(id))) {
            thread.addLabel(okLabel);
        }
        SpreadsheetApp.flush();
    }
    result.remaining = !result.stoppedByUser && (handled < candidates.length || !searchExhausted);
    return result;
}
/** Cuenta los tickets de la hoja 'Tickets' por estado. */
function countTicketsByStatus() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TICKETS);
    const counts = { ok: 0, review: 0, error: 0 };
    if (!sheet || sheet.getLastRow() <= 1)
        return counts;
    for (const row of sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).getValues()) {
        const s = String(row[0] ?? '');
        if (s.includes('REVISAR'))
            counts.review++;
        else if (s.includes('ERROR'))
            counts.error++;
        else if (s.includes('OK'))
            counts.ok++;
    }
    return counts;
}
/**
 * Repara todas las celdas de la hoja 'Lista' y 'Tickets' que contengan fórmulas #ERROR!,
 * textos 'RichTextValue' sin enlace o enlaces antiguos, sustituyéndolos por hipervínculos
 * nativos directos de Google Sheets enlazados al archivo PDF correspondiente en Drive.
 */
function repararEnlacesErrorExistentes() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let listaReparados = 0;
    let ticketsReparados = 0;
    const folder = getOrCreateTicketsFolder();
    // Obtener todos los archivos PDF existentes en la subcarpeta Archivos_tickets
    const allFiles = [];
    const fileIter = folder.getFiles();
    while (fileIter.hasNext()) {
        const f = fileIter.next();
        allFiles.push({ name: f.getName(), url: f.getUrl() });
    }
    function findDriveFile(invoice, rawText) {
        const cleanInvoice = invoice ? invoice.trim() : '';
        if (cleanInvoice) {
            // Coincidencia exacta por número de factura simplificada en el nombre del PDF
            const byInvoice = allFiles.find((f) => f.name.includes(cleanInvoice));
            if (byInvoice)
                return byInvoice;
        }
        const cleanRaw = rawText ? rawText.trim() : '';
        if (cleanRaw && cleanRaw !== 'RichTextValue' && !cleanRaw.includes('ERROR') && cleanRaw !== 'PDF' && cleanRaw !== 'Ver PDF') {
            const byName = allFiles.find((f) => f.name.includes(cleanRaw) || cleanRaw.includes(f.name));
            if (byName)
                return byName;
        }
        return null;
    }
    // 1. Hoja 'Lista' (Columna 1: Archivo_PDF, Columna 8: Num_Factura)
    const listaSheet = ss.getSheetByName(SHEET_LISTA);
    if (listaSheet && listaSheet.getLastRow() > 1) {
        const numRows = listaSheet.getLastRow() - 1;
        const range = listaSheet.getRange(2, 1, numRows, 1);
        const invoiceValues = listaSheet.getRange(2, 8, numRows, 1).getValues();
        const formulas = range.getFormulas();
        const values = range.getValues();
        const richTexts = range.getRichTextValues();
        const rtvs = [];
        let changed = false;
        for (let i = 0; i < numRows; i++) {
            const formula = String(formulas[i]?.[0] ?? '');
            const value = String(values[i]?.[0] ?? '');
            const existingRtv = richTexts[i]?.[0];
            const existingUrl = existingRtv?.getLinkUrl() ?? '';
            const invoice = String(invoiceValues[i]?.[0] ?? '').trim();
            const driveMatch = findDriveFile(invoice, value);
            const parsed = parseHyperlinkFormula(formula);
            if (existingUrl) {
                rtvs.push([existingRtv]);
            }
            else if (driveMatch) {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(driveMatch.name).setLinkUrl(driveMatch.url).build()]);
                changed = true;
                listaReparados++;
            }
            else if (parsed && parsed.url) {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(parsed.label).setLinkUrl(parsed.url).build()]);
                changed = true;
                listaReparados++;
            }
            else if (value.includes('ERROR') && formula) {
                const match = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']\s*[,;]\s*["']([^"']+)["']\s*\)/i);
                if (match && match[1] && match[2]) {
                    rtvs.push([SpreadsheetApp.newRichTextValue().setText(match[2]).setLinkUrl(match[1]).build()]);
                    changed = true;
                    listaReparados++;
                }
                else {
                    rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
                }
            }
            else {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
            }
        }
        if (changed) {
            range.setRichTextValues(rtvs);
        }
    }
    // 2. Hoja 'Tickets' (Columna 2: Nº Factura, Columna 10: PDF)
    const ticketsSheet = ss.getSheetByName(SHEET_TICKETS);
    if (ticketsSheet && ticketsSheet.getLastRow() > 1) {
        const numRows = ticketsSheet.getLastRow() - 1;
        const range = ticketsSheet.getRange(2, 10, numRows, 1);
        const invoiceValues = ticketsSheet.getRange(2, 2, numRows, 1).getValues();
        const formulas = range.getFormulas();
        const values = range.getValues();
        const richTexts = range.getRichTextValues();
        const rtvs = [];
        let changed = false;
        for (let i = 0; i < numRows; i++) {
            const formula = String(formulas[i]?.[0] ?? '');
            const value = String(values[i]?.[0] ?? '');
            const existingRtv = richTexts[i]?.[0];
            const existingUrl = existingRtv?.getLinkUrl() ?? '';
            const invoice = String(invoiceValues[i]?.[0] ?? '').trim();
            const driveMatch = findDriveFile(invoice, value);
            const parsed = parseHyperlinkFormula(formula);
            if (existingUrl) {
                rtvs.push([existingRtv]);
            }
            else if (driveMatch) {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(driveMatch.name).setLinkUrl(driveMatch.url).build()]);
                changed = true;
                ticketsReparados++;
            }
            else if (parsed && parsed.url) {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(parsed.label).setLinkUrl(parsed.url).build()]);
                changed = true;
                ticketsReparados++;
            }
            else if (value.includes('ERROR') && formula) {
                const match = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']\s*[,;]\s*["']([^"']+)["']\s*\)/i);
                if (match && match[1] && match[2]) {
                    rtvs.push([SpreadsheetApp.newRichTextValue().setText(match[2]).setLinkUrl(match[1]).build()]);
                    changed = true;
                    ticketsReparados++;
                }
                else {
                    rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
                }
            }
            else {
                rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
            }
        }
        if (changed) {
            range.setRichTextValues(rtvs);
        }
    }
    return { listaReparados, ticketsReparados };
}
/**
 * Reintenta únicamente los tickets que se quedaron en estado '❌ ERROR' en la hoja Tickets.
 * Lee de nuevo el correo correspondiente de Gmail con el reintento de 3 fases de OCR,
 * sustituye la fila roja por la fila válida y añade los productos a 'Lista'.
 */
function retryFailedTickets() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ticketsSheet = ss.getSheetByName(SHEET_TICKETS);
    const listaSheet = ss.getSheetByName(SHEET_LISTA);
    const folder = getOrCreateTicketsFolder();
    const okLabel = getOrCreateLabel(LABEL_OK);
    const errorLabel = getOrCreateLabel(LABEL_ERROR);
    if (!ticketsSheet || ticketsSheet.getLastRow() <= 1) {
        return { retried: 0, recovered: 0, stillFailing: 0 };
    }
    const numRows = ticketsSheet.getLastRow() - 1;
    const statusValues = ticketsSheet.getRange(2, 8, numRows, 1).getValues();
    // Buscar todas las filas con estado ERROR
    const errorRowIndices = [];
    for (let i = 0; i < numRows; i++) {
        if (String(statusValues[i]?.[0] ?? '').includes('ERROR')) {
            errorRowIndices.push(i + 2);
        }
    }
    if (errorRowIndices.length === 0) {
        return { retried: 0, recovered: 0, stillFailing: 0 };
    }
    let recovered = 0;
    let stillFailing = 0;
    const knownInvoices = readColumnSet(listaSheet ? listaSheet : ticketsSheet, 8);
    for (const rowNum of errorRowIndices) {
        const messageId = String(ticketsSheet.getRange(rowNum, 11).getValue() ?? '').trim();
        if (!messageId) {
            stillFailing++;
            continue;
        }
        try {
            showFloatingToast(`Reintentando ticket en fila ${rowNum}...`, '🛒 Mercadona', 4);
            const msg = GmailApp.getMessageById(messageId);
            const thread = msg.getThread();
            const pdfs = msg.getAttachments().filter(isPdf);
            if (pdfs.length === 0) {
                stillFailing++;
                continue;
            }
            for (const att of pdfs) {
                const attName = att.getName();
                const blob = att.copyBlob();
                const ticket = parseMercadonaTicketText(extractTextFromPdfBlob(blob), attName);
                const validation = validateTicket(ticket);
                const fileName = `${ticket.invoiceNumber}_${attName}`;
                const existing = folder.getFilesByName(fileName);
                const driveFile = existing.hasNext() ? existing.next() : folder.createFile(blob).setName(fileName);
                while (existing.hasNext()) {
                    existing.next().setTrashed(true);
                }
                if (listaSheet && !knownInvoices.has(ticket.invoiceNumber)) {
                    appendTicketToListaSheet(listaSheet, ticket, driveFile.getUrl(), fileName);
                    knownInvoices.add(ticket.invoiceNumber);
                }
                // Sustituir la fila de error en Tickets por la fila válida
                ticketsSheet.getRange(rowNum, 1, 1, TICKETS_HEADERS.length).setValues([[
                        parseTicketDate(ticket.dateTime) ?? ticket.dateTime,
                        ticket.invoiceNumber,
                        ticket.storeName,
                        ticket.totalAmount,
                        validation.itemsSum,
                        validation.difference,
                        validation.itemCount,
                        STATUS_LABELS[validation.status],
                        validation.observations,
                        fileName,
                        messageId,
                        new Date(),
                    ]]);
                const rtv = SpreadsheetApp.newRichTextValue().setText(fileName).setLinkUrl(driveFile.getUrl()).build();
                ticketsSheet.getRange(rowNum, 10).setRichTextValue(rtv);
                thread.removeLabel(errorLabel);
                thread.addLabel(okLabel);
                recovered++;
                logActivity('TICKET_RECUPERADO', `Ticket ${ticket.invoiceNumber} (${ticket.totalAmount} €) recuperado con éxito.`, 'SUCCESS');
            }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`Reintento de mensaje ${messageId} falló: ${errMsg}`);
            ticketsSheet.getRange(rowNum, 9).setValue(`Reintento fallido: ${errMsg}`);
            stillFailing++;
            logActivity('REINTENTO_FALLIDO', `Fila ${rowNum}: ${errMsg}`, 'ERROR');
        }
    }
    return { retried: errorRowIndices.length, recovered, stillFailing };
}

// ----------------------------------------------------------------------------
// Archivo fuente: services/notificationService.ts
// ----------------------------------------------------------------------------
const PROP_EMAIL_ENABLED = 'EMAIL_NOTIFICATIONS_ENABLED';
/** Comprueba si los avisos por correo están activados (activos por defecto). */
function areEmailNotificationsEnabled() {
    const val = PropertiesService.getScriptProperties().getProperty(PROP_EMAIL_ENABLED);
    return val !== 'false';
}
/** Activa o desactiva los avisos por correo electrónico. */
function setEmailNotificationsEnabled(enabled) {
    PropertiesService.getScriptProperties().setProperty(PROP_EMAIL_ENABLED, enabled ? 'true' : 'false');
}
function getRecipientEmail() {
    try {
        return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '';
    }
    catch {
        return '';
    }
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function statusBadgeHtml(status) {
    if (status === 'OK')
        return '<span style="color:#1b5e20;font-weight:bold;">✅ OK</span>';
    if (status === 'REVISAR')
        return '<span style="color:#e65100;font-weight:bold;">⚠️ REVISAR</span>';
    return '<span style="color:#b71c1c;font-weight:bold;">❌ ERROR</span>';
}
/**
 * Envía aviso por email tras importar tickets nuevos o detectar errores
 * (no se llama en tandas intermedias del histórico).
 */
function sendImportNotificationEmail(res, spreadsheetUrl) {
    if (!areEmailNotificationsEnabled())
        return;
    if (res.processedCount === 0 && res.errorsCount === 0)
        return;
    const recipient = getRecipientEmail();
    if (!recipient)
        return;
    const hasIssues = res.errorsCount > 0 || res.reviewCount > 0;
    const subject = hasIssues
        ? `⚠️ Mercadona Tickets: ${res.processedCount} importado(s) · ${res.reviewCount} a revisar · ${res.errorsCount} error(es)`
        : `✅ Mercadona Tickets: ${res.processedCount} nuevo(s) ticket(s) importado(s)`;
    const rowsHtml = res.importedTickets
        .map((t) => `
      <tr>
        <td style="padding:8px;border:1px solid #d0d7de;">${escapeHtml(t.dateTime || '—')}</td>
        <td style="padding:8px;border:1px solid #d0d7de;">${escapeHtml(t.invoiceNumber)}</td>
        <td style="padding:8px;border:1px solid #d0d7de;text-align:right;">${t.status === 'ERROR' ? '—' : `${t.totalAmount.toFixed(2)} €`}</td>
        <td style="padding:8px;border:1px solid #d0d7de;text-align:center;">${t.status === 'ERROR' ? '—' : t.itemCount}</td>
        <td style="padding:8px;border:1px solid #d0d7de;">${statusBadgeHtml(t.status)}</td>
        <td style="padding:8px;border:1px solid #d0d7de;font-size:12px;color:#555;">${escapeHtml(t.observations || 'Cuadra al céntimo')}</td>
      </tr>`)
        .join('');
    const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:720px;color:#1f2937;">
      <div style="background:#007A3D;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🛒 Resumen de Importación · Mercadona</h2>
      </div>
      <div style="border:1px solid #d0d7de;border-top:none;padding:18px;border-radius:0 0 8px 8px;">
        <p style="margin-top:0;">
          <strong>Tickets nuevos importados:</strong> ${res.processedCount} &nbsp;|&nbsp;
          <strong>Para revisar:</strong> ${res.reviewCount} &nbsp;|&nbsp;
          <strong>Errores:</strong> ${res.errorsCount}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:14px 0;">
          <thead>
            <tr style="background:#f4f6f8;">
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Fecha</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Factura</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:right;">Total</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:center;">Artículos</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Verificación</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Detalle</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin-bottom:0;">
          <a href="${escapeHtml(spreadsheetUrl)}" style="display:inline-block;background:#007A3D;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;">
            Abrir Dashboard en Google Sheets
          </a>
        </p>
      </div>
    </div>
  `;
    try {
        MailApp.sendEmail({
            to: recipient,
            subject,
            htmlBody,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`No se pudo enviar el email de notificación: ${msg}`);
    }
}
/**
 * Envía un ÚNICO email con el resumen global cuando finaliza toda la importación histórica.
 */
function sendHistoricalCompleteEmail(summary, spreadsheetUrl, okTotalInSheet) {
    if (!areEmailNotificationsEnabled())
        return;
    const recipient = getRecipientEmail();
    if (!recipient)
        return;
    const hasIssues = summary.totalErrors > 0 || summary.totalReview > 0;
    const subject = hasIssues
        ? `📊 Mercadona Histórico Completado: ${summary.totalProcessed} importados (${summary.totalReview} a revisar, ${summary.totalErrors} errores)`
        : `🎉 Mercadona Histórico Completado: ${summary.totalProcessed} tickets importados sin fallos`;
    const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#1f2937;">
      <div style="background:#007A3D;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🛒 Importación Histórica Finalizada</h2>
      </div>
      <div style="border:1px solid #d0d7de;border-top:none;padding:18px;border-radius:0 0 8px 8px;">
        <p style="margin-top:0;">Ha terminado la carga completa de tu histórico de tickets de Mercadona:</p>
        <ul style="line-height:1.8;">
          <li><strong>Tickets importados en este proceso:</strong> ${summary.totalProcessed}</li>
          <li><strong>Tickets verificados al céntimo (✅ OK en hoja Tickets):</strong> ${okTotalInSheet}</li>
          <li><strong>Tickets marcados como ⚠️ REVISAR:</strong> ${summary.totalReview}</li>
          <li><strong>Correos con ❌ ERROR de lectura:</strong> ${summary.totalErrors}</li>
          <li><strong>Omitidos por existir previamente:</strong> ${summary.totalSkipped}</li>
        </ul>
        <p style="font-size:13px;color:#555;">
          Puedes consultar la pestaña <strong>Tickets</strong> para ver la conciliación individual de cada compra y la pestaña <strong>Análisis</strong> para explorar tu Dashboard completo.
        </p>
        <p style="margin-bottom:0;">
          <a href="${escapeHtml(spreadsheetUrl)}" style="display:inline-block;background:#007A3D;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;">
            Ver Dashboard y Hoja de Control
          </a>
        </p>
      </div>
    </div>
  `;
    try {
        MailApp.sendEmail({
            to: recipient,
            subject,
            htmlBody,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`No se pudo enviar el email de fin de histórico: ${msg}`);
    }
}

// ----------------------------------------------------------------------------
// Archivo fuente: ui/instructionsView.ts
// ----------------------------------------------------------------------------
/**
 * Vista y renderizado de la pestaña 'Instrucciones'.
 * Vuelca el manual completo de instalación y uso en una hoja formateada y legible.
 */
const BRAND_DARK_GREEN = '#007A3D';
const SECTION_BG = '#E8F5E9';
const INSTR_BORDER_COLOR = '#D0D7DE';
function renderInstructionsSheet(ss) {
    let sheet = ss.getSheetByName('Instrucciones');
    if (!sheet) {
        sheet = ss.insertSheet('Instrucciones');
    }
    sheet.clear();
    sheet.setTabColor(BRAND_DARK_GREEN);
    // Anchos de columna optimizados para lectura tipo documento
    sheet.setColumnWidth(1, 24); // Margen izq
    sheet.setColumnWidth(2, 860); // Columna de lectura principal
    sheet.setColumnWidth(3, 24); // Margen der
    const sections = [
        { type: 'TITLE', text: '🛒 MERCADONA TICKETS ANALYTICS — MANUAL DE INSTALACIÓN Y USO' },
        { type: 'SUBTITLE', text: 'Sistema autónomo en la nube para ingesta, extracción OCR, control contable y analítica en Google Sheets y Drive.' },
        { type: 'HEADER', text: '1. PEGAR EL CÓDIGO EN GOOGLE SHEETS' },
        { type: 'BULLET', text: '1. En la barra superior de esta hoja, haz clic en Extensiones > Apps Script.' },
        { type: 'BULLET', text: '2. En la barra lateral izquierda, verifica que en Servicios (+) aparezca añadido "Drive API".' },
        { type: 'BULLET', text: '3. En el archivo Código.gs, selecciona todo el texto anterior, bórralo y pega el contenido del archivo Codigo_AppsScript.gs.' },
        { type: 'BULLET', text: '4. Haz clic en Guardar (icono de disquete 💾 o Ctrl + S) y recarga la hoja en el navegador (F5).' },
        { type: 'HEADER', text: '2. LIMPIEZA INICIAL E IMPORTACIÓN DE TODO EL HISTÓRICO' },
        { type: 'BULLET', text: '1. Haz clic en 🛒 Mercadona > 🔄 Reiniciar importación desde cero (con copia de seguridad).' },
        { type: 'TIP', text: '💡 Seguridad garantizada: antes de limpiar nada, el sistema guarda automáticamente una copia de respaldo oculta de tu hoja Lista actual.' },
        { type: 'BULLET', text: '2. Haz clic en 🛒 Mercadona > ⚡ Importar TODO el histórico automáticamente.' },
        { type: 'BULLET', text: '3. El script importará tus correos en tandas seguras de 4 minutos (con bloqueo exclusivo contra duplicados).' },
        { type: 'BULLET', text: '4. Puedes cerrar la ventana si lo deseas: continuará solo en segundo plano y te enviará UN ÚNICO email con el resumen completo al terminar.' },
        { type: 'HEADER', text: '3. ACTIVAR LA COMPROBACIÓN DIARIA AUTOMÁTICA (09:00 AM)' },
        { type: 'BULLET', text: '1. Haz clic en 🛒 Mercadona > ⏰ Activar comprobación automática diaria (09:00).' },
        { type: 'BULLET', text: '2. Cada mañana, los servidores de Google buscarán si tienes nuevos tickets sin necesidad de abrir el ordenador.' },
        { type: 'BULLET', text: '3. Si has comprado, descargará el PDF en Drive, añadirá las líneas a Lista, comprobará que cuadre al céntimo y te enviará un email.' },
        { type: 'BULLET', text: '4. Si ese día no has comprado, descansará con consumo 0.' },
        { type: 'HEADER', text: '4. QUÉ ENCONTRARÁS EN CADA PESTAÑA' },
        { type: 'BULLET', text: '• 📋 Lista: Detalle línea a línea de todos los productos (archivo PDF con enlace directo, fecha real, precio, cantidad, importe y tienda).' },
        { type: 'BULLET', text: '• 🧾 Tickets: Verificación contable al céntimo de cada factura. Estado ✅ OK (cuadra exacto), ⚠️ REVISAR o ❌ ERROR.' },
        { type: 'BULLET', text: '• 📊 Análisis: Cuadro de mando automático con 5 tarjetas KPI, 2 gráficos superiores cronológicos, Top 10 más comprados, Top 10 abandonados y Top 40 inflación.' },
        { type: 'BULLET', text: '• 📡 Estado: Panel en tiempo real que muestra si el sistema está en ejecución, en pausa entre tandas o en reposo, junto al registro de eventos.' },
        { type: 'HEADER', text: '5. BOTONES DE CONTROL Y UTILIDADES DEL MENÚ 🛒 MERCADONA' },
        { type: 'BULLET', text: '• 🛑 DETENER TODAS LAS EJECUCIONES AHORA: Parada de emergencia inmediata. Corta cualquier proceso y borra activadores.' },
        { type: 'BULLET', text: '• 📥 Importar tickets nuevos (1 lote): Importa de inmediato hasta 15 tickets pendientes.' },
        { type: 'BULLET', text: '• ⚡ Importar TODO el histórico automáticamente: Procesa el histórico completo de correos de forma encadenada.' },
        { type: 'BULLET', text: '• 🔁 Reintentar solo los tickets en ERROR: Revisa las filas con error en Tickets y vuelve a intentar leerlas automáticamente sin tocar el resto.' },
        { type: 'BULLET', text: '• 🔧 Reparar enlaces #ERROR! existentes: Convierte los enlaces a PDF en enlaces nativos de Google Sheets sin depender del idioma ni fórmulas.' },
        { type: 'BULLET', text: '• 📡 Ver estado actual: Abre y actualiza la pestaña Estado con el semáforo y la última actividad en tiempo real.' },
        { type: 'BULLET', text: '• 📧 / 🔕 Avisos por email: Activa o desactiva las alertas por correo electrónico.' },
        { type: 'BULLET', text: '• 🔍 Diagnosticar último ticket en detalle: Vuelca en la hoja Diagnóstico el texto OCR crudo del último correo para inspección.' },
    ];
    let currentRow = 2;
    for (const item of sections) {
        const cell = sheet.getRange(currentRow, 2);
        cell.setValue(item.text);
        if (item.type === 'TITLE') {
            cell.setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(BRAND_DARK_GREEN);
            sheet.getRange(currentRow, 2, 1, 1).setVerticalAlignment('middle');
            sheet.setRowHeight(currentRow, 40);
            currentRow++;
        }
        else if (item.type === 'SUBTITLE') {
            cell.setFontSize(10).setFontStyle('italic').setFontColor('#555555');
            sheet.setRowHeight(currentRow, 24);
            currentRow += 2;
        }
        else if (item.type === 'HEADER') {
            cell.setFontSize(11).setFontWeight('bold').setFontColor(BRAND_DARK_GREEN).setBackground(SECTION_BG);
            sheet.getRange(currentRow, 2).setBorder(true, true, true, true, false, false, INSTR_BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
            sheet.setRowHeight(currentRow, 28);
            currentRow++;
        }
        else if (item.type === 'BULLET') {
            cell.setFontSize(10).setFontColor('#222222').setWrap(true);
            sheet.setRowHeight(currentRow, 22);
            currentRow++;
        }
        else if (item.type === 'TIP') {
            cell.setFontSize(9.5).setFontColor('#1B5E20').setBackground('#F1F8E9').setFontStyle('italic').setWrap(true);
            sheet.setRowHeight(currentRow, 24);
            currentRow++;
        }
    }
    sheet.getRange(2, 2, currentRow - 2, 1).setHorizontalAlignment('left');
}

// ----------------------------------------------------------------------------
// Archivo fuente: ui/statusView.ts
// ----------------------------------------------------------------------------
/**
 * Vista y renderizado de la pestaña '📡 Estado'.
 * Muestra el semáforo de ejecución en tiempo real y el registro de eventos recientes.
 */


const HEADER_DARK = '#1F2937';
const STATUS_BORDER_COLOR = '#D0D7DE';
function renderStatusSheet(ss) {
    let sheet = ss.getSheetByName('Estado') ?? ss.getSheetByName('📡 Estado');
    if (!sheet) {
        sheet = ss.insertSheet('📡 Estado');
    }
    sheet.clear();
    const status = getExecutionStatus();
    // Colores y textos según el estado
    let badgeText = '🟢 SISTEMA EN REPOSO · LISTO';
    let badgeBg = '#2E7D32'; // Verde
    let badgeFg = '#FFFFFF';
    if (status.state === 'EJECUTANDO') {
        badgeText = '🔄 EJECUTANDO EN ESTE MOMENTO';
        badgeBg = '#1565C0'; // Azul
        badgeFg = '#FFFFFF';
    }
    else if (status.state === 'ESPERANDO_TANDA') {
        badgeText = '⏳ EN PAUSA ENTRE TANDAS (Esperando 1 min)';
        badgeBg = '#E65100'; // Naranja
        badgeFg = '#FFFFFF';
    }
    else if (status.state === 'DETENIDO') {
        badgeText = '🛑 DETENIDO POR EL USUARIO';
        badgeBg = '#757575'; // Gris
        badgeFg = '#FFFFFF';
    }
    else if (status.state === 'ERROR') {
        badgeText = '❌ ERROR EN LA ÚLTIMA EJECUCIÓN';
        badgeBg = '#C62828'; // Rojo
        badgeFg = '#FFFFFF';
    }
    sheet.setTabColor(badgeBg);
    sheet.setColumnWidth(1, 24);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 24);
    sheet.setColumnWidth(5, 180);
    sheet.setColumnWidth(6, 260);
    // 1. TÍTULO Y SEMÁFORO SUPERIOR
    sheet.getRange(2, 2, 1, 5).merge()
        .setValue('📡 ESTADO Y SEGUIMIENTO EN TIEMPO REAL · MERCADONA TICKETS')
        .setFontWeight('bold')
        .setFontSize(13)
        .setFontColor('#FFFFFF')
        .setBackground(HEADER_DARK)
        .setVerticalAlignment('middle');
    sheet.setRowHeight(2, 36);
    sheet.getRange(3, 2, 1, 5).merge()
        .setValue(badgeText)
        .setFontWeight('bold')
        .setFontSize(14)
        .setFontColor(badgeFg)
        .setBackground(badgeBg)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    sheet.setRowHeight(3, 44);
    // 2. DETALLE DE EJECUCIÓN (Izquierda)
    const infoRows = [
        ['Operación actual:', status.currentAction],
        ['Detalle de avance:', status.progressMsg],
        ['Último latido / actualización:', status.lastUpdate],
        ['Última ejecución terminada:', status.lastExecutionDate],
        ['Avisos por email:', areEmailNotificationsEnabled() ? '✅ ACTIVADOS' : '🔕 DESACTIVADOS'],
    ];
    sheet.getRange(5, 2, 1, 2).merge()
        .setValue('⚙️ INFORMACIÓN DE EJECUCIÓN')
        .setFontWeight('bold')
        .setBackground('#F3F4F6');
    sheet.getRange(6, 2, infoRows.length, 2).setValues(infoRows);
    sheet.getRange(6, 2, infoRows.length, 1).setFontWeight('bold');
    sheet.getRange(5, 2, infoRows.length + 1, 2)
        .setBorder(true, true, true, true, true, true, STATUS_BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
    // 3. MÉTRICAS DE HOJAS (Derecha)
    const listaSheet = ss.getSheetByName('Lista');
    const ticketsSheet = ss.getSheetByName('Tickets');
    const listaRows = listaSheet && listaSheet.getLastRow() > 1 ? listaSheet.getLastRow() - 1 : 0;
    const ticketsRows = ticketsSheet && ticketsSheet.getLastRow() > 1 ? ticketsSheet.getLastRow() - 1 : 0;
    let okCount = 0;
    let reviewCount = 0;
    let errorCount = 0;
    if (ticketsSheet && ticketsRows > 0) {
        const statuses = ticketsSheet.getRange(2, 8, ticketsRows, 1).getValues();
        for (const [st] of statuses) {
            const s = String(st ?? '');
            if (s.includes('OK'))
                okCount++;
            else if (s.includes('REVISAR'))
                reviewCount++;
            else if (s.includes('ERROR'))
                errorCount++;
        }
    }
    const metricRows = [
        ['Líneas de producto (Lista):', listaRows],
        ['Tickets registrados:', ticketsRows],
        ['Tickets verificados ✅ OK:', okCount],
        ['Tickets para ⚠️ REVISAR:', reviewCount],
        ['Tickets con ❌ ERROR:', errorCount],
    ];
    sheet.getRange(5, 5, 1, 2).merge()
        .setValue('📊 ESTADO DE LOS DATOS')
        .setFontWeight('bold')
        .setBackground('#F3F4F6');
    sheet.getRange(6, 5, metricRows.length, 2).setValues(metricRows);
    sheet.getRange(6, 5, metricRows.length, 1).setFontWeight('bold');
    sheet.getRange(5, 5, metricRows.length + 1, 2)
        .setBorder(true, true, true, true, true, true, STATUS_BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
    // 4. HISTÓRICO DE ACTIVIDAD RECIENTE (Abajo)
    const startLog = 13;
    sheet.getRange(startLog, 2, 1, 5).merge()
        .setValue('📜 REGISTRO DE ACTIVIDAD RECIENTE (ÚLTIMOS EVENTOS)')
        .setFontWeight('bold')
        .setBackground('#E5E7EB');
    const logHeaders = ['Hora', 'Evento', 'Detalle', '', 'Resultado'];
    sheet.getRange(startLog + 1, 2, 1, 5).setValues([logHeaders]).setFontWeight('bold').setBackground('#F9FAFB');
    if (status.logs.length > 0) {
        const logData = status.logs.map((l) => [
            l.timestamp,
            l.event,
            l.detail,
            '',
            l.status === 'SUCCESS' ? '✅ OK' : l.status === 'ERROR' ? '❌ ERROR' : l.status === 'WARN' ? '⚠️ AVISO' : 'ℹ️ INFO',
        ]);
        sheet.getRange(startLog + 2, 2, logData.length, 5).setValues(logData);
        sheet.getRange(startLog + 1, 2, logData.length + 1, 5)
            .setBorder(true, true, true, true, true, true, STATUS_BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
    }
    else {
        sheet.getRange(startLog + 2, 2, 1, 5).merge()
            .setValue('No hay eventos registrados recientemente.')
            .setFontStyle('italic')
            .setHorizontalAlignment('center');
    }
    // Nota explicativa
    sheet.getRange(startLog + status.logs.length + 3, 2, 1, 5).merge()
        .setValue('💡 Para refrescar esta pantalla en cualquier momento, ve al menú superior: 🛒 Mercadona > 📡 Ver estado actual.')
        .setFontSize(9)
        .setFontStyle('italic')
        .setFontColor('#555555');
}

// ----------------------------------------------------------------------------
// Archivo fuente: ui/dashboardView.ts
// ----------------------------------------------------------------------------
/**
 * Renderiza el Dashboard completo en la pestaña 'Análisis' de Google Sheets.
 * Diseño de posiciones fijas en la parte superior para que el crecimiento del histórico
 * de tickets nunca desplace los gráficos ni las tablas de Top 10 / Top 40.
 */
function renderAnalyticsDashboard(sheet, data, statusSummary) {
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
    const conditionalRules = [];
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
    const top10Rows = data.top10MostPurchased.map((p) => [
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
    }
    else {
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
    const abandonedRows = data.top10Abandoned.map((a) => [
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
    }
    else {
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
    const top40Rows = data.top40ProductsInflation.map((p) => [
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
        conditionalRules.push(SpreadsheetApp.newConditionalFormatRule()
            .whenNumberGreaterThan(0.001)
            .setBackground(ALERT_RED_BG)
            .setFontColor('#B71C1C')
            .setRanges([pctRange])
            .build(), SpreadsheetApp.newConditionalFormatRule()
            .whenNumberLessThan(-0.001)
            .setBackground(OK_GREEN_BG)
            .setFontColor('#1B5E20')
            .setRanges([pctRange])
            .build());
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
    const ticketRows = data.tickets.map((t) => {
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
        const linkRtvs = data.tickets.map((t) => {
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
    const monthlyRows = data.monthlySpend.map((m) => [
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

// ----------------------------------------------------------------------------
// Archivo fuente: main.ts
// ----------------------------------------------------------------------------
const MAX_RUNTIME_MS = 4 * 60 * 1000; // 4 min por tanda (margen amplio antes del límite de 6 min de Google)
const HIST_KEYS = {
    processed: 'HIST_PROCESSED',
    skipped: 'HIST_SKIPPED',
    review: 'HIST_REVIEW',
    errors: 'HIST_ERRORS',
    startedAt: 'HIST_STARTED_AT',
};
/**
 * Obtiene la interfaz de usuario solo si existe contexto interactivo (menú).
 * En ejecuciones automáticas en segundo plano devuelve null sin lanzar excepción.
 */
function tryGetUi() {
    try {
        return SpreadsheetApp.getUi();
    }
    catch {
        return null;
    }
}
/**
 * Crea el menú superior interactivo al abrir la hoja de cálculo.
 */
function onOpen() {
    const ui = tryGetUi();
    if (!ui)
        return;
    const emailStatusLabel = areEmailNotificationsEnabled()
        ? '📧 Avisos por email: ACTIVADOS (clic para cambiar)'
        : '🔕 Avisos por email: DESACTIVADOS (clic para activar)';
    ui.createMenu('🛒 Mercadona')
        .addItem('🛑 DETENER TODAS LAS EJECUCIONES AHORA', 'pararTodoInmediatamente')
        .addSeparator()
        .addItem('📥 Importar tickets nuevos (1 lote)', 'ejecutarImportacionLote')
        .addItem('⚡ Importar TODO el histórico automáticamente', 'iniciarImportacionHistoricoCompleto')
        .addItem('🔁 Reintentar solo los tickets en ERROR', 'reintentarTicketsError')
        .addItem('🔧 Reparar enlaces #ERROR! existentes', 'repararEnlacesError')
        .addItem('📊 Actualizar panel de Análisis', 'actualizarDashboardAnalisis')
        .addSeparator()
        .addItem('📡 Ver estado de ejecución en tiempo real', 'verEstadoActual')
        .addItem('📖 Ver manual de Instrucciones', 'verManualInstrucciones')
        .addSeparator()
        .addItem('⏰ Activar comprobación automática diaria (09:00)', 'activarTriggerDiario')
        .addItem('🛑 Desactivar comprobación automática', 'desactivarTriggers')
        .addItem(emailStatusLabel, 'alternarAvisosEmail')
        .addSeparator()
        .addItem('🔍 Diagnosticar último ticket en detalle', 'diagnosticarUltimoTicket')
        .addItem('🔄 Reiniciar importación desde cero (con copia de seguridad)', 'reiniciarImportacionDesdeCero')
        .addToUi();
}
/**
 * Ejecuta la importación bajo bloqueo exclusivo (LockService) para impedir que dos
 * ejecuciones simultáneas dupliquen archivos en Drive o filas en las hojas.
 */
function runProtectedBatch(maxMessages) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
        console.warn('Ya hay otra importación en curso; se omite esta vuelta para evitar duplicados.');
        return {
            processedCount: 0,
            skippedCount: 0,
            errorsCount: 0,
            reviewCount: 0,
            importedTickets: [],
            remaining: false,
            stoppedByUser: false,
            busy: true,
            messages: ['Ya hay otra ejecución en marcha en este momento.'],
        };
    }
    try {
        return processPendingTickets({
            maxMessages,
            deadline: Date.now() + MAX_RUNTIME_MS,
        });
    }
    finally {
        lock.releaseLock();
    }
}
/**
 * Lee las filas de la hoja 'Lista' soportando tanto fechas reales Date como texto,
 * y fórmulas HYPERLINK con separador ',' o ';'.
 */
function readListaRows(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1)
        return [];
    const numRows = lastRow - 1;
    const range = sheet.getRange(2, 1, numRows, LISTA_HEADERS.length);
    const values = range.getValues();
    const formulas = range.getFormulas();
    const richTexts = range.getRichTextValues();
    // Mapa de respaldo desde la hoja 'Tickets' por si alguna fila de Lista no tiene el enlace
    const ss = sheet.getParent();
    const ticketsSheet = ss.getSheetByName(SHEET_TICKETS);
    const ticketLinksByInvoice = new Map();
    if (ticketsSheet && ticketsSheet.getLastRow() > 1) {
        const tRows = ticketsSheet.getLastRow() - 1;
        const invVals = ticketsSheet.getRange(2, 2, tRows, 1).getValues();
        const pdfRichTexts = ticketsSheet.getRange(2, 10, tRows, 1).getRichTextValues();
        const pdfFormulas = ticketsSheet.getRange(2, 10, tRows, 1).getFormulas();
        for (let k = 0; k < tRows; k++) {
            const inv = String(invVals[k]?.[0] ?? '').trim();
            const rt = pdfRichTexts[k]?.[0];
            const parsedF = parseHyperlinkFormula(String(pdfFormulas[k]?.[0] ?? ''));
            const url = rt?.getLinkUrl() || parsedF?.url || '';
            const label = (rt ? rt.getText() : '') || parsedF?.label || '';
            if (inv && url) {
                ticketLinksByInvoice.set(inv, { url, label });
            }
        }
    }
    return values.map((row, idx) => {
        const rawFormula = String(formulas[idx]?.[0] ?? '');
        const parsedLink = rawFormula ? parseHyperlinkFormula(rawFormula) : null;
        const cellRichText = richTexts[idx]?.[0];
        const invoiceNumber = String(row[7] ?? '').trim();
        const fallbackLink = invoiceNumber ? ticketLinksByInvoice.get(invoiceNumber) : null;
        const pdfUrl = cellRichText?.getLinkUrl() ||
            (parsedLink ? parsedLink.url : '') ||
            (fallbackLink ? fallbackLink.url : '');
        let pdfName = (cellRichText ? cellRichText.getText() : '') ||
            (parsedLink ? parsedLink.label : String(row[0] ?? '').trim()) ||
            (fallbackLink ? fallbackLink.label : '');
        if (pdfName === 'RichTextValue') {
            pdfName = fallbackLink?.label || 'Ver PDF';
        }
        const rawDate = row[1];
        const dateTime = rawDate instanceof Date
            ? formatDateEs(rawDate)
            : String(rawDate ?? '').trim();
        const unitStr = String(row[6] ?? '').toLowerCase().trim();
        const unit = unitStr === 'kg' ? 'kg' : 'ud';
        return {
            pdfFileUrl: pdfUrl,
            pdfFileName: pdfName,
            dateTime,
            productName: String(row[2] ?? '').trim(),
            unitPrice: typeof row[3] === 'number' ? row[3] : parseFloat(String(row[3])) || 0,
            quantity: typeof row[4] === 'number' ? row[4] : parseFloat(String(row[4])) || 1,
            amount: typeof row[5] === 'number' ? row[5] : parseFloat(String(row[5])) || 0,
            unit,
            invoiceNumber,
            storeName: String(row[8] ?? '').trim(),
        };
    });
}
/**
 * Recalcula todas las métricas y redibuja el Dashboard en la pestaña 'Análisis'.
 */
function actualizarDashboardAnalisis() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const listaSheet = ss.getSheetByName(SHEET_LISTA);
    if (!listaSheet) {
        const ui = tryGetUi();
        if (ui)
            ui.alert(`No se encontró la hoja '${SHEET_LISTA}'.`);
        return;
    }
    let analisisSheet = ss.getSheetByName('Análisis') ?? ss.getSheetByName('Analisis');
    if (!analisisSheet) {
        analisisSheet = ss.insertSheet('Análisis');
    }
    const rows = readListaRows(listaSheet);
    const analyticsData = computeAnalyticsFromRows(rows);
    const statusSummary = countTicketsByStatus();
    renderAnalyticsDashboard(analisisSheet, analyticsData, statusSummary);
}
/**
 * Botón de parada de emergencia: corta bucles en curso y elimina todos los activadores.
 */
function pararTodoInmediatamente() {
    PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'true');
    desactivarTriggersInterno();
    const ui = tryGetUi();
    if (ui) {
        ui.alert('🛑 PARADA DE EMERGENCIA EJECUTADA', 'Se han eliminado todos los activadores y cualquier tarea en ejecución se detendrá antes del siguiente correo.', ui.ButtonSet.OK);
    }
}
/**
 * Importa un lote puntual (hasta 15 correos) desde el menú interactivo.
 * Envía email de resumen si se importa algún ticket nuevo o si hay errores.
 */
function ejecutarImportacionLote() {
    PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'false');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = tryGetUi();
    const res = runProtectedBatch(15);
    if (res.busy) {
        if (ui) {
            ui.alert('Proceso ocupado', 'Ya hay otra importación ejecutándose en este momento. Espera unos segundos y vuelve a intentarlo.', ui.ButtonSet.OK);
        }
        return;
    }
    actualizarDashboardAnalisis();
    sendImportNotificationEmail(res, ss.getUrl());
    if (ui) {
        let msg = `Resultado del lote:\n` +
            `• Tickets nuevos importados: ${res.processedCount}\n` +
            `• Tickets con aviso ⚠️ REVISAR: ${res.reviewCount}\n` +
            `• Omitidos (ya existían): ${res.skippedCount}\n` +
            `• Errores de lectura: ${res.errorsCount}\n\n`;
        if (res.errorsCount > 0 && res.messages.length > 0) {
            msg += `Detalle:\n${res.messages.slice(0, 3).join('\n')}\n\n`;
        }
        msg += res.remaining
            ? '⚠️ Quedan más correos en tu histórico. Puedes usar "⚡ Importar TODO el histórico automáticamente".'
            : '✅ No quedan más correos pendientes en Gmail.';
        ui.alert('Importación finalizada', msg, ui.ButtonSet.OK);
    }
}
// ---------------------------------------------------------------------------
// Importación histórica encadenada (sin usar getUi en segundo plano)
// ---------------------------------------------------------------------------
function resetHistoricalCounters() {
    const props = PropertiesService.getScriptProperties();
    props.setProperties({
        [HIST_KEYS.processed]: '0',
        [HIST_KEYS.skipped]: '0',
        [HIST_KEYS.review]: '0',
        [HIST_KEYS.errors]: '0',
        [HIST_KEYS.startedAt]: new Date().toISOString(),
    });
}
function accumulateHistoricalCounters(res) {
    const props = PropertiesService.getScriptProperties();
    const totalProcessed = (parseInt(props.getProperty(HIST_KEYS.processed) ?? '0', 10) || 0) + res.processedCount;
    const totalSkipped = (parseInt(props.getProperty(HIST_KEYS.skipped) ?? '0', 10) || 0) + res.skippedCount;
    const totalReview = (parseInt(props.getProperty(HIST_KEYS.review) ?? '0', 10) || 0) + res.reviewCount;
    const totalErrors = (parseInt(props.getProperty(HIST_KEYS.errors) ?? '0', 10) || 0) + res.errorsCount;
    const startedAtIso = props.getProperty(HIST_KEYS.startedAt) ?? new Date().toISOString();
    props.setProperties({
        [HIST_KEYS.processed]: String(totalProcessed),
        [HIST_KEYS.skipped]: String(totalSkipped),
        [HIST_KEYS.review]: String(totalReview),
        [HIST_KEYS.errors]: String(totalErrors),
    });
    return { totalProcessed, totalSkipped, totalReview, totalErrors, startedAtIso };
}
function clearHistoricalCounters() {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty(HIST_KEYS.processed);
    props.deleteProperty(HIST_KEYS.skipped);
    props.deleteProperty(HIST_KEYS.review);
    props.deleteProperty(HIST_KEYS.errors);
    props.deleteProperty(HIST_KEYS.startedAt);
}
function scheduleNextHistoricalWave() {
    eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
    eliminarTriggersDeFuncion('iniciarImportacionHistoricoCompleto');
    ScriptApp.newTrigger('continuarImportacionHistoricoEnFondo')
        .timeBased()
        .after(60 * 1000)
        .create();
}
/**
 * Punto de entrada desde el menú para importar todo el histórico.
 * NO envía emails parciales; solo enviará UN email global cuando finalice el 100%.
 */
function iniciarImportacionHistoricoCompleto() {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('STOP_REQUESTED', 'false');
    resetHistoricalCounters();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = tryGetUi();
    setExecutionStatus('EJECUTANDO', 'Importando histórico (primera tanda)', 'Procesando correos de Mercadona...');
    logActivity('INICIO_HISTORICO', 'Iniciada importación de todo el histórico de tickets.');
    const res = runProtectedBatch(40);
    if (res.busy) {
        setExecutionStatus('EN_REPOSO', 'Sistema ocupado', 'Hay otro proceso ejecutándose actualmente.');
        if (ui) {
            ui.alert('Importación ya en curso', 'Ya hay un proceso trabajando en segundo plano. Recibirás un email cuando termine por completo.', ui.ButtonSet.OK);
        }
        return;
    }
    const summary = accumulateHistoricalCounters(res);
    actualizarDashboardAnalisis();
    if (res.stoppedByUser) {
        setExecutionStatus('DETENIDO', 'Parada solicitada', 'El usuario detuvo la importación histórica.');
        eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
        clearHistoricalCounters();
        return;
    }
    if (res.remaining) {
        setExecutionStatus('ESPERANDO_TANDA', 'Pausa entre tandas', `Acumulados ${summary.totalProcessed} tickets. Siguiente tanda en 1 min.`);
        logActivity('TANDA_HISTORICA', `Completada tanda con ${summary.totalProcessed} tickets acumulados.`);
        scheduleNextHistoricalWave();
        if (ui) {
            ui.alert('Importación histórica en marcha', `Primera tanda completada (${summary.totalProcessed} tickets importados).\n\n` +
                `El sistema seguirá trabajando solo en segundo plano en tandas seguras de 4 minutos hasta vaciar todo tu histórico. ` +
                `Puedes cerrar esta pestaña: recibirás un único email con el resumen final cuando termine al 100%.`, ui.ButtonSet.OK);
        }
    }
    else {
        setExecutionStatus('EN_REPOSO', 'Histórico completado', `Importados ${summary.totalProcessed} tickets en total.`);
        logActivity('HISTORICO_COMPLETADO', `Total ${summary.totalProcessed} tickets importados.`, 'SUCCESS');
        eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
        const statusCounts = countTicketsByStatus();
        sendHistoricalCompleteEmail(summary, ss.getUrl(), statusCounts.ok);
        clearHistoricalCounters();
        if (ui) {
            ui.alert('🎉 ¡Histórico completado!', `Se han importado todos tus tickets (${summary.totalProcessed} nuevos, ${summary.totalReview} a revisar, ${summary.totalErrors} errores).\n` +
                `Te hemos enviado también el resumen completo por email.`, ui.ButtonSet.OK);
        }
    }
}
/**
 * Continuación automática en segundo plano (invocada exclusivamente por activador temporal).
 * NUNCA invoca SpreadsheetApp.getUi() para no fallar jamás en modo desatendido.
 */
function continuarImportacionHistoricoEnFondo() {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('STOP_REQUESTED') === 'true') {
        console.warn('Continuación de histórico cancelada por bandera STOP_REQUESTED.');
        setExecutionStatus('DETENIDO', 'Parada solicitada', 'Cancelada continuación por bandera de parada.');
        eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
        clearHistoricalCounters();
        return;
    }
    setExecutionStatus('EJECUTANDO', 'Importando histórico en segundo plano', 'Procesando siguiente tanda...');
    const res = runProtectedBatch(40);
    if (res.busy) {
        scheduleNextHistoricalWave();
        return;
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const summary = accumulateHistoricalCounters(res);
    actualizarDashboardAnalisis();
    if (res.stoppedByUser) {
        setExecutionStatus('DETENIDO', 'Parada solicitada', 'El usuario detuvo la ejecución.');
        eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
        clearHistoricalCounters();
        return;
    }
    if (res.remaining) {
        console.log(`Histórico en progreso: acumulados ${summary.totalProcessed} tickets. Programando siguiente tanda en 1 min...`);
        setExecutionStatus('ESPERANDO_TANDA', 'Pausa entre tandas', `Acumulados ${summary.totalProcessed} tickets. Siguiente tanda en 1 min.`);
        logActivity('TANDA_HISTORICA', `Acumulados ${summary.totalProcessed} tickets. Próxima tanda en 1 minuto.`);
        scheduleNextHistoricalWave();
    }
    else {
        console.log(`¡Importación histórica completada! Total: ${summary.totalProcessed} tickets.`);
        setExecutionStatus('EN_REPOSO', 'Histórico completado', `Importados ${summary.totalProcessed} tickets.`);
        logActivity('HISTORICO_COMPLETADO', `Total ${summary.totalProcessed} tickets importados con éxito.`, 'SUCCESS');
        eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
        const statusCounts = countTicketsByStatus();
        sendHistoricalCompleteEmail(summary, ss.getUrl(), statusCounts.ok);
        clearHistoricalCounters();
    }
}
// ---------------------------------------------------------------------------
// Automatización diaria desatendida y preferencias de avisos
// ---------------------------------------------------------------------------
/**
 * Ejecución diaria automática (09:00 AM).
 * Si entran tickets nuevos o hay algún error, actualiza el Dashboard y envía email de aviso.
 */
function ejecucionAutomaticaProgramada() {
    if (PropertiesService.getScriptProperties().getProperty('STOP_REQUESTED') === 'true') {
        console.warn('Ejecución diaria omitida porque la parada de emergencia sigue activa.');
        return;
    }
    const res = runProtectedBatch(25);
    if (res.busy)
        return;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (res.processedCount > 0) {
        actualizarDashboardAnalisis();
    }
    if (res.processedCount > 0 || res.errorsCount > 0) {
        sendImportNotificationEmail(res, ss.getUrl());
    }
}
/**
 * Activa la revisión diaria a las 09:00 AM y limpia la bandera de parada si estaba activa.
 */
function activarTriggerDiario() {
    PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'false');
    eliminarTriggersDeFuncion('ejecucionAutomaticaProgramada');
    ScriptApp.newTrigger('ejecucionAutomaticaProgramada')
        .timeBased()
        .everyDays(1)
        .atHour(9)
        .create();
    const ui = tryGetUi();
    if (ui) {
        ui.alert('⏰ Automatización diaria activada', 'Google revisará tu Gmail cada día a las 09:00 AM. Cuando importe un ticket nuevo o detecte cualquier incidencia, actualizará tu Dashboard y te enviará un email de confirmación.', ui.ButtonSet.OK);
    }
}
function desactivarTriggersInterno() {
    for (const t of ScriptApp.getProjectTriggers()) {
        ScriptApp.deleteTrigger(t);
    }
}
/**
 * Desactiva todos los activadores automáticos programados.
 */
function desactivarTriggers() {
    desactivarTriggersInterno();
    const ui = tryGetUi();
    if (ui) {
        ui.alert('Automatización desactivada', 'Se han eliminado todos los activadores automáticos del proyecto.', ui.ButtonSet.OK);
    }
}
function eliminarTriggersDeFuncion(functionName) {
    for (const t of ScriptApp.getProjectTriggers()) {
        if (t.getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(t);
        }
    }
}
/**
 * Permite activar o desactivar los avisos por email desde el menú.
 */
function alternarAvisosEmail() {
    const nextState = !areEmailNotificationsEnabled();
    setEmailNotificationsEnabled(nextState);
    onOpen(); // Refresca el texto del menú
    const ui = tryGetUi();
    if (ui) {
        ui.alert(nextState ? '📧 Avisos por email activados' : '🔕 Avisos por email desactivados', nextState
            ? 'Recibirás un email cuando se importe un ticket nuevo (o al finalizar el histórico completo) y si ocurre algún error.'
            : 'No se enviarán correos de aviso.', ui.ButtonSet.OK);
    }
}
// ---------------------------------------------------------------------------
// Reintentos, Reparación de Enlaces y Vistas de Estado / Instrucciones
// ---------------------------------------------------------------------------
/**
 * Reintenta únicamente los tickets marcados con ❌ ERROR en la hoja Tickets.
 */
function reintentarTicketsError() {
    const ui = tryGetUi();
    setExecutionStatus('EJECUTANDO', 'Reintentando tickets con error', 'Buscando tickets en estado ERROR...');
    showFloatingToast('Buscando tickets con error...', '🛒 Mercadona', 3);
    const res = retryFailedTickets();
    actualizarDashboardAnalisis();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    renderStatusSheet(ss);
    setExecutionStatus('EN_REPOSO', 'Reintento finalizado', `Recuperados ${res.recovered} de ${res.retried} tickets.`);
    if (ui) {
        if (res.retried === 0) {
            ui.alert('No hay tickets con error', 'No se ha encontrado ninguna fila en estado ❌ ERROR en la hoja Tickets.', ui.ButtonSet.OK);
        }
        else {
            ui.alert('Reintento de errores completado', `• Tickets con error reintentados: ${res.retried}\n` +
                `• Recuperados con éxito: ${res.recovered}\n` +
                `• Aún con incidencias: ${res.stillFailing}\n\n` +
                `Las hojas 'Tickets', 'Lista' y 'Análisis' se han actualizado.`, ui.ButtonSet.OK);
        }
    }
}
/**
 * Convierte todas las celdas que daban #ERROR! en hipervínculos nativos de Google Sheets (RichTextValue).
 */
function repararEnlacesError() {
    const ui = tryGetUi();
    showFloatingToast('Reparando hipervínculos...', '🛒 Mercadona', 3);
    const res = repararEnlacesErrorExistentes();
    actualizarDashboardAnalisis();
    if (ui) {
        ui.alert('🔧 Enlaces reparados con éxito', `Se han convertido los enlaces a formato nativo directo de Google Sheets:\n` +
            `• Enlaces corregidos en 'Lista': ${res.listaReparados}\n` +
            `• Enlaces corregidos en 'Tickets': ${res.ticketsReparados}\n\n` +
            `Ya no aparecerá ningún aviso de #ERROR! en las columnas de PDF.`, ui.ButtonSet.OK);
    }
}
/**
 * Abre y actualiza la pestaña '📡 Estado' con el semáforo y la última actividad en tiempo real.
 */
function verEstadoActual() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    renderStatusSheet(ss);
    const estadoSheet = ss.getSheetByName('📡 Estado') ?? ss.getSheetByName('Estado');
    if (estadoSheet) {
        ss.setActiveSheet(estadoSheet);
    }
}
/**
 * Abre y actualiza la pestaña 'Instrucciones' con el manual completo de instalación y uso.
 */
function verManualInstrucciones() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    renderInstructionsSheet(ss);
    const instSheet = ss.getSheetByName('Instrucciones');
    if (instSheet) {
        ss.setActiveSheet(instSheet);
    }
}
// ---------------------------------------------------------------------------
// Diagnóstico y Reinicio seguro con copia de respaldo
// ---------------------------------------------------------------------------
/**
 * Vuelca el texto OCR y el resultado de validación del último correo de Mercadona en la hoja 'Diagnóstico'.
 */
function diagnosticarUltimoTicket() {
    const ui = tryGetUi();
    const threads = GmailApp.search(`from:${SENDER} has:attachment`, 0, 1);
    if (threads.length === 0) {
        if (ui)
            ui.alert('No se encontraron correos de Mercadona en Gmail.');
        return;
    }
    const messages = threads[0].getMessages();
    const lastMsg = messages[messages.length - 1];
    const att = lastMsg
        .getAttachments()
        .find((a) => a.getContentType() === 'application/pdf' || a.getName().toLowerCase().endsWith('.pdf'));
    if (!att) {
        if (ui)
            ui.alert('El último correo no contiene ningún archivo PDF adjunto.');
        return;
    }
    const rawText = extractTextFromPdfBlob(att.copyBlob());
    const parsed = parseMercadonaTicketText(rawText, att.getName());
    const validation = validateTicket(parsed);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let diagSheet = ss.getSheetByName('Diagnóstico');
    if (!diagSheet) {
        diagSheet = ss.insertSheet('Diagnóstico');
    }
    diagSheet.clear();
    const summaryRows = [
        ['DIAGNÓSTICO DE LECTURA Y CONCILIACIÓN', ''],
        ['Archivo PDF', att.getName()],
        ['Factura detectada', parsed.invoiceNumber],
        ['Fecha detectada', parsed.dateTime || '(no detectada)'],
        ['Tienda detectada', parsed.storeName],
        ['Total impreso en ticket (€)', parsed.totalAmount],
        ['Suma de productos leídos (€)', validation.itemsSum],
        ['Diferencia (€)', validation.difference],
        ['Artículos leídos', validation.itemCount],
        ['Estado de verificación', validation.status === 'OK' ? '✅ OK (Cuadra al céntimo)' : `⚠️ REVISAR: ${validation.observations}`],
    ];
    diagSheet.getRange(1, 1, summaryRows.length, 2).setValues(summaryRows);
    diagSheet.getRange(1, 1, 1, 2).merge().setFontWeight('bold').setBackground('#007A3D').setFontColor('#FFFFFF');
    diagSheet.getRange(2, 1, summaryRows.length - 1, 1).setFontWeight('bold');
    const rawLines = rawText.split(/\r?\n/).map((l) => [l]);
    diagSheet.getRange(12, 1).setValue('TEXTO OCR CRUDO EXTRAÍDO DEL PDF:').setFontWeight('bold');
    if (rawLines.length > 0) {
        diagSheet.getRange(13, 1, rawLines.length, 1).setValues(rawLines);
    }
    diagSheet.autoResizeColumn(1);
    diagSheet.autoResizeColumn(2);
    if (ui) {
        ui.alert('Diagnóstico completado', `Archivo: ${att.getName()}\n` +
            `Factura: ${parsed.invoiceNumber}\n` +
            `Artículos leídos: ${validation.itemCount}\n` +
            `Total impreso: ${parsed.totalAmount.toFixed(2)} € | Suma leída: ${validation.itemsSum.toFixed(2)} €\n` +
            `Estado: ${validation.status}\n\n` +
            `Revisa la pestaña "Diagnóstico" para ver el detalle completo.`, ui.ButtonSet.OK);
    }
}
/**
 * Quita una etiqueta de TODOS los hilos de Gmail que la tengan (paginando sin límite de 100).
 */
function removeLabelFromAllThreads(labelName) {
    const label = GmailApp.getUserLabelByName(labelName);
    if (!label)
        return;
    while (true) {
        const batch = label.getThreads(0, 100);
        if (batch.length === 0)
            break;
        for (const thread of batch) {
            thread.removeLabel(label);
        }
    }
}
/**
 * Reinicia las hojas de control haciendo antes una copia de seguridad oculta de 'Lista'
 * si tenía datos previos (operación segura y no destructiva), y limpia todas las etiquetas de Gmail.
 */
function reiniciarImportacionDesdeCero() {
    const ui = tryGetUi();
    if (!ui)
        return;
    const resp = ui.alert('¿Reiniciar importación limpia?', 'Antes de limpiar, se guardará automáticamente una copia de seguridad oculta de tu hoja "Lista" actual (si tiene datos).\n' +
        'Después se reiniciarán "Lista", "Tickets", "Análisis" y todas las etiquetas de Gmail para reimportar todo limpio.\n\n' +
        '¿Deseas continuar?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES)
        return;
    desactivarTriggersInterno();
    clearHistoricalCounters();
    PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'false');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // 1. Copia de seguridad no destructiva si 'Lista' tenía filas
    const existingLista = ss.getSheetByName(SHEET_LISTA);
    if (existingLista && existingLista.getLastRow() > 1) {
        const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Madrid', 'yyyyMMdd_HHmm');
        const backupCopy = existingLista.copyTo(ss).setName(`Backup_Lista_${stamp}`);
        backupCopy.hideSheet();
    }
    // 2. Reiniciar hojas de datos y control
    for (const [name, headers] of [
        [SHEET_LISTA, LISTA_HEADERS],
        [SHEET_TICKETS, TICKETS_HEADERS],
        [SHEET_CORREOS, CORREOS_HEADERS],
    ]) {
        const s = ss.getSheetByName(name);
        if (s)
            s.clear();
        getOrCreateSheet(ss, name, [...headers]);
    }
    const analisis = ss.getSheetByName('Análisis') ?? ss.getSheetByName('Analisis');
    if (analisis) {
        analisis.clear();
        analisis.clearConditionalFormatRules();
        for (const c of analisis.getCharts()) {
            analisis.removeChart(c);
        }
    }
    // 3. Quitar etiquetas de TODOS los correos en Gmail (sin límite de 100)
    removeLabelFromAllThreads(LABEL_OK);
    removeLabelFromAllThreads(LABEL_ERROR);
    // 4. Actualizar hojas de Instrucciones y Estado
    renderInstructionsSheet(ss);
    renderStatusSheet(ss);
    setExecutionStatus('EN_REPOSO', 'Reinicio completado', 'Sistema limpio y listo para importar.');
    logActivity('REINICIO_SISTEMA', 'Hojas y etiquetas reiniciadas con copia de seguridad guardada.', 'INFO');
    ui.alert('✅ Reinicio completado con seguridad', 'Tus datos anteriores tienen copia de respaldo oculta y las hojas y etiquetas están limpias.\n' +
        'Se han generado también las pestañas "Instrucciones" y "📡 Estado".\n\n' +
        'Ya puedes pulsar "⚡ Importar TODO el histórico automáticamente".', ui.ButtonSet.OK);
}

