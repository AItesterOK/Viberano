import type { ApiResult, AppSnapshot, BankImport, Batch, InvoiceDocument, Supplier } from '../types';
import { createMockSnapshot } from './mockData';
import { buildMonthlyMetrics, validateInvoice } from './domain';

declare global {
  interface Window {
    google?: { script?: { run?: GoogleScriptRunner } };
  }
}

interface GoogleScriptRunner {
  withSuccessHandler(handler: (value: unknown) => void): GoogleScriptRunner;
  withFailureHandler(handler: (error: Error) => void): GoogleScriptRunner;
  [key: string]: unknown;
}

let mock = createMockSnapshot();

function requestId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, requestId: requestId() };
}

function callServer<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const runner = window.google?.script?.run;
    if (!runner) throw new Error('Apps Script no disponible');
    const success = runner.withSuccessHandler((value) => resolve(value as ApiResult<T>)).withFailureHandler((error) => resolve({ ok: false, error: { code: 'SERVER_ERROR', message: error.message }, requestId: requestId() }));
    const fn = success[method] as ((...values: unknown[]) => void) | undefined;
    if (!fn) resolve({ ok: false, error: { code: 'METHOD_NOT_FOUND', message: `Método ${method} no disponible` }, requestId: requestId() });
    else fn.apply(success, args);
  });
}

const serverAvailable = () => Boolean(window.google?.script?.run);
const delay = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

export const api = {
  isLocal: !serverAvailable(),

  async bootstrap(): Promise<ApiResult<AppSnapshot>> {
    if (serverAvailable()) return callServer<AppSnapshot>('apiBootstrap');
    await delay(420);
    return ok(structuredClone(mock));
  },

  async startBatch(input: { dateFrom: string; dateTo: string; maxEmails: number }): Promise<ApiResult<Batch>> {
    if (serverAvailable()) return callServer<Batch>('apiStartBatch', { ...input, requestId: requestId() });
    await delay(700);
    mock.activeBatch = { ...mock.activeBatch!, ...input, requestedEmails: input.maxEmails, status: 'PENDIENTE DE APROBACIÓN', createdAt: new Date().toISOString() };
    return ok(structuredClone(mock.activeBatch));
  },

  async continueBatch(batchId: string): Promise<ApiResult<Batch>> {
    if (serverAvailable()) return callServer<Batch>('apiContinueBatch', { batchId, requestId: requestId() });
    await delay(600);
    if (!mock.activeBatch) return { ok: false, error: { code: 'BATCH_NOT_FOUND', message: 'No hay un lote activo' }, requestId: requestId() };
    mock.activeBatch = { ...mock.activeBatch, status: 'PENDIENTE DE APROBACIÓN', progress: 100, reviewedEmails: mock.activeBatch.requestedEmails };
    return ok(structuredClone(mock.activeBatch));
  },

  async setupSchema(): Promise<ApiResult<{ backup: { id: string; name: string; url: string }; report: unknown[] }>> {
    if (serverAvailable()) return callServer('apiSetupSchema', { confirmation: 'CREAR_COPIA_Y_MIGRAR', requestId: requestId() });
    await delay(700);
    mock.settings.schemaReady = true;
    return ok({ backup: { id: 'mock-backup', name: 'Copia local simulada', url: '#' }, report: [] });
  },

  async saveDocument(document: InvoiceDocument, reason: string): Promise<ApiResult<InvoiceDocument>> {
    if (serverAvailable()) return callServer<InvoiceDocument>('apiSaveDocumentReview', { document, reason, requestId: requestId() });
    await delay();
    const errors = validateInvoice(document, mock.suppliers);
    const updated: InvoiceDocument = { ...document, reviewReason: reason || errors.join('; '), phase: errors.length ? 'EN REVISIÓN' : 'LISTO PARA APROBAR', proposedStatus: errors.length ? 'REVISIÓN MANUAL' : document.proposedStatus };
    mock.activeBatch = { ...mock.activeBatch!, documents: mock.activeBatch!.documents.map((item) => item.id === updated.id ? updated : item) };
    mock.reviewDocuments = mock.reviewDocuments.map((item) => item.id === updated.id ? updated : item);
    return ok(structuredClone(updated));
  },

  async approveDocument(documentId: string): Promise<ApiResult<InvoiceDocument>> {
    if (serverAvailable()) return callServer<InvoiceDocument>('apiApproveDocument', { documentId, requestId: requestId() });
    await delay(500);
    const document = mock.reviewDocuments.find((item) => item.id === documentId);
    if (!document) return { ok: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'No se encuentra el documento' }, requestId: requestId() };
    if (document.phase !== 'LISTO PARA APROBAR') return { ok: false, error: { code: 'DOCUMENT_NOT_READY', message: 'El documento todavía necesita revisión' }, requestId: requestId() };
    const finalized = { ...document, phase: 'FINALIZADO' as const, finalStatus: document.proposedStatus };
    mock.reviewDocuments = mock.reviewDocuments.filter((item) => item.id !== documentId);
    if (mock.activeBatch) mock.activeBatch = { ...mock.activeBatch, documents: mock.activeBatch.documents.map((item) => item.id === documentId ? finalized : item) };
    return ok(structuredClone(finalized));
  },

  async approveBatch(batchId: string, documentIds: string[]): Promise<ApiResult<Batch>> {
    if (serverAvailable()) return callServer<Batch>('apiApproveBatch', { batchId, documentIds, requestId: requestId() });
    await delay(900);
    if (!mock.activeBatch || mock.activeBatch.id !== batchId) return { ok: false, error: { code: 'BATCH_NOT_FOUND', message: 'El lote ya no está activo' }, requestId: requestId() };
    const docs = mock.activeBatch.documents.map((doc) => documentIds.includes(doc.id) ? { ...doc, phase: 'FINALIZADO' as const, finalStatus: doc.proposedStatus } : doc);
    docs.forEach((doc) => {
      if (!documentIds.includes(doc.id) || doc.proposedStatus !== 'PROCESADA') return;
      mock.invoices.unshift({ id: `inv-${doc.id}`, date: doc.invoiceDate, supplier: doc.supplier, taxId: doc.taxId, number: doc.invoiceNumber, total: doc.total ?? 0, currency: doc.currency, status: 'PROCESADA', driveUrl: '#', gmailUrl: doc.gmailUrl, originalName: doc.originalName, batchId, hash: doc.hash });
    });
    mock.activeBatch = { ...mock.activeBatch, documents: docs, status: 'COMPLETADO', approvedAt: new Date().toISOString(), approvedBy: mock.settings.user };
    mock.metrics = buildMonthlyMetrics(mock.invoices, new Date('2026-07-31T12:00:00Z'));
    mock.audit.unshift({ id: requestId(), timestamp: new Date().toISOString(), level: 'INFO', action: 'LOTE_COMPLETADO', object: batchId, detail: `${documentIds.length} documentos finalizados`, user: mock.settings.user, batchId });
    return ok(structuredClone(mock.activeBatch));
  },

  async saveSupplier(supplier: Supplier): Promise<ApiResult<Supplier>> {
    if (serverAvailable()) return callServer<Supplier>('apiSaveSupplier', { supplier, requestId: requestId() });
    await delay();
    const saved = { ...supplier, id: supplier.id || `sup-${requestId()}`, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
    const index = mock.suppliers.findIndex((item) => item.id === saved.id);
    if (index >= 0) mock.suppliers[index] = saved; else mock.suppliers.unshift(saved);
    return ok(structuredClone(saved));
  },

  async toggleSupplier(id: string, active: boolean): Promise<ApiResult<Supplier>> {
    if (serverAvailable()) return callServer<Supplier>('apiSetSupplierActive', { id, active, requestId: requestId() });
    const supplier = mock.suppliers.find((item) => item.id === id)!;
    return this.saveSupplier({ ...supplier, active });
  },

  async mergeSuppliers(sourceId: string, targetId: string, reason: string): Promise<ApiResult<{ source: Supplier; target: Supplier }>> {
    if (serverAvailable()) return callServer('apiMergeSuppliers', { sourceId, targetId, reason, requestId: requestId() });
    await delay();
    const source = mock.suppliers.find((item) => item.id === sourceId);
    const target = mock.suppliers.find((item) => item.id === targetId);
    if (!source || !target || sourceId === targetId) return { ok: false, error: { code: 'INVALID_SUPPLIER_MERGE', message: 'Selecciona dos proveedores distintos' }, requestId: requestId() };
    const mergedTarget = { ...target, aliases: [...new Set([...target.aliases, source.name, ...source.aliases])], evidence: `${target.evidence} | Fusión demo: ${reason}`, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
    const mergedSource = { ...source, active: false, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
    mock.suppliers = mock.suppliers.map((item) => item.id === sourceId ? mergedSource : item.id === targetId ? mergedTarget : item);
    return ok({ source: structuredClone(mergedSource), target: structuredClone(mergedTarget) });
  },

  async previewBankImport(input: { fileName: string; base64: string; source: string; periodFrom: string; periodTo: string; coverage: string; mapping?: Record<string, number> }): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiPreviewBankImport', { ...input, requestId: requestId() });
    await delay(900);
    const sample = structuredClone(mock.bankImports[0]);
    sample.id = `BANK-${Date.now()}`;
    sample.fileName = input.fileName;
    sample.source = input.source;
    sample.periodFrom = input.periodFrom;
    sample.periodTo = input.periodTo;
    sample.coverage = input.coverage;
    sample.status = 'PREVISUALIZACIÓN';
    return ok(sample);
  },

  async confirmBankImport(bankImport: BankImport): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiConfirmBankImport', { importId: bankImport.id, requestId: requestId() });
    await delay(600);
    const saved = { ...bankImport, status: 'CONFIRMADA' as const };
    mock.bankImports.unshift(saved);
    return ok(structuredClone(saved));
  },

  async decideReconciliation(importId: string, movementId: string, status: string, invoiceId?: string): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiDecideReconciliation', { importId, movementId, status, invoiceId, requestId: requestId() });
    const bankImport = mock.bankImports.find((item) => item.id === importId)!;
    bankImport.movements = bankImport.movements.map((movement) => movement.id === movementId ? { ...movement, status: status as never, candidateInvoiceId: invoiceId ?? movement.candidateInvoiceId } : movement);
    return ok(structuredClone(bankImport));
  },

  async updateSettings(settings: AppSnapshot['settings']): Promise<ApiResult<AppSnapshot['settings']>> {
    if (serverAvailable()) return callServer('apiUpdateSettings', { settings, requestId: requestId() });
    mock.settings = settings;
    return ok(structuredClone(settings));
  },
};
