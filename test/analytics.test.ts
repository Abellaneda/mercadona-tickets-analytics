import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalyticsFromRows } from '../src/services/analyticsService.ts';
import type { ProductUnit } from '../src/types/index.ts';

test('Analytics - Totales, ticket medio, gasto mensual cronológico y exclusión de bolsas en Top 10', () => {
  const sampleRows = [
    // Ticket 1 (Enero): Leche 5€ + Plátano 5€ + Bolsa 0.30€ = 10.30€
    {
      pdfFileUrl: 'https://drive.google.com/file1',
      pdfFileName: 'ticket1.pdf',
      dateTime: '10/01/2026 10:00',
      productName: 'LECHE SEMI',
      unitPrice: 1.0,
      quantity: 5,
      amount: 5.0,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-001',
      storeName: 'Mercadona Centro',
    },
    {
      pdfFileUrl: 'https://drive.google.com/file1',
      pdfFileName: 'ticket1.pdf',
      dateTime: '10/01/2026 10:00',
      productName: 'PLATANO',
      unitPrice: 2.0,
      quantity: 2.5,
      amount: 5.0,
      unit: 'kg' as ProductUnit,
      invoiceNumber: 'INV-001',
      storeName: 'Mercadona Centro',
    },
    {
      pdfFileUrl: 'https://drive.google.com/file1',
      pdfFileName: 'ticket1.pdf',
      dateTime: '10/01/2026 10:00',
      productName: 'BOLSA PLASTICO',
      unitPrice: 0.15,
      quantity: 2,
      amount: 0.3,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-001',
      storeName: 'Mercadona Centro',
    },
    // Ticket 2 (Febrero): Leche 12€ + Arroz 8€ - Descuento 0.30€ = 19.70€
    {
      pdfFileUrl: 'https://drive.google.com/file2',
      pdfFileName: 'ticket2.pdf',
      dateTime: '15/02/2026 18:00',
      productName: 'LECHE SEMI',
      unitPrice: 1.2,
      quantity: 10,
      amount: 12.0,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-002',
      storeName: 'Mercadona Centro',
    },
    {
      pdfFileUrl: 'https://drive.google.com/file2',
      pdfFileName: 'ticket2.pdf',
      dateTime: '15/02/2026 18:00',
      productName: 'ARROZ',
      unitPrice: 1.6,
      quantity: 5,
      amount: 8.0,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-002',
      storeName: 'Mercadona Centro',
    },
    {
      pdfFileUrl: 'https://drive.google.com/file2',
      pdfFileName: 'ticket2.pdf',
      dateTime: '15/02/2026 18:00',
      productName: 'BAJADA DE PRECIO',
      unitPrice: -0.3,
      quantity: 1,
      amount: -0.3,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-002',
      storeName: 'Mercadona Centro',
    },
  ];

  const res = computeAnalyticsFromRows(sampleRows);

  // El total del ticket SÍ incluye bolsas y descuentos (10.30 + 19.70 = 30.00 €)
  assert.equal(res.totalTickets, 2);
  assert.equal(res.totalSpend, 30.0);
  assert.equal(res.averageTicket, 15.0);
  assert.equal(res.averageMonthlySpend, 15.0);

  // El gasto mensual viene ordenado cronológicamente (01/2026 -> 02/2026)
  assert.equal(res.monthlySpend.length, 2);
  assert.equal(res.monthlySpend[0]?.label, '01/2026');
  assert.equal(res.monthlySpend[0]?.totalAmount, 10.3);
  assert.equal(res.monthlySpend[1]?.label, '02/2026');
  assert.equal(res.monthlySpend[1]?.totalAmount, 19.7);

  // Ni BOLSA PLASTICO ni BAJADA DE PRECIO aparecen en el Top 10 de productos
  assert.equal(
    res.top10MostPurchased.some((p) => p.productName.includes('BOLSA')),
    false
  );
  assert.equal(
    res.top10MostPurchased.some((p) => p.productName.includes('BAJADA')),
    false
  );
});

test('Analytics - Control de inflación de los 40 productos (máximo, mínimo, último y fechas)', () => {
  const sampleRows = [
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '01/01/2026 10:00',
      productName: 'ACEITE DE OLIVA',
      unitPrice: 5.0,
      quantity: 1,
      amount: 5.0,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-001',
      storeName: 'Mercadona Albacete',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '01/02/2026 10:00',
      productName: 'ACEITE DE OLIVA',
      unitPrice: 9.5,
      quantity: 1,
      amount: 9.5,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-002',
      storeName: 'Mercadona Albacete',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '01/03/2026 10:00',
      productName: 'ACEITE DE OLIVA',
      unitPrice: 8.0,
      quantity: 1,
      amount: 8.0,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-003',
      storeName: 'Mercadona Albacete',
    },
  ];

  const res = computeAnalyticsFromRows(sampleRows);
  const aceite = res.top40ProductsInflation.find((p) => p.productName === 'ACEITE DE OLIVA');

  assert.ok(aceite);
  assert.equal(aceite.timesPurchased, 3);
  assert.equal(aceite.minPrice, 5.0);
  assert.equal(aceite.minDate, '01/01/2026 10:00');
  assert.equal(aceite.maxPrice, 9.5);
  assert.equal(aceite.maxDate, '01/02/2026 10:00');
  assert.equal(aceite.lastPrice, 8.0);
  assert.equal(aceite.lastDate, '01/03/2026 10:00');
  assert.equal(aceite.priceChangePct, 60.0);
});

test('Analytics - Productos abandonados según su propio ritmo habitual de compra', () => {
  // Referencia: 15 de marzo de 2026
  const refTime = new Date(2026, 2, 15).getTime();

  const sampleRows = [
    // Producto quincenal (comprado cada ~10 días en enero, pero lleva 44 días sin comprarse -> abandonado)
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '10/01/2026 10:00',
      productName: 'KEFIR NATURAL',
      unitPrice: 1.3,
      quantity: 1,
      amount: 1.3,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-1',
      storeName: 'Mercadona',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '20/01/2026 10:00',
      productName: 'KEFIR NATURAL',
      unitPrice: 1.3,
      quantity: 1,
      amount: 1.3,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-2',
      storeName: 'Mercadona',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '30/01/2026 10:00',
      productName: 'KEFIR NATURAL',
      unitPrice: 1.3,
      quantity: 1,
      amount: 1.3,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-3',
      storeName: 'Mercadona',
    },
    // Producto bimensual (comprado cada ~60 días, última compra hace 44 días -> sigue en su ritmo normal, NO abandonado)
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '01/10/2025 10:00',
      productName: 'DETERGENTE ROPA',
      unitPrice: 6.5,
      quantity: 1,
      amount: 6.5,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-4',
      storeName: 'Mercadona',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '01/12/2025 10:00',
      productName: 'DETERGENTE ROPA',
      unitPrice: 6.5,
      quantity: 1,
      amount: 6.5,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-5',
      storeName: 'Mercadona',
    },
    {
      pdfFileUrl: '',
      pdfFileName: '',
      dateTime: '30/01/2026 10:00',
      productName: 'DETERGENTE ROPA',
      unitPrice: 6.5,
      quantity: 1,
      amount: 6.5,
      unit: 'ud' as ProductUnit,
      invoiceNumber: 'INV-6',
      storeName: 'Mercadona',
    },
  ];

  const res = computeAnalyticsFromRows(sampleRows, { referenceTimestamp: refTime });

  assert.equal(res.top10Abandoned.length, 1);
  assert.equal(res.top10Abandoned[0]?.productName, 'KEFIR NATURAL');
  assert.equal(res.top10Abandoned[0]?.usualIntervalDays, 10);
  assert.equal(
    res.top10Abandoned.some((p) => p.productName === 'DETERGENTE ROPA'),
    false
  );
});
