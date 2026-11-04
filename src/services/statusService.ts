import type { ActivityLogEntry, ExecutionState, SystemStatus } from '../types/index.ts';

const STATUS_KEYS = {
  state: 'STATUS_STATE',
  action: 'STATUS_ACTION',
  progress: 'STATUS_PROGRESS',
  lastUpdate: 'STATUS_LAST_UPDATE',
  lastRun: 'STATUS_LAST_RUN',
  logs: 'STATUS_LOGS',
} as const;

const MAX_LOGS = 15;

/**
 * Registra un evento en el histórico de actividad reciente del sistema.
 */
export function logActivity(
  event: string,
  detail: string,
  status: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' = 'INFO'
): void {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Europe/Madrid', 'dd/MM/yyyy HH:mm:ss');

  const rawLogs = props.getProperty(STATUS_KEYS.logs);
  let logs: ActivityLogEntry[] = [];
  if (rawLogs) {
    try {
      logs = JSON.parse(rawLogs) as ActivityLogEntry[];
    } catch {
      logs = [];
    }
  }

  logs.unshift({
    timestamp: timeStr,
    event,
    detail,
    status,
  });

  if (logs.length > MAX_LOGS) {
    logs = logs.slice(0, MAX_LOGS);
  }

  props.setProperty(STATUS_KEYS.logs, JSON.stringify(logs));
}

/**
 * Actualiza el estado de ejecución global (consultable en tiempo real).
 */
export function setExecutionStatus(
  state: ExecutionState,
  action: string,
  progressMsg: string
): void {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Europe/Madrid', 'dd/MM/yyyy HH:mm:ss');

  props.setProperties({
    [STATUS_KEYS.state]: state,
    [STATUS_KEYS.action]: action,
    [STATUS_KEYS.progress]: progressMsg,
    [STATUS_KEYS.lastUpdate]: timeStr,
    ...(state === 'EN_REPOSO' ? { [STATUS_KEYS.lastRun]: timeStr } : {}),
  });
}

/**
 * Obtiene el estado actual de ejecución y los últimos registros de actividad.
 */
export function getExecutionStatus(): SystemStatus {
  const props = PropertiesService.getScriptProperties();
  const state = (props.getProperty(STATUS_KEYS.state) as ExecutionState) || 'EN_REPOSO';
  const currentAction = props.getProperty(STATUS_KEYS.action) || 'Sistema en espera';
  const progressMsg = props.getProperty(STATUS_KEYS.progress) || 'Sin operaciones en curso';
  const lastUpdate = props.getProperty(STATUS_KEYS.lastUpdate) || 'Sin registrar';
  const lastExecutionDate = props.getProperty(STATUS_KEYS.lastRun) || 'Sin registrar';

  const rawLogs = props.getProperty(STATUS_KEYS.logs);
  let logs: ActivityLogEntry[] = [];
  if (rawLogs) {
    try {
      logs = JSON.parse(rawLogs) as ActivityLogEntry[];
    } catch {
      logs = [];
    }
  }

  return {
    state,
    currentAction,
    progressMsg,
    lastUpdate,
    lastExecutionDate,
    logs,
  };
}

/**
 * Muestra una notificación emergente nativa (toast) en la esquina inferior derecha de Google Sheets.
 */
export function showFloatingToast(
  message: string,
  title = '🛒 Mercadona',
  timeoutSec = 5
): void {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      ss.toast(message, title, timeoutSec);
    }
  } catch {
    // Si corre en segundo plano sin ventana activa, se ignora silenciosamente
  }
}
