/**
 * Contratos de datos estrictos para el sistema de tickets de Mercadona.
 * Diseñado conforme al protocolo de calidad y tipado estricto.
 */

export type ProductUnit = 'ud' | 'kg';

export type TicketStatus = 'OK' | 'REVISAR' | 'ERROR';

export type ExecutionState =
  | 'EN_REPOSO'
  | 'EJECUTANDO'
  | 'ESPERANDO_TANDA'
  | 'DETENIDO'
  | 'ERROR';

export interface ActivityLogEntry {
  timestamp: string;
  event: string;
  detail: string;
  status: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
}

export interface SystemStatus {
  state: ExecutionState;
  currentAction: string;
  progressMsg: string;
  lastUpdate: string;
  lastExecutionDate: string;
  logs: ActivityLogEntry[];
}

export interface TicketItem {
  productName: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  unit: ProductUnit;
  isWeighted: boolean;
}

export interface TicketData {
  invoiceNumber: string;
  /** Fecha en formato 'dd/mm/aaaa hh:mm'. Cadena vacía si no se encontró en el PDF. */
  dateTime: string;
  storeName: string;
  totalAmount: number;
  items: TicketItem[];
  /** Avisos detectados durante la lectura (fecha ausente, total ausente, etc.). */
  warnings: string[];
  rawPdfFileName?: string;
  pdfFileUrl?: string;
}

/** Resultado de la verificación (conciliación) de un ticket leído. */
export interface TicketValidation {
  status: TicketStatus;
  itemsSum: number;
  difference: number;
  itemCount: number;
  observations: string;
}

export interface TicketSummary {
  invoiceNumber: string;
  dateTime: string;
  storeName: string;
  totalAmount: number;
  pdfFileUrl: string;
  pdfFileName: string;
}

export interface ProductStats {
  productName: string;
  unit: ProductUnit;
  timesPurchased: number;
  totalAmountSpent: number;
  totalQuantity: number;
  lastPrice: number;
  lastDate: string;
  maxPrice: number;
  maxDate: string;
  minPrice: number;
  minDate: string;
  priceChangePct: number;
}

export interface AbandonedProduct {
  productName: string;
  timesPurchased: number;
  lastPurchasedDate: string;
  daysSinceLastPurchase: number;
  /** Intervalo medio (en días) entre compras de este producto. */
  usualIntervalDays: number;
}

export interface MonthlySpend {
  /** Clave ordenable 'aaaa-mm'. */
  monthKey: string;
  /** Etiqueta legible 'mm/aaaa'. */
  label: string;
  totalAmount: number;
  ticketCount: number;
}

export interface AnalyticsDashboardData {
  totalSpend: number;
  totalTickets: number;
  averageTicket: number;
  averageMonthlySpend: number;
  tickets: TicketSummary[];
  monthlySpend: MonthlySpend[];
  top10MostPurchased: ProductStats[];
  top10Abandoned: AbandonedProduct[];
  top40ProductsInflation: ProductStats[];
}

/** Resumen de un ticket importado (para avisos por email y mensajes en pantalla). */
export interface ImportedTicketInfo {
  invoiceNumber: string;
  dateTime: string;
  totalAmount: number;
  itemCount: number;
  status: TicketStatus;
  observations: string;
}

export interface ProcessBatchResult {
  processedCount: number;
  skippedCount: number;
  errorsCount: number;
  reviewCount: number;
  /** Tickets importados (o con error) en esta ejecución. */
  importedTickets: ImportedTicketInfo[];
  /** Indica si pueden quedar correos pendientes de procesar. */
  remaining: boolean;
  stoppedByUser: boolean;
  /** Indica que no se pudo arrancar porque ya había otra ejecución en marcha. */
  busy: boolean;
  messages: string[];
}
