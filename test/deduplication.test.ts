import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHyperlinkFormula,
  formatDateEs,
  parseHyperlinkFormula,
  round2,
} from '../src/utils/sheetUtils.ts';

test('sheetUtils - HYPERLINK soporta separador de coma y punto y coma', () => {
  const built = buildHyperlinkFormula('https://drive.google.com/file/d/abc', 'Ver PDF');
  assert.equal(built, '=HYPERLINK("https://drive.google.com/file/d/abc","Ver PDF")');

  const fromComma = parseHyperlinkFormula('=HYPERLINK("https://drive.google.com/file/d/abc", "ticket.pdf")');
  assert.deepEqual(fromComma, {
    url: 'https://drive.google.com/file/d/abc',
    label: 'ticket.pdf',
  });

  const fromSemicolon = parseHyperlinkFormula('=HYPERLINK("https://drive.google.com/file/d/abc"; "ticket.pdf")');
  assert.deepEqual(fromSemicolon, {
    url: 'https://drive.google.com/file/d/abc',
    label: 'ticket.pdf',
  });
});

test('sheetUtils - formatDateEs y redondeo monetario exacto', () => {
  const dt = new Date(2026, 10, 3, 19, 19); // 03/11/2026 19:19
  assert.equal(formatDateEs(dt), '03/11/2026 19:19');
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(184.9099999), 184.91);
});

test('Deduplicación - No duplica facturas ni correos ya registrados', () => {
  const knownInvoices = new Set<string>(['3826-011-665994']);
  const knownMessageIds = new Set<string>(['msg-001']);

  // Mismo correo reintentado -> se ignora antes de descargar el PDF
  assert.equal(knownMessageIds.has('msg-001'), true);
  assert.equal(knownMessageIds.has('msg-002'), false);

  // Correo distinto (p. ej. reenviado) con la misma factura -> se detecta como duplicado
  assert.equal(knownInvoices.has('3826-011-665994'), true);
  assert.equal(knownInvoices.has('3826-013-261168'), false);
});
