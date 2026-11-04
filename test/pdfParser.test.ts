import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMercadonaTicketText,
  parseSpanishNumber,
  parseTicketDate,
  validateTicket,
} from '../src/utils/pdfParser.ts';

// Ticket real 1: Albacete (97,67 € · 40 artículos)
const TICKET_ALBACETE_97 = `
MERCADONA, S.A. A-46103834
AVDA. CONSTANTINO ROMERO S/N
02005 ALBACETE
TELÉFONO: 967219522
17/07/2023 19:14 OP: 378512
FACTURA SIMPLIFICADA: 3826-013-261168
Descripción P. Unit Importe
1 LECHE SEMI S/LACT 5,88
1 GEL LIMPIADOR BAÑO 1,50
2 BOLSA PLASTICO 0,15 0,30
1 LECHE ENTERA PACK-6 7,74
1 TONICA P-6 LATAS 2,22
1 PATATA PREFREG. FINA 1,80
1 BURGER VACUNO CERDO 3,78
2 TÓNICA PINK ZERO 0,89 1,78
2 FTE MERLUZA AL HUEVO 4,60 9,20
1 MINI BOMBONES 12 UNI 2,40
1 CERDO TACOS 3,35
1 PECHUGA 2 UND 3,99
1 FILETE PECHUGA 4,28
1 MUSLO DESHUESADO 3,58
1 TORTILLA TRIGO 6 UN 1,60
1 JAMÓN SERRANO SOBRE 3,88
1 ARROZ REDONDO 1,30
1 P INTEGRAL TRIGO100% 1,63
1 GARBANZO M.COCIDO 0,79
1 12 HUEVOS SUELO 2,40
1 +PROT NATILLA VAINI 1,70
1 PAN M.100% INTEGRAL 0,95
1 QUESO LONCHAS SEMI 2,36
1 MINI TAQUITOS JAMON 2,49
1 PATATA 3 KG 4,30
1 ZANAHORIA EN TIRAS 1,20
1 JUDIA PLANA 1,15
1 ATUN CLARO NATURAL P 4,50
1 CEBOLLA 750 GR 1,50
1 GARBANZO M.COCIDO 0,70
1 PICADILLO VARIANTES 1,40
1 MAYONESA 500ML 1,25
1 ESPÁRRAGO CORTO DELG 1,55
1 LIMON MALLA 2,29
1 PENNE INTEGRAL 1,20
1 SAZONADOR PAELLA 1,40
1 PIMIENTO ROJO
0,282 kg 2,69 €/kg 0,76
1 BERENJENA
0,840 kg 1,69 €/kg 1,42
1 PLATANO
0,822 kg 2,10 €/kg 1,73
1 CALABACIN VERDE
0,422 kg 0,99 €/kg 0,42
TOTAL (€) 97,67
TARJETA BANCARIA 97,67
`;

// Ticket real 2: Albacete (184,91 € · 60 artículos en texto continuo de Drive OCR)
const TICKET_ALBACETE_184 = `
MERCADONA, S.A. A-46103834 
AV CONSTANTINO ROMERO 
02005 ALBACETE 
TELÉFONO: 967219522 
03/11/2026 19:19 OP: 976371 
FACTURA SIMPLIFICADA: 3826-011-665994 
Cnt. Descripción P. Unit Importe 1 EMPANADILLAS ATUN 1,90 1 SALTEADO DE VERDURAS 1,55 1 SALTEADO VERD. ASADA 1,80 1 PATATAS GAJO 1,65 1 ALBONDIGAS DE BACALA 2,10 1 PATATA PREFREG. FINA 1,85 1 BOLSA FIGURAS CHOCO 2,80 1 CHICLES MENTA FUERTE 1,00 1 LAGARTO CERDO 4,16 1 PANCETA 3,12 1 HAMB. CERDO IBÉRICO 3,90 1 PORCIÓN SALMÓN 9,54 1 MEDIA CARETA S/OREJA 3,01 1 LECHE ENTERA P6 9,36 1 BURGER M CERDO 500G 2,75 1 BENTO MIX 8,75 1 FILETE EXTRA-TIERNO 4,51 1 PECHUGA FAMILIAR 8,01 1 FILETE PECHUGA 4,87 1 CHOCOBUNS 1,50 1 TIRAS FRITAS 0,80 1 PAN RALLADO CASERO 1,00 1 200 SERVIL. BLANCAS 1,20 2 BARRA CAMPESINA 0,65 1,30 2 ESPONJA INFANTIL 1,90 3,80 1 SAZONADOR PAELLA 1,55 2 STICKS SALAMI 1,10 2,20 1 ROSQUILLA CACAO 1,55 1 CURCUMA 1,30 1 FUET ESPETEC EXTRA 2,50 1 BRAGUITAS T-17-30 KG 10,65 1 MANDARINA 1 KG 2,35 1 PATATAS CAMPESTRES 1,25 1 NACHOS 0,90 1 RESERVA LONCHAS 25,00 5,05 1 MAGDALENA CASERA 2,70 2 GARBANZO PEDROSILLAN 0,90 1,80 1 ACEITUNA ALIÑADA 1,90 1 TOM. RECETA ARTESANA 2,00 1 MERMELADA FRESA 1,45 2 CALDO POLLO 0,75 1,50 1 VINO BLANCO BRICK 0,95 1 HUMMUS CLASICO 1,05 1 PAN SEMILLAS 1,50 4 PIRULETA CHOCOLATE 1,50 6,00 1 Q.IBÉRICO PRECORTADO 4,58 1 T. NEGRO CRUJIENTE 2,20 1 PATATAS SERRANO 1,25 2 BOLSA PLASTICO 0,15 0,30 2 TOALLITA BEBE FRESC 0,75 1,50 1 ATÚN CON TOMATE P3 2,10 1 ATUN CLARO NATURAL 4,20 1 AJO SECO 250 G 1,85 1 TOMATE NATURAL RALLA 1,45 1 GUACAMOLE 500 GR 3,95 1 CHILI CON CARNE 2,80 1 COLA CAO 17,00 1 PATATA 
1,300 kg 1,90 €/kg 2,47 1 CALABACIN VERDE 
1,032 kg 1,40 €/kg 1,44 1 BANANA 
0,932 kg 1,55 €/kg 1,44 
TOTAL (€) 184,91 
TARJETA BANCARIA 184,91
`;

test('PDF Parser - Ticket 97,67 € (40 artículos y conciliación exacta OK)', () => {
  const ticket = parseMercadonaTicketText(TICKET_ALBACETE_97, 'ticket_97.pdf');
  const val = validateTicket(ticket);

  assert.equal(ticket.invoiceNumber, '3826-013-261168');
  assert.equal(ticket.dateTime, '17/07/2023 19:14');
  assert.equal(ticket.items.length, 40);
  assert.equal(ticket.totalAmount, 97.67);
  assert.match(ticket.storeName, /ALBACETE/i);
  assert.equal(val.status, 'OK');
  assert.equal(val.itemsSum, 97.67);
  assert.equal(val.difference, 0);
});

test('PDF Parser - Ticket 184,91 € (60 artículos en stream OCR de Drive y conciliación OK)', () => {
  const ticket = parseMercadonaTicketText(TICKET_ALBACETE_184, 'ticket_184.pdf');
  const val = validateTicket(ticket);

  assert.equal(ticket.invoiceNumber, '3826-011-665994');
  assert.equal(ticket.dateTime, '03/11/2026 19:19');
  assert.equal(ticket.storeName, 'AV CONSTANTINO ROMERO (ALBACETE)');
  assert.equal(ticket.items.length, 60);
  assert.equal(ticket.totalAmount, 184.91);
  assert.equal(val.status, 'OK');
  assert.equal(val.itemsSum, 184.91);
  assert.equal(val.difference, 0);

  const patata = ticket.items.find((i) => i.productName === 'PATATA' && i.isWeighted);
  assert.ok(patata);
  assert.equal(patata.quantity, 1.3);
  assert.equal(patata.unitPrice, 1.9);
  assert.equal(patata.amount, 2.47);
});

test('PDF Parser - Caracteres especiales, cabecera multipágina, descuentos y devoluciones', () => {
  const specialTicket = `
    MERCADONA, S.A.
    C/ MAYOR 12
    28013 MADRID
    12/05/2026 11:05
    FACTURA SIMPLIFICADA: 1111-222-333333
    Cnt. Descripción P. Unit Importe
    1 M&M'S CACAHUETE 2,35
    1 QUESO CURADO N.º 1 4,10
    Cnt. Descripción P. Unit Importe
    -1 YOGUR GRIEGO -1,20
    BAJADA DE PRECIO -0,50
    TOTAL (€) 4,75
  `;

  const ticket = parseMercadonaTicketText(specialTicket, 'especial.pdf');
  const val = validateTicket(ticket);

  assert.equal(ticket.storeName, 'C/ MAYOR 12 (MADRID)');
  assert.equal(ticket.items.length, 4);
  assert.equal(ticket.items[0]?.productName, "M&M'S CACAHUETE");
  assert.equal(ticket.items[1]?.productName, 'QUESO CURADO N.º 1');
  assert.equal(ticket.items[2]?.amount, -1.2);
  assert.equal(ticket.items[3]?.amount, -0.5);
  assert.equal(val.status, 'OK');
  assert.equal(val.itemsSum, 4.75);
});

test('PDF Parser - Dirección de tienda no se confunde con líneas de producto', () => {
  const ticketWithProductPrefix = `
    MERCADONA, S.A. A-46103834
    AVDA. ILUSTRACION 5
    02006 ALBACETE
    TELÉFONO: 967112233
    26/08/2026 20:44 OP: 123456
    FACTURA SIMPLIFICADA: 2496-011-953525
    Cnt. Descripción P. Unit Importe
    1 FILETE PECHUGA 4,74
    1 TOALLITAS 1,20
    TOTAL (€) 5,94
  `;

  const parsed = parseMercadonaTicketText(ticketWithProductPrefix);
  assert.equal(parsed.storeName, 'AVDA. ILUSTRACION 5 (ALBACETE)');
  assert.equal(parsed.invoiceNumber, '2496-011-953525');
  assert.equal(parsed.items.length, 2);
});

test('PDF Parser - Conciliación detecta descuadre o falta de fecha y marca REVISAR (sin inventar fecha)', () => {
  const brokenTicket = `
    MERCADONA, S.A.
    FACTURA SIMPLIFICADA: 9999-000-111111
    Descripción P. Unit Importe
    1 LECHE ENTERA 1,10
    TOTAL (€) 5,50
  `;

  const ticket = parseMercadonaTicketText(brokenTicket, 'incompleto.pdf');
  const val = validateTicket(ticket);

  assert.equal(ticket.dateTime, '');
  assert.equal(val.status, 'REVISAR');
  assert.equal(val.difference, 4.4);
  assert.match(val.observations, /No se encontró la fecha/);
  assert.match(val.observations, /no coincide con el total/);
});

test('PDF Parser - Números con coma española, miles y punto OCR', () => {
  assert.equal(parseSpanishNumber('1.234,56'), 1234.56);
  assert.equal(parseSpanishNumber('1,300'), 1.3);
  assert.equal(parseSpanishNumber('1.300'), 1.3);
  assert.equal(parseSpanishNumber('-0,50'), -0.5);

  const d = parseTicketDate('03/11/2026 19:19');
  assert.ok(d);
  assert.equal(d.getDate(), 3);
  assert.equal(d.getMonth(), 10); // Noviembre = 10 (base 0), sin confundir con 11 de marzo
  assert.equal(d.getFullYear(), 2026);
});
