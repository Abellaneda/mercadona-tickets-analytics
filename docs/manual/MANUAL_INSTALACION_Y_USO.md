# 🛒 Manual de Instalación y Uso: Mercadona Tickets Analytics

Este manual explica paso a paso cómo actualizar y manejar la automatización en tu hoja de cálculo **`Listado_tickets`**. El sistema funciona de forma **100% gratuita y desatendida** en los servidores de Google, incluso con tu ordenador apagado.

---

## 1. Pegar el Código en Google Sheets

1. Abre tu hoja de cálculo **`Listado_tickets`** en Google Drive.
2. En la barra superior, haz clic en **`Extensiones`** > **`Apps Script`**.
3. En la columna izquierda del editor:
   - Comprueba que en **`Servicios (+)`** sigue apareciendo **`Drive`** (ya lo tienes activado; si alguna vez instalas esto en otra hoja nueva, pulsa `+` junto a *Servicios*, elige **Drive API** y pulsa *Añadir*).
4. Haz clic en el archivo **`Código.gs`**:
   - Selecciona todo el código antiguo (`Ctrl + A`) y bórralo.
   - Abre en tu ordenador el archivo empaquetado:
     `C:\Users\Luis\antigravity\Mercadona-Tickets-Analytics\dist\Codigo_AppsScript.gs`
   - Copia todo su contenido y pégalo en `Código.gs`.
5. Pulsa **Guardar** (icono de disquete 💾 o `Ctrl + S`).
6. Cierra la pestaña de Apps Script y **recarga la pestaña de `Listado_tickets` (`F5`)**.

---

## 2. Reparar Enlaces y Reintentar Errores (Si ya tienes datos importados)

Si ya tienes tickets importados y quieres dejarlos limpios al instante sin tener que volver a descargarlo todo:

1. **Reparar enlaces `#ERROR!`:**
   - Haz clic en **`🛒 Mercadona`** > **`🔧 Reparar enlaces #ERROR! existentes`**.
   - En un segundo convertirá todos los enlaces a formato nativo directo de Google Sheets. El texto `#ERROR!` desaparecerá y verás el enlace clicable en azul al PDF en Drive.
2. **Recuperar tickets en `❌ ERROR`:**
   - Haz clic en **`🛒 Mercadona`** > **`🔁 Reintentar solo los tickets en ERROR`**.
   - El script buscará solo las filas rojas de la pestaña `Tickets`, volverá a leer esos correos con el sistema de reintento automático x3 de Google Drive, insertará las líneas en `Lista`, convertirá la fila de `Tickets` en verde `✅ OK` y actualizará tu panel `Análisis`.
3. **Ver el avance en tiempo real:**
   - Haz clic en **`🛒 Mercadona`** > **`📡 Ver estado de ejecución en tiempo real`** para ver el semáforo y los últimos eventos registrados.

*(Alternativa opcional: Si prefieres empezar 100% desde cero, puedes pulsar **`🛒 Mercadona` > `🔄 Reiniciar importación desde cero (con copia de seguridad)`** y después **`⚡ Importar TODO el histórico automáticamente`**).*

---

## 3. Activar la Comprobación Diaria Automática

1. Haz clic en **`🛒 Mercadona`** > **`⏰ Activar comprobación automática diaria (09:00)`**.
2. Cada mañana entre las 09:00 y las 10:00 AM, Google comprobará si tienes algún ticket nuevo de `ticket_digital@mail.mercadona.com`:
   - **Si hay compra nueva:** guarda el PDF en tu carpeta `Archivos_tickets` de Drive, añade todos los productos a `Lista`, verifica que el total cuadre al céntimo en `Tickets`, actualiza las gráficas de `Análisis` y **te envía un email de confirmación** con el resumen del ticket importado.
   - **Si algún ticket tuviera algún problema de lectura:** lo reintenta hasta 3 veces automáticamente y, si no puede, te avisa por email.
   - **Si ese día no has comprado en Mercadona:** no hace nada ni envía ningún correo.

*(Puedes activar o desactivar los avisos por email cuando quieras desde **`🛒 Mercadona` > `📧 Avisos por email`**).*

---

## 4. Hojas de tu Documento y Qué Contiene Cada Una

### 📋 Pestaña `Lista` (Detalle línea a línea)
Contiene cada artículo comprado con enlace nativo al PDF, fecha real de compra, precio unitario (`€/ud` o `€/kg`), cantidad, importe total del producto, unidad, número de factura simplificada y tienda/ciudad.

### 🧾 Pestaña `Tickets` (Control contable y conciliación)
Comprueba fila a fila cada ticket recibido:
- Compara el **Total impreso (€)** con la **Suma de los productos leídos (€)**.
- `✅ OK` (Verde): La suma cuadra al céntimo (diferencia `0,00 €`).
- `⚠️ REVISAR` (Amarillo): Diferencia detectada o fecha no encontrada.
- `❌ ERROR` (Rojo): Fallo puntual de red o lectura (reparable con un clic en *"Reintentar solo los tickets en ERROR"*).

### 📊 Pestaña `Análisis` (Cuadro de Mando)
- **5 KPIs superiores:** Gasto total acumulado, total de tickets, ticket medio, gasto medio mensual y estado de verificación.
- **2 Gráficos cronológicos:** Evolución del importe de cada ticket + gasto mensual agregado (`mm/aaaa`).
- **Top 10 más comprados** (sin bolsas de plástico) y **Top 10 abandonados** (adaptado al ritmo de compra propio de cada producto).
- **Top 40 precios e inflación:** Último precio y fecha, máximo histórico y fecha, mínimo histórico y fecha, y % de variación con colores.
- **Histórico completo de tickets** (abajo para no desplazar tus gráficas).

### 📡 Pestaña `Estado` (Seguimiento en vivo)
Muestra un semáforo visual (`🟢 EN REPOSO`, `🔄 EJECUTANDO AHORA`, `⏳ ESPERANDO SIGUIENTE TANDA`), el detalle de avance, contadores de tickets y el histórico de los últimos 15 eventos.

### 📖 Pestaña `Instrucciones`
Manual integrado dentro de tu propio Google Sheets para consulta rápida en cualquier momento sin salir del navegador.

---

## 5. Botones del Menú `🛒 Mercadona`

- **`🛑 DETENER TODAS LAS EJECUCIONES AHORA`:** Parada de emergencia. Detiene cualquier tanda en curso y borra activadores.
- **`📥 Importar tickets nuevos (1 lote)`:** Importa de inmediato hasta 15 tickets pendientes.
- **`⚡ Importar TODO el histórico automáticamente`:** Carga histórica completa por tandas de 4 minutos con un único email final.
- **`🔁 Reintentar solo los tickets en ERROR`:** Reprocesa únicamente las facturas en rojo de la pestaña `Tickets`.
- **`🔧 Reparar enlaces #ERROR! existentes`:** Elimina el error de idioma en la columna de PDF y lo convierte en enlace nativo.
- **`📊 Actualizar panel de Análisis`:** Recalcula todas las métricas y gráficas a partir de `Lista`.
- **`📡 Ver estado de ejecución en tiempo real`:** Abre y actualiza la pestaña `Estado`.
- **`📖 Ver manual de Instrucciones`:** Abre y actualiza la pestaña `Instrucciones`.
- **`⏰ Activar comprobación automática diaria (09:00)`:** Automatización desatendida matinal.
- **`🛑 Desactivar comprobación automática`:** Elimina las comprobaciones automáticas diarias.
- **`📧 / 🔕 Avisos por email`:** Conmuta las notificaciones por correo.
- **`🔍 Diagnosticar último ticket en detalle`:** Vuelca en `Diagnóstico` el OCR crudo para auditoría.
- **`🔄 Reiniciar importación desde cero (con copia de seguridad)`:** Limpieza segura previa copia oculta.
