import type { AppSnapshot, AuditEvent, BankFormat, BankImport, Batch, CoverageMap, ExpenseCategory, InvoiceDocument, InvoiceRecord, ReconciliationCandidate, Supplier, SupplierRule, SupplierSchedule, WeeklyWorkbench } from '../types';
import { buildMonthlyMetrics } from './domain';

// Datos sintéticos para desarrollo local. No proceden de correos, facturas ni extractos reales.
const user = 'compras@reparapro.com';

export const mockCategories: ExpenseCategory[] = [
  { id: 'cat-components', name: 'Componentes y repuestos', active: true, supplierIds: ['sup-europa', 'sup-taller'], updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
  { id: 'cat-logistics', name: 'Logística y transporte', active: true, supplierIds: ['sup-logistica'], updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
  { id: 'cat-software', name: 'Software y servicios digitales', active: true, supplierIds: ['sup-servicios'], updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
  { id: 'cat-other', name: 'Otros', active: true, supplierIds: [], updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
];

export const mockSuppliers: Supplier[] = [
  { id: 'sup-norte', name: 'Proveedor Demo Norte SL', domain: 'demo-norte.invalid', taxId: 'B00000001', aliases: ['Demo Norte'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:10:00Z', updatedBy: user, invoiceCount: 3, recurrent: true, frequency: 'QUARTERLY', usualCurrency: 'EUR' },
  { id: 'sup-europa', name: 'Componentes Demo Europa BV', domain: 'demo-europa.invalid', taxId: 'NL000000002B01', aliases: ['Demo Europa'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:12:00Z', updatedBy: user, invoiceCount: 5, recurrent: true, frequency: 'MONTHLY', defaultCategoryId: 'cat-components', usualCurrency: 'EUR' },
  { id: 'sup-taller', name: 'Suministros Taller Demo SL', domain: '', taxId: 'B00000003', aliases: ['Taller Demo'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:13:00Z', updatedBy: user, invoiceCount: 4, recurrent: true, frequency: 'MONTHLY', defaultCategoryId: 'cat-components', usualCurrency: 'EUR' },
  { id: 'sup-logistica', name: 'Logística Demo SL', domain: 'logistica-demo.invalid', taxId: 'B00000004', aliases: ['Demo Logística'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:14:00Z', updatedBy: user, invoiceCount: 2 },
  { id: 'sup-servicios', name: 'Servicios Cloud Demo Ltd', domain: 'cloud-demo.invalid', taxId: '', aliases: ['Cloud Demo'], active: true, evidence: 'Razón social sintética', updatedAt: '2026-07-21T09:15:00Z', updatedBy: user, invoiceCount: 1 },
  { id: 'sup-old', name: 'Proveedor histórico demo inactivo', domain: '', taxId: '', aliases: [], active: false, evidence: 'Desactivado en el escenario sintético', updatedAt: '2026-07-30T10:00:00Z', updatedBy: user, invoiceCount: 1 },
];

export const mockInvoices: InvoiceRecord[] = [
  { id: 'inv-1', date: '2026-07-17', dueDate: '2026-08-01', supplier: 'Logística Demo SL', taxId: 'B00000004', number: 'DEMO-1204', total: 106.89, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-1204.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-1', reconciliationStatus: 'PAGO NO CONFIRMADO' },
  { id: 'inv-2', date: '2026-07-15', supplier: 'Componentes Demo Europa BV', taxId: 'NL000000002B01', number: 'DEMO-117848', total: 305.69, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-2.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-2' },
  { id: 'inv-3', date: '2026-07-06', supplier: 'Suministros Taller Demo SL', taxId: 'B00000003', number: 'DEMO-7811', total: 196.84, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-3.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-3' },
  { id: 'inv-4', date: '2026-06-30', supplier: 'Suministros Taller Demo SL', taxId: 'B00000003', number: 'DEMO-7535', total: 105.99, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-4.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-4' },
  { id: 'inv-5', date: '2026-05-20', supplier: 'Proveedor Demo Norte SL', taxId: 'B00000001', number: 'DEMO-125', total: 143.85, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-5.pdf', batchId: 'LOT-DEMO-0525', hash: 'demo-hash-5' },
  { id: 'inv-6', date: '2026-04-06', supplier: 'Servicios Cloud Demo Ltd', taxId: '', number: 'DEMO-40988', total: 42.35, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-6.pdf', batchId: 'LOT-DEMO-0410', hash: 'demo-hash-6' },
  { id: 'inv-7', date: '2026-03-11', supplier: 'Componentes Demo Europa BV', taxId: 'NL000000002B01', number: 'DEMO-09122', total: 219.2, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-7.pdf', batchId: 'LOT-DEMO-0315', hash: 'demo-hash-7' },
  { id: 'inv-8', date: '2026-07-16', supplier: 'Organismo Demo', taxId: '', number: '', total: 0, currency: 'EUR', status: 'NO ES FACTURA', gmailUrl: '#', originalName: 'notificacion-demo.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-8' },
];

const reviewDocument: InvoiceDocument = {
  id: 'doc-review-1', batchId: 'LOT-DEMO-0731', messageId: 'msg-demo-review', attachmentId: 'att-demo-review', originalName: 'factura-demo-revision.pdf', sender: 'pedidos@proveedor-demo.invalid', subject: 'Factura de demostración', emailDate: '2026-07-30T16:22:00Z', invoiceDate: '2026-07-29', supplier: 'Proveedor Nuevo Demo SL', taxId: '', invoiceNumber: 'DEMO-0771', total: 88.42, currency: 'EUR', phase: 'EN REVISIÓN', proposedStatus: 'REVISIÓN MANUAL', reviewReason: 'Proveedor desconocido: falta validarlo en el catálogo', evidence: [
    { field: 'supplier', value: 'Proveedor Nuevo Demo SL', source: 'PDF', excerpt: 'Proveedor Nuevo Demo, S.L. · Factura DEMO-0771' },
    { field: 'invoiceNumber', value: 'DEMO-0771', source: 'PDF', excerpt: 'Número de factura: DEMO-0771' },
    { field: 'total', value: '88.42 EUR', source: 'PDF', excerpt: 'Total 88,42 EUR' },
  ], hash: 'demo-sha256-review-1', gmailUrl: '#', selected: false, categoryId: 'cat-other', taxableBase: 73.07, taxLines: [{ id: 'tax-demo-1', kind: 'IVA', rate: 21, base: 73.07, amount: 15.35 }], updatedAt: '2026-07-31T08:00:00Z', validationErrors: ['Proveedor desconocido o inactivo'],
};

const readyDocument: InvoiceDocument = {
  id: 'doc-ready-1', batchId: 'LOT-DEMO-0731', messageId: 'msg-demo-ready', attachmentId: 'att-demo-ready', originalName: 'factura-demo-lista.pdf', sender: 'ventas@demo-europa.invalid', subject: 'Factura demo del pedido 4100', emailDate: '2026-07-31T08:12:00Z', invoiceDate: '2026-07-30', supplier: 'Componentes Demo Europa BV', supplierId: 'sup-europa', taxId: 'NL000000002B01', invoiceNumber: 'DEMO-118901', total: 187.4, currency: 'EUR', phase: 'LISTO PARA APROBAR', proposedStatus: 'PROCESADA', reviewReason: '', evidence: [
    { field: 'supplier', value: 'Componentes Demo Europa BV', source: 'PDF', excerpt: 'Componentes Demo Europa B.V.' },
    { field: 'invoiceNumber', value: 'DEMO-118901', source: 'PDF', excerpt: 'Factura DEMO-118901' },
    { field: 'total', value: '187.40 EUR', source: 'PDF', excerpt: 'Total € 187,40' },
  ], hash: 'demo-sha256-ready-1', gmailUrl: '#', selected: true,
};

const excludedDocument: InvoiceDocument = {
  id: 'doc-no-1', batchId: 'LOT-DEMO-0731', messageId: 'msg-demo-no', attachmentId: 'att-demo-no', originalName: 'propuesta-demo.pdf', sender: 'equipo@servicio-demo.invalid', subject: 'Propuesta de servicio demo', emailDate: '2026-07-30T11:00:00Z', invoiceDate: '', supplier: 'Proveedor desconocido', taxId: '', invoiceNumber: '', total: null, currency: 'EUR', phase: 'LISTO PARA APROBAR', proposedStatus: 'NO ES FACTURA', reviewReason: 'El contenido identifica una propuesta comercial, no una factura', evidence: [
    { field: 'classification', value: 'NO ES FACTURA', source: 'PDF', excerpt: 'Propuesta de servicio · presupuesto estimado' },
  ], hash: 'demo-sha256-no-1', gmailUrl: '#', selected: true,
};

export const mockBatch: Batch = {
  id: 'LOT-DEMO-0731', status: 'PENDIENTE DE APROBACIÓN', dateFrom: '2026-07-28', dateTo: '2026-07-31', requestedEmails: 10, reviewedEmails: 10, pdfCount: 3, progress: 100, createdAt: '2026-07-31T09:22:00Z', createdBy: user, cursor: 'msg-demo-ready', nextSearchDate: '2026-08-01', documents: [readyDocument, reviewDocument, excludedDocument],
};

export const mockAudit: AuditEvent[] = [
  { id: 'evt-1', timestamp: '2026-07-31T09:23:22Z', level: 'INFO', action: 'LOTE_ANALIZADO', object: mockBatch.id, detail: '10 correos sintéticos · 3 PDF encontrados', user, batchId: mockBatch.id },
  { id: 'evt-2', timestamp: '2026-07-30T18:04:10Z', level: 'WARN', action: 'REVISION_PENDIENTE', object: 'doc-review-1', detail: 'Proveedor demo desconocido', user, batchId: mockBatch.id },
  { id: 'evt-3', timestamp: '2026-07-21T11:42:00Z', level: 'INFO', action: 'LOTE_COMPLETADO', object: 'LOT-DEMO-0721', detail: '20 correos sintéticos · 7 facturas archivadas · 0 errores', user, batchId: 'LOT-DEMO-0721' },
];

export const mockBankImport: BankImport = {
  id: 'BANK-DEMO-2026-07', fileName: 'extracto-demo.xlsx', fileHash: 'demo-sha256-bank-july', source: 'Cuenta demo', periodFrom: '2026-07-01', periodTo: '2026-07-31', coverage: 'Cuenta demo · julio completo', status: 'CONFIRMADA', movementCount: 5, createdAt: '2026-07-31T08:00:00Z', createdBy: user, driveUrl: '#', movements: [
    { id: 'mov-1', importId: 'BANK-DEMO-2026-07', operationDate: '2026-07-18', valueDate: '2026-07-18', concept: 'PAGO LOGISTICA DEMO 1204', amount: -106.89, currency: 'EUR', reference: 'DEMO 8841', type: 'CARGO', status: 'CANDIDATA PENDIENTE', candidateInvoiceId: 'inv-1', evidence: 'Importe exacto, proveedor en concepto, 1 día después' },
    { id: 'mov-2', importId: 'BANK-DEMO-2026-07', operationDate: '2026-07-16', valueDate: '2026-07-16', concept: 'COMPONENTES DEMO EUROPA', amount: -305.69, currency: 'EUR', reference: 'DEMO 69021', type: 'CARGO', status: 'COINCIDENCIA CONFIRMADA', candidateInvoiceId: 'inv-2', evidence: 'Importe exacto y proveedor' },
    { id: 'mov-3', importId: 'BANK-DEMO-2026-07', operationDate: '2026-07-08', valueDate: '2026-07-08', concept: 'SUMINISTROS TALLER DEMO', amount: -196.84, currency: 'EUR', reference: 'DEMO 120893', type: 'CARGO', status: 'CANDIDATA PENDIENTE', candidateInvoiceId: 'inv-3', evidence: 'Importe exacto y razón social' },
    { id: 'mov-4', importId: 'BANK-DEMO-2026-07', operationDate: '2026-07-20', valueDate: '2026-07-20', concept: 'TRASPASO ENTRE CUENTAS', amount: -600, currency: 'EUR', reference: '', type: 'TRASPASO', status: 'EXCLUIDO: TRASPASO' },
    { id: 'mov-5', importId: 'BANK-DEMO-2026-07', operationDate: '2026-07-23', valueDate: '2026-07-23', concept: 'CARGO DEMO SIN FACTURA', amount: -54.2, currency: 'EUR', reference: 'DEMO 2201', type: 'CARGO', status: 'MOVIMIENTO SIN FACTURA' },
  ],
};

export const mockBankFormats: BankFormat[] = [
  { id: 'NATIVE-CAIXABANK-CSV', name: 'CaixaBank CSV', source: 'caixabank', extension: 'csv', separator: ';', headerSignature: 'concepto|fecha|importe|saldo', headerRow: 0, mapping: { operationDate: 1, valueDate: 1, concept: 0, amount: 2 }, currencyMode: 'EMBEDDED', fixedCurrency: '', active: true, native: true, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' },
];

export const mockCoverageMap: CoverageMap = {
  from: '2026-01-01',
  to: '2026-08-12',
  nextGmailCursor: { date: '2026-02-10', batchId: 'LOT-DEMO-0210', pendingMessages: 7, label: 'Continuar desde el correo pendiente del 10 de febrero de 2026' },
  warnings: ['Gmail conserva un hueco entre febrero y julio.', 'Los extractos bancarios de julio tienen cobertura parcial.'],
  lanes: [
    { id: 'gmail', type: 'GMAIL', name: 'Gmail', segments: [
      { id: 'cov-gmail-jan-feb', sourceId: 'gmail', sourceType: 'GMAIL', sourceName: 'Gmail', from: '2026-01-01', to: '2026-02-10', status: 'CON HUECOS', detail: 'Recorrido cronológico en curso; quedan mensajes del 10 de febrero.', batchIds: ['LOT-DEMO-0210'], route: 'process' },
      { id: 'cov-gmail-july', sourceId: 'gmail', sourceType: 'GMAIL', sourceName: 'Gmail', from: '2026-07-18', to: '2026-07-29', status: 'COMPLETA', detail: 'Lotes de julio revisados y aprobados.', batchIds: ['LOT-DEMO-0729'], route: 'process' },
    ] },
    { id: 'caixabank', type: 'BANK', name: 'CaixaBank', segments: [
      { id: 'cov-caixa-july', sourceId: 'caixabank', sourceType: 'BANK', sourceName: 'CaixaBank', from: '2026-07-01', to: '2026-07-20', status: 'PARCIAL', detail: 'Extracto parcial; no cubre el cierre del mes.', importId: 'BANK-DEMO-CAIXA-07', movementCount: 58, route: 'bank' },
    ] },
    { id: 'santander', type: 'BANK', name: 'Santander', segments: [
      { id: 'cov-santander-july', sourceId: 'santander', sourceType: 'BANK', sourceName: 'Santander', from: '2026-07-01', to: '2026-07-20', status: 'PARCIAL', detail: 'Extracto parcial confirmado.', importId: 'BANK-DEMO-2026-07', movementCount: 51, route: 'bank' },
    ] },
  ],
};

export const mockSupplierRules: SupplierRule[] = [
  { id: 'rule-1', supplierId: 'sup-europa', type: 'BANK_CONCEPT', pattern: 'COMPONENTES DEMO EUROPA', value: 'COMPONENTES DEMO EUROPA', evidence: 'Concepto confirmado en una conciliación sintética.', active: true, createdAt: '2026-07-31T08:00:00Z', createdBy: user, updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
  { id: 'rule-2', supplierId: 'sup-europa', type: 'DEFAULT_CATEGORY', pattern: '', value: 'cat-components', evidence: 'Categoría confirmada manualmente en tres facturas sintéticas.', active: true, createdAt: '2026-07-31T08:00:00Z', createdBy: user, updatedAt: '2026-07-31T08:00:00Z', updatedBy: user },
];

export const mockSupplierSchedules: SupplierSchedule[] = [
  { supplierId: 'sup-europa', frequency: 'MONTHLY', expectedDay: 10, excludedPeriods: [], evidence: 'Frecuencia confirmada por el histórico sintético.' },
  { supplierId: 'sup-taller', frequency: 'MONTHLY', expectedDay: 15, excludedPeriods: [], evidence: 'Frecuencia confirmada por el histórico sintético.' },
];

export const mockReconciliationCandidates: ReconciliationCandidate[] = [
  { id: 'candidate-1', importId: mockBankImport.id, status: 'PENDING', movement: mockBankImport.movements[0], invoice: mockInvoices[0], confidence: 'ALTA', safeStatusLabel: 'CANDIDATA PENDIENTE', evidence: [{ kind: 'AMOUNT', label: 'Importe', detail: 'Importe exacto', matched: true }, { kind: 'SUPPLIER', label: 'Proveedor', detail: 'Localizado en el concepto', matched: true }, { kind: 'DATE', label: 'Fecha', detail: 'Movimiento un día después', matched: true }], difference: 0, assignedAmount: 106.89, canBulkDecide: true },
  { id: 'candidate-2', importId: mockBankImport.id, status: 'PENDING', movement: mockBankImport.movements[2], invoice: mockInvoices[2], confidence: 'ALTA', safeStatusLabel: 'CANDIDATA PENDIENTE', evidence: [{ kind: 'AMOUNT', label: 'Importe', detail: 'Importe exacto', matched: true }, { kind: 'SUPPLIER', label: 'Proveedor', detail: 'Razón social coincidente', matched: true }], difference: 0, assignedAmount: 196.84, canBulkDecide: true },
  { id: 'candidate-3', importId: mockBankImport.id, status: 'COMPLEX', movement: mockBankImport.movements[4], invoice: null, confidence: 'BAJA', safeStatusLabel: 'SIN COINCIDENCIA EN ESTA COBERTURA', evidence: [{ kind: 'COVERAGE', label: 'Cobertura', detail: 'No existe una factura con importe exacto en la cobertura disponible', matched: false }], difference: 54.2, assignedAmount: 0, canBulkDecide: false },
  { id: 'candidate-4', importId: mockBankImport.id, status: 'CONFIRMED', movement: mockBankImport.movements[1], invoice: mockInvoices[1], confidence: 'ALTA', safeStatusLabel: 'COINCIDENCIA CONFIRMADA', evidence: [{ kind: 'AMOUNT', label: 'Importe', detail: 'Importe exacto', matched: true }, { kind: 'SUPPLIER', label: 'Proveedor', detail: 'Proveedor coincidente', matched: true }], difference: 0, assignedAmount: 305.69, canBulkDecide: false, reconciliationId: 'rec-demo-1' },
  { id: 'candidate-5', importId: mockBankImport.id, status: 'EXCLUDED', movement: mockBankImport.movements[3], invoice: null, confidence: 'ALTA', safeStatusLabel: 'EXCLUIDA CON MOTIVO', evidence: [{ kind: 'TYPE', label: 'Tipo', detail: 'Concepto identificado como traspaso', matched: true }], difference: 600, assignedAmount: 0, canBulkDecide: false },
];

export const mockWeeklyWorkbench: WeeklyWorkbench = {
  weekStart: '2026-08-10',
  weekEnd: '2026-08-16',
  generatedAt: '2026-08-12T08:00:00Z',
  counters: { emailsPendingAnalysis: 20, invalidInvoices: 1, unidentifiedSuppliers: 1, pendingReconciliations: 2, movementsWithoutInvoice: 1, monthlyCloseBlockers: 3 },
  steps: [
    { id: 'CAPTURE', label: 'Capturar', count: 20, status: 'READY', route: 'process' },
    { id: 'VALIDATE', label: 'Validar', count: 1, status: 'BLOCKED', route: 'review' },
    { id: 'RECONCILE', label: 'Conciliar', count: 2, status: 'READY', route: 'bank' },
    { id: 'CLOSE', label: 'Cerrar', count: 3, status: 'BLOCKED', route: 'close' },
  ],
  nextAction: { id: 'task-review', step: 'VALIDATE', title: 'Resolver una factura con proveedor sin identificar', detail: 'La clasificación está guardada, pero faltan datos acreditados para poder aprobar.', count: 1, priority: 'HIGH', actionLabel: 'Abrir revisión', route: 'review', entityId: 'doc-review-1' },
  tasks: [
    { id: 'task-capture', step: 'CAPTURE', title: 'Continuar el recorrido cronológico de Gmail', detail: 'Continuar desde el mensaje pendiente del 10 de febrero de 2026.', count: 20, priority: 'MEDIUM', actionLabel: 'Analizar correos', route: 'process' },
    { id: 'task-review', step: 'VALIDATE', title: 'Resolver datos pendientes', detail: 'Una factura tiene proveedor o campos sin acreditar.', count: 1, priority: 'HIGH', actionLabel: 'Abrir revisión', route: 'review', entityId: 'doc-review-1' },
    { id: 'task-match', step: 'RECONCILE', title: 'Decidir propuestas bancarias', detail: 'Hay dos pares con importe exacto pendientes de confirmación humana.', count: 2, priority: 'MEDIUM', actionLabel: 'Revisar propuestas', route: 'bank' },
    { id: 'task-close', step: 'CLOSE', title: 'Completar cobertura de julio', detail: 'El cierre permanece bloqueado por extractos parciales y un movimiento sin justificante.', count: 3, priority: 'LOW', actionLabel: 'Ver cierre', route: 'close' },
  ],
  expectedDocuments: [
    { id: 'expected-europa', supplierId: 'sup-europa', supplierName: 'Componentes Demo Europa BV', frequency: 'MONTHLY', expectedDate: '2026-08-10', dueDate: '2026-08-15', status: 'EXPECTED', detail: 'No localizada todavía en Gmail.' },
    { id: 'expected-taller', supplierId: 'sup-taller', supplierName: 'Suministros Taller Demo SL', frequency: 'MONTHLY', expectedDate: '2026-08-15', status: 'EXPECTED', detail: 'Prevista para esta semana.' },
  ],
};

export function createMockSnapshot(): AppSnapshot {
  const metrics = buildMonthlyMetrics(mockInvoices, new Date('2026-07-31T12:00:00Z'));
  return {
    settings: { mode: 'DRY_RUN', user, effectiveUser: user, allowedUsers: [user], timezone: 'Europe/Madrid', spreadsheetName: 'ReparaPRO Docs', invoiceFolderName: 'A.2 - FA-GASTOS', bankFolderName: 'MOVIMIENTOS BANCARIOS', maxBatchSize: 20, sliceSize: 5, startDate: '2026-01-01', services: { gmail: true, drive: true, sheets: true } },
    activeBatch: mockBatch,
    reviewDocuments: [reviewDocument],
    invoices: mockInvoices,
    suppliers: mockSuppliers,
    categories: mockCategories,
    metrics,
    bankImports: [mockBankImport],
    bankFormats: mockBankFormats,
    audit: mockAudit,
    reviewCount: 1,
    processedCount: 7,
    duplicateCount: 2,
    exports: [],
    weeklyWorkbench: mockWeeklyWorkbench,
    coverageMap: mockCoverageMap,
    reconciliationCandidates: mockReconciliationCandidates,
    supplierRules: mockSupplierRules,
    supplierSchedules: mockSupplierSchedules,
  };
}
