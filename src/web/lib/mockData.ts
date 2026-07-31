import type { AppSnapshot, AuditEvent, BankImport, Batch, InvoiceDocument, InvoiceRecord, Supplier } from '../types';
import { buildMonthlyMetrics } from './domain';

// Datos sintéticos para desarrollo local. No proceden de correos, facturas ni extractos reales.
const user = 'compras@reparapro.com';

export const mockSuppliers: Supplier[] = [
  { id: 'sup-norte', name: 'Proveedor Demo Norte SL', domain: 'demo-norte.invalid', taxId: 'B00000001', aliases: ['Demo Norte'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:10:00Z', updatedBy: user, invoiceCount: 18 },
  { id: 'sup-europa', name: 'Componentes Demo Europa BV', domain: 'demo-europa.invalid', taxId: 'NL000000002B01', aliases: ['Demo Europa'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:12:00Z', updatedBy: user, invoiceCount: 34 },
  { id: 'sup-taller', name: 'Suministros Taller Demo SL', domain: '', taxId: 'B00000003', aliases: ['Taller Demo'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:13:00Z', updatedBy: user, invoiceCount: 26 },
  { id: 'sup-logistica', name: 'Logística Demo SL', domain: 'logistica-demo.invalid', taxId: 'B00000004', aliases: ['Demo Logística'], active: true, evidence: 'Evidencia sintética de demostración', updatedAt: '2026-07-21T09:14:00Z', updatedBy: user, invoiceCount: 11 },
  { id: 'sup-servicios', name: 'Servicios Cloud Demo Ltd', domain: 'cloud-demo.invalid', taxId: '', aliases: ['Cloud Demo'], active: true, evidence: 'Razón social sintética', updatedAt: '2026-07-21T09:15:00Z', updatedBy: user, invoiceCount: 7 },
  { id: 'sup-old', name: 'Proveedor histórico demo inactivo', domain: '', taxId: '', aliases: [], active: false, evidence: 'Desactivado en el escenario sintético', updatedAt: '2026-07-30T10:00:00Z', updatedBy: user, invoiceCount: 1 },
];

export const mockInvoices: InvoiceRecord[] = [
  { id: 'inv-1', date: '2026-07-17', supplier: 'Logística Demo SL', taxId: 'B00000004', number: 'DEMO-1204', total: 106.89, currency: 'EUR', status: 'PROCESADA', driveUrl: '#', gmailUrl: '#', originalName: 'factura-demo-1204.pdf', batchId: 'LOT-DEMO-0717', hash: 'demo-hash-1' },
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
  ], hash: 'demo-sha256-review-1', gmailUrl: '#', selected: false,
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
  id: 'LOT-DEMO-0731', status: 'PENDIENTE DE APROBACIÓN', dateFrom: '2026-07-28', dateTo: '2026-07-31', requestedEmails: 10, reviewedEmails: 10, pdfCount: 3, progress: 100, createdAt: '2026-07-31T09:22:00Z', createdBy: user, cursor: 'msg-demo-ready', documents: [readyDocument, reviewDocument, excludedDocument],
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

export function createMockSnapshot(): AppSnapshot {
  const metrics = buildMonthlyMetrics(mockInvoices, new Date('2026-07-31T12:00:00Z'));
  return {
    settings: { mode: 'DRY_RUN', user, effectiveUser: user, allowedUsers: [user], timezone: 'Europe/Madrid', spreadsheetName: 'ReparaPRO Docs', invoiceFolderName: 'A.2 - FA-GASTOS', bankFolderName: 'MOVIMIENTOS BANCARIOS', maxBatchSize: 20, sliceSize: 5, startDate: '2026-01-01', services: { gmail: true, drive: true, sheets: true } },
    activeBatch: mockBatch,
    invoices: mockInvoices,
    suppliers: mockSuppliers,
    metrics,
    bankImports: [mockBankImport],
    audit: mockAudit,
    reviewCount: 44,
    processedCount: 177,
    duplicateCount: 45,
  };
}
