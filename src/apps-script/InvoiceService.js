function saveDocumentReview_(payload, user, requestId) {
  const input = payload.document || {};
  const row = getRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return String(item.DOCUMENTO_ID) === String(input.id); });
  if (!row) throw appError_('DOCUMENT_NOT_FOUND', 'No se encuentra el documento.');
  if (!String(payload.reason || '').trim()) throw appError_('REASON_REQUIRED', 'Toda corrección manual necesita un motivo.');
  const providers = activeProviders_();
  const provider = providers.find(function (item) { return item.id === input.supplierId; });
  const errors = [];
  if (input.proposedStatus === 'PROCESADA') {
    if (!provider) errors.push('Proveedor desconocido o inactivo');
    if (!String(input.invoiceNumber || '').trim()) errors.push('Número de factura ausente');
    if (!parseDate_(input.invoiceDate)) errors.push('Fecha inválida');
    if (input.total === null || Number(input.total) <= 0) errors.push('Importe inválido');
    if (!/^[A-Z]{3}$/.test(String(input.currency || ''))) errors.push('Moneda inválida');
  }
  const phase = errors.length ? 'EN REVISIÓN' : 'LISTO PARA APROBAR';
  const proposed = errors.length ? 'REVISIÓN MANUAL' : input.proposedStatus;
  const previous = documentFromRow_(row);
  updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FECHA_FACTURA: input.invoiceDate || '', PROVEEDOR: provider ? provider.name : input.supplier || '', PROVEEDOR_ID: provider ? provider.id : '', CIF_NIF: input.taxId || '', NUMERO_FACTURA: input.invoiceNumber || '', IMPORTE_TOTAL: input.total === null ? '' : Number(input.total), MONEDA: String(input.currency || '').toUpperCase(), FASE: phase, ESTADO_PROPUESTO: proposed, MOTIVO_REVISION: errors.length ? errors.join('; ') : String(payload.reason), EVIDENCIA_JSON: JSON.stringify((input.evidence || []).concat([{ field: 'manualDecision', value: proposed, source: 'MANUAL', excerpt: String(payload.reason) }])), SELECCIONADO: phase === 'LISTO PARA APROBAR', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
  logEvent_('INFO', 'DOCUMENTO_REVISADO', input.id, String(payload.reason), { before: previous, after: input, validationErrors: errors }, String(row.LOTE_ID || ''), requestId, user);
  return documentFromRow_(getRows_(APP.SHEETS.DOCUMENTS).find(function (item) { return item.__row === row.__row; }));
}

function approveBatch_(payload, user, requestId) {
  if (uniqueRequestExists_(requestId)) {
    const prior = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.LOTE_ID) === String(payload.batchId); });
    return batchFromRow_(prior);
  }
  const config = getConfigMap_();
  if (String(config.APP_MODE || 'DRY_RUN') !== 'PRODUCTION') throw appError_('DRY_RUN_ACTIVE', 'La aplicación está en modo seco. Cambia a PRODUCCIÓN de forma explícita antes de aprobar.');
  const batchRow = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.LOTE_ID) === String(payload.batchId); });
  if (!batchRow) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote.');
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
  const duplicate = existingRows.find(function (invoice) { return String(invoice.ID_UNICO || '') === sourceKey || (hash && String(invoice.HASH_PDF || '') === hash); });
  if (duplicate) {
    writeInvoiceRegister_(row, 'DUPLICADO IGNORADO', '', '', 'Coincidencia con ' + String(duplicate.ID_UNICO || ''), user);
    updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'FINALIZADO', ESTADO_FINAL: 'DUPLICADO IGNORADO', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user });
    return;
  }
  let drive = { name: '', url: '' };
  if (status === 'PROCESADA') {
    validateFinalInvoice_(row);
    if (row.DRIVE_FILE_ID && row.URL_DRIVE) drive = { id: String(row.DRIVE_FILE_ID), name: String(row.ARCHIVO_DRIVE || ''), url: String(row.URL_DRIVE) };
    else {
      drive = archiveInvoice_(row);
      updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { ARCHIVO_DRIVE: drive.name, URL_DRIVE: drive.url, DRIVE_FILE_ID: drive.id, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user });
    }
  }
  writeInvoiceRegister_(row, status, drive.name, drive.url, String(row.MOTIVO_REVISION || ''), user);
  updateObjectRow_(APP.SHEETS.DOCUMENTS, row.__row, { FASE: 'FINALIZADO', ESTADO_FINAL: status, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '' });
}

function validateFinalInvoice_(row) {
  const providers = activeProviders_();
  if (!providers.some(function (provider) { return provider.id === String(row.PROVEEDOR_ID); })) throw appError_('INVALID_SUPPLIER', 'El proveedor no está activo.');
  if (!String(row.NUMERO_FACTURA || '').trim()) throw appError_('INVALID_INVOICE', 'Falta número de factura.');
  if (!parseDate_(row.FECHA_FACTURA)) throw appError_('INVALID_INVOICE', 'Fecha de factura inválida.');
  if (Number(row.IMPORTE_TOTAL || 0) <= 0) throw appError_('INVALID_INVOICE', 'Importe total inválido.');
  if (!/^[A-Z]{3}$/.test(String(row.MONEDA || ''))) throw appError_('INVALID_INVOICE', 'Moneda inválida.');
  const key = invoiceAccountingKey_(row);
  const duplicate = getRows_(APP.SHEETS.INVOICES).find(function (item) { return invoiceAccountingKey_(item) === key; });
  if (duplicate) throw appError_('ACCOUNTING_DUPLICATE', 'Ya existe una factura con el mismo proveedor, número, fecha, importe y moneda.');
}

function invoiceAccountingKey_(row) {
  return [normalizeText_(row.PROVEEDOR || ''), normalizeText_(row.NUMERO_FACTURA || row['NÚMERO_FACTURA'] || ''), String(row.FECHA_FACTURA || ''), Number(row.IMPORTE_TOTAL || 0).toFixed(2), String(row.MONEDA || '').toUpperCase()].join('|');
}

function archiveInvoice_(row) {
  const raw = Gmail.Users.Messages.Attachments.get('me', String(row.MESSAGE_ID), String(row.ATTACHMENT_ID));
  const bytes = base64UrlDecode_(raw.data);
  if (bytesHash_(bytes) !== String(row.HASH_PDF)) throw appError_('SOURCE_CHANGED', 'La huella del adjunto ya no coincide con la analizada.');
  const info = monthInfo_(String(row.FECHA_FACTURA));
  let parentId = APP.INVOICE_FOLDER_ID;
  [info.year, info.quarter, info.month].forEach(function (name) { parentId = ensureFolder_(parentId, name); });
  const name = formatInvoiceName_({ invoiceDate: String(row.FECHA_FACTURA), supplier: String(row.PROVEEDOR), total: Number(row.IMPORTE_TOTAL), currency: String(row.MONEDA), invoiceNumber: String(row.NUMERO_FACTURA) });
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
  appendObject_(APP.SHEETS.INVOICES, { FECHA_FACTURA: row.FECHA_FACTURA || '', PROVEEDOR: row.PROVEEDOR || '', CIF_NIF: row.CIF_NIF || '', 'NÚMERO_FACTURA': row.NUMERO_FACTURA || '', IMPORTE_TOTAL: row.IMPORTE_TOTAL === '' ? 0 : Number(row.IMPORTE_TOTAL), MONEDA: row.MONEDA || 'EUR', ESTADO: status, ARCHIVO_DRIVE: savedName || '', URL_DRIVE: driveUrl || '', REMITENTE: row.REMITENTE || '', ASUNTO: row.ASUNTO || '', FECHA_PROCESO: nowIso_(), OBSERVACIONES: observation || '', FECHA_CORREO: row.FECHA_CORREO || '', NOMBRE_ORIGINAL: row.NOMBRE_ORIGINAL || '', MOTIVO_REVISION: status === 'REVISIÓN MANUAL' ? observation : '', REFERENCIA_CORREO: row.GMAIL_URL || '', ID_UNICO: row.SOURCE_KEY || '', HASH_PDF: row.HASH_PDF || '', LOTE_ID: row.LOTE_ID || '', USUARIO_DECISION: user, FECHA_DECISION: nowIso_(), EVIDENCIA_JSON: row.EVIDENCIA_JSON || '[]', VERSION_ESQUEMA: APP.VERSION });
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
