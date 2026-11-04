# 🛒 DOSIER DE CONTEXTO: MERCADONA TICKETS ANALYTICS

Este documento contiene todo el contexto técnico, funcional, decisiones de arquitectura y estado del proyecto para que cualquier nuevo agente o chat dentro del workspace de Antigravity pueda continuar el trabajo sin pérdida de información.

---

## 1. 📌 Resumen Ejecutivo del Proyecto
- **Nombre del proyecto:** `Mercadona-Tickets-Analytics`
- **Ruta local del repositorio:** `C:\Users\Luis\antigravity\Mercadona-Tickets-Analytics`
- **Propósito:** Automatización integral, gratuita y 100% desatendida en la nube de Google para la ingesta, extracción OCR, conciliación contable y analítica inteligente de los tickets de compra digitales de Mercadona.
- **Flujo de datos:**
  `Gmail (ticket_digital@mail.mercadona.com)` ➔ `Google Drive (Archivos_tickets)` ➔ `Google Docs OCR (Drive API v3)` ➔ `Google Sheets (Listado_tickets) [Lista, Tickets, Análisis, Estado, Instrucciones]` ➔ `Notificaciones Gmail`.

---

## 2. 🗂️ Arquitectura del Repositorio Local

```text
C:\Users\Luis\antigravity\Mercadona-Tickets-Analytics\
├── src\
│   ├── types\index.ts               # Contratos e interfaces estrictos (sin 'any')
│   ├── utils\
│   │   ├── pdfParser.ts             # Parser de tickets (flujo continuo OCR y multilínea) + conciliación
│   │   └── sheetUtils.ts            # Formato de fechas, redondeo céntimo-exacto, hyperlinks
│   ├── services\
│   │   ├── analyticsService.ts      # Motor puro: KPIs, series mensuales, Top 10, abandonados, Top 40
│   │   ├── googleService.ts         # Integración Gmail, Drive v3 (reintento x3), hojas Lista, Tickets y _Correos
│   │   ├── notificationService.ts   # Emails HTML (aviso diario si hay ticket; email único final en histórico)
│   │   └── statusService.ts         # Seguimiento en vivo: semáforo, latidos, log de actividad y toasts
│   ├── ui\
│   │   ├── dashboardView.ts         # Renderizado de 'Análisis' (tarjetas KPI, 2 gráficos, rankings y tablas)
│   │   ├── statusView.ts            # Renderizado de pestaña '📡 Estado' (semáforo en tiempo real)
│   │   └── instructionsView.ts      # Renderizado de pestaña 'Instrucciones' (manual integrado)
│   └── main.ts                      # Menú '🛒 Mercadona', triggers de Apps Script, LockService y reinicio seguro
├── scripts\
│   └── build-gas.mjs                # Empaquetador TS -> dist/Codigo_AppsScript.gs con validación vm.Script
├── test\
│   ├── analytics.test.ts            # Tests de KPIs, inflación y productos abandonados
│   ├── deduplication.test.ts        # Tests de deduplicación de facturas e IDs de Gmail
│   └── pdfParser.test.ts            # Tests de tickets reales (97,67 € y 184,91 €), caracteres y tiendas
├── docs\
│   ├── DOSSIER_CONTEXTO.md          # Este documento de contexto para agentes
│   └── manual\
│       └── MANUAL_INSTALACION_Y_USO.md  # Manual paso a paso para el usuario
├── dist\
│   └── Codigo_AppsScript.gs         # Archivo único listo para pegar en Extensiones > Apps Script
├── package.json
└── tsconfig.json
```

---

## 3. 📊 Estructura del Libro Google Sheets (`Listado_tickets`)

1. **`Lista` (Detalle línea a línea de productos):**
   - Columnas: `Archivo_PDF` (enlace nativo RichText), `Fecha_ticket` (fecha real de Sheets `dd/mm/yyyy hh:mm`), `Producto`, `Precio_Kg_o_Ud`, `Cantidad`, `Importe`, `Unidad` (`ud` o `kg`), `Num_Factura`, `Tienda`.
2. **`Tickets` (Conciliación y auditoría contable al céntimo):**
   - Columnas: `Fecha`, `Nº Factura`, `Tienda`, `Total ticket (€)`, `Suma productos (€)`, `Diferencia (€)`, `Nº artículos`, `Estado`, `Observaciones`, `PDF`, `Id correo`, `Importado el`.
   - Estados con formato condicional: `✅ OK` (verde), `⚠️ REVISAR` (amarillo), `❌ ERROR` (rojo).
3. **`Análisis` (Cuadro de Mando inteligente):**
   - **5 Tarjetas KPI:** Gasto total acumulado, total de compras, precio medio por ticket, gasto medio mensual y estado de verificación de tickets.
   - **2 Gráficos cronológicos superiores:** Evolución del importe por compra (eje temporal real) + evolución de gasto mensual (`mm/aaaa`).
   - **Top 10 más comprados** (excluyendo accesorios como `BOLSA PLASTICO`).
   - **Top 10 recurrentes abandonados** (adaptativo al intervalo habitual de compra de cada artículo: inactivo $\ge \max(30d, 3 \times \text{intervalo})$ con $\ge 3$ compras previas).
   - **Top 40 control de precios e inflación:** Unidad (`€/ud` o `€/kg`), compras, último precio + fecha, máximo histórico + fecha, mínimo histórico + fecha, y `%` de variación con semáforo de color.
   - **Histórico completo de tickets y desglose mensual** ubicados abajo para nunca desplazar las gráficas.
4. **`📡 Estado` (Seguimiento en tiempo real):**
   - Semáforo visual: `🟢 EN REPOSO`, `🔄 EJECUTANDO AHORA`, `⏳ ESPERANDO SIGUIENTE TANDA HISTÓRICA`, `🛑 DETENIDO`.
   - Métricas en directo y registro de los últimos 15 eventos con hora exacta.
5. **`Instrucciones`:**
   - Manual completo incrustado directamente en la hoja de cálculo.
6. **`_Correos` (Hoja oculta):**
   - Guarda los Message IDs de Gmail procesados para permitir tickets adicionales dentro de conversaciones agrupadas.

---

## 4. 🛒 Opciones del Menú en Google Sheets (`🛒 Mercadona`)

- `🛑 DETENER TODAS LAS EJECUCIONES AHORA` (Parada de emergencia inmediata y borrado de triggers).
- `📥 Importar tickets nuevos (1 lote)` (Importación manual de hasta 15 tickets pendientes).
- `⚡ Importar TODO el histórico automáticamente` (Importación histórica en tandas seguras de 4 minutos; **sin emails intermedios, envía solo 1 email resumen final al terminar el 100%**).
- `🔁 Reintentar solo los tickets en ERROR` (Reprocesa exclusivamente las filas rojas de `Tickets`).
- `🔧 Reparar enlaces #ERROR! existentes` (Convierte fórmulas fallidas en enlaces nativos de Drive).
- `📊 Actualizar panel de Análisis` (Recalcula todo a partir de `Lista`).
- `📡 Ver estado de ejecución en tiempo real` (Abre y refresca la pestaña `Estado`).
- `📖 Ver manual de Instrucciones` (Abre y refresca la pestaña `Instrucciones`).
- `⏰ Activar comprobación automática diaria (09:00)` (Disparador diario matinal; **envía email si hay compra nueva o incidencia**).
- `🛑 Desactivar comprobación automática` (Elimina activadores diarios).
- `📧 / 🔕 Avisos por email` (Activa o desactiva notificaciones).
- `🔍 Diagnosticar último ticket en detalle` (Vuelca texto OCR crudo en la pestaña `Diagnóstico`).
- `🔄 Reiniciar importación desde cero (con copia de seguridad)` (Copia de respaldo oculta automática y limpieza de etiquetas).

---

## 5. 💡 Problemas Técnicos Críticos Resueltos (Lecciones Aprendidas)

1. **Formato OCR de Google Drive:**
   - Al convertir PDFs a Google Docs con OCR de Drive API v3, los productos se concatenan en **un flujo continuo de texto** (`Cnt. Descripción P. Unit Importe 1 ARTICULO 1,90 1 ARTICULO...`) y solo saltan línea en productos al peso (`kg` y `€/kg`). El parser `pdfParser.ts` está adaptado para procesar este stream continuo con expresiones regulares atómicas.
2. **Crash de `SpreadsheetApp.getUi()` en activadores en segundo plano:**
   - En Google Apps Script, invocar `getUi()` dentro de un activador basado en tiempo lanza excepción fatal. Se separó la función interactiva (`iniciarImportacionHistoricoCompleto`) de la función desatendida (`continuarImportacionHistoricoEnFondo`) usando `tryGetUi()`.
3. **Bloqueo de concurrencia y duplicados en Drive:**
   - Se usa `LockService.getScriptLock()` con timeout para impedir que dos ejecuciones simultáneas se pisen. Además, antes de crear un PDF en Drive se verifica con `folder.getFilesByName()` y se eliminan copias duplicadas `(1)`.
4. **Microcortes de Google Drive (`Internal Error`):**
   - El conversor OCR incluye un bucle de reintento automático de hasta **3 intentos** con pausa progresiva antes de catalogar un ticket como error.
5. **Separador regional de fórmulas e hipervínculos (`#ERROR!`):**
   - En España, Google Sheets requiere punto y coma (`;`) en fórmulas, mientras que Apps Script escribía `,`. Se sustituyeron las fórmulas por **hipervínculos nativos (`RichTextValue`)**, que son universales e inmunes al idioma.
6. **Extracción de Tienda delimitada:**
   - La búsqueda de dirección se acotó estrictamente al encabezado (antes de la factura simplificada) para evitar capturar nombres de productos como `C/ 4,00 1 FILETE PECHUGA...`.
7. **Empaquetado para Apps Script (Windows / Node v24):**
   - En Windows PowerShell, usar siempre `npm.cmd` (para evitar restricciones de ejecución de `.ps1`).
   - El script de compilación `build-gas.mjs` valida la sintaxis con `vm.Script` y elimina cualquier token `import`/`export`.

---

## 6. 🧪 Comandos de Verificación (QA)

Para comprobar el código en cualquier momento desde PowerShell:
```powershell
Set-Location "C:\Users\Luis\antigravity\Mercadona-Tickets-Analytics"

# 1. Comprobación de tipado estricto (0 errores)
npm.cmd run lint

# 2. Batería completa de pruebas unitarias (12/12 passing)
npm.cmd test

# 3. Compilación y validación sintáctica del bundle Apps Script
npm.cmd run build
```

---

## 7. 🚀 Archivo para Google Sheets
El código final compilado y verificado se encuentra siempre en:
`C:\Users\Luis\antigravity\Mercadona-Tickets-Analytics\dist\Codigo_AppsScript.gs`
Este archivo se copia y pega directamente en `Extensiones > Apps Script` dentro de la hoja `Listado_tickets`.
