function safeRows_(name) { try { return getRows_(name); } catch (_) { return []; } }

function apiBootstrap() {
  return withApi_(null, function (user) {
    const config = getConfigMap_();
    const invoiceRows = safeRows_(APP.SHEETS.INVOICES);
    const invoices = invoiceRows.map(invoiceFromRow_);
    const providerRows = safeRows_(APP.SHEETS.PROVIDERS).map(providerFromRow_);
    const invoiceCounts = invoices.reduce(function (map, invoice) { const key = normalizeText_(invoice.supplier); map[key] = (map[key] || 0) + 1; return map; }, {});
    providerRows.forEach(function (provider) { provider.invoiceCount = invoiceCounts[normalizeText_(provider.name)] || 0; delete provider.__row; });
    const metrics = buildMetrics_(invoices);
    const logRows = safeRows_(APP.SHEETS.LOG).slice(-100).reverse();
    const schemaReady = Boolean(spreadsheet_().getSheetByName(APP.SHEETS.BATCHES) && spreadsheet_().getSheetByName(APP.SHEETS.DOCUMENTS) && spreadsheet_().getSheetByName(APP.SHEETS.MOVEMENTS) && spreadsheet_().getSheetByName(APP.SHEETS.RECONCILIATIONS));
    const reviewDocuments = schemaReady ? reviewDocuments_() : [];
    return {
      settings: { mode: String(config.APP_MODE || 'DRY_RUN'), user: user, effectiveUser: getEffectiveEmail_(), allowedUsers: String(config.APP_ALLOWED_USERS || APP.OWNER_EMAIL).split(/[;,\s]+/).filter(Boolean), timezone: String(config.APP_TIMEZONE || APP.TIMEZONE), spreadsheetName: 'ReparaPRO Docs', invoiceFolderName: 'A.2 - FA-GASTOS', bankFolderName: 'MOVIMIENTOS BANCARIOS', maxBatchSize: Number(config.APP_MAX_BATCH_SIZE || APP.MAX_BATCH_SIZE), sliceSize: Number(config.APP_SLICE_SIZE || APP.SLICE_SIZE), startDate: String(config.APP_START_DATE || APP.START_DATE), services: { gmail: true, drive: true, sheets: true }, schemaReady: schemaReady },
      activeBatch: schemaReady ? getActiveBatch_() : null, reviewDocuments: reviewDocuments, invoices: invoices, suppliers: providerRows, metrics: metrics, bankImports: schemaReady ? allBankImports_() : [], audit: logRows.map(function (row) { return { id: String(row.ID_EVENTO || ('legacy-log-' + row.__row)), timestamp: String(row.FECHA_HORA || ''), level: String(row.NIVEL || 'INFO'), action: String(row['ACCIÓN'] || ''), object: String(row.DOCUMENTO || ''), detail: String(row.DETALLE || ''), user: String(row.USUARIO || 'sistema'), batchId: String(row.LOTE_ID || '') || undefined }; }), reviewCount: reviewDocuments.length, processedCount: invoices.filter(function (item) { return item.status === 'PROCESADA'; }).length, duplicateCount: invoices.filter(function (item) { return item.status === 'DUPLICADO IGNORADO'; }).length,
    };
  });
}

function apiSetupSchema(payload) { return withApi_(payload, function (user, requestId) { if (!payload || payload.confirmation !== 'CREAR_COPIA_Y_MIGRAR') throw appError_('CONFIRMATION_REQUIRED', 'Debes confirmar la copia y migración aditiva.'); return setupSchema_(user, requestId); }, { lock: true }); }
function apiStartBatch(payload) { return withApi_(payload, function (user, requestId) { return startBatch_(payload, user, requestId); }, { lock: true }); }
function apiContinueBatch(payload) { return withApi_(payload, function (user, requestId) { return continueBatch_(payload.batchId, user, requestId); }, { lock: true }); }
function apiSaveDocumentReview(payload) { return withApi_(payload, function (user, requestId) { return saveDocumentReview_(payload, user, requestId); }, { lock: true }); }
function apiApproveDocument(payload) { return withApi_(payload, function (user, requestId) { return approveDocument_(payload.documentId, user, requestId); }, { lock: true }); }
function apiApproveBatch(payload) { return withApi_(payload, function (user, requestId) { return approveBatch_(payload, user, requestId); }, { lock: true }); }
function apiRetryBatch(payload) { return withApi_(payload, function (user, requestId) { return retryBatch_(payload.batchId, user, requestId); }, { lock: true }); }
function apiPreviewBankImport(payload) { return withApi_(payload, function (user, requestId) { return previewBankImport_(payload, user, requestId); }, { lock: true }); }
function apiConfirmBankImport(payload) { return withApi_(payload, function (user, requestId) { return confirmBankImport_(payload.importId, user, requestId); }, { lock: true }); }
function apiDecideReconciliation(payload) { return withApi_(payload, function (user, requestId) { return decideReconciliation_(payload, user, requestId); }, { lock: true }); }

function apiListBatches() { return withApi_(null, function () { return safeRows_(APP.SHEETS.BATCHES).slice().reverse().map(batchFromRow_); }); }
function apiGetBatch(payload) { return withApi_(payload, function () { const row = safeRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(payload.batchId); }); if (!row) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote.'); return batchFromRow_(row); }); }
function apiListDocuments(payload) { return withApi_(payload, function () { const rows = safeRows_(APP.SHEETS.DOCUMENTS).filter(function (row) { return !payload || !payload.phase || String(row.FASE) === String(payload.phase); }); return rows.slice(-Math.min(Number(payload && payload.limit || 200), 500)).reverse().map(documentFromRow_); }); }
function apiGetDocument(payload) { return withApi_(payload, function () { const row = safeRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return String(item.DOCUMENTO_ID) === String(payload.documentId); }); if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.'); return documentFromRow_(row); }); }
function apiGetDocumentPreview(payload) { return withApi_(payload, function () { const row = safeRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return String(item.DOCUMENTO_ID) === String(payload.documentId); }); if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.'); return { id: String(row.DOCUMENTO_ID), originalName: String(row.NOMBRE_ORIGINAL || ''), gmailUrl: String(row.GMAIL_URL || ''), driveUrl: String(row.URL_DRIVE || ''), evidence: safeJsonParse_(row.EVIDENCIA_JSON, []).slice(0, 20) }; }); }
function apiGetMetrics() { return withApi_(null, function () { return buildMetrics_(safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_)); }); }
function apiListAudit(payload) { return withApi_(payload, function () { const limit = Math.min(Math.max(Number(payload && payload.limit || 100), 1), 500); return safeRows_(APP.SHEETS.LOG).slice(-limit).reverse(); }); }
function apiExportSuppliers() { return withApi_(null, function () { return safeRows_(APP.SHEETS.PROVIDERS).map(function (row) { return { PROVEEDOR: String(row.PROVEEDOR || ''), DOMINIO: String(row.DOMINIO || ''), CIF_NIF: String(row.CIF_NIF || '') }; }); }); }

function apiSaveSupplier(payload) {
  return withApi_(payload, function (user, requestId) {
    const priorEvent = eventByRequest_(requestId, ['PROVEEDOR_ACTUALIZADO', 'PROVEEDOR_CREADO']);
    if (priorEvent) { const priorRow = safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR || '') === String(priorEvent.DOCUMENTO || ''); }); if (priorRow) return providerFromRow_(priorRow); }
    const input = payload.supplier || {};
    if (!String(input.name || '').trim()) throw appError_('SUPPLIER_NAME_REQUIRED', 'El nombre canónico es obligatorio.');
    if (!String(input.evidence || '').trim()) throw appError_('SUPPLIER_EVIDENCE_REQUIRED', 'La evidencia es obligatoria.');
    const rows = safeRows_(APP.SHEETS.PROVIDERS);
    const existing = rows.find(function (row) { return String(row.ID_PROVEEDOR || ('legacy-' + row.__row)) === String(input.id || ''); });
    const id = existing ? String(existing.ID_PROVEEDOR || ('legacy-' + existing.__row)) : (String(input.id || '') || 'SUP-' + uuid_());
    const data = { PROVEEDOR: String(input.name).trim(), DOMINIO: String(input.domain || '').trim().toLowerCase(), CIF_NIF: String(input.taxId || '').trim().toUpperCase(), TIPO: 'Factura de gasto', ACTIVO: input.active !== false, OBSERVACIONES: String(input.evidence), ID_PROVEEDOR: id, ALIASES: (input.aliases || []).join('; '), EVIDENCIA: String(input.evidence), FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId };
    const before = existing ? providerFromRow_(existing) : null;
    if (existing) updateObjectRow_(APP.SHEETS.PROVIDERS, existing.__row, data); else appendObject_(APP.SHEETS.PROVIDERS, data);
    logEvent_('INFO', existing ? 'PROVEEDOR_ACTUALIZADO' : 'PROVEEDOR_CREADO', id, data.PROVEEDOR, { before: before, after: data }, '', requestId, user);
    const saved = safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR) === id; });
    return providerFromRow_(saved);
  }, { lock: true });
}

function apiSetSupplierActive(payload) {
  return withApi_(payload, function (user, requestId) {
    const priorEvent = eventByRequest_(requestId, ['PROVEEDOR_REACTIVADO', 'PROVEEDOR_DESACTIVADO']);
    if (priorEvent) { const priorRow = safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return String(item.ID_PROVEEDOR || '') === String(payload.id); }); if (priorRow) return providerFromRow_(priorRow); }
    const row = safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return String(item.ID_PROVEEDOR || ('legacy-' + item.__row)) === String(payload.id); });
    if (!row) throw appError_('SUPPLIER_NOT_FOUND', 'No se encuentra el proveedor.');
    updateObjectRow_(APP.SHEETS.PROVIDERS, row.__row, { ACTIVO: Boolean(payload.active), FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    logEvent_('INFO', payload.active ? 'PROVEEDOR_REACTIVADO' : 'PROVEEDOR_DESACTIVADO', payload.id, String(row.PROVEEDOR), {}, '', requestId, user);
    return providerFromRow_(safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return item.__row === row.__row; }));
  }, { lock: true });
}

function apiMergeSuppliers(payload) {
  return withApi_(payload, function (user, requestId) {
    const priorEvent = eventByRequest_(requestId, 'PROVEEDORES_FUSIONADOS');
    if (priorEvent) { const priorData = safeJsonParse_(priorEvent.DATOS_JSON, {}); return { source: providerFromRow_(safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR || '') === String(priorData.sourceId || ''); })), target: providerFromRow_(safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR || '') === String(priorData.targetId || ''); })) }; }
    const sourceId = String(payload.sourceId || '');
    const targetId = String(payload.targetId || '');
    const reason = String(payload.reason || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) throw appError_('INVALID_SUPPLIER_MERGE', 'Selecciona dos proveedores distintos.');
    if (!reason) throw appError_('REASON_REQUIRED', 'La fusión necesita un motivo y evidencia.');
    const rows = safeRows_(APP.SHEETS.PROVIDERS);
    const source = rows.find(function (row) { return String(row.ID_PROVEEDOR || ('legacy-' + row.__row)) === sourceId; });
    const target = rows.find(function (row) { return String(row.ID_PROVEEDOR || ('legacy-' + row.__row)) === targetId; });
    if (!source || !target) throw appError_('SUPPLIER_NOT_FOUND', 'No se encuentran ambos proveedores.');
    if (!toBoolean_(target.ACTIVO)) throw appError_('TARGET_SUPPLIER_INACTIVE', 'El proveedor de destino debe estar activo.');
    const aliases = String(target.ALIASES || '').split(';').concat([String(source.PROVEEDOR || '')], String(source.ALIASES || '').split(';')).map(function (value) { return value.trim(); }).filter(Boolean).filter(function (value, index, list) { return list.map(normalizeText_).indexOf(normalizeText_(value)) === index && normalizeText_(value) !== normalizeText_(target.PROVEEDOR || ''); });
    updateObjectRow_(APP.SHEETS.PROVIDERS, target.__row, { ALIASES: aliases.join('; '), EVIDENCIA: [String(target.EVIDENCIA || target.OBSERVACIONES || '').trim(), 'Fusión acreditada: ' + reason].filter(Boolean).join(' | '), FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    updateObjectRow_(APP.SHEETS.PROVIDERS, source.__row, { ACTIVO: false, OBSERVACIONES: 'Fusionado en ' + String(target.PROVEEDOR || '') + ': ' + reason, FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    safeRows_(APP.SHEETS.DOCUMENTS).filter(function (row) { return String(row.PROVEEDOR_ID || '') === sourceId && String(row.FASE || '') !== 'FINALIZADO'; }).forEach(function (row) { updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { PROVEEDOR_ID: targetId, PROVEEDOR: String(target.PROVEEDOR || ''), CIF_NIF: String(target.CIF_NIF || ''), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId }); });
    logEvent_('INFO', 'PROVEEDORES_FUSIONADOS', targetId, String(source.PROVEEDOR || '') + ' → ' + String(target.PROVEEDOR || ''), { sourceId: sourceId, targetId: targetId, reason: reason }, '', requestId, user);
    const updated = safeRows_(APP.SHEETS.PROVIDERS);
    return { source: providerFromRow_(updated.find(function (row) { return row.__row === source.__row; })), target: providerFromRow_(updated.find(function (row) { return row.__row === target.__row; })) };
  }, { lock: true });
}

function apiUpdateSettings(payload) {
  return withApi_(payload, function (user, requestId) {
    const input = payload.settings || {};
    const mode = String(input.mode || 'DRY_RUN');
    if (['DRY_RUN', 'PRODUCTION'].indexOf(mode) === -1) throw appError_('INVALID_MODE', 'Modo no válido.');
    const allowed = (input.allowedUsers || []).map(function (email) { return String(email).trim().toLowerCase(); }).filter(Boolean);
    if (allowed.indexOf(APP.OWNER_EMAIL) === -1) throw appError_('OWNER_REQUIRED', 'compras@reparapro.com debe permanecer autorizado.');
    const max = Math.min(Math.max(Number(input.maxBatchSize || 10), 1), APP.MAX_BATCH_SIZE);
    const slice = Math.min(Math.max(Number(input.sliceSize || APP.SLICE_SIZE), 1), APP.SLICE_SIZE);
    const before = getConfigMap_();
    upsertConfig_('APP_MODE', mode, 'DRY_RUN impide archivo y registro definitivo');
    upsertConfig_('APP_ALLOWED_USERS', allowed.join(','), 'Correos autorizados separados por coma');
    upsertConfig_('APP_MAX_BATCH_SIZE', String(max), 'Máximo de correos por lote');
    upsertConfig_('APP_SLICE_SIZE', String(slice), 'Correos por ejecución interna');
    upsertConfig_('APP_START_DATE', parseDate_(input.startDate) || APP.START_DATE, 'Inicio mínimo de búsqueda en Gmail');
    logEvent_('INFO', 'CONFIG_ACTUALIZADA', 'CONFIG', 'Configuración operativa actualizada', { before: before, after: getConfigMap_() }, '', requestId, user);
    return { mode: mode, user: user, effectiveUser: getEffectiveEmail_(), allowedUsers: allowed, timezone: APP.TIMEZONE, spreadsheetName: 'ReparaPRO Docs', invoiceFolderName: 'A.2 - FA-GASTOS', bankFolderName: 'MOVIMIENTOS BANCARIOS', maxBatchSize: max, sliceSize: slice, startDate: parseDate_(input.startDate) || APP.START_DATE, services: { gmail: true, drive: true, sheets: true }, schemaReady: true };
  }, { lock: true });
}

function buildMetrics_(invoices) {
  const grouped = {};
  invoices.filter(function (invoice) { return invoice.status === 'PROCESADA' && /^\d{4}-\d{2}-\d{2}$/.test(invoice.date); }).forEach(function (invoice) { const month = invoice.date.slice(0, 7); if (!grouped[month]) grouped[month] = { count: 0, total: 0 }; grouped[month].count += 1; grouped[month].total += Number(invoice.total || 0); });
  const currentMonth = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM');
  return Object.keys(grouped).sort().map(function (month) { return { month: month, count: grouped[month].count, total: Number(grouped[month].total.toFixed(2)), complete: month < currentMonth }; });
}
