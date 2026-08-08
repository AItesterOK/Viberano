export type DocumentStatus =
  | 'PROCESADA'
  | 'REVISIÓN MANUAL'
  | 'DUPLICADO IGNORADO'
  | 'NO ES FACTURA'
  | 'FACTURA DE VENTA';

export type WorkPhase =
  | 'PENDIENTE'
  | 'ANALIZANDO'
  | 'LISTO PARA APROBAR'
  | 'EN REVISIÓN'
  | 'FINALIZADO'
  | 'CANCELADO'
  | 'ERROR';

export type BatchStatus =
  | 'BORRADOR'
  | 'ANALIZANDO'
  | 'PENDIENTE DE APROBACIÓN'
  | 'EJECUTANDO'
  | 'COMPLETADO'
  | 'COMPLETADO CON ERRORES'
  | 'INTERRUMPIDO'
  | 'CANCELADO';

export type ReconciliationStatus =
  | 'COINCIDENCIA CONFIRMADA'
  | 'CANDIDATA PENDIENTE'
  | 'NO ENCONTRADA EN ESTE EXTRACTO'
  | 'MOVIMIENTO SIN FACTURA'
  | 'EXCLUIDO: INGRESO'
  | 'EXCLUIDO: TRASPASO'
  | 'REVISIÓN MANUAL';

export interface Evidence {
  field: string;
  value: string;
  source: 'PDF' | 'CORREO' | 'PROVEEDOR' | 'MANUAL';
  excerpt: string;
}

export interface InvoiceDocument {
  id: string;
  batchId: string;
  messageId: string;
  attachmentId?: string;
  originalName: string;
  sender: string;
  recipients?: string;
  emailDirection?: 'ENTRANTE' | 'REENVIO RECIBIDO' | 'SALIENTE';
  subject: string;
  emailDate: string;
  invoiceDate: string;
  supplier: string;
  supplierId?: string;
  taxId: string;
  invoiceNumber: string;
  total: number | null;
  currency: string;
  phase: WorkPhase;
  proposedStatus: DocumentStatus;
  finalStatus?: DocumentStatus;
  reviewReason: string;
  evidence: Evidence[];
  hash: string;
  driveUrl?: string;
  gmailUrl?: string;
  selected: boolean;
  nonRegularSupplier?: boolean;
}

export interface DocumentPreview {
  id: string;
  originalName: string;
  mimeType: 'application/pdf';
  base64: string;
  size: number;
  gmailUrl?: string;
}

export interface Batch {
  id: string;
  status: BatchStatus;
  dateFrom: string;
  dateTo: string;
  requestedEmails: number;
  reviewedEmails: number;
  pdfCount: number;
  progress: number;
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
  cursor?: string;
  nextSearchDate?: string;
  cancelReason?: string;
  documents: InvoiceDocument[];
  error?: string;
}

export interface Supplier {
  id: string;
  name: string;
  domain: string;
  taxId: string;
  aliases: string[];
  active: boolean;
  evidence: string;
  updatedAt: string;
  updatedBy: string;
  invoiceCount: number;
}

export interface InvoiceRecord {
  id: string;
  date: string;
  supplier: string;
  taxId: string;
  number: string;
  total: number;
  currency: string;
  status: DocumentStatus;
  driveUrl?: string;
  gmailUrl?: string;
  originalName: string;
  batchId: string;
  hash: string;
  nonRegularSupplier?: boolean;
}

export interface MonthlyMetric {
  month: string;
  count: number;
  total: number;
  complete: boolean;
}

export interface BankMovement {
  id: string;
  importId: string;
  operationDate: string;
  valueDate: string;
  concept: string;
  amount: number;
  currency: string;
  reference: string;
  type: 'CARGO' | 'INGRESO' | 'TRASPASO' | 'REVISIÓN';
  status: ReconciliationStatus;
  candidateInvoiceId?: string;
  evidence?: string;
}

export interface BankImport {
  id: string;
  fileName: string;
  fileHash: string;
  source: string;
  periodFrom: string;
  periodTo: string;
  coverage: string;
  status: 'PREVISUALIZACIÓN' | 'CONFIRMADA' | 'CANCELADA';
  movementCount: number;
  detectedPeriodFrom?: string;
  detectedPeriodTo?: string;
  warnings?: string[];
  driveUrl?: string;
  createdAt: string;
  createdBy: string;
  movements: BankMovement[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  action: string;
  object: string;
  detail: string;
  user: string;
  batchId?: string;
}

export interface AppSettings {
  mode: 'DRY_RUN' | 'PRODUCTION';
  user: string;
  effectiveUser: string;
  allowedUsers: string[];
  timezone: string;
  spreadsheetName: string;
  invoiceFolderName: string;
  bankFolderName: string;
  maxBatchSize: number;
  sliceSize: number;
  startDate: string;
  services: Record<'gmail' | 'drive' | 'sheets', boolean>;
  triggers?: { id: string; handler: string; eventType: string; source: string }[];
  triggerDiagnosticAvailable?: boolean;
  schemaReady?: boolean;
}

export interface AppSnapshot {
  settings: AppSettings;
  activeBatch: Batch | null;
  reviewDocuments: InvoiceDocument[];
  invoices: InvoiceRecord[];
  suppliers: Supplier[];
  metrics: MonthlyMetric[];
  bankImports: BankImport[];
  audit: AuditEvent[];
  reviewCount: number;
  processedCount: number;
  duplicateCount: number;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable?: boolean; details?: unknown };
  requestId: string;
}
