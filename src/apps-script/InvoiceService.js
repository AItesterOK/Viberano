function saveDocumentReview_(payload, user, requestId) {
  const result = saveDocumentReviews_({ items: [{ document: payload.document, reason: payload.reason, baseUpdatedAt: payload.baseUpdatedAt || '', decisionId: requestId }] }, user, requestId);
  const item = result.items[0];
  if (!item.ok) throw appError_(item.error.code, item.error.message, item.error.retryable);
  return item.document;
}

function saveDocumentReviews_(payload, user, requestId) {
  const started = Date.now();
  const items = (payload && payload.items || []).slice(0, 20);
  if (!items.length) throw appError_('EMPTY_REVIEW_SAVE', 'No hay decisiones modificadas para guardar.');
  const rows = getRows_(APP.SHEETS.DOCUMENTS);
  const providers = activeProviders_();
  const invoices = getRows_(APP.SHEETS.INVOICES);
  const providerCounts = invoices.reduce(function (map, invoice) { if (String(invoice.ESTADO || '') === 'PROCESADA') { const key = normalizeText_(invoice.PROVEEDOR || ''); map[key] = (map[key] || 0) + 1; } return map; }, {});
  const rowChanges = [];
  const auditEvents = [];
  const results = items.map(function (item) {
    const input = item.document || {};
    const row = rows.find(function (candidate) { return String(candidate.DOCUMENTO_ID) === String(input.id); });
    try {
      if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.');
      const decisionId = String(item.decisionId || requestId + '-' + input.id);
      if (String(row.REQUEST_ID || '') === decisionId) return { documentId: String(input.id), ok: true, ready: String(row.FASE) === 'LISTO PARA APROBAR', document: documentFromRow_(row) };
      if (item.baseUpdatedAt && String(row.ACTUALIZADO_EN || '') && String(item.baseUpdatedAt) !== String(row.ACTUALIZADO_EN)) throw appError_('REVIEW_CONFLICT', 'La factura cambió desde que abriste la revisión. Recarga antes de sobrescribirla.');
      const reason = String(item.reason || '').trim();
      if (!reason) throw appError_('REASON_REQUIRED', 'Toda corrección manual necesita un motivo.');
      const provider = providers.find(function (candidate) { return candidate.id === input.supplierId; }) || providers.find(function (candidate) { return normalizeText_(candidate.name) === normalizeText_(input.supplier || ''); });
      const history = provider ? providerCounts[normalizeText_(provider.name)] || 0 : 0;
      const errors = validateReviewDocument_(input, provider, history, reason);
      const classification = String(input.proposedStatus || 'REVISIÓN MANUAL');
      const phase = errors.length || classification === 'REVISIÓN MANUAL' ? 'EN REVISIÓN' : 'LISTO PARA APROBAR';
      const keepAccounting = classification === 'PROCESADA' || classification === 'REVISIÓN MANUAL';
      const evidence = (input.evidence || []).filter(function (entry) { return String(entry.source) !== 'MANUAL'; });
      evidence.push({ field: 'manualDecision', value: classification, source: 'MANUAL', excerpt: reason });
      if (input.nonRegularSupplier) evidence.push({ field: 'supplierFrequency', value: 'PROVEEDOR NO HABITUAL', source: 'MANUAL', excerpt: provider ? history + ' factura(s) histórica(s) procesada(s)' : 'Proveedor no reconocido en el catálogo' });
      const updatedAt = nowIso_();
      const updates = {
        FECHA_FACTURA: keepAccounting ? parseDate_(input.invoiceDate) : '', FECHA_OPERACION: keepAccounting ? parseDate_(input.operationDate) : '', FECHA_VENCIMIENTO: keepAccounting ? parseDate_(input.dueDate) : '', CATEGORIA_ID: keepAccounting ? String(input.categoryId || '') : '', BASE_IMPONIBLE: keepAccounting && input.taxableBase !== null && input.taxableBase !== undefined ? Number(input.taxableBase) : '', IMPUESTOS_JSON: keepAccounting ? JSON.stringify(input.taxLines || []) : '[]', NOTA_INTERNA: keepAccounting ? String(input.internalNote || '') : '',
        PROVEEDOR: keepAccounting ? (provider ? provider.name : input.supplier || '') : '', PROVEEDOR_ID: keepAccounting && provider ? provider.id : '', CIF_NIF: keepAccounting ? input.taxId || '' : '', NUMERO_FACTURA: keepAccounting ? input.invoiceNumber || '' : '', IMPORTE_TOTAL: keepAccounting && input.total !== null && isFinite(Number(input.total)) ? Number(input.total) : '', MONEDA: keepAccounting ? String(input.currency || '').toUpperCase() : '', FASE: phase, ESTADO_PROPUESTO: classification, MOTIVO_REVISION: errors.join('; '), MOTIVO_DECISION: reason, ERRORES_VALIDACION_JSON: JSON.stringify(errors), EVIDENCIA_JSON: JSON.stringify(evidence), SELECCIONADO: phase === 'LISTO PARA APROBAR', PROVEEDOR_NO_HABITUAL: keepAccounting && Boolean(input.nonRegularSupplier), ACTUALIZADO_EN: updatedAt, ACTUALIZADO_POR: user, REQUEST_ID: decisionId,
      };
      rowChanges.push({ rowNumber: row.__row, updates: updates });
      Object.assign(row, updates);
      auditEvents.push(logEventObject_('INFO', 'DOCUMENTO_REVISADO', input.id, reason, { classification: classification, validationErrors: errors }, String(row.LOTE_ID || ''), decisionId, user));
      return { documentId: String(input.id), ok: true, ready: phase === 'LISTO PARA APROBAR', document: documentFromRow_(row) };
    } catch (error) {
      return { documentId: String(input.id || ''), ok: false, ready: false, error: { code: error.code || 'SERVER_ERROR', message: error.message || String(error), retryable: Boolean(error.retryable) } };
    }
  });
  updateObjectRows_(APP.SHEETS.DOCUMENTS, rowChanges);
  const saved = results.filter(function (item) { return item.ok; }).length;
  const failed = results.filter(function (item) { return !item.ok; }).length;
  const writeDurationMs = Date.now() - started;
  auditEvents.push(logEventObject_('INFO', 'REVISION_MASIVA_GUARDADA', '', saved + ' guardadas; ' + failed + ' fallidas', { count: items.length, durationMs: writeDurationMs }, '', requestId, user));
  appendObjects_(APP.SHEETS.LOG, auditEvents);
  const response = { items: results, saved: saved, failed: failed, durationMs: Date.now() - started };
  return response;
}

function validateReviewDocument_(input, provider, providerHistory, reason) {
  const errors = [];
  if (String(input.proposedStatus) !== 'PROCESADA') return errors;
  if (!String(input.supplier || '').trim() && !provider) errors.push('Proveedor ausente');
  if (!provider && !input.nonRegularSupplier) errors.push('Proveedor desconocido o inactivo');
  if (input.nonRegularSupplier && provider && providerHistory >= 3) errors.push('El proveedor ya es habitual: tiene al menos 3 facturas históricas');
  if (!String(input.invoiceNumber || '').trim()) errors.push('Número de factura ausente');
  if (!parseDate_(input.invoiceDate)) errors.push('Fecha inválida');
  if (input.total === null || !isValidInvoiceAmount_(input.total, input, reason)) errors.push('Importe inválido; las notas de crédito deben estar acreditadas y tener importe negativo');
  if (!/^[A-Z]{3}$/.test(String(input.currency || ''))) errors.push('Moneda inválida');
  if (input.operationDate && !parseDate_(input.operationDate)) errors.push('Fecha de operación inválida');
  if (input.dueDate && !parseDate_(input.dueDate)) errors.push('Fecha de vencimiento inválida');
  const lines = input.taxLines || [];
  if (lines.length) {
    if (input.taxableBase === null || input.taxableBase === undefined || input.taxableBase === '') errors.push('Falta la base imponible del desglose fiscal');
    const base = Math.round(Number(input.taxableBase || 0) * 100);
    const taxes = lines.reduce(function (sum, line) { const amount = Math.round(Number(line.amount || 0) * 100); return sum + (String(line.kind) === 'RETENCION' ? -Math.abs(amount) : amount); }, 0);
    const total = Math.round(Number(input.total || 0) * 100);
    if (Math.abs(base + taxes - total) > 1) errors.push('El desglose fiscal no cuadra con el total');
  }
  return errors;
}

function approveDocument_(documentId, user, requestId) {
  if (String(getConfigMap_().APP_MODE || 'DRY_RUN') !== 'PRODUCTION') throw appError_('DRY_RUN_ACTIVE', 'La aplicación está en modo seco. No se archivará ni registrará el documento.');
  const row = getRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return String(item.DOCUMENTO_ID) === String(documentId); });
  if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.');
  if (String(row.FASE) === 'FINALIZADO') return documentFromRow_(row);
  if (String(row.FASE) !== 'LISTO PARA APROBAR' && String(row.FASE) !== 'ERROR') throw appError_('DOCUMENT_NOT_READY', 'El documento todavía necesita revisión humana.');
  try {
    finalizeDocument_(row, user, requestId);
    logEvent_('INFO', 'DOCUMENTO_APROBADO', documentId, 'Documento pendiente finalizado', {}, String(row.LOTE_ID || ''), requestId, user);
  } catch (error) {
    updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'ERROR', ERROR: error.message || String(error), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    throw error;
  }
  return documentFromRow_(getRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return item.__row === row.__row; }));
}

function approveDocuments_(payload, user, requestId) {
  if (String(getConfigMap_().APP_MODE || 'DRY_RUN') !== 'PRODUCTION') throw appError_('DRY_RUN_ACTIVE', 'La aplicación está en modo seco. No se archivará ni registrará ningún documento.');
  const repeated = eventByRequest_(requestId, 'DOCUMENTOS_APROBADOS_EN_CONJUNTO');
  if (repeated) return safeJsonParse_(repeated.DATOS_JSON, {}).response || { items: [], approved: 0, failed: 0 };
  const ids = (payload.documentIds || []).map(String).filter(Boolean).filter(function (id, index, list) { return list.indexOf(id) === index; });
  if (!ids.length) throw appError_('EMPTY_APPROVAL', 'Selecciona al menos un documento.');
  if (ids.length > 20) throw appError_('TOO_MANY_DOCUMENTS', 'Aprueba como máximo 20 documentos cada vez.');
  const rows = getRows_(APP.SHEETS.DOCUMENTS);
  const results = [];
  ids.forEach(function (documentId, index) {
    const row = rows.find(function (candidate) { return String(candidate.DOCUMENTO_ID || '') === documentId; });
    try {
      if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.');
      if (String(row.FASE || '') === 'FINALIZADO') { results.push({ documentId: documentId, ok: true, document: documentFromRow_(row), destination: String(row.URL_DRIVE || '') || undefined }); return; }
      if (String(row.FASE || '') !== 'LISTO PARA APROBAR' && String(row.FASE || '') !== 'ERROR') throw appError_('DOCUMENT_NOT_READY', 'El documento todavía necesita revisión humana.');
      finalizeDocument_(row, user, requestId + '-' + index);
      const saved = getRows_(APP.SHEETS.DOCUMENTS).find(function (candidate) { return candidate.__row === row.__row; });
      results.push({ documentId: documentId, ok: true, document: documentFromRow_(saved), destination: String(saved.URL_DRIVE || '') || undefined });
    } catch (error) {
      if (row) updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'ERROR', ERROR: error.message || String(error), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId + '-' + index });
      results.push({ documentId: documentId, ok: false, error: error.message || String(error) });
    }
  });
  const response = { items: results, approved: results.filter(function (item) { return item.ok; }).length, failed: results.filter(function (item) { return !item.ok; }).length };
  logEvent_('INFO', 'DOCUMENTOS_APROBADOS_EN_CONJUNTO', '', response.approved + ' documentos aprobados; ' + response.failed + ' con error', { response: response }, '', requestId, user);
  return response;
}

function approveBatch_(payload, user, requestId) {
  const config = getConfigMap_();
  if (String(config.APP_MODE || 'DRY_RUN') !== 'PRODUCTION') throw appError_('DRY_RUN_ACTIVE', 'La aplicación está en modo seco. Cambia a PRODUCCIÓN de forma explícita antes de aprobar.');
  const batchRow = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.LOTE_ID) === String(payload.batchId); });
  if (!batchRow) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote.');
  if (String(batchRow.REQUEST_ID || '') === String(requestId) && ['COMPLETADO', 'COMPLETADO CON ERRORES'].indexOf(String(batchRow.ESTADO || '')) !== -1) return batchFromRow_(batchRow);
  if (String(batchRow.ESTADO) === 'COMPLETADO') return batchFromRow_(batchRow);
  const ids = payload.documentIds || [];
  if (!ids.length) throw appError_('EMPTY_APPROVAL', 'Selecciona al menos un documento.');
  updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { ESTADO: 'EJECUTANDO' });
  const documents = getRows_(APP.SHEETS.DOCUMENTS).filter(function (row) { return String(row.LOTE_ID) === String(payload.batchId) && ids.indexOf(String(row.DOCUMENTO_ID)) !== -1; });
  let errors = 0;
  documents.forEach(function (row) {
    try { finalizeDocument_(row, user, requestId); }
    catch (error) {
      errors += 1;
      updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'ERROR', ERROR: error.message || String(error), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user });
      logEvent_('ERROR', 'DOCUMENTO_ERROR', String(row.DOCUMENTO_ID), error.message || String(error), {}, String(payload.batchId), requestId + '-' + row.DOCUMENTO_ID, user);
    }
  });
  const finalStatus = errors ? 'COMPLETADO CON ERRORES' : 'COMPLETADO';
  updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { ESTADO: finalStatus, APROBADO_EN: nowIso_(), APROBADO_POR: user, ERROR: errors ? errors + ' documentos con error' : '', REQUEST_ID: requestId });
  logEvent_(errors ? 'WARN' : 'INFO', 'LOTE_COMPLETADO', String(payload.batchId), documents.length + ' documentos finalizados', { errors: errors }, String(payload.batchId), requestId, user);
  const updated = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.LOTE_ID) === String(payload.batchId); });
  return batchFromRow_(updated);
}

function finalizeDocument_(row, user, requestId) {
  if (String(row.FASE) === 'FINALIZADO') return;
  const status = String(row.ESTADO_PROPUESTO || 'REVISIÓN MANUAL');
  const sourceKey = String(row.SOURCE_KEY || '');
  const hash = String(row.HASH_PDF || '');
  const existingRows = getRows_(APP.SHEETS.INVOICES);
  const sameSource = existingRows.find(function (invoice) { return invoiceMatchesDocumentSource_(invoice, row); });
  const historicalReview = sameSource && String(sameSource.ESTADO || '') === 'REVISIÓN MANUAL' ? sameSource : null;
  if (sameSource && !historicalReview) {
    updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'FINALIZADO', ESTADO_FINAL: String(sameSource.ESTADO || 'DUPLICADO IGNORADO'), ARCHIVO_DRIVE: String(sameSource.ARCHIVO_DRIVE || ''), URL_DRIVE: String(sameSource.URL_DRIVE || ''), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '' });
    return;
  }
  const byteDuplicate = existingRows.find(function (invoice) { return invoice.__row !== (historicalReview && historicalReview.__row) && hash && String(invoice.HASH_PDF || '') === hash; });
  const accountingKey = status === 'PROCESADA' ? invoiceAccountingKey_(row) : '';
  const accountingDuplicate = status === 'PROCESADA' ? existingRows.find(function (invoice) { return invoice.__row !== (historicalReview && historicalReview.__row) && invoiceAccountingKey_(invoice) === accountingKey; }) : null;
  const duplicate = byteDuplicate || accountingDuplicate;
  if (duplicate) {
    writeInvoiceRegister_(row, 'DUPLICADO IGNORADO', '', '', 'Coincidencia con ' + String(duplicate.ID_UNICO || ''), user);
    updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'FINALIZADO', ESTADO_FINAL: 'DUPLICADO IGNORADO', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user });
    return;
  }
  let drive = { name: '', url: '' };
  if (status === 'PROCESADA') {
    validateFinalInvoice_(row, historicalReview && historicalReview.__row);
    if (row.DRIVE_FILE_ID && row.URL_DRIVE) drive = { id: String(row.DRIVE_FILE_ID), name: String(row.ARCHIVO_DRIVE || ''), url: String(row.URL_DRIVE) };
    else {
      drive = archiveInvoice_(row);
      updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { ARCHIVO_DRIVE: drive.name, URL_DRIVE: drive.url, DRIVE_FILE_ID: drive.id, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user });
    }
  }
  if (historicalReview) {
    updateHistoricalInvoiceRegister_(historicalReview, row, status, drive.name, drive.url, String(row.MOTIVO_REVISION || ''), user);
    logEvent_('INFO', 'FACTURA_HISTORICA_ACTUALIZADA', String(row.DOCUMENTO_ID || ''), 'La revisión histórica se completó sin crear otra fila', { invoiceRow: historicalReview.__row, status: status }, String(row.LOTE_ID || ''), requestId, user);
  } else {
    writeInvoiceRegister_(row, status, drive.name, drive.url, String(row.MOTIVO_REVISION || ''), user);
  }
  updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'FINALIZADO', ESTADO_FINAL: status, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '' });
}

function validateFinalInvoice_(row, ignoredInvoiceRow) {
  const providers = activeProviders_();
  const provider = providers.find(function (item) { return item.id === String(row.PROVEEDOR_ID); }) || providers.find(function (item) { return normalizeText_(item.name) === normalizeText_(row.PROVEEDOR || ''); });
  const nonRegularSupplier = toBoolean_(row.PROVEEDOR_NO_HABITUAL);
  if (!String(row.PROVEEDOR || '').trim()) throw appError_('INVALID_SUPPLIER', 'Falta el nombre acreditado del proveedor.');
  if (!nonRegularSupplier && !provider) throw appError_('INVALID_SUPPLIER', 'El proveedor no está activo.');
  if (nonRegularSupplier && provider && processedSupplierInvoiceCount_(provider.name) >= 3) throw appError_('SUPPLIER_ALREADY_REGULAR', 'El proveedor ya es habitual: tiene al menos 3 facturas históricas.');
  if (!String(row.NUMERO_FACTURA || '').trim()) throw appError_('INVALID_INVOICE', 'Falta número de factura.');
  if (!parseDate_(row.FECHA_FACTURA)) throw appError_('INVALID_INVOICE', 'Fecha de factura inválida.');
  if (!isValidInvoiceAmount_(row.IMPORTE_TOTAL, row)) throw appError_('INVALID_INVOICE', 'Importe total inválido; las notas de crédito deben estar acreditadas y tener importe negativo.');
  if (!/^[A-Z]{3}$/.test(String(row.MONEDA || ''))) throw appError_('INVALID_INVOICE', 'Moneda inválida.');
  const validationErrors = safeJsonParse_(row.ERRORES_VALIDACION_JSON, []);
  if (validationErrors.length) throw appError_('INVALID_INVOICE', validationErrors.join('; '));
  const key = invoiceAccountingKey_(row);
  const duplicate = getRows_(APP.SHEETS.INVOICES).find(function (item) { return item.__row !== ignoredInvoiceRow && invoiceAccountingKey_(item) === key; });
  if (duplicate) throw appError_('ACCOUNTING_DUPLICATE', 'Ya existe una factura con el mismo proveedor, número, fecha, importe y moneda.');
}

function processedSupplierInvoiceCount_(supplierName) {
  const normalized = normalizeText_(supplierName || '');
  if (!normalized) return 0;
  return getRows_(APP.SHEETS.INVOICES).filter(function (row) { return String(row.ESTADO || '') === 'PROCESADA' && normalizeText_(row.PROVEEDOR || '') === normalized; }).length;
}

function invoiceAccountingKey_(row) {
  return [normalizeText_(row.PROVEEDOR || ''), normalizeText_(row.NUMERO_FACTURA || row['NÚMERO_FACTURA'] || ''), parseDate_(row.FECHA_FACTURA), Number(row.IMPORTE_TOTAL || 0).toFixed(2), String(row.MONEDA || '').toUpperCase()].join('|');
}

function legacyInvoiceMessageId_(invoice) {
  const reference = String(invoice.REFERENCIA_CORREO || '');
  const fromReference = reference.match(/#(?:all|inbox)\/([a-z0-9]+)/i);
  if (fromReference) return fromReference[1];
  const fromLegacyId = String(invoice.ID_UNICO || '').match(/^gmail:([^|]+)\|/i);
  return fromLegacyId ? fromLegacyId[1] : '';
}

function invoiceMatchesDocumentSource_(invoice, documentRow) {
  const sourceKey = String(documentRow.SOURCE_KEY || '');
  if (sourceKey && String(invoice.ID_UNICO || '') === sourceKey) return true;
  const messageId = String(documentRow.MESSAGE_ID || '');
  if (!messageId || legacyInvoiceMessageId_(invoice) !== messageId) return false;
  return normalizeText_(invoice.NOMBRE_ORIGINAL || '') === normalizeText_(documentRow.NOMBRE_ORIGINAL || '');
}

function archiveInvoice_(row) {
  const raw = Gmail.Users.Messages.Attachments.get('me', String(row.MESSAGE_ID), String(row.ATTACHMENT_ID));
  const bytes = base64UrlDecode_(raw.data);
  if (bytesHash_(bytes) !== String(row.HASH_PDF)) throw appError_('SOURCE_CHANGED', 'La huella del adjunto ya no coincide con la analizada.');
  const invoiceDate = parseDate_(row.FECHA_FACTURA);
  const info = monthInfo_(invoiceDate);
  let parentId = APP.INVOICE_FOLDER_ID;
  [info.year, info.quarter, info.month].forEach(function (name) { parentId = ensureFolder_(parentId, name); });
  const name = formatInvoiceName_({ invoiceDate: invoiceDate, supplier: String(row.PROVEEDOR), total: Number(row.IMPORTE_TOTAL), currency: String(row.MONEDA), invoiceNumber: String(row.NUMERO_FACTURA) });
  const existing = Drive.Files.list({ q: "name = '" + escapeDriveQuery_(name) + "' and '" + parentId + "' in parents and trashed = false", fields: 'files(id,name,webViewLink)', pageSize: 10 }).files || [];
  if (existing.length) throw appError_('FILE_EXISTS', 'Ya existe un archivo con el nombre de destino: ' + name + '.');
  const created = Drive.Files.create({ name: name, parents: [parentId], mimeType: 'application/pdf' }, Utilities.newBlob(bytes, 'application/pdf', name), { fields: 'id,name,webViewLink' });
  return { id: created.id, name: created.name, url: created.webViewLink || ('https://drive.google.com/file/d/' + created.id + '/view') };
}

function ensureFolder_(parentId, name) {
  const found = Drive.Files.list({ q: "mimeType = 'application/vnd.google-apps.folder' and name = '" + escapeDriveQuery_(name) + "' and '" + parentId + "' in parents and trashed = false", fields: 'files(id,name)', pageSize: 10 }).files || [];
  if (found.length) return found[0].id;
  return Drive.Files.create({ name: name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' }).id;
}

function writeInvoiceRegister_(row, status, savedName, driveUrl, observation, user) {
  const keepAccountingFields = status === 'PROCESADA' || (status === 'DUPLICADO IGNORADO' && String(row.ESTADO_PROPUESTO || '') === 'PROCESADA');
  appendObject_(APP.SHEETS.INVOICES, { FECHA_FACTURA: keepAccountingFields ? parseDate_(row.FECHA_FACTURA) : '', FECHA_OPERACION: keepAccountingFields ? parseDate_(row.FECHA_OPERACION) : '', FECHA_VENCIMIENTO: keepAccountingFields ? parseDate_(row.FECHA_VENCIMIENTO) : '', CATEGORIA_ID: keepAccountingFields ? row.CATEGORIA_ID || '' : '', BASE_IMPONIBLE: keepAccountingFields && row.BASE_IMPONIBLE !== '' ? Number(row.BASE_IMPONIBLE) : '', IMPUESTOS_JSON: keepAccountingFields ? row.IMPUESTOS_JSON || '[]' : '[]', NOTA_INTERNA: keepAccountingFields ? row.NOTA_INTERNA || '' : '', ESTADO_CONCILIACION: keepAccountingFields ? 'SIN CONCILIAR' : '', IMPORTE_ASIGNADO: 0, PROVEEDOR: keepAccountingFields ? row.PROVEEDOR || '' : '', CIF_NIF: keepAccountingFields ? row.CIF_NIF || '' : '', 'NÚMERO_FACTURA': keepAccountingFields ? row.NUMERO_FACTURA || '' : '', IMPORTE_TOTAL: keepAccountingFields && Number.isFinite(Number(row.IMPORTE_TOTAL)) ? Number(row.IMPORTE_TOTAL) : '', MONEDA: keepAccountingFields ? row.MONEDA || '' : '', ESTADO: status, ARCHIVO_DRIVE: savedName || '', URL_DRIVE: driveUrl || '', REMITENTE: row.REMITENTE || '', ASUNTO: row.ASUNTO || '', FECHA_PROCESO: nowIso_(), OBSERVACIONES: observation || '', FECHA_CORREO: row.FECHA_CORREO || '', NOMBRE_ORIGINAL: row.NOMBRE_ORIGINAL || '', MOTIVO_REVISION: status === 'REVISIÓN MANUAL' ? observation : '', REFERENCIA_CORREO: row.GMAIL_URL || '', ID_UNICO: row.SOURCE_KEY || '', HASH_PDF: row.HASH_PDF || '', LOTE_ID: row.LOTE_ID || '', USUARIO_DECISION: user, FECHA_DECISION: nowIso_(), EVIDENCIA_JSON: row.EVIDENCIA_JSON || '[]', VERSION_ESQUEMA: APP.VERSION, PROVEEDOR_NO_HABITUAL: toBoolean_(row.PROVEEDOR_NO_HABITUAL) });
}

function updateHistoricalInvoiceRegister_(historical, row, status, savedName, driveUrl, observation, user) {
  const keepAccountingFields = status === 'PROCESADA' || (status === 'DUPLICADO IGNORADO' && String(row.ESTADO_PROPUESTO || '') === 'PROCESADA');
  const updates = {
    FECHA_FACTURA: keepAccountingFields ? parseDate_(row.FECHA_FACTURA) : '',
    FECHA_OPERACION: keepAccountingFields ? parseDate_(row.FECHA_OPERACION) : '',
    FECHA_VENCIMIENTO: keepAccountingFields ? parseDate_(row.FECHA_VENCIMIENTO) : '',
    CATEGORIA_ID: keepAccountingFields ? row.CATEGORIA_ID || '' : '',
    BASE_IMPONIBLE: keepAccountingFields && row.BASE_IMPONIBLE !== '' ? Number(row.BASE_IMPONIBLE) : '',
    IMPUESTOS_JSON: keepAccountingFields ? row.IMPUESTOS_JSON || '[]' : '[]',
    NOTA_INTERNA: keepAccountingFields ? row.NOTA_INTERNA || '' : '',
    ESTADO_CONCILIACION: keepAccountingFields ? 'SIN CONCILIAR' : '',
    IMPORTE_ASIGNADO: 0,
    PROVEEDOR: keepAccountingFields ? row.PROVEEDOR || '' : '',
    CIF_NIF: keepAccountingFields ? row.CIF_NIF || '' : '',
    IMPORTE_TOTAL: keepAccountingFields && Number.isFinite(Number(row.IMPORTE_TOTAL)) ? Number(row.IMPORTE_TOTAL) : '',
    MONEDA: keepAccountingFields ? row.MONEDA || '' : '',
    ESTADO: status,
    ARCHIVO_DRIVE: savedName || '',
    URL_DRIVE: driveUrl || '',
    REMITENTE: row.REMITENTE || '',
    ASUNTO: row.ASUNTO || '',
    FECHA_PROCESO: nowIso_(),
    OBSERVACIONES: observation || '',
    FECHA_CORREO: row.FECHA_CORREO || '',
    NOMBRE_ORIGINAL: row.NOMBRE_ORIGINAL || '',
    MOTIVO_REVISION: status === 'REVISIÓN MANUAL' ? observation : '',
    REFERENCIA_CORREO: row.GMAIL_URL || '',
    ID_UNICO: row.SOURCE_KEY || '',
    HASH_PDF: row.HASH_PDF || '',
    LOTE_ID: row.LOTE_ID || '',
    USUARIO_DECISION: user,
    FECHA_DECISION: nowIso_(),
    EVIDENCIA_JSON: row.EVIDENCIA_JSON || '[]',
    VERSION_ESQUEMA: APP.VERSION,
    PROVEEDOR_NO_HABITUAL: toBoolean_(row.PROVEEDOR_NO_HABITUAL),
  };
  updates['NÚMERO_FACTURA'] = keepAccountingFields ? row.NUMERO_FACTURA || '' : '';
  updateObjectRow_(APP.SHEETS.INVOICES, historical.__row, updates);
}

function retryBatch_(batchId, user, requestId) {
  const row = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  if (!row) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote.');
  const failed = getRows_(APP.SHEETS.DOCUMENTS).filter(function (item) { return String(item.LOTE_ID) === String(batchId) && String(item.FASE) === 'ERROR'; });
  failed.forEach(function (item) { try { finalizeDocument_(item, user, requestId); } catch (error) { updateObjectRow_(APP.SHEETS.DOCUMENTS, item.__row, { ERROR: error.message || String(error) }); } });
  const remaining = getRows_(APP.SHEETS.DOCUMENTS).filter(function (item) { return String(item.LOTE_ID) === String(batchId) && String(item.FASE) === 'ERROR'; }).length;
  updateObjectRow_(APP.SHEETS.BATCHES, row.__row, { ESTADO: remaining ? 'COMPLETADO CON ERRORES' : 'COMPLETADO', ERROR: remaining ? remaining + ' documentos con error' : '' });
  return batchFromRow_(getRows_(APP.SHEETS.BATCHES).find(function (item) { return item.__row === row.__row; }));
}
