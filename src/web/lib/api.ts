import type { AccountantExport, ApiResult, AppSnapshot, BankFormat, BankImport, BankMapping, Batch, DocumentPreview, ExpenseCategory, InvoiceDocument, MonthlyClose, ReconciliationLink, ReviewDraft, ReviewSaveResult, Supplier } from '../types';
import { createMockSnapshot } from './mockData';
import { buildMonthlyMetrics, normalizeText, validateInvoice } from './domain';

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
    const success = runner.withSuccessHandler((value) => resolve(value && typeof value === 'object' ? value as ApiResult<T> : { ok: false, error: { code: 'EMPTY_SERVER_RESPONSE', message: 'Google no devolvió una respuesta válida. Recarga la aplicación o reintenta la operación.' }, requestId: requestId() })).withFailureHandler((error) => resolve({ ok: false, error: { code: 'SERVER_ERROR', message: error.message }, requestId: requestId() }));
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

  async cancelBatch(batchId: string, reason: string): Promise<ApiResult<Batch>> {
    if (serverAvailable()) return callServer<Batch>('apiCancelBatch', { batchId, reason, requestId: requestId() });
    await delay();
    if (!mock.activeBatch || mock.activeBatch.id !== batchId) return { ok: false, error: { code: 'BATCH_NOT_FOUND', message: 'No hay un lote activo' }, requestId: requestId() };
    mock.activeBatch = { ...mock.activeBatch, status: 'CANCELADO', cancelReason: reason, documents: mock.activeBatch.documents.map((item) => item.phase === 'FINALIZADO' ? item : { ...item, phase: 'CANCELADO', selected: false }) };
    return ok(structuredClone(mock.activeBatch));
  },

  async setupSchema(): Promise<ApiResult<{ backup: { id: string; name: string; url: string }; report: unknown[] }>> {
    if (serverAvailable()) return callServer('apiSetupSchema', { confirmation: 'CREAR_COPIA_Y_MIGRAR', requestId: requestId() });
    await delay(700);
    mock.settings.schemaReady = true;
    return ok({ backup: { id: 'mock-backup', name: 'Copia local simulada', url: '#' }, report: [] });
  },

  async saveDocument(document: InvoiceDocument, reason: string): Promise<ApiResult<InvoiceDocument>> {
    const bulk = await this.saveDocuments([{ document, reason, baseUpdatedAt: document.updatedAt ?? '', decisionId: requestId(), dirtyAt: new Date().toISOString() }]);
    const item = bulk.data?.items[0];
    return item?.ok && item.document ? { ok: true, data: item.document, requestId: bulk.requestId } : { ok: false, error: item?.error ?? bulk.error ?? { code: 'SAVE_FAILED', message: 'No se pudo guardar la decisión' }, requestId: bulk.requestId };
  },

  async saveDocuments(drafts: ReviewDraft[]): Promise<ApiResult<ReviewSaveResult>> {
    if (serverAvailable()) return callServer<ReviewSaveResult>('apiSaveDocumentReviews', { items: drafts.map((draft) => ({ document: draft.document, reason: draft.reason, baseUpdatedAt: draft.baseUpdatedAt, decisionId: draft.decisionId })), requestId: requestId() });
    await delay(420);
    const started = performance.now();
    const items = drafts.map((draft) => {
      const current = mock.reviewDocuments.find((item) => item.id === draft.document.id) ?? mock.activeBatch?.documents.find((item) => item.id === draft.document.id);
      if (current?.updatedAt && draft.baseUpdatedAt && current.updatedAt !== draft.baseUpdatedAt) return { documentId: draft.document.id, ok: false, ready: false, error: { code: 'REVIEW_CONFLICT', message: 'La factura cambió desde que abriste la revisión.' } };
      const errors = draft.document.proposedStatus === 'PROCESADA' ? validateInvoice(draft.document, mock.suppliers) : [];
      const updated: InvoiceDocument = { ...draft.document, decisionReason: draft.reason, reviewReason: errors.join('; '), validationErrors: errors, phase: errors.length || draft.document.proposedStatus === 'REVISIÓN MANUAL' ? 'EN REVISIÓN' : 'LISTO PARA APROBAR', selected: !errors.length && draft.document.proposedStatus !== 'REVISIÓN MANUAL', updatedAt: new Date().toISOString() };
      if (mock.activeBatch) mock.activeBatch = { ...mock.activeBatch, documents: mock.activeBatch.documents.map((item) => item.id === updated.id ? updated : item) };
      mock.reviewDocuments = mock.reviewDocuments.map((item) => item.id === updated.id ? updated : item);
      return { documentId: updated.id, ok: true, ready: updated.phase === 'LISTO PARA APROBAR', document: updated };
    });
    return ok({ items, saved: items.filter((item) => item.ok).length, failed: items.filter((item) => !item.ok).length, durationMs: Math.round(performance.now() - started) });
  },

  async saveCategory(category: ExpenseCategory): Promise<ApiResult<ExpenseCategory>> {
    if (serverAvailable()) return callServer<ExpenseCategory>('apiSaveCategory', { category, requestId: requestId() });
    await delay();
    const saved = { ...category, id: category.id || `cat-${requestId()}`, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
    mock.categories = mock.categories.some((item) => item.id === saved.id) ? mock.categories.map((item) => item.id === saved.id ? saved : item) : [saved, ...mock.categories];
    return ok(structuredClone(saved));
  },

  async saveReconciliationLinks(importId: string, links: Pick<ReconciliationLink, 'movementId' | 'invoiceId' | 'allocatedAmount' | 'evidence'>[], reason = '', allowDifference = false): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiSaveReconciliationLinks', { importId, links, reason, allowDifference, requestId: requestId() });
    await delay();
    const bankImport = mock.bankImports.find((item) => item.id === importId)!;
    bankImport.reconciliations = [...(bankImport.reconciliations ?? []), ...links.map((link) => ({ ...link, id: `rec-${requestId()}`, importId, status: 'CONFIRMADA' as const, reason, createdAt: new Date().toISOString(), createdBy: mock.settings.user }))];
    return ok(structuredClone(bankImport));
  },

  async undoReconciliation(importId: string, reconciliationId: string, reason: string): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiUndoReconciliation', { importId, reconciliationId, reason, requestId: requestId() });
    const bankImport = mock.bankImports.find((item) => item.id === importId)!;
    bankImport.reconciliations = (bankImport.reconciliations ?? []).map((item) => item.id === reconciliationId ? { ...item, status: 'DESHECHA', reason } : item);
    return ok(structuredClone(bankImport));
  },

  async saveReconciliationException(importId: string, targetType: 'MOVEMENT' | 'INVOICE', targetId: string, reason: string): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiSaveReconciliationException', { importId, targetType, targetId, reason, requestId: requestId() });
    const bankImport = mock.bankImports.find((item) => item.id === importId)!;
    if (targetType === 'MOVEMENT') bankImport.movements = bankImport.movements.map((item) => item.id === targetId ? { ...item, status: 'EXCLUIDA CON MOTIVO', evidence: reason } : item);
    else mock.invoices = mock.invoices.map((item) => item.id === targetId ? { ...item, reconciliationStatus: 'EXCLUIDA CON MOTIVO' } : item);
    return ok(structuredClone(bankImport));
  },

  async getMonthlyClose(period: string): Promise<ApiResult<MonthlyClose>> {
    if (serverAvailable()) return callServer<MonthlyClose>('apiGetMonthlyClose', { period });
    const invoices = mock.invoices.filter((item) => item.status === 'PROCESADA' && item.date.startsWith(period));
    return ok({ period, coverage: mock.bankImports[0]?.coverage ?? 'Sin extracto confirmado', invoices: invoices.length, reviews: mock.reviewDocuments.length, reconciled: invoices.filter((item) => item.reconciliationStatus === 'CONCILIADA').length, partial: invoices.filter((item) => item.reconciliationStatus === 'PARCIALMENTE CONCILIADA').length, excluded: 0, movementsWithoutInvoice: 1, invoicesWithoutMovement: invoices.filter((item) => !item.reconciliationStatus || item.reconciliationStatus === 'SIN CONCILIAR').length, taxableBase: invoices.reduce((sum, item) => sum + Number(item.taxableBase || 0), 0), taxes: invoices.flatMap((item) => item.taxLines || []).filter((line) => line.kind !== 'RETENCION').reduce((sum, line) => sum + line.amount, 0), withholdings: invoices.flatMap((item) => item.taxLines || []).filter((line) => line.kind === 'RETENCION').reduce((sum, line) => sum + Math.abs(line.amount), 0), total: invoices.reduce((sum, item) => sum + item.total, 0), warnings: ['Datos sintéticos de desarrollo'], byCategory: [] });
  },

  async createAccountantExport(period: string, coverage: string): Promise<ApiResult<AccountantExport>> {
    if (serverAvailable()) return callServer<AccountantExport>('apiCreateAccountantExport', { period, coverage, confirmation: 'GENERAR_EXPORTACION_GESTORIA', requestId: requestId() });
    await delay(700);
    return ok({ id: `exp-${requestId()}`, period, status: 'COMPLETADA', folderUrl: '#', files: [{ name: `ReparaPRO-Gestoria-${period}.zip`, url: '#', size: 1024 }], createdAt: new Date().toISOString(), createdBy: mock.settings.user });
  },

  async _legacySaveDocumentMock(document: InvoiceDocument, reason: string): Promise<ApiResult<InvoiceDocument>> {
    await delay();
    const errors = validateInvoice(document, mock.suppliers);
    const keepInReview = document.proposedStatus === 'REVISIÓN MANUAL';
    const updated: InvoiceDocument = { ...document, reviewReason: reason || errors.join('; '), phase: errors.length || keepInReview ? 'EN REVISIÓN' : 'LISTO PARA APROBAR', proposedStatus: errors.length || keepInReview ? 'REVISIÓN MANUAL' : document.proposedStatus, selected: !(errors.length || keepInReview) };
    mock.activeBatch = { ...mock.activeBatch!, documents: mock.activeBatch!.documents.map((item) => item.id === updated.id ? updated : item) };
    mock.reviewDocuments = mock.reviewDocuments.map((item) => item.id === updated.id ? updated : item);
    return ok(structuredClone(updated));
  },

  async getDocumentPreview(document: InvoiceDocument): Promise<ApiResult<DocumentPreview>> {
    if (serverAvailable()) return callServer<DocumentPreview>('apiGetDocumentPreview', { documentId: document.id });
    await delay();
    return ok({
      id: document.id,
      originalName: document.originalName,
      mimeType: 'application/pdf',
      base64: 'JVBERi0xLjQKJcTl8uXrCg==',
      size: 16,
      gmailUrl: document.gmailUrl,
    });
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
      mock.invoices.unshift({ id: `inv-${doc.id}`, date: doc.invoiceDate, supplier: doc.supplier, taxId: doc.taxId, number: doc.invoiceNumber, total: doc.total ?? 0, currency: doc.currency, status: 'PROCESADA', driveUrl: '#', gmailUrl: doc.gmailUrl, originalName: doc.originalName, batchId, hash: doc.hash, nonRegularSupplier: doc.nonRegularSupplier });
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

  async previewBankImport(input: { fileName: string; base64: string; source: string; periodFrom: string; periodTo: string; coverage: string; mapping?: BankMapping; forceManual?: boolean }): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiPreviewBankImport', { ...input, requestId: requestId() });
    await delay(900);
    if (input.forceManual) return { ok: false, error: { code: 'BANK_MAPPING_REQUIRED', message: 'Selecciona las columnas y cómo se obtiene la moneda.', details: { headers: ['Concepto', 'Fecha', 'Importe', 'Saldo'], headerRow: 0, headerSignature: 'concepto|fecha|importe|saldo', extension: 'csv', separator: ';', suggestedCurrencyMode: 'EMBEDDED' } }, requestId: requestId() };
    const sample = structuredClone(mock.bankImports[0]);
    sample.id = `BANK-${Date.now()}`;
    sample.fileName = input.fileName;
    sample.source = input.source;
    sample.periodFrom = input.periodFrom;
    sample.periodTo = input.periodTo;
    sample.coverage = input.coverage;
    sample.status = 'PREVISUALIZACIÓN';
    if (/caixabank/i.test(input.fileName) && !input.mapping) { sample.bankFormatId = 'NATIVE-CAIXABANK-CSV'; sample.bankFormatName = 'CaixaBank CSV'; sample.movementCount = 58; }
    if (input.mapping?.rememberProfile && input.mapping.profileName) {
      const saved: BankFormat = { id: `BF-${requestId()}`, name: input.mapping.profileName, source: normalizeText(input.source), extension: 'csv', separator: ';', headerSignature: 'concepto|fecha|importe|saldo', headerRow: input.mapping.headerRow, mapping: { operationDate: input.mapping.operationDate, valueDate: input.mapping.valueDate, concept: input.mapping.concept, amount: input.mapping.amount, currency: input.mapping.currency, reference: input.mapping.reference }, currencyMode: input.mapping.currencyMode, fixedCurrency: input.mapping.fixedCurrency ?? '', active: true, native: false, createdAt: new Date().toISOString(), createdBy: mock.settings.user, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
      mock.bankFormats = [...mock.bankFormats.filter((item) => item.name !== saved.name), saved];
      sample.bankFormatId = saved.id; sample.bankFormatName = saved.name;
    }
    return ok(sample);
  },

  async listBankFormats(activeOnly = true): Promise<ApiResult<BankFormat[]>> {
    if (serverAvailable()) return callServer<BankFormat[]>('apiListBankFormats', { activeOnly });
    return ok(structuredClone(mock.bankFormats.filter((item) => !activeOnly || item.active)));
  },

  async deactivateBankFormat(formatId: string): Promise<ApiResult<BankFormat>> {
    if (serverAvailable()) return callServer<BankFormat>('apiDeactivateBankFormat', { formatId, requestId: requestId() });
    const current = mock.bankFormats.find((item) => item.id === formatId);
    if (!current || current.native) return { ok: false, error: { code: 'BANK_FORMAT_NOT_FOUND', message: 'No se encuentra el formato bancario editable.' }, requestId: requestId() };
    const updated = { ...current, active: false, updatedAt: new Date().toISOString(), updatedBy: mock.settings.user };
    mock.bankFormats = mock.bankFormats.map((item) => item.id === formatId ? updated : item);
    return ok(structuredClone(updated));
  },

  async confirmBankImport(bankImport: BankImport): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiConfirmBankImport', { importId: bankImport.id, requestId: requestId() });
    await delay(600);
    const saved = { ...bankImport, status: 'CONFIRMADA' as const };
    mock.bankImports.unshift(saved);
    return ok(structuredClone(saved));
  },

  async cancelBankImport(bankImport: BankImport, reason: string): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiCancelBankImport', { importId: bankImport.id, reason, requestId: requestId() });
    await delay();
    return ok({ ...structuredClone(bankImport), status: 'CANCELADA' });
  },

  async decideReconciliation(importId: string, movementId: string, status: string, invoiceId?: string): Promise<ApiResult<BankImport>> {
    if (serverAvailable()) return callServer<BankImport>('apiDecideReconciliation', { importId, movementId, status, invoiceId, requestId: requestId() });
    const bankImport = mock.bankImports.find((item) => item.id === importId)!;
    bankImport.movements = bankImport.movements.map((movement) => movement.id === movementId ? { ...movement, status: status as never, candidateInvoiceId: invoiceId ?? movement.candidateInvoiceId } : movement);
    return ok(structuredClone(bankImport));
  },

  async updateSettings(settings: AppSnapshot['settings'], confirmProduction = false): Promise<ApiResult<AppSnapshot['settings']>> {
    if (serverAvailable()) return callServer('apiUpdateSettings', { settings, confirmation: confirmProduction ? 'ACTIVAR_PRODUCCION' : '', requestId: requestId() });
    mock.settings = settings;
    return ok(structuredClone(settings));
  },

  async disableLegacyTriggers(): Promise<ApiResult<{ removed: AppSnapshot['settings']['triggers']; remaining: AppSnapshot['settings']['triggers'] }>> {
    if (serverAvailable()) return callServer('apiDisableLegacyTriggers', { confirmation: 'DESACTIVAR_AUTOMATIZACION_ANTIGUA', requestId: requestId() });
    const removed = (mock.settings.triggers || []).filter((item) => ['procesarFacturasPendientes', 'myFunction'].includes(item.handler));
    const remaining = (mock.settings.triggers || []).filter((item) => !['procesarFacturasPendientes', 'myFunction'].includes(item.handler));
    mock.settings = { ...mock.settings, triggers: remaining };
    return ok({ removed, remaining });
  },
};
