function previewBankImport_(payload, user, requestId) {
  const repeatedEvent = eventByRequest_(requestId, 'BANCO_PREVISUALIZADO');
  if (repeatedEvent) { const repeatedImport = bankImportById_(String(repeatedEvent.DOCUMENTO || '')); if (repeatedImport) return repeatedImport; }
  if (!payload.fileName || !payload.base64 || !payload.source || !payload.periodFrom || !payload.periodTo || !payload.coverage) throw appError_('BANK_METADATA_REQUIRED', 'Archivo, fuente, periodo y cobertura son obligatorios.');
  const bytes = Utilities.base64Decode(String(payload.base64));
  if (bytes.length > APP.MAX_UPLOAD_BYTES) throw appError_('FILE_TOO_LARGE', 'El extracto supera el límite de 12 MB.');
  const hash = bytesHash_(bytes);
  const duplicate = safeRows_(APP.SHEETS.MOVEMENTS).find(function (row) { return String(row.ARCHIVO_HASH || '') === hash && String(row.ESTADO_IMPORTACION) !== 'CANCELADA'; });
  if (duplicate) throw appError_('DUPLICATE_BANK_IMPORT', 'Este extracto ya fue importado con el identificador ' + duplicate.IMPORT_ID + '.');
  const importId = 'BANK-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + uuid_().slice(0, 6);
  const tempFolder = ensureFolder_(APP.BANK_FOLDER_ID, '_APP_TEMP');
  const mime = /\.csv$/i.test(payload.fileName) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const raw = Drive.Files.create({ name: '_PENDIENTE ' + importId + ' - ' + sanitizeFileName_(payload.fileName), parents: [tempFolder], mimeType: mime }, Utilities.newBlob(bytes, mime, payload.fileName), { fields: 'id,name,webViewLink' });
  let values;
  try { values = readBankValues_(bytes, payload.fileName, raw.id); }
  catch (error) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw error; }
  let normalized;
  try { normalized = normalizeBankRows_(values, payload.mapping || null); }
  catch (error) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw error; }
  if (!normalized.rows.length) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw appError_('EMPTY_BANK_FILE', 'No se encontraron movimientos válidos.'); }
  const warnings = bankPeriodWarnings_(normalized.detectedPeriodFrom, normalized.detectedPeriodTo, parseDate_(payload.periodFrom), parseDate_(payload.periodTo), String(payload.coverage || ''));
  const invoices = safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_).filter(function (invoice) { return invoice.status === 'PROCESADA'; });
  normalized.rows.forEach(function (movement, index) {
    const candidates = findBankCandidates_(movement, invoices);
    let reconciliationStatus = movement.type === 'INGRESO' ? 'EXCLUIDO: INGRESO' : movement.type === 'TRASPASO' ? 'EXCLUIDO: TRASPASO' : candidates.length === 1 ? 'CANDIDATA PENDIENTE' : candidates.length > 1 ? 'REVISIÓN MANUAL' : 'MOVIMIENTO SIN FACTURA';
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const movementId = importId + '-M' + ('0000' + (index + 1)).slice(-4);
    const evidence = candidate ? bankEvidence_(movement, candidate) : candidates.length > 1 ? candidates.length + ' facturas candidatas con evidencia insuficiente para elegir' : '';
    appendObject_(APP.SHEETS.MOVEMENTS, { MOVIMIENTO_ID: movementId, IMPORT_ID: importId, ARCHIVO_NOMBRE: payload.fileName, ARCHIVO_HASH: hash, RAW_FILE_ID: raw.id, URL_DRIVE: '', FUENTE: payload.source, PERIODO_DESDE: parseDate_(payload.periodFrom), PERIODO_HASTA: parseDate_(payload.periodTo), PERIODO_DETECTADO_DESDE: normalized.detectedPeriodFrom, PERIODO_DETECTADO_HASTA: normalized.detectedPeriodTo, ADVERTENCIAS_JSON: JSON.stringify(warnings), COBERTURA: payload.coverage, ESTADO_IMPORTACION: 'PREVISUALIZACIÓN', FECHA_OPERACION: movement.operationDate, FECHA_VALOR: movement.valueDate, CONCEPTO: movement.concept, IMPORTE: movement.amount, MONEDA: movement.currency, REFERENCIA: movement.reference, TIPO: movement.type, ESTADO_CONCILIACION: reconciliationStatus, FACTURA_CANDIDATA_ID: candidate ? candidate.id : '', EVIDENCIA: evidence, CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
    if (candidate) appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: importId, MOVIMIENTO_ID: movementId, FACTURA_ID: candidate.id, ESTADO: 'PROPUESTA', EVIDENCIA: evidence, DECISION: '', MOTIVO: '', CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
  });
  logEvent_('INFO', 'BANCO_PREVISUALIZADO', importId, payload.fileName, { movements: normalized.rows.length, headerRow: normalized.headerRow, detectedPeriodFrom: normalized.detectedPeriodFrom, detectedPeriodTo: normalized.detectedPeriodTo, warnings: warnings }, '', requestId, user);
  return bankImportById_(importId);
}

function readBankValues_(bytes, fileName, rawId) {
  if (/\.csv$/i.test(fileName)) {
    const text = Utilities.newBlob(bytes).getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const separator = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return Utilities.parseCsv(text, separator);
  }
  if (!/\.xlsx?$/i.test(fileName)) throw appError_('UNSUPPORTED_BANK_FILE', 'Solo se admiten archivos XLSX, XLS o CSV.');
  const converted = Drive.Files.copy({ name: '_CONVERSION ' + uuid_(), mimeType: 'application/vnd.google-apps.spreadsheet' }, rawId, { fields: 'id,name' });
  try { return SpreadsheetApp.openById(converted.id).getSheets()[0].getDataRange().getDisplayValues(); }
  finally { try { DriveApp.getFileById(converted.id).setTrashed(true); } catch (_) {} }
}

function normalizeBankRows_(values, explicitMapping) {
  if (!values || !values.length) return { rows: [], headerRow: -1 };
  const aliases = {
    operationDate: ['fecha operacion', 'f operacion', 'fecha de operacion'], valueDate: ['fecha valor', 'f valor', 'fecha de valor'], concept: ['concepto', 'descripcion', 'detalle'], amount: ['importe', 'cantidad', 'amount'], currency: ['divisa', 'moneda', 'currency'], reference: ['referencia', 'referencia 1', 'referencia adicional', 'informacion adicional'],
  };
  let headerRow = -1;
  let mapping = explicitMapping;
  if (!mapping) {
    for (let rowIndex = 0; rowIndex < Math.min(values.length, 30); rowIndex += 1) {
      const headers = values[rowIndex].map(normalizeText_);
      const detected = {};
      Object.keys(aliases).forEach(function (key) { const index = headers.findIndex(function (header) { return aliases[key].indexOf(header) !== -1; }); if (index >= 0) detected[key] = index; });
      if (detected.operationDate !== undefined && detected.concept !== undefined && detected.amount !== undefined && detected.currency !== undefined) { headerRow = rowIndex; mapping = detected; break; }
    }
  } else headerRow = Number(explicitMapping.headerRow || 0);
  if (!mapping || mapping.operationDate === undefined || mapping.concept === undefined || mapping.amount === undefined || mapping.currency === undefined) {
    let candidate = 0;
    for (let probe = 1; probe < Math.min(values.length, 30); probe += 1) if ((values[probe] || []).filter(function (value) { return String(value || '').trim(); }).length > (values[candidate] || []).filter(function (value) { return String(value || '').trim(); }).length) candidate = probe;
    throw appError_('BANK_MAPPING_REQUIRED', 'No se reconoce el formato. Debes mapear fecha de operación, concepto, importe y moneda.', false, { headers: (values[candidate] || []).map(String), headerRow: candidate });
  }
  const rows = [];
  for (let index = headerRow + 1; index < values.length; index += 1) {
    const row = values[index];
    const amount = parseNumber_(row[mapping.amount]);
    const operationDate = parseDate_(row[mapping.operationDate]);
    const concept = String(row[mapping.concept] || '').trim();
    if (amount === null || !operationDate || !concept) continue;
    const valueDate = mapping.valueDate === undefined ? operationDate : (parseDate_(row[mapping.valueDate]) || operationDate);
    const currency = String(row[mapping.currency] || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw appError_('INVALID_BANK_CURRENCY', 'La fila ' + (index + 1) + ' contiene una moneda vacía o no válida. Corrige el archivo o el mapeo; no se asumirá EUR.');
    const referenceIndexes = Array.isArray(mapping.reference) ? mapping.reference : mapping.reference === undefined ? [] : [mapping.reference];
    const reference = referenceIndexes.map(function (column) { return String(row[column] || '').trim(); }).filter(Boolean).join(' · ');
    rows.push({ operationDate: operationDate, valueDate: valueDate, concept: concept, amount: amount, currency: currency, reference: reference, type: classifyBankMovement_(amount, concept) });
  }
  const dates = rows.map(function (row) { return row.operationDate; }).sort();
  return { rows: rows, headerRow: headerRow, detectedPeriodFrom: dates[0] || '', detectedPeriodTo: dates[dates.length - 1] || '' };
}

function bankPeriodWarnings_(detectedFrom, detectedTo, declaredFrom, declaredTo, coverage) {
  const warnings = [];
  if (detectedFrom !== declaredFrom || detectedTo !== declaredTo) warnings.push('El periodo declarado (' + declaredFrom + ' a ' + declaredTo + ') no coincide con las fechas detectadas (' + detectedFrom + ' a ' + detectedTo + ').');
  if (detectedTo && detectedTo.slice(-2) !== String(new Date(Number(detectedTo.slice(0, 4)), Number(detectedTo.slice(5, 7)), 0).getDate()).padStart(2, '0') && normalizeText_(coverage).indexOf('parcial') === -1) warnings.push('La cobertura no identifica el extracto como parcial aunque no llega al último día del mes.');
  return warnings;
}

function classifyBankMovement_(amount, concept) {
  const text = normalizeText_(concept);
  if (amount > 0) return 'INGRESO';
  if (/traspaso|transferencia interna|entre cuentas|liquidacion tarjeta/.test(text)) return 'TRASPASO';
  if (amount < 0) return 'CARGO';
  return 'REVISIÓN';
}

function findBankCandidates_(movement, invoices) {
  if (movement.amount >= 0) return [];
  const amount = Math.abs(movement.amount);
  const concept = normalizeText_(movement.concept);
  return invoices.filter(function (invoice) {
    if (String(invoice.currency) !== String(movement.currency) || Math.abs(Number(invoice.total) - amount) > 0.01) return false;
    const days = Math.abs(new Date(movement.operationDate).getTime() - new Date(invoice.date).getTime()) / 86400000;
    const supplier = normalizeText_(invoice.supplier);
    const words = supplier.split(' ').filter(function (word) { return word.length > 4; });
    const supplierMatch = concept.indexOf(supplier) !== -1 || words.some(function (word) { return concept.indexOf(word) !== -1; });
    return days <= 62 && (supplierMatch || days <= 14);
  });
}

function bankEvidence_(movement, invoice) {
  const days = Math.round(Math.abs(new Date(movement.operationDate).getTime() - new Date(invoice.date).getTime()) / 86400000);
  return 'Importe exacto en ' + movement.currency + '; diferencia temporal de ' + days + ' días; concepto: ' + movement.concept;
}

function confirmBankImport_(importId, user, requestId) {
  if (String(getConfigMap_().APP_MODE || 'DRY_RUN') !== 'PRODUCTION') throw appError_('DRY_RUN_ACTIVE', 'La aplicación está en modo seco. No se archivará el extracto.');
  const rows = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); });
  if (!rows.length) throw appError_('BANK_IMPORT_NOT_FOUND', 'No se encuentra la importación bancaria.');
  if (String(rows[0].ESTADO_IMPORTACION) === 'CANCELADA') throw appError_('BANK_IMPORT_CANCELLED', 'La vista previa fue cancelada y no se puede archivar.');
  if (String(rows[0].ESTADO_IMPORTACION) === 'CONFIRMADA') return bankImportById_(importId);
  const rawId = String(rows[0].RAW_FILE_ID || '');
  const period = parseDate_(rows[0].PERIODO_DESDE);
  const info = monthInfo_(period);
  let parent = ensureFolder_(APP.BANK_FOLDER_ID, info.year);
  parent = ensureFolder_(parent, info.month);
  const targetName = info.year + '-' + info.month.slice(0, 2) + ' - ' + sanitizeFileName_(String(rows[0].FUENTE)) + ' - ' + sanitizeFileName_(String(rows[0].ARCHIVO_NOMBRE));
  const currentParents = Drive.Files.get(rawId, { fields: 'parents' }).parents || [];
  const file = Drive.Files.update({ name: targetName }, rawId, { addParents: parent, removeParents: currentParents.join(','), fields: 'id,name,webViewLink,parents' });
  rows.forEach(function (row) { updateObjectRow_(APP.SHEETS.MOVEMENTS, row.__row, { ESTADO_IMPORTACION: 'CONFIRMADA', URL_DRIVE: file.webViewLink || ('https://drive.google.com/file/d/' + rawId + '/view'), CREADO_POR: user, REQUEST_ID: requestId }); });
  logEvent_('INFO', 'BANCO_CONFIRMADO', importId, file.name, { movements: rows.length, driveId: rawId }, '', requestId, user);
  return bankImportById_(importId);
}

function cancelBankImport_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, 'BANCO_CANCELADO');
  if (repeated) return bankImportById_(String(repeated.DOCUMENTO || ''));
  const importId = String(payload.importId || '');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw appError_('REASON_REQUIRED', 'Indica el motivo para descartar la vista previa.');
  const rows = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.IMPORT_ID) === importId; });
  if (!rows.length) throw appError_('BANK_IMPORT_NOT_FOUND', 'No se encuentra la importación bancaria.');
  if (String(rows[0].ESTADO_IMPORTACION) === 'CANCELADA') return bankImportById_(importId);
  if (String(rows[0].ESTADO_IMPORTACION) === 'CONFIRMADA') throw appError_('BANK_IMPORT_ALREADY_CONFIRMED', 'Un extracto archivado no se puede descartar.');
  const rawId = String(rows[0].RAW_FILE_ID || '');
  if (rawId) try { DriveApp.getFileById(rawId).setTrashed(true); } catch (_) {}
  rows.forEach(function (row) { updateObjectRow_(APP.SHEETS.MOVEMENTS, row.__row, { ESTADO_IMPORTACION: 'CANCELADA', CANCELADO_EN: nowIso_(), CANCELADO_POR: user, MOTIVO_CANCELACION: reason, REQUEST_ID: requestId }); });
  safeRows_(APP.SHEETS.RECONCILIATIONS).filter(function (row) { return String(row.IMPORT_ID) === importId; }).forEach(function (row) { updateObjectRow_(APP.SHEETS.RECONCILIATIONS, row.__row, { ESTADO: 'CANCELADA', DECISION: 'CANCELADA', MOTIVO: reason, DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId }); });
  logEvent_('WARN', 'BANCO_CANCELADO', importId, reason, { rawFileId: rawId, movedToTrash: Boolean(rawId) }, '', requestId, user);
  return bankImportById_(importId);
}

function decideReconciliation_(payload, user, requestId) {
  const repeatedEvent = eventByRequest_(requestId, 'CONCILIACION_DECIDIDA');
  if (repeatedEvent) { const repeatedData = safeJsonParse_(repeatedEvent.DATOS_JSON, {}); const repeatedMovement = safeRows_(APP.SHEETS.MOVEMENTS).find(function (row) { return String(row.MOVIMIENTO_ID || '') === String(repeatedEvent.DOCUMENTO || ''); }); return bankImportById_(String(repeatedMovement && repeatedMovement.IMPORT_ID || payload.importId || repeatedData.importId || '')); }
  const allowed = ['COINCIDENCIA CONFIRMADA', 'REVISIÓN MANUAL', 'CANDIDATA PENDIENTE', 'MOVIMIENTO SIN FACTURA'];
  if (allowed.indexOf(String(payload.status)) === -1) throw appError_('INVALID_RECONCILIATION_STATUS', 'Estado de conciliación no permitido.');
  const movement = safeRows_(APP.SHEETS.MOVEMENTS).find(function (row) { return String(row.MOVIMIENTO_ID) === String(payload.movementId) && String(row.IMPORT_ID) === String(payload.importId); });
  if (!movement) throw appError_('MOVEMENT_NOT_FOUND', 'No se encuentra el movimiento.');
  if (String(movement.ESTADO_IMPORTACION) !== 'CONFIRMADA') throw appError_('BANK_IMPORT_NOT_CONFIRMED', 'Archiva primero el extracto antes de decidir conciliaciones.');
  const before = String(movement.ESTADO_CONCILIACION || '');
  updateObjectRow_(APP.SHEETS.MOVEMENTS, movement.__row, { ESTADO_CONCILIACION: payload.status, FACTURA_CANDIDATA_ID: payload.invoiceId || movement.FACTURA_CANDIDATA_ID || '', CREADO_POR: user, REQUEST_ID: requestId });
  const reconciliation = safeRows_(APP.SHEETS.RECONCILIATIONS).find(function (row) { return String(row.MOVIMIENTO_ID) === String(payload.movementId); });
  if (reconciliation) updateObjectRow_(APP.SHEETS.RECONCILIATIONS, reconciliation.__row, { ESTADO: payload.status === 'COINCIDENCIA CONFIRMADA' ? 'CONFIRMADA' : payload.status, DECISION: payload.status, MOTIVO: payload.reason || '', DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId });
  else appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: payload.importId, MOVIMIENTO_ID: payload.movementId, FACTURA_ID: payload.invoiceId || '', ESTADO: payload.status === 'COINCIDENCIA CONFIRMADA' ? 'CONFIRMADA' : payload.status, EVIDENCIA: movement.EVIDENCIA || '', DECISION: payload.status, MOTIVO: payload.reason || '', CREADO_EN: nowIso_(), CREADO_POR: user, DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId });
  logEvent_('INFO', 'CONCILIACION_DECIDIDA', payload.movementId, before + ' → ' + payload.status, { invoiceId: payload.invoiceId || '', importId: payload.importId }, '', requestId, user);
  return bankImportById_(payload.importId);
}

function saveReconciliationLinks_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, 'CONCILIACION_MULTIPLE_CONFIRMADA');
  if (repeated) return bankImportById_(String(repeated.DOCUMENTO || payload.importId || ''));
  const links = (payload.links || []).slice(0, 50);
  if (!links.length) throw appError_('EMPTY_RECONCILIATION', 'Selecciona al menos una factura o movimiento.');
  const movements = safeRows_(APP.SHEETS.MOVEMENTS);
  const invoices = safeRows_(APP.SHEETS.INVOICES);
  const existingLinks = safeRows_(APP.SHEETS.RECONCILIATIONS);
  const results = [];
  links.forEach(function (input, index) {
    const movement = movements.find(function (row) { return String(row.MOVIMIENTO_ID) === String(input.movementId); });
    const invoice = invoices.find(function (row) { return String(row.ID_UNICO || '') === String(input.invoiceId); });
    if (!movement || !invoice) throw appError_('RECONCILIATION_TARGET_MISSING', 'No se encuentra la factura o el movimiento seleccionado.');
    if (String(movement.ESTADO_IMPORTACION) !== 'CONFIRMADA') throw appError_('BANK_IMPORT_NOT_CONFIRMED', 'Archiva primero el extracto antes de conciliar.');
    if (String(movement.MONEDA) !== String(invoice.MONEDA)) throw appError_('CURRENCY_MISMATCH', 'Factura y movimiento deben tener la misma moneda.');
    const allocated = Math.round(Math.abs(Number(input.allocatedAmount || 0)) * 100);
    if (!allocated) throw appError_('INVALID_ALLOCATION', 'El importe asignado debe ser mayor que cero.');
    const movementTotal = Math.round(Math.abs(Number(movement.IMPORTE || 0)) * 100);
    const invoiceTotal = Math.round(Math.abs(Number(invoice.IMPORTE_TOTAL || 0)) * 100);
    const active = existingLinks.filter(function (row) { return String(row.ESTADO) === 'CONFIRMADA'; });
    const movementAssigned = active.filter(function (row) { return String(row.MOVIMIENTO_ID) === String(input.movementId); }).reduce(function (sum, row) { return sum + Math.round(Math.abs(Number(row.IMPORTE_ASIGNADO || 0)) * 100); }, 0);
    const invoiceAssigned = active.filter(function (row) { return String(row.FACTURA_ID) === String(input.invoiceId); }).reduce(function (sum, row) { return sum + Math.round(Math.abs(Number(row.IMPORTE_ASIGNADO || 0)) * 100); }, 0);
    const exceeds = allocated > movementTotal - movementAssigned + 1 || allocated > invoiceTotal - invoiceAssigned + 1;
    if (exceeds && !(payload.allowDifference && String(payload.reason || '').trim())) throw appError_('ALLOCATION_EXCEEDS_BALANCE', 'La asignación supera el saldo pendiente. Confirma la diferencia e indica el motivo.');
    const id = 'REC-' + uuid_();
    appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: id, IMPORT_ID: String(movement.IMPORT_ID || ''), MOVIMIENTO_ID: input.movementId, FACTURA_ID: input.invoiceId, IMPORTE_ASIGNADO: allocated / 100, ESTADO: 'CONFIRMADA', EVIDENCIA: String(input.evidence || movement.EVIDENCIA || ''), DECISION: 'CONCILIADA', MOTIVO: String(payload.reason || ''), CREADO_EN: nowIso_(), CREADO_POR: user, DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId + '-' + index });
    existingLinks.push({ MOVIMIENTO_ID: input.movementId, FACTURA_ID: input.invoiceId, IMPORTE_ASIGNADO: allocated / 100, ESTADO: 'CONFIRMADA' });
    results.push(id);
  });
  recalculateReconciliationState_(links.map(function (link) { return link.movementId; }), links.map(function (link) { return link.invoiceId; }), user, requestId);
  logEvent_('INFO', 'CONCILIACION_MULTIPLE_CONFIRMADA', String(payload.importId || ''), results.length + ' vínculos confirmados', { links: results }, '', requestId, user);
  return bankImportById_(String(payload.importId || ''));
}

function undoReconciliation_(payload, user, requestId) {
  const row = safeRows_(APP.SHEETS.RECONCILIATIONS).find(function (candidate) { return String(candidate.CONCILIACION_ID) === String(payload.reconciliationId); });
  if (!row) throw appError_('RECONCILIATION_NOT_FOUND', 'No se encuentra la conciliación.');
  if (String(row.ESTADO) === 'DESHECHA') return bankImportById_(String(row.IMPORT_ID || ''));
  const reason = String(payload.reason || '').trim();
  if (!reason) throw appError_('REASON_REQUIRED', 'Indica el motivo para deshacer la conciliación.');
  updateObjectRow_(APP.SHEETS.RECONCILIATIONS, row.__row, { ESTADO: 'DESHECHA', DECISION: 'DESHECHA', MOTIVO: reason, DESHECHO_EN: nowIso_(), DESHECHO_POR: user, REQUEST_ID: requestId });
  recalculateReconciliationState_([String(row.MOVIMIENTO_ID)], [String(row.FACTURA_ID)], user, requestId);
  logEvent_('WARN', 'CONCILIACION_DESHECHA', String(row.CONCILIACION_ID), reason, {}, '', requestId, user);
  return bankImportById_(String(row.IMPORT_ID || ''));
}

function saveReconciliationException_(payload, user, requestId) {
  const reason = String(payload.reason || '').trim();
  if (!reason) throw appError_('REASON_REQUIRED', 'La exclusión necesita un motivo acreditado.');
  const targetType = String(payload.targetType || 'MOVEMENT');
  const targetId = String(payload.targetId || '');
  if (targetType === 'MOVEMENT') {
    const movement = safeRows_(APP.SHEETS.MOVEMENTS).find(function (row) { return String(row.MOVIMIENTO_ID) === targetId && String(row.IMPORT_ID) === String(payload.importId || ''); });
    if (!movement) throw appError_('MOVEMENT_NOT_FOUND', 'No se encuentra el movimiento.');
    if (String(movement.ESTADO_IMPORTACION) !== 'CONFIRMADA') throw appError_('BANK_IMPORT_NOT_CONFIRMED', 'Archiva primero el extracto.');
    updateObjectRow_(APP.SHEETS.MOVEMENTS, movement.__row, { ESTADO_CONCILIACION: 'EXCLUIDA CON MOTIVO', EVIDENCIA: reason, CREADO_POR: user, REQUEST_ID: requestId });
    logEvent_('WARN', 'MOVIMIENTO_EXCLUIDO', targetId, reason, {}, '', requestId, user);
    return bankImportById_(String(movement.IMPORT_ID || ''));
  }
  if (targetType === 'INVOICE') {
    const invoice = safeRows_(APP.SHEETS.INVOICES).find(function (row) { return String(row.ID_UNICO || '') === targetId; });
    if (!invoice) throw appError_('INVOICE_NOT_FOUND', 'No se encuentra la factura.');
    updateObjectRow_(APP.SHEETS.INVOICES, invoice.__row, { ESTADO_CONCILIACION: 'EXCLUIDA CON MOTIVO' });
    logEvent_('WARN', 'FACTURA_FUERA_DE_EXTRACTO', targetId, reason, { importId: String(payload.importId || '') }, '', requestId, user);
    return bankImportById_(String(payload.importId || ''));
  }
  throw appError_('INVALID_EXCEPTION_TARGET', 'El tipo de excepción no es válido.');
}

function recalculateReconciliationState_(movementIds, invoiceIds, user, requestId) {
  const links = safeRows_(APP.SHEETS.RECONCILIATIONS).filter(function (row) { return String(row.ESTADO) === 'CONFIRMADA'; });
  const movements = safeRows_(APP.SHEETS.MOVEMENTS);
  movementIds.filter(function (id, index, list) { return list.indexOf(id) === index; }).forEach(function (id) { const row = movements.find(function (candidate) { return String(candidate.MOVIMIENTO_ID) === String(id); }); if (!row) return; const assigned = links.filter(function (link) { return String(link.MOVIMIENTO_ID) === String(id); }).reduce(function (sum, link) { return sum + Math.abs(Number(link.IMPORTE_ASIGNADO || 0)); }, 0); const total = Math.abs(Number(row.IMPORTE || 0)); const status = assigned <= 0.009 ? 'SIN CONCILIAR' : Math.abs(total - assigned) <= 0.01 ? 'CONCILIADA' : 'PARCIALMENTE CONCILIADA'; updateObjectRow_(APP.SHEETS.MOVEMENTS, row.__row, { ESTADO_CONCILIACION: status, CREADO_POR: user, REQUEST_ID: requestId }); });
  const invoices = safeRows_(APP.SHEETS.INVOICES);
  invoiceIds.filter(function (id, index, list) { return list.indexOf(id) === index; }).forEach(function (id) { const row = invoices.find(function (candidate) { return String(candidate.ID_UNICO || '') === String(id); }); if (!row) return; const assigned = links.filter(function (link) { return String(link.FACTURA_ID) === String(id); }).reduce(function (sum, link) { return sum + Math.abs(Number(link.IMPORTE_ASIGNADO || 0)); }, 0); const total = Math.abs(Number(row.IMPORTE_TOTAL || 0)); const status = assigned <= 0.009 ? 'SIN CONCILIAR' : Math.abs(total - assigned) <= 0.01 ? 'CONCILIADA' : 'PARCIALMENTE CONCILIADA'; updateObjectRow_(APP.SHEETS.INVOICES, row.__row, { ESTADO_CONCILIACION: status, IMPORTE_ASIGNADO: Math.round(assigned * 100) / 100 }); });
}

function movementFromRow_(row, allLinks) {
  const links = (allLinks || safeRows_(APP.SHEETS.RECONCILIATIONS)).filter(function (link) { return String(link.MOVIMIENTO_ID) === String(row.MOVIMIENTO_ID) && String(link.ESTADO) === 'CONFIRMADA'; });
  const assigned = links.reduce(function (sum, link) { return sum + Math.abs(Number(link.IMPORTE_ASIGNADO || 0)); }, 0);
  return { id: String(row.MOVIMIENTO_ID || ''), importId: String(row.IMPORT_ID || ''), operationDate: String(row.FECHA_OPERACION || ''), valueDate: String(row.FECHA_VALOR || ''), concept: String(row.CONCEPTO || ''), amount: Number(row.IMPORTE || 0), currency: String(row.MONEDA || ''), reference: String(row.REFERENCIA || ''), type: String(row.TIPO || 'REVISIÓN'), status: String(row.ESTADO_CONCILIACION || 'SIN CONCILIAR'), candidateInvoiceId: String(row.FACTURA_CANDIDATA_ID || '') || undefined, evidence: String(row.EVIDENCIA || '') || undefined, assignedAmount: Math.round(assigned * 100) / 100, difference: Math.round((Math.abs(Number(row.IMPORTE || 0)) - assigned) * 100) / 100 };
}

function bankImportById_(importId) {
  const rows = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); });
  if (!rows.length) return null;
  const first = rows[0];
  const links = safeRows_(APP.SHEETS.RECONCILIATIONS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); }).map(function (row) { return { id: String(row.CONCILIACION_ID || ''), importId: String(row.IMPORT_ID || ''), movementId: String(row.MOVIMIENTO_ID || ''), invoiceId: String(row.FACTURA_ID || ''), allocatedAmount: Number(row.IMPORTE_ASIGNADO || 0), status: String(row.ESTADO || 'PROPUESTA'), evidence: String(row.EVIDENCIA || ''), reason: String(row.MOTIVO || ''), createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), decidedAt: String(row.DECIDIDO_EN || '') || undefined, decidedBy: String(row.DECIDIDO_POR || '') || undefined }; });
  return { id: String(importId), fileName: String(first.ARCHIVO_NOMBRE || ''), fileHash: String(first.ARCHIVO_HASH || ''), source: String(first.FUENTE || ''), periodFrom: String(first.PERIODO_DESDE || ''), periodTo: String(first.PERIODO_HASTA || ''), detectedPeriodFrom: String(first.PERIODO_DETECTADO_DESDE || '') || undefined, detectedPeriodTo: String(first.PERIODO_DETECTADO_HASTA || '') || undefined, warnings: safeJsonParse_(first.ADVERTENCIAS_JSON, []), coverage: String(first.COBERTURA || ''), status: String(first.ESTADO_IMPORTACION || 'PREVISUALIZACIÓN'), movementCount: rows.length, driveUrl: String(first.URL_DRIVE || '') || undefined, createdAt: String(first.CREADO_EN || ''), createdBy: String(first.CREADO_POR || ''), movements: rows.map(function (row) { return movementFromRow_(row, links); }), reconciliations: links };
}

function allBankImports_() {
  const ids = [];
  safeRows_(APP.SHEETS.MOVEMENTS).forEach(function (row) { const id = String(row.IMPORT_ID || ''); if (id && ids.indexOf(id) === -1) ids.push(id); });
  return ids.map(bankImportById_).filter(Boolean).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
