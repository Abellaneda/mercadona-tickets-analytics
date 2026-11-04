import { computeAnalyticsFromRows, type RawRowData } from './services/analyticsService.ts';
import {
  CORREOS_HEADERS,
  countTicketsByStatus,
  extractTextFromPdfBlob,
  getOrCreateSheet,
  LABEL_ERROR,
  LABEL_OK,
  LISTA_HEADERS,
  processPendingTickets,
  repararEnlacesErrorExistentes,
  retryFailedTickets,
  SENDER,
  SHEET_CORREOS,
  SHEET_LISTA,
  SHEET_TICKETS,
  TICKETS_HEADERS,
} from './services/googleService.ts';
import {
  areEmailNotificationsEnabled,
  type HistoricalImportSummary,
  sendHistoricalCompleteEmail,
  sendImportNotificationEmail,
  setEmailNotificationsEnabled,
} from './services/notificationService.ts';
import {
  logActivity,
  setExecutionStatus,
  showFloatingToast,
} from './services/statusService.ts';
import { renderAnalyticsDashboard } from './ui/dashboardView.ts';
import { renderInstructionsSheet } from './ui/instructionsView.ts';
import { renderStatusSheet } from './ui/statusView.ts';
import type { ProcessBatchResult, ProductUnit } from './types/index.ts';
import { parseMercadonaTicketText, validateTicket } from './utils/pdfParser.ts';
import { formatDateEs, parseHyperlinkFormula } from './utils/sheetUtils.ts';

const MAX_RUNTIME_MS = 4 * 60 * 1000; // 4 min por tanda (margen amplio antes del límite de 6 min de Google)

const HIST_KEYS = {
  processed: 'HIST_PROCESSED',
  skipped: 'HIST_SKIPPED',
  review: 'HIST_REVIEW',
  errors: 'HIST_ERRORS',
  startedAt: 'HIST_STARTED_AT',
} as const;

/**
 * Obtiene la interfaz de usuario solo si existe contexto interactivo (menú).
 * En ejecuciones automáticas en segundo plano devuelve null sin lanzar excepción.
 */
function tryGetUi(): GoogleAppsScript.Base.Ui | null {
  try {
    return SpreadsheetApp.getUi();
  } catch {
    return null;
  }
}

/**
 * Crea el menú superior interactivo al abrir la hoja de cálculo.
 */
export function onOpen(): void {
  const ui = tryGetUi();
  if (!ui) return;

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
function runProtectedBatch(maxMessages: number): ProcessBatchResult {
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
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lee las filas de la hoja 'Lista' soportando tanto fechas reales Date como texto,
 * y fórmulas HYPERLINK con separador ',' o ';'.
 */
function readListaRows(sheet: GoogleAppsScript.Spreadsheet.Sheet): RawRowData[] {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const numRows = lastRow - 1;
  const range = sheet.getRange(2, 1, numRows, LISTA_HEADERS.length);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const richTexts = range.getRichTextValues();

  // Mapa de respaldo desde la hoja 'Tickets' por si alguna fila de Lista no tiene el enlace
  const ss = sheet.getParent();
  const ticketsSheet = ss.getSheetByName(SHEET_TICKETS);
  const ticketLinksByInvoice = new Map<string, { url: string; label: string }>();
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

    const pdfUrl =
      cellRichText?.getLinkUrl() ||
      (parsedLink ? parsedLink.url : '') ||
      (fallbackLink ? fallbackLink.url : '');

    let pdfName =
      (cellRichText ? cellRichText.getText() : '') ||
      (parsedLink ? parsedLink.label : String(row[0] ?? '').trim()) ||
      (fallbackLink ? fallbackLink.label : '');

    if (pdfName === 'RichTextValue') {
      pdfName = fallbackLink?.label || 'Ver PDF';
    }

    const rawDate = row[1];
    const dateTime =
      rawDate instanceof Date
        ? formatDateEs(rawDate)
        : String(rawDate ?? '').trim();

    const unitStr = String(row[6] ?? '').toLowerCase().trim();
    const unit: ProductUnit = unitStr === 'kg' ? 'kg' : 'ud';

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
export function actualizarDashboardAnalisis(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listaSheet = ss.getSheetByName(SHEET_LISTA);
  if (!listaSheet) {
    const ui = tryGetUi();
    if (ui) ui.alert(`No se encontró la hoja '${SHEET_LISTA}'.`);
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
export function pararTodoInmediatamente(): void {
  PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'true');
  desactivarTriggersInterno();

  const ui = tryGetUi();
  if (ui) {
    ui.alert(
      '🛑 PARADA DE EMERGENCIA EJECUTADA',
      'Se han eliminado todos los activadores y cualquier tarea en ejecución se detendrá antes del siguiente correo.',
      ui.ButtonSet.OK
    );
  }
}

/**
 * Importa un lote puntual (hasta 15 correos) desde el menú interactivo.
 * Envía email de resumen si se importa algún ticket nuevo o si hay errores.
 */
export function ejecutarImportacionLote(): void {
  PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'false');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = tryGetUi();

  const res = runProtectedBatch(15);
  if (res.busy) {
    if (ui) {
      ui.alert(
        'Proceso ocupado',
        'Ya hay otra importación ejecutándose en este momento. Espera unos segundos y vuelve a intentarlo.',
        ui.ButtonSet.OK
      );
    }
    return;
  }

  actualizarDashboardAnalisis();
  sendImportNotificationEmail(res, ss.getUrl());

  if (ui) {
    let msg =
      `Resultado del lote:\n` +
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

function resetHistoricalCounters(): void {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    [HIST_KEYS.processed]: '0',
    [HIST_KEYS.skipped]: '0',
    [HIST_KEYS.review]: '0',
    [HIST_KEYS.errors]: '0',
    [HIST_KEYS.startedAt]: new Date().toISOString(),
  });
}

function accumulateHistoricalCounters(res: ProcessBatchResult): HistoricalImportSummary {
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

function clearHistoricalCounters(): void {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(HIST_KEYS.processed);
  props.deleteProperty(HIST_KEYS.skipped);
  props.deleteProperty(HIST_KEYS.review);
  props.deleteProperty(HIST_KEYS.errors);
  props.deleteProperty(HIST_KEYS.startedAt);
}

function scheduleNextHistoricalWave(): void {
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
export function iniciarImportacionHistoricoCompleto(): void {
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
      ui.alert(
        'Importación ya en curso',
        'Ya hay un proceso trabajando en segundo plano. Recibirás un email cuando termine por completo.',
        ui.ButtonSet.OK
      );
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
      ui.alert(
        'Importación histórica en marcha',
        `Primera tanda completada (${summary.totalProcessed} tickets importados).\n\n` +
          `El sistema seguirá trabajando solo en segundo plano en tandas seguras de 4 minutos hasta vaciar todo tu histórico. ` +
          `Puedes cerrar esta pestaña: recibirás un único email con el resumen final cuando termine al 100%.`,
        ui.ButtonSet.OK
      );
    }
  } else {
    setExecutionStatus('EN_REPOSO', 'Histórico completado', `Importados ${summary.totalProcessed} tickets en total.`);
    logActivity('HISTORICO_COMPLETADO', `Total ${summary.totalProcessed} tickets importados.`, 'SUCCESS');
    eliminarTriggersDeFuncion('continuarImportacionHistoricoEnFondo');
    const statusCounts = countTicketsByStatus();
    sendHistoricalCompleteEmail(summary, ss.getUrl(), statusCounts.ok);
    clearHistoricalCounters();

    if (ui) {
      ui.alert(
        '🎉 ¡Histórico completado!',
        `Se han importado todos tus tickets (${summary.totalProcessed} nuevos, ${summary.totalReview} a revisar, ${summary.totalErrors} errores).\n` +
          `Te hemos enviado también el resumen completo por email.`,
        ui.ButtonSet.OK
      );
    }
  }
}

/**
 * Continuación automática en segundo plano (invocada exclusivamente por activador temporal).
 * NUNCA invoca SpreadsheetApp.getUi() para no fallar jamás en modo desatendido.
 */
export function continuarImportacionHistoricoEnFondo(): void {
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
    console.log(
      `Histórico en progreso: acumulados ${summary.totalProcessed} tickets. Programando siguiente tanda en 1 min...`
    );
    setExecutionStatus('ESPERANDO_TANDA', 'Pausa entre tandas', `Acumulados ${summary.totalProcessed} tickets. Siguiente tanda en 1 min.`);
    logActivity('TANDA_HISTORICA', `Acumulados ${summary.totalProcessed} tickets. Próxima tanda en 1 minuto.`);
    scheduleNextHistoricalWave();
  } else {
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
export function ejecucionAutomaticaProgramada(): void {
  if (PropertiesService.getScriptProperties().getProperty('STOP_REQUESTED') === 'true') {
    console.warn('Ejecución diaria omitida porque la parada de emergencia sigue activa.');
    return;
  }

  const res = runProtectedBatch(25);
  if (res.busy) return;

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
export function activarTriggerDiario(): void {
  PropertiesService.getScriptProperties().setProperty('STOP_REQUESTED', 'false');
  eliminarTriggersDeFuncion('ejecucionAutomaticaProgramada');

  ScriptApp.newTrigger('ejecucionAutomaticaProgramada')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  const ui = tryGetUi();
  if (ui) {
    ui.alert(
      '⏰ Automatización diaria activada',
      'Google revisará tu Gmail cada día a las 09:00 AM. Cuando importe un ticket nuevo o detecte cualquier incidencia, actualizará tu Dashboard y te enviará un email de confirmación.',
      ui.ButtonSet.OK
    );
  }
}

function desactivarTriggersInterno(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    ScriptApp.deleteTrigger(t);
  }
}

/**
 * Desactiva todos los activadores automáticos programados.
 */
export function desactivarTriggers(): void {
  desactivarTriggersInterno();
  const ui = tryGetUi();
  if (ui) {
    ui.alert(
      'Automatización desactivada',
      'Se han eliminado todos los activadores automáticos del proyecto.',
      ui.ButtonSet.OK
    );
  }
}

function eliminarTriggersDeFuncion(functionName: string): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
    }
  }
}

/**
 * Permite activar o desactivar los avisos por email desde el menú.
 */
export function alternarAvisosEmail(): void {
  const nextState = !areEmailNotificationsEnabled();
  setEmailNotificationsEnabled(nextState);
  onOpen(); // Refresca el texto del menú

  const ui = tryGetUi();
  if (ui) {
    ui.alert(
      nextState ? '📧 Avisos por email activados' : '🔕 Avisos por email desactivados',
      nextState
        ? 'Recibirás un email cuando se importe un ticket nuevo (o al finalizar el histórico completo) y si ocurre algún error.'
        : 'No se enviarán correos de aviso.',
      ui.ButtonSet.OK
    );
  }
}

// ---------------------------------------------------------------------------
// Reintentos, Reparación de Enlaces y Vistas de Estado / Instrucciones
// ---------------------------------------------------------------------------

/**
 * Reintenta únicamente los tickets marcados con ❌ ERROR en la hoja Tickets.
 */
export function reintentarTicketsError(): void {
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
    } else {
      ui.alert(
        'Reintento de errores completado',
        `• Tickets con error reintentados: ${res.retried}\n` +
          `• Recuperados con éxito: ${res.recovered}\n` +
          `• Aún con incidencias: ${res.stillFailing}\n\n` +
          `Las hojas 'Tickets', 'Lista' y 'Análisis' se han actualizado.`,
        ui.ButtonSet.OK
      );
    }
  }
}

/**
 * Convierte todas las celdas que daban #ERROR! en hipervínculos nativos de Google Sheets (RichTextValue).
 */
export function repararEnlacesError(): void {
  const ui = tryGetUi();
  showFloatingToast('Reparando hipervínculos...', '🛒 Mercadona', 3);
  const res = repararEnlacesErrorExistentes();
  actualizarDashboardAnalisis();

  if (ui) {
    ui.alert(
      '🔧 Enlaces reparados con éxito',
      `Se han convertido los enlaces a formato nativo directo de Google Sheets:\n` +
        `• Enlaces corregidos en 'Lista': ${res.listaReparados}\n` +
        `• Enlaces corregidos en 'Tickets': ${res.ticketsReparados}\n\n` +
        `Ya no aparecerá ningún aviso de #ERROR! en las columnas de PDF.`,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Abre y actualiza la pestaña '📡 Estado' con el semáforo y la última actividad en tiempo real.
 */
export function verEstadoActual(): void {
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
export function verManualInstrucciones(): void {
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
export function diagnosticarUltimoTicket(): void {
  const ui = tryGetUi();
  const threads = GmailApp.search(`from:${SENDER} has:attachment`, 0, 1);
  if (threads.length === 0) {
    if (ui) ui.alert('No se encontraron correos de Mercadona en Gmail.');
    return;
  }

  const messages = threads[0]!.getMessages();
  const lastMsg = messages[messages.length - 1]!;
  const att = lastMsg
    .getAttachments()
    .find((a) => a.getContentType() === 'application/pdf' || a.getName().toLowerCase().endsWith('.pdf'));

  if (!att) {
    if (ui) ui.alert('El último correo no contiene ningún archivo PDF adjunto.');
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

  const summaryRows: (string | number)[][] = [
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
    ui.alert(
      'Diagnóstico completado',
      `Archivo: ${att.getName()}\n` +
        `Factura: ${parsed.invoiceNumber}\n` +
        `Artículos leídos: ${validation.itemCount}\n` +
        `Total impreso: ${parsed.totalAmount.toFixed(2)} € | Suma leída: ${validation.itemsSum.toFixed(2)} €\n` +
        `Estado: ${validation.status}\n\n` +
        `Revisa la pestaña "Diagnóstico" para ver el detalle completo.`,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Quita una etiqueta de TODOS los hilos de Gmail que la tengan (paginando sin límite de 100).
 */
function removeLabelFromAllThreads(labelName: string): void {
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) return;
  while (true) {
    const batch = label.getThreads(0, 100);
    if (batch.length === 0) break;
    for (const thread of batch) {
      thread.removeLabel(label);
    }
  }
}

/**
 * Reinicia las hojas de control haciendo antes una copia de seguridad oculta de 'Lista'
 * si tenía datos previos (operación segura y no destructiva), y limpia todas las etiquetas de Gmail.
 */
export function reiniciarImportacionDesdeCero(): void {
  const ui = tryGetUi();
  if (!ui) return;

  const resp = ui.alert(
    '¿Reiniciar importación limpia?',
    'Antes de limpiar, se guardará automáticamente una copia de seguridad oculta de tu hoja "Lista" actual (si tiene datos).\n' +
      'Después se reiniciarán "Lista", "Tickets", "Análisis" y todas las etiquetas de Gmail para reimportar todo limpio.\n\n' +
      '¿Deseas continuar?',
    ui.ButtonSet.YES_NO
  );

  if (resp !== ui.Button.YES) return;

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
  ] as const) {
    const s = ss.getSheetByName(name);
    if (s) s.clear();
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

  ui.alert(
    '✅ Reinicio completado con seguridad',
    'Tus datos anteriores tienen copia de respaldo oculta y las hojas y etiquetas están limpias.\n' +
      'Se han generado también las pestañas "Instrucciones" y "📡 Estado".\n\n' +
      'Ya puedes pulsar "⚡ Importar TODO el histórico automáticamente".',
    ui.ButtonSet.OK
  );
}
