/**
 * Vista y renderizado de la pestaña '📡 Estado'.
 * Muestra el semáforo de ejecución en tiempo real y el registro de eventos recientes.
 */

import { areEmailNotificationsEnabled } from '../services/notificationService.ts';
import { getExecutionStatus } from '../services/statusService.ts';

const HEADER_DARK = '#1F2937';
const STATUS_BORDER_COLOR = '#D0D7DE';

export function renderStatusSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
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
  } else if (status.state === 'ESPERANDO_TANDA') {
    badgeText = '⏳ EN PAUSA ENTRE TANDAS (Esperando 1 min)';
    badgeBg = '#E65100'; // Naranja
    badgeFg = '#FFFFFF';
  } else if (status.state === 'DETENIDO') {
    badgeText = '🛑 DETENIDO POR EL USUARIO';
    badgeBg = '#757575'; // Gris
    badgeFg = '#FFFFFF';
  } else if (status.state === 'ERROR') {
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
  const infoRows: [string, string][] = [
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
      if (s.includes('OK')) okCount++;
      else if (s.includes('REVISAR')) reviewCount++;
      else if (s.includes('ERROR')) errorCount++;
    }
  }

  const metricRows: [string, string | number][] = [
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
  } else {
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
