import type { ProcessBatchResult, TicketData, TicketValidation } from '../types/index.ts';
import { parseMercadonaTicketText, parseTicketDate, validateTicket } from '../utils/pdfParser.ts';
import { parseHyperlinkFormula } from '../utils/sheetUtils.ts';
import { logActivity, setExecutionStatus, showFloatingToast } from './statusService.ts';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
export const SENDER = 'ticket_digital@mail.mercadona.com';
export const LABEL_OK = 'Mercadona/Procesado';
export const LABEL_ERROR = 'Mercadona/Error';
export const SHEET_LISTA = 'Lista';
export const SHEET_TICKETS = 'Tickets';
export const SHEET_CORREOS = '_Correos';
export const TICKETS_FOLDER_NAME = 'Archivos_tickets';
/** Ventana de días en la que se revisan también conversaciones ya etiquetadas. */
const RECENT_WINDOW_DAYS = 45;

export const STATUS_LABELS = {
  OK: '✅ OK',
  REVISAR: '⚠️ REVISAR',
  ERROR: '❌ ERROR',
} as const;

export const LISTA_HEADERS = [
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

export const TICKETS_HEADERS = [
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

export const CORREOS_HEADERS = ['Id correo', 'Fecha correo', 'Resultado', 'Procesado el'];

type CellValue = string | number | Date;

// ---------------------------------------------------------------------------
// Hojas, carpeta y etiquetas
// ---------------------------------------------------------------------------

/** Obtiene una hoja (creándola si no existe) y garantiza que tiene las cabeceras indicadas. */
export function getOrCreateSheet(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
  headers: string[]
): GoogleAppsScript.Spreadsheet.Sheet {
  let sheet = ss.getSheetByName(name);
  let created = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    created = true;
  }

  // Añade solo las cabeceras que falten (operación aditiva, nunca borra columnas existentes)
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0] ?? [];
  headers.forEach((h, i) => {
    if (!current[i]) sheet!.getRange(1, i + 1).setValue(h);
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
function applyTicketsSheetFormat(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
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
export function getOrCreateTicketsFolder(): GoogleAppsScript.Drive.Folder {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const subfolders = parentFolder.getFoldersByName(TICKETS_FOLDER_NAME);
  return subfolders.hasNext() ? subfolders.next() : parentFolder.createFolder(TICKETS_FOLDER_NAME);
}

/** Obtiene o crea una etiqueta de Gmail. */
export function getOrCreateLabel(labelName: string): GoogleAppsScript.Gmail.GmailLabel {
  return GmailApp.getUserLabelByName(labelName) ?? GmailApp.createLabel(labelName);
}

/** Lee los valores no vacíos de una columna (desde la fila 2) como conjunto de textos. */
export function readColumnSet(sheet: GoogleAppsScript.Spreadsheet.Sheet, column: number): Set<string> {
  const result = new Set<string>();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return result;
  for (const row of sheet.getRange(2, column, lastRow - 1, 1).getValues()) {
    const v = String(row[0] ?? '').trim();
    if (v) result.add(v);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lectura del PDF (OCR de Google Drive)
// ---------------------------------------------------------------------------

function executeSingleOcr(blob: GoogleAppsScript.Base.Blob): string {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  let docId = '';

  if (typeof anyGlobal['Drive'] !== 'undefined') {
    const driveService = anyGlobal['Drive'] as {
      Files: {
        create?: (resource: { name: string; mimeType: string }, media: GoogleAppsScript.Base.Blob, optionalArgs?: Record<string, unknown>) => { id: string };
        insert?: (resource: { title: string; mimeType: string }, media: GoogleAppsScript.Base.Blob, optionalArgs?: Record<string, unknown>) => { id: string };
      };
    };

    if (typeof driveService.Files.create === 'function') {
      docId = driveService.Files.create(
        { name: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
        blob,
        { fields: 'id', ocrLanguage: 'es' }
      ).id;
    } else if (typeof driveService.Files.insert === 'function') {
      docId = driveService.Files.insert(
        { title: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
        blob,
        { ocr: true, ocrLanguage: 'es' }
      ).id;
    }
  } else {
    const boundary = '-------314159265358979323846';
    const body =
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify({ title: 'temp_ocr_' + Date.now(), mimeType: 'application/vnd.google-apps.document' }) +
      `\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      Utilities.base64Encode(blob.getBytes()) +
      `\r\n--${boundary}--`;

    const response = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&ocr=true&ocrLanguage=es',
      {
        method: 'post',
        contentType: 'multipart/related; boundary=' + boundary,
        payload: body,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      }
    );
    if (response.getResponseCode() !== 200) {
      throw new Error(
        `Fallo en el OCR de Google Drive (código ${response.getResponseCode()}). Activa el servicio 'Drive API' en Apps Script (Servicios + > Drive API > Añadir).`
      );
    }
    docId = (JSON.parse(response.getContentText()) as { id: string }).id;
  }

  if (!docId) throw new Error('No se pudo crear el documento temporal de OCR.');

  try {
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    DriveApp.getFileById(docId).setTrashed(true);
  }
}

/**
 * Extrae el texto de un PDF convirtiéndolo temporalmente a Google Docs con OCR.
 * Incluye reintento automático de hasta 3 intentos con pausa progresiva para absorber
 * microcortes temporales de Google Drive ('Internal Error').
 */
export function extractTextFromPdfBlob(blob: GoogleAppsScript.Base.Blob): string {
  const MAX_RETRIES = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return executeSingleOcr(blob);
    } catch (err: unknown) {
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
export function appendTicketToListaSheet(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  ticket: TicketData,
  fileUrl: string,
  fileName: string
): void {
  if (ticket.items.length === 0) return;

  const date: CellValue = parseTicketDate(ticket.dateTime) ?? ticket.dateTime;

  const rows: CellValue[][] = ticket.items.map((item) => [
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
function appendTicketsRow(sheet: GoogleAppsScript.Spreadsheet.Sheet, row: CellValue[]): void {
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, TICKETS_HEADERS.length).setValues([row]);
  sheet.getRange(r, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(r, 4, 1, 3).setNumberFormat('#,##0.00 €');
  sheet.getRange(r, 12).setNumberFormat('dd/mm/yyyy hh:mm');
}

function appendTicketControlRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  ticket: TicketData,
  validation: TicketValidation,
  fileUrl: string,
  fileName: string,
  messageId: string
): void {
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

function appendErrorControlRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  messageDate: Date | GoogleAppsScript.Base.Date,
  fileName: string,
  error: string,
  messageId: string
): void {
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

// ---------------------------------------------------------------------------
// Proceso principal
// ---------------------------------------------------------------------------

export interface ProcessOptions {
  /** Número máximo de correos a procesar en esta ejecución. */
  maxMessages: number;
  /** Momento (ms) a partir del cual no se empieza ningún correo nuevo. */
  deadline: number;
}

interface Candidate {
  thread: GoogleAppsScript.Gmail.GmailThread;
  message: GoogleAppsScript.Gmail.GmailMessage;
}

function isStopRequested(): boolean {
  return PropertiesService.getScriptProperties().getProperty('STOP_REQUESTED') === 'true';
}

function isPdf(att: GoogleAppsScript.Gmail.GmailAttachment): boolean {
  return att.getContentType() === 'application/pdf' || att.getName().toLowerCase().endsWith('.pdf');
}

/**
 * Busca los correos de Mercadona pendientes. El control se hace correo a correo
 * (por su identificador), no por conversación, para no perder tickets que Gmail
 * agrupe en una conversación ya etiquetada.
 */
function findPendingMessages(
  knownMessageIds: Set<string>,
  threadMessageIds: Map<string, string[]>,
  okLabel: GoogleAppsScript.Gmail.GmailLabel,
  options: ProcessOptions
): { candidates: Candidate[]; searchExhausted: boolean } {
  const candidates: Candidate[] = [];
  const seenThreads = new Set<string>();
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
      if (threads.length === 0) break;
      const messagesPerThread = GmailApp.getMessagesForThreads(threads);

      threads.forEach((thread, i) => {
        const threadId = thread.getId();
        if (seenThreads.has(threadId)) return;
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
      if (threads.length < PAGE) break;
    }
  }

  return { candidates, searchExhausted };
}

/**
 * Procesa los correos de tickets pendientes respetando el límite de tiempo y la parada de emergencia.
 */
export function processPendingTickets(options: ProcessOptions): ProcessBatchResult {
  const result: ProcessBatchResult = {
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

  const threadMessageIds = new Map<string, string[]>();
  const { candidates, searchExhausted } = findPendingMessages(knownMessageIds, threadMessageIds, okLabel, options);
  console.log(`Correos pendientes encontrados en esta vuelta: ${candidates.length}`);

  let handled = 0;
  for (const { thread, message } of candidates) {
    if (handled >= options.maxMessages) break;
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
      setExecutionStatus(
        'EJECUTANDO',
        'Importando tickets',
        `Procesando ticket ${handled + 1} de ${candidates.length} (${attName})...`
      );
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
      } catch (err: unknown) {
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
export function countTicketsByStatus(): { ok: number; review: number; error: number } {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TICKETS);
  const counts = { ok: 0, review: 0, error: 0 };
  if (!sheet || sheet.getLastRow() <= 1) return counts;
  for (const row of sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).getValues()) {
    const s = String(row[0] ?? '');
    if (s.includes('REVISAR')) counts.review++;
    else if (s.includes('ERROR')) counts.error++;
    else if (s.includes('OK')) counts.ok++;
  }
  return counts;
}

/**
 * Repara todas las celdas de la hoja 'Lista' y 'Tickets' que contengan fórmulas #ERROR!,
 * textos 'RichTextValue' sin enlace o enlaces antiguos, sustituyéndolos por hipervínculos
 * nativos directos de Google Sheets enlazados al archivo PDF correspondiente en Drive.
 */
export function repararEnlacesErrorExistentes(): { listaReparados: number; ticketsReparados: number } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let listaReparados = 0;
  let ticketsReparados = 0;

  const folder = getOrCreateTicketsFolder();
  // Obtener todos los archivos PDF existentes en la subcarpeta Archivos_tickets
  const allFiles: { name: string; url: string }[] = [];
  const fileIter = folder.getFiles();
  while (fileIter.hasNext()) {
    const f = fileIter.next();
    allFiles.push({ name: f.getName(), url: f.getUrl() });
  }

  function findDriveFile(invoice: string, rawText: string): { url: string; name: string } | null {
    const cleanInvoice = invoice ? invoice.trim() : '';
    if (cleanInvoice) {
      // Coincidencia exacta por número de factura simplificada en el nombre del PDF
      const byInvoice = allFiles.find((f) => f.name.includes(cleanInvoice));
      if (byInvoice) return byInvoice;
    }
    const cleanRaw = rawText ? rawText.trim() : '';
    if (cleanRaw && cleanRaw !== 'RichTextValue' && !cleanRaw.includes('ERROR') && cleanRaw !== 'PDF' && cleanRaw !== 'Ver PDF') {
      const byName = allFiles.find((f) => f.name.includes(cleanRaw) || cleanRaw.includes(f.name));
      if (byName) return byName;
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
    const rtvs: GoogleAppsScript.Spreadsheet.RichTextValue[][] = [];
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
        rtvs.push([existingRtv!]);
      } else if (driveMatch) {
        rtvs.push([SpreadsheetApp.newRichTextValue().setText(driveMatch.name).setLinkUrl(driveMatch.url).build()]);
        changed = true;
        listaReparados++;
      } else if (parsed && parsed.url) {
        rtvs.push([SpreadsheetApp.newRichTextValue().setText(parsed.label).setLinkUrl(parsed.url).build()]);
        changed = true;
        listaReparados++;
      } else if (value.includes('ERROR') && formula) {
        const match = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']\s*[,;]\s*["']([^"']+)["']\s*\)/i);
        if (match && match[1] && match[2]) {
          rtvs.push([SpreadsheetApp.newRichTextValue().setText(match[2]).setLinkUrl(match[1]).build()]);
          changed = true;
          listaReparados++;
        } else {
          rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
        }
      } else {
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
    const rtvs: GoogleAppsScript.Spreadsheet.RichTextValue[][] = [];
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
        rtvs.push([existingRtv!]);
      } else if (driveMatch) {
        rtvs.push([SpreadsheetApp.newRichTextValue().setText(driveMatch.name).setLinkUrl(driveMatch.url).build()]);
        changed = true;
        ticketsReparados++;
      } else if (parsed && parsed.url) {
        rtvs.push([SpreadsheetApp.newRichTextValue().setText(parsed.label).setLinkUrl(parsed.url).build()]);
        changed = true;
        ticketsReparados++;
      } else if (value.includes('ERROR') && formula) {
        const match = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']\s*[,;]\s*["']([^"']+)["']\s*\)/i);
        if (match && match[1] && match[2]) {
          rtvs.push([SpreadsheetApp.newRichTextValue().setText(match[2]).setLinkUrl(match[1]).build()]);
          changed = true;
          ticketsReparados++;
        } else {
          rtvs.push([SpreadsheetApp.newRichTextValue().setText(value).build()]);
        }
      } else {
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
export function retryFailedTickets(): { retried: number; recovered: number; stillFailing: number } {
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
  const errorRowIndices: number[] = [];
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Reintento de mensaje ${messageId} falló: ${errMsg}`);
      ticketsSheet.getRange(rowNum, 9).setValue(`Reintento fallido: ${errMsg}`);
      stillFailing++;
      logActivity('REINTENTO_FALLIDO', `Fila ${rowNum}: ${errMsg}`, 'ERROR');
    }
  }

  return { retried: errorRowIndices.length, recovered, stillFailing };
}
