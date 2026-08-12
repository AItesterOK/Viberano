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
  | 'SIN CONCILIAR'
  | 'PARCIALMENTE CONCILIADA'
  | 'CONCILIADA'
  | 'EXCLUIDA CON MOTIVO'
  | 'COINCIDENCIA CONFIRMADA'
  | 'CANDIDATA PENDIENTE'
  | 'NO ENCONTRADA EN ESTE EXTRACTO'
  | 'SIN COINCIDENCIA EN ESTA COBERTURA'
  | 'PAGO NO CONFIRMADO'
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
  operationDate?: string;
  dueDate?: string;
  categoryId?: string;
  taxableBase?: number | null;
  taxLines?: TaxLine[];
  internalNote?: string;
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
  decisionReason?: string;
  validationErrors?: string[];
  updatedAt?: string;
}

export type TaxKind = 'IVA' | 'IGIC' | 'RETENCION' | 'OTRO';

export interface TaxLine {
  id: string;
  kind: TaxKind;
  rate: number;
  base: number;
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
  supplierIds: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface ReviewDraft {
  document: InvoiceDocument;
  reason: string;
  baseUpdatedAt: string;
  decisionId: string;
  dirtyAt: string;
}

export interface ReviewSaveItemResult {
  documentId: string;
  ok: boolean;
  ready: boolean;
  document?: InvoiceDocument;
  error?: { code: string; message: string; retryable?: boolean };
}

export interface ReviewSaveResult {
  items: ReviewSaveItemResult[];
  saved: number;
  failed: number;
  durationMs: number;
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
  recurrent?: boolean;
  frequency?: SupplierFrequency;
  schedule?: SupplierSchedule;
  defaultCategoryId?: string;
  usualCurrency?: string;
}

export interface DocumentApprovalResult {
  items: { documentId: string; ok: boolean; document?: InvoiceDocument; destination?: string; error?: { code: string; message: string } }[];
  approved: number;
  failed: number;
}

export type SupplierFrequency = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export type WorkbenchStepId = 'CAPTURE' | 'VALIDATE' | 'RECONCILE' | 'CLOSE';
export type AppRoute = 'process' | 'review' | 'invoices' | 'suppliers' | 'bank' | 'close';

export interface WeeklyTask {
  id: string;
  step: WorkbenchStepId;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  detail: string;
  count: number;
  route: AppRoute;
  actionLabel: string;
  entityId?: string;
}

export interface WeeklyWorkbenchStep {
  id: WorkbenchStepId;
  label: string;
  count: number;
  status: 'READY' | 'BLOCKED' | 'DONE';
  route: AppRoute;
}

export interface WeeklyWorkbenchCounters {
  emailsPendingAnalysis: number;
  invalidInvoices: number;
  unidentifiedSuppliers: number;
  pendingReconciliations: number;
  movementsWithoutInvoice: number;
  monthlyCloseBlockers: number;
}

export interface ExpectedDocument {
  id: string;
  supplierId: string;
  supplierName: string;
  frequency: SupplierFrequency;
  expectedDate: string;
  dueDate?: string;
  status: 'EXPECTED' | 'RECEIVED' | 'SKIPPED';
  detail: string;
}

export interface WeeklyWorkbench {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  nextAction: WeeklyTask | null;
  steps: WeeklyWorkbenchStep[];
  counters: WeeklyWorkbenchCounters;
  tasks: WeeklyTask[];
  expectedDocuments: ExpectedDocument[];
}

export type CoverageStatus = 'COMPLETA' | 'PARCIAL' | 'SIN REVISAR' | 'CON HUECOS';

export interface CoverageSegment {
  id: string;
  sourceId: string;
  sourceType: 'GMAIL' | 'BANK';
  sourceName: string;
  from: string;
  to: string;
  status: CoverageStatus;
  detail: string;
  batchIds?: string[];
  importId?: string;
  movementCount?: number;
  route: 'process' | 'bank';
}

export interface CoverageLane {
  id: string;
  type: 'GMAIL' | 'BANK';
  name: string;
  segments: CoverageSegment[];
}

export interface CoverageMap {
  from: string;
  to: string;
  lanes: CoverageLane[];
  nextGmailCursor: { date: string; batchId?: string; pendingMessages: number; label: string } | null;
  warnings: string[];
}

export type ReconciliationConfidence = 'ALTA' | 'MEDIA' | 'BAJA';
export type ReconciliationCandidateStatus = 'PENDING' | 'COMPLEX' | 'CONFIRMED' | 'EXCLUDED';

export interface ReconciliationEvidence {
  kind: string;
  label: string;
  detail: string;
  matched: boolean;
}

export interface ReconciliationCandidate {
  id: string;
  importId: string;
  status: ReconciliationCandidateStatus;
  confidence: ReconciliationConfidence;
  safeStatusLabel: string;
  movement: BankMovement;
  invoice: InvoiceRecord | null;
  evidence: ReconciliationEvidence[];
  difference: number;
  assignedAmount: number;
  canBulkDecide: boolean;
  reconciliationId?: string;
}

export interface ReconciliationCandidatePage {
  items: ReconciliationCandidate[];
  total: number;
  nextCursor?: string;
}

export interface ReconciliationDecisionItem {
  candidateId?: string;
  movementId: string;
  invoiceId?: string;
  decision: 'CONFIRM' | 'REJECT';
  allocatedAmount?: number;
  reason?: string;
  evidence?: string;
}

export interface ReconciliationDecisionResult {
  results: { movementId: string; invoiceId?: string; status: 'SAVED' | 'ERROR'; decision: 'CONFIRM' | 'REJECT'; error?: string }[];
  saved: number;
  failed: number;
}

export type SupplierRuleType = 'EMAIL_DOMAIN' | 'SENDER_EMAIL' | 'BANK_CONCEPT' | 'DEFAULT_CATEGORY' | 'DEFAULT_CURRENCY';

export interface SupplierRule {
  id: string;
  supplierId: string;
  type: SupplierRuleType;
  pattern: string;
  value: string;
  active: boolean;
  evidence: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SupplierSchedule {
  supplierId: string;
  frequency: SupplierFrequency;
  expectedDay?: number;
  anchorMonth?: number;
  excludedPeriods: string[];
  evidence: string;
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
  operationDate?: string;
  dueDate?: string;
  categoryId?: string;
  taxableBase?: number | null;
  taxLines?: TaxLine[];
  internalNote?: string;
  reconciliationStatus?: ReconciliationStatus;
  assignedAmount?: number;
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
  assignedAmount?: number;
  difference?: number;
}

export type BankCurrencyMode = 'COLUMN' | 'EMBEDDED' | 'FIXED';

export interface BankMapping {
  operationDate?: number;
  valueDate?: number;
  concept?: number;
  amount?: number;
  currency?: number;
  reference?: number;
  headerRow: number;
  currencyMode: BankCurrencyMode;
  fixedCurrency?: string;
  rememberProfile?: boolean;
  profileName?: string;
}

export interface BankFormat {
  id: string;
  name: string;
  source: string;
  extension: string;
  separator: string;
  headerSignature: string;
  headerRow: number;
  mapping: Omit<BankMapping, 'headerRow' | 'currencyMode' | 'fixedCurrency' | 'rememberProfile' | 'profileName'>;
  currencyMode: BankCurrencyMode;
  fixedCurrency: string;
  active: boolean;
  native: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BankMappingRequiredDetails {
  headers: string[];
  headerRow: number;
  headerSignature: string;
  extension: string;
  separator: string;
  suggestedCurrencyMode: BankCurrencyMode;
}

export interface ReconciliationLink {
  id: string;
  importId: string;
  movementId: string;
  invoiceId: string;
  allocatedAmount: number;
  status: 'PROPUESTA' | 'CONFIRMADA' | 'DESHECHA' | 'RECHAZADA';
  evidence: string;
  reason: string;
  createdAt: string;
  createdBy: string;
  decidedAt?: string;
  decidedBy?: string;
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
  bankFormatId?: string;
  bankFormatName?: string;
  driveUrl?: string;
  createdAt: string;
  createdBy: string;
  movements: BankMovement[];
  reconciliations?: ReconciliationLink[];
}

export interface MonthlyClose {
  period: string;
  coverage: string;
  invoices: number;
  reviews: number;
  reconciled: number;
  partial: number;
  excluded: number;
  movementsWithoutInvoice: number;
  invoicesWithoutMovement: number;
  taxableBase: number;
  taxes: number;
  withholdings: number;
  total: number;
  warnings: string[];
  byCategory: { categoryId: string; category: string; count: number; total: number }[];
}

export interface AccountantExport {
  id: string;
  period: string;
  status: 'GENERANDO' | 'COMPLETADA' | 'ERROR';
  folderUrl?: string;
  files: { name: string; url: string; size: number }[];
  manifestHash?: string;
  createdAt: string;
  createdBy: string;
  error?: string;
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

export interface PagedResult<T> {
  items: T[];
  total: number;
  nextCursor?: string;
  nextOffset?: number | null;
}

export interface SnapshotWindow {
  returned: number;
  total: number;
  complete: boolean;
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
  categories: ExpenseCategory[];
  metrics: MonthlyMetric[];
  bankImports: BankImport[];
  bankFormats: BankFormat[];
  audit: AuditEvent[];
  reviewCount: number;
  processedCount: number;
  duplicateCount: number;
  invoiceWindow?: SnapshotWindow;
  auditWindow?: SnapshotWindow;
  exports?: AccountantExport[];
  weeklyWorkbench?: WeeklyWorkbench;
  coverageMap?: CoverageMap;
  reconciliationCandidates?: ReconciliationCandidate[];
  supplierRules?: SupplierRule[];
  supplierSchedules?: SupplierSchedule[];
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable?: boolean; details?: unknown };
  requestId: string;
}
