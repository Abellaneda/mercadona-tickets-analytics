/**
 * Vista y renderizado de la pestaña 'Instrucciones'.
 * Vuelca el manual completo de instalación y uso en una hoja formateada y legible.
 */

const BRAND_DARK_GREEN = '#007A3D';
const SECTION_BG = '#E8F5E9';
const INSTR_BORDER_COLOR = '#D0D7DE';

export function renderInstructionsSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  let sheet = ss.getSheetByName('Instrucciones');
  if (!sheet) {
    sheet = ss.insertSheet('Instrucciones');
  }

  sheet.clear();
  sheet.setTabColor(BRAND_DARK_GREEN);

  // Anchos de columna optimizados para lectura tipo documento
  sheet.setColumnWidth(1, 24);  // Margen izq
  sheet.setColumnWidth(2, 860); // Columna de lectura principal
  sheet.setColumnWidth(3, 24);  // Margen der

  const sections: { type: 'TITLE' | 'SUBTITLE' | 'HEADER' | 'PARA' | 'BULLET' | 'TIP'; text: string }[] = [
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
    } else if (item.type === 'SUBTITLE') {
      cell.setFontSize(10).setFontStyle('italic').setFontColor('#555555');
      sheet.setRowHeight(currentRow, 24);
      currentRow += 2;
    } else if (item.type === 'HEADER') {
      cell.setFontSize(11).setFontWeight('bold').setFontColor(BRAND_DARK_GREEN).setBackground(SECTION_BG);
      sheet.getRange(currentRow, 2).setBorder(true, true, true, true, false, false, INSTR_BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
      sheet.setRowHeight(currentRow, 28);
      currentRow++;
    } else if (item.type === 'BULLET') {
      cell.setFontSize(10).setFontColor('#222222').setWrap(true);
      sheet.setRowHeight(currentRow, 22);
      currentRow++;
    } else if (item.type === 'TIP') {
      cell.setFontSize(9.5).setFontColor('#1B5E20').setBackground('#F1F8E9').setFontStyle('italic').setWrap(true);
      sheet.setRowHeight(currentRow, 24);
      currentRow++;
    }
  }

  sheet.getRange(2, 2, currentRow - 2, 1).setHorizontalAlignment('left');
}
