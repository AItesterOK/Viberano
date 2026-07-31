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
    return {
      settings: { mode: String(config.APP_MODE || 'DRY_RUN'), user: user, effectiveUser: getEffectiveEmail_(), allowedUsers: String(config.APP_ALLOWED_USERS || APP.OWNER_EMAIL).split(/[;,\s]+/).filter(Boolean), timezone: String(config.APP_TIMEZONE || APP.TIMEZONE), spreadsheetName: 'ReparaPRO Docs', invoiceFolderName: 'A.2 - FA-GASTOS', bankFolderName: 'MOVIMIENTOS BANCARIOS', maxBatchSize: Number(config.APP_MAX_BATCH_SIZE || APP.MAX_BATCH_SIZE), sliceSize: Number(config.APP_SLICE_SIZE || APP.SLICE_SIZE), startDate: String(config.APP_START_DATE || APP.START_DATE), services: { gmail: true, drive: true, sheets: true }, schemaReady: schemaReady },
      activeBatch: schemaReady ? getActiveBatch_() : null, invoices: invoices, suppliers: providerRows, metrics: metrics, bankImports: schemaReady ? allBankImports_() : [], audit: logRows.map(function (row) { return { id: String(row.ID_EVENTO || ('legacy-log-' + row.__row)), timestamp: String(row.FECHA_HORA || ''), level: String(row.NIVEL || 'INFO'), action: String(row['ACCIÓN'] || ''), object: String(row.DOCUMENTO || ''), detail: String(row.DETALLE || ''), user: String(row.USUARIO || 'sistema'), batchId: String(row.LOTE_ID || '') || undefined }; }), reviewCount: invoices.filter(function (item) { return item.status === 'REVISIÓN MANUAL'; }).length, processedCount: invoices.filter(function (item) { return item.status === 'PROCESADA'; }).length, duplicateCount: invoices.filter(function (item) { return item.status === 'DUPLICADO IGNORADO'; }).length,
    };
  });
}

function apiSetupSchema(payload) { return withApi_(payload, function (user, requestId) { if (!payload || payload.confirmation !== 'CREAR_COPIA_Y_MIGRAR') throw appError_('CONFIRMATION_REQUIRED', 'Debes confirmar la copia y migración aditiva.'); return setupSchema_(user, requestId); }, { lock: true }); }
function apiStartBatch(payload) { return withApi_(payload, function (user, requestId) { return startBatch_(payload, user, requestId); }, { lock: true }); }
function apiContinueBatch(payload) { return withApi_(payload, function (user, requestId) { return continueBatch_(payload.batchId, user, requestId); }, { lock: true }); }
function apiSaveDocumentReview(payload) { return withApi_(payload, function (user, requestId) { return saveDocumentReview_(payload, user, requestId); }, { lock: true }); }
function apiApproveBatch(payload) { return withApi_(payload, function (user, requestId) { return approveBatch_(payload, user, requestId); }, { lock: true }); }
function apiRetryBatch(payload) { return withApi_(payload, function (user, requestId) { return retryBatch_(payload.batchId, user, requestId); }, { lock: true }); }
function apiPreviewBankImport(payload) { return withApi_(payload, function (user, requestId) { return previewBankImport_(payload, user, requestId); }, { lock: true }); }
function apiConfirmBankImport(payload) { return withApi_(payload, function (user, requestId) { return confirmBankImport_(payload.importId, user, requestId); }, { lock: true }); }
function apiDecideReconciliation(payload) { return withApi_(payload, function (user, requestId) { return decideReconciliation_(payload, user, requestId); }, { lock: true }); }

function apiSaveSupplier(payload) {
  return withApi_(payload, function (user, requestId) {
    const input = payload.supplier || {};
    if (!String(input.name || '').trim()) throw appError_('SUPPLIER_NAME_REQUIRED', 'El nombre canónico es obligatorio.');
    if (!String(input.evidence || '').trim()) throw appError_('SUPPLIER_EVIDENCE_REQUIRED', 'La evidencia es obligatoria.');
    const rows = safeRows_(APP.SHEETS.PROVIDERS);
    const existing = rows.find(function (row) { return String(row.ID_PROVEEDOR || ('legacy-' + row.__row)) === String(input.id || ''); });
    const id = existing ? String(existing.ID_PROVEEDOR || ('legacy-' + existing.__row)) : (String(input.id || '') || 'SUP-' + uuid_());
    const data = { PROVEEDOR: String(input.name).trim(), DOMINIO: String(input.domain || '').trim().toLowerCase(), CIF_NIF: String(input.taxId || '').trim().toUpperCase(), TIPO: 'Factura de gasto', ACTIVO: input.active !== false, OBSERVACIONES: String(input.evidence), ID_PROVEEDOR: id, ALIASES: (input.aliases || []).join('; '), EVIDENCIA: String(input.evidence), FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user };
    const before = existing ? providerFromRow_(existing) : null;
    if (existing) updateObjectRow_(APP.SHEETS.PROVIDERS, existing.__row, data); else appendObject_(APP.SHEETS.PROVIDERS, data);
    logEvent_('INFO', existing ? 'PROVEEDOR_ACTUALIZADO' : 'PROVEEDOR_CREADO', id, data.PROVEEDOR, { before: before, after: data }, '', requestId, user);
    const saved = safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR) === id; });
    return providerFromRow_(saved);
  }, { lock: true });
}

function apiSetSupplierActive(payload) {
  return withApi_(payload, function (user, requestId) {
    const row = safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return String(item.ID_PROVEEDOR || ('legacy-' + item.__row)) === String(payload.id); });
    if (!row) throw appError_('SUPPLIER_NOT_FOUND', 'No se encuentra el proveedor.');
    updateObjectRow_(APP.SHEETS.PROVIDERS, row.__row, { ACTIVO: Boolean(payload.active), FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user });
    logEvent_('INFO', payload.active ? 'PROVEEDOR_REACTIVADO' : 'PROVEEDOR_DESACTIVADO', payload.id, String(row.PROVEEDOR), {}, '', requestId, user);
    return providerFromRow_(safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return item.__row === row.__row; }));
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
