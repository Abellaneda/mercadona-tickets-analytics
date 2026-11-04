import type { TicketData, TicketItem, TicketValidation } from '../types/index.ts';
import { round2 } from './sheetUtils.ts';

/**
 * Convierte un número escrito en formato español ("1,30" / "1.234,56") o con punto decimal
 * ("1.300" que devuelve el OCR) a número de JavaScript.
 */
export function parseSpanishNumber(val: string): number {
  if (!val) return 0;
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
export function normalizeProductName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Convierte 'dd/mm/aaaa hh:mm' en un objeto Date (hora local). Devuelve null si no es válido.
 */
export function parseTicketDate(dateTime: string): Date | null {
  const m = dateTime.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const d = new Date(
    parseInt(m[3], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[1], 10),
    m[4] ? parseInt(m[4], 10) : 0,
    m[5] ? parseInt(m[5], 10) : 0
  );
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
const ITEM_SOURCE =
  `(?:(-?\\d+)\\s+)?(\\S.*?)\\s+` +
  `(?:(${NUM3})\\s*kg\\s+(${NUM2})\\s*(?:€|EUR|E)?\\s*\\/\\s*kg\\s+(${NUM2})` +
  `|(${NUM2})\\s+(${NUM2})` +
  `|(${NUM2}))` +
  `(?=\\s+\\S|\\s*$)`;

/**
 * Parsea el texto extraído de un ticket PDF de Mercadona.
 * Funciona tanto con texto línea a línea como con el texto continuo que devuelve el OCR de Drive.
 */
export function parseMercadonaTicketText(rawText: string, fileName = ''): TicketData {
  const text = rawText.replace(/\u00a0/g, ' ');
  const warnings: string[] = [];

  // 1. Fecha y hora (ej: 03/11/2026 19:19)
  let dateTime = '';
  const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
  if (dateMatch && dateMatch[1] && dateMatch[2]) {
    dateTime = `${dateMatch[1]} ${dateMatch[2]}`;
  } else {
    warnings.push('No se encontró la fecha del ticket');
  }

  // 2. Factura simplificada (ej: 3826-011-665994)
  let invoiceNumber = '';
  const invoiceMatch = text.match(/FACTURA\s+SIMPLIFICADA:?\s*([0-9A-Za-z\-_]+)/i);
  if (invoiceMatch && invoiceMatch[1]) {
    invoiceNumber = invoiceMatch[1].trim();
  } else {
    warnings.push('No se encontró el número de factura');
  }

  // 3. Tienda (dirección + ciudad)
  // Restringir la búsqueda estrictamente a la cabecera (antes de la factura simplificada o lista de productos)
  // para evitar capturar nombres de artículos que contengan abreviaturas de calle (ej. 'C/ 4,00 1 FILETE...')
  let storeName = 'Mercadona';
  const headerCutoff = Math.min(
    invoiceMatch?.index ?? text.length,
    dateMatch?.index ?? text.length,
    450
  );
  const headerSection = text.substring(0, headerCutoff > 0 ? headerCutoff : 450);

  const cityMatch = headerSection.match(/\b(\d{5})\s+([A-Za-zÁÉÍÓÚÜáéíóúüÑñ\- ]{2,30})/);
  const city = cityMatch && cityMatch[2] ? cityMatch[2].trim().replace(/\s+/g, ' ') : '';
  const addressMatch = headerSection.match(
    /(?:AVDA\.?|AV\.?|AVENIDA|C\/|C\.|CALLE|PLAZA|PZA\.?|CTRA\.?|CARRETERA|PASEO|P\.º|RONDA|CAMINO|GRAN VIA|TRAVESIA)\s+[^\r\n]{3,60}/i
  );
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
  } else if (address) {
    storeName = address;
  } else if (city) {
    storeName = `Mercadona (${city})`;
  }

  // 4. Bloque de productos: desde la cabecera hasta el primer TOTAL posterior
  let totalAmount = 0;
  const items: TicketItem[] = [];
  const headerMatch = new RegExp(HEADER_SOURCE, 'i').exec(text);

  if (!headerMatch) {
    warnings.push('No se encontró la cabecera de la lista de productos');
  } else {
    const afterHeader = text.substring(headerMatch.index + headerMatch[0].length);
    const totalMatch = /TOTAL\s*(?:\(€\))?\s*(-?\d+[,.]\d{2})/i.exec(afterHeader);

    let blockRaw = afterHeader;
    if (totalMatch && totalMatch[1]) {
      totalAmount = parseSpanishNumber(totalMatch[1]);
      blockRaw = afterHeader.substring(0, totalMatch.index);
    } else {
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
      if (!name) continue;

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
      } else if (m[6] && m[7]) {
        // Varias unidades con precio unitario impreso
        items.push({
          productName: name,
          quantity: qty,
          unitPrice: parseSpanishNumber(m[6]),
          amount: parseSpanishNumber(m[7]),
          unit: 'ud',
          isWeighted: false,
        });
      } else if (m[8]) {
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
export function validateTicket(ticket: TicketData): TicketValidation {
  const itemsSum = round2(ticket.items.reduce((acc, it) => acc + it.amount, 0));
  const difference = round2(ticket.totalAmount - itemsSum);
  const observations = [...ticket.warnings];

  if (Math.abs(difference) >= 0.01) {
    observations.push(
      `La suma de productos (${itemsSum.toFixed(2)} €) no coincide con el total (${ticket.totalAmount.toFixed(2)} €)`
    );
  }

  return {
    status: observations.length === 0 ? 'OK' : 'REVISAR',
    itemsSum,
    difference,
    itemCount: ticket.items.length,
    observations: observations.join('. '),
  };
}
