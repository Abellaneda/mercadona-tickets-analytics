import type { ImportedTicketInfo, ProcessBatchResult } from '../types/index.ts';

const PROP_EMAIL_ENABLED = 'EMAIL_NOTIFICATIONS_ENABLED';

export interface HistoricalImportSummary {
  totalProcessed: number;
  totalSkipped: number;
  totalReview: number;
  totalErrors: number;
  startedAtIso: string;
}

/** Comprueba si los avisos por correo están activados (activos por defecto). */
export function areEmailNotificationsEnabled(): boolean {
  const val = PropertiesService.getScriptProperties().getProperty(PROP_EMAIL_ENABLED);
  return val !== 'false';
}

/** Activa o desactiva los avisos por correo electrónico. */
export function setEmailNotificationsEnabled(enabled: boolean): void {
  PropertiesService.getScriptProperties().setProperty(
    PROP_EMAIL_ENABLED,
    enabled ? 'true' : 'false'
  );
}

function getRecipientEmail(): string {
  try {
    return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '';
  } catch {
    return '';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadgeHtml(status: ImportedTicketInfo['status']): string {
  if (status === 'OK') return '<span style="color:#1b5e20;font-weight:bold;">✅ OK</span>';
  if (status === 'REVISAR') return '<span style="color:#e65100;font-weight:bold;">⚠️ REVISAR</span>';
  return '<span style="color:#b71c1c;font-weight:bold;">❌ ERROR</span>';
}

/**
 * Envía aviso por email tras importar tickets nuevos o detectar errores
 * (no se llama en tandas intermedias del histórico).
 */
export function sendImportNotificationEmail(res: ProcessBatchResult, spreadsheetUrl: string): void {
  if (!areEmailNotificationsEnabled()) return;
  if (res.processedCount === 0 && res.errorsCount === 0) return;

  const recipient = getRecipientEmail();
  if (!recipient) return;

  const hasIssues = res.errorsCount > 0 || res.reviewCount > 0;
  const subject = hasIssues
    ? `⚠️ Mercadona Tickets: ${res.processedCount} importado(s) · ${res.reviewCount} a revisar · ${res.errorsCount} error(es)`
    : `✅ Mercadona Tickets: ${res.processedCount} nuevo(s) ticket(s) importado(s)`;

  const rowsHtml = res.importedTickets
    .map(
      (t) => `
      <tr>
        <td style="padding:8px;border:1px solid #d0d7de;">${escapeHtml(t.dateTime || '—')}</td>
        <td style="padding:8px;border:1px solid #d0d7de;">${escapeHtml(t.invoiceNumber)}</td>
        <td style="padding:8px;border:1px solid #d0d7de;text-align:right;">${t.status === 'ERROR' ? '—' : `${t.totalAmount.toFixed(2)} €`}</td>
        <td style="padding:8px;border:1px solid #d0d7de;text-align:center;">${t.status === 'ERROR' ? '—' : t.itemCount}</td>
        <td style="padding:8px;border:1px solid #d0d7de;">${statusBadgeHtml(t.status)}</td>
        <td style="padding:8px;border:1px solid #d0d7de;font-size:12px;color:#555;">${escapeHtml(t.observations || 'Cuadra al céntimo')}</td>
      </tr>`
    )
    .join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:720px;color:#1f2937;">
      <div style="background:#007A3D;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🛒 Resumen de Importación · Mercadona</h2>
      </div>
      <div style="border:1px solid #d0d7de;border-top:none;padding:18px;border-radius:0 0 8px 8px;">
        <p style="margin-top:0;">
          <strong>Tickets nuevos importados:</strong> ${res.processedCount} &nbsp;|&nbsp;
          <strong>Para revisar:</strong> ${res.reviewCount} &nbsp;|&nbsp;
          <strong>Errores:</strong> ${res.errorsCount}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:14px 0;">
          <thead>
            <tr style="background:#f4f6f8;">
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Fecha</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Factura</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:right;">Total</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:center;">Artículos</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Verificación</th>
              <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Detalle</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin-bottom:0;">
          <a href="${escapeHtml(spreadsheetUrl)}" style="display:inline-block;background:#007A3D;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;">
            Abrir Dashboard en Google Sheets
          </a>
        </p>
      </div>
    </div>
  `;

  try {
    MailApp.sendEmail({
      to: recipient,
      subject,
      htmlBody,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`No se pudo enviar el email de notificación: ${msg}`);
  }
}

/**
 * Envía un ÚNICO email con el resumen global cuando finaliza toda la importación histórica.
 */
export function sendHistoricalCompleteEmail(
  summary: HistoricalImportSummary,
  spreadsheetUrl: string,
  okTotalInSheet: number
): void {
  if (!areEmailNotificationsEnabled()) return;

  const recipient = getRecipientEmail();
  if (!recipient) return;

  const hasIssues = summary.totalErrors > 0 || summary.totalReview > 0;
  const subject = hasIssues
    ? `📊 Mercadona Histórico Completado: ${summary.totalProcessed} importados (${summary.totalReview} a revisar, ${summary.totalErrors} errores)`
    : `🎉 Mercadona Histórico Completado: ${summary.totalProcessed} tickets importados sin fallos`;

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#1f2937;">
      <div style="background:#007A3D;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🛒 Importación Histórica Finalizada</h2>
      </div>
      <div style="border:1px solid #d0d7de;border-top:none;padding:18px;border-radius:0 0 8px 8px;">
        <p style="margin-top:0;">Ha terminado la carga completa de tu histórico de tickets de Mercadona:</p>
        <ul style="line-height:1.8;">
          <li><strong>Tickets importados en este proceso:</strong> ${summary.totalProcessed}</li>
          <li><strong>Tickets verificados al céntimo (✅ OK en hoja Tickets):</strong> ${okTotalInSheet}</li>
          <li><strong>Tickets marcados como ⚠️ REVISAR:</strong> ${summary.totalReview}</li>
          <li><strong>Correos con ❌ ERROR de lectura:</strong> ${summary.totalErrors}</li>
          <li><strong>Omitidos por existir previamente:</strong> ${summary.totalSkipped}</li>
        </ul>
        <p style="font-size:13px;color:#555;">
          Puedes consultar la pestaña <strong>Tickets</strong> para ver la conciliación individual de cada compra y la pestaña <strong>Análisis</strong> para explorar tu Dashboard completo.
        </p>
        <p style="margin-bottom:0;">
          <a href="${escapeHtml(spreadsheetUrl)}" style="display:inline-block;background:#007A3D;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;">
            Ver Dashboard y Hoja de Control
          </a>
        </p>
      </div>
    </div>
  `;

  try {
    MailApp.sendEmail({
      to: recipient,
      subject,
      htmlBody,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`No se pudo enviar el email de fin de histórico: ${msg}`);
  }
}
