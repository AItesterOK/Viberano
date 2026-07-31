function previewBankImport_(payload, user, requestId) {
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
  const invoices = safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_).filter(function (invoice) { return invoice.status === 'PROCESADA'; });
  normalized.rows.forEach(function (movement, index) {
    const candidates = findBankCandidates_(movement, invoices);
    let reconciliationStatus = movement.type === 'INGRESO' ? 'EXCLUIDO: INGRESO' : movement.type === 'TRASPASO' ? 'EXCLUIDO: TRASPASO' : candidates.length === 1 ? 'CANDIDATA PENDIENTE' : candidates.length > 1 ? 'REVISIÓN MANUAL' : 'MOVIMIENTO SIN FACTURA';
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const movementId = importId + '-M' + ('0000' + (index + 1)).slice(-4);
    const evidence = candidate ? bankEvidence_(movement, candidate) : candidates.length > 1 ? candidates.length + ' facturas candidatas con evidencia insuficiente para elegir' : '';
    appendObject_(APP.SHEETS.MOVEMENTS, { MOVIMIENTO_ID: movementId, IMPORT_ID: importId, ARCHIVO_NOMBRE: payload.fileName, ARCHIVO_HASH: hash, RAW_FILE_ID: raw.id, URL_DRIVE: '', FUENTE: payload.source, PERIODO_DESDE: parseDate_(payload.periodFrom), PERIODO_HASTA: parseDate_(payload.periodTo), COBERTURA: payload.coverage, ESTADO_IMPORTACION: 'PREVISUALIZACIÓN', FECHA_OPERACION: movement.operationDate, FECHA_VALOR: movement.valueDate, CONCEPTO: movement.concept, IMPORTE: movement.amount, MONEDA: movement.currency, REFERENCIA: movement.reference, TIPO: movement.type, ESTADO_CONCILIACION: reconciliationStatus, FACTURA_CANDIDATA_ID: candidate ? candidate.id : '', EVIDENCIA: evidence, CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
    if (candidate) appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: importId, MOVIMIENTO_ID: movementId, FACTURA_ID: candidate.id, ESTADO: 'PROPUESTA', EVIDENCIA: evidence, DECISION: '', MOTIVO: '', CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
  });
  logEvent_('INFO', 'BANCO_PREVISUALIZADO', importId, payload.fileName, { movements: normalized.rows.length, headerRow: normalized.headerRow }, '', requestId, user);
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
      if (detected.operationDate !== undefined && detected.concept !== undefined && detected.amount !== undefined) { headerRow = rowIndex; mapping = detected; break; }
    }
  } else headerRow = Number(explicitMapping.headerRow || 0);
  if (!mapping || mapping.operationDate === undefined || mapping.concept === undefined || mapping.amount === undefined) {
    let candidate = 0;
    for (let probe = 1; probe < Math.min(values.length, 30); probe += 1) if ((values[probe] || []).filter(function (value) { return String(value || '').trim(); }).length > (values[candidate] || []).filter(function (value) { return String(value || '').trim(); }).length) candidate = probe;
    throw appError_('BANK_MAPPING_REQUIRED', 'No se reconoce el formato. Debes mapear fecha de operación, concepto e importe.', false, { headers: (values[candidate] || []).map(String), headerRow: candidate });
  }
  const rows = [];
  for (let index = headerRow + 1; index < values.length; index += 1) {
    const row = values[index];
    const amount = parseNumber_(row[mapping.amount]);
    const operationDate = parseDate_(row[mapping.operationDate]);
    const concept = String(row[mapping.concept] || '').trim();
    if (amount === null || !operationDate || !concept) continue;
    const valueDate = mapping.valueDate === undefined ? operationDate : (parseDate_(row[mapping.valueDate]) || operationDate);
    const currency = mapping.currency === undefined ? 'EUR' : String(row[mapping.currency] || 'EUR').trim().toUpperCase();
    const referenceIndexes = Array.isArray(mapping.reference) ? mapping.reference : mapping.reference === undefined ? [] : [mapping.reference];
    const reference = referenceIndexes.map(function (column) { return String(row[column] || '').trim(); }).filter(Boolean).join(' · ');
    rows.push({ operationDate: operationDate, valueDate: valueDate, concept: concept, amount: amount, currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR', reference: reference, type: classifyBankMovement_(amount, concept) });
  }
  return { rows: rows, headerRow: headerRow };
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

function decideReconciliation_(payload, user, requestId) {
  const allowed = ['COINCIDENCIA CONFIRMADA', 'REVISIÓN MANUAL', 'CANDIDATA PENDIENTE', 'MOVIMIENTO SIN FACTURA'];
  if (allowed.indexOf(String(payload.status)) === -1) throw appError_('INVALID_RECONCILIATION_STATUS', 'Estado de conciliación no permitido.');
  const movement = safeRows_(APP.SHEETS.MOVEMENTS).find(function (row) { return String(row.MOVIMIENTO_ID) === String(payload.movementId) && String(row.IMPORT_ID) === String(payload.importId); });
  if (!movement) throw appError_('MOVEMENT_NOT_FOUND', 'No se encuentra el movimiento.');
  const before = String(movement.ESTADO_CONCILIACION || '');
  updateObjectRow_(APP.SHEETS.MOVEMENTS, movement.__row, { ESTADO_CONCILIACION: payload.status, FACTURA_CANDIDATA_ID: payload.invoiceId || movement.FACTURA_CANDIDATA_ID || '', CREADO_POR: user, REQUEST_ID: requestId });
  const reconciliation = safeRows_(APP.SHEETS.RECONCILIATIONS).find(function (row) { return String(row.MOVIMIENTO_ID) === String(payload.movementId); });
  if (reconciliation) updateObjectRow_(APP.SHEETS.RECONCILIATIONS, reconciliation.__row, { ESTADO: payload.status === 'COINCIDENCIA CONFIRMADA' ? 'CONFIRMADA' : payload.status, DECISION: payload.status, MOTIVO: payload.reason || '', DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId });
  else appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: payload.importId, MOVIMIENTO_ID: payload.movementId, FACTURA_ID: payload.invoiceId || '', ESTADO: payload.status === 'COINCIDENCIA CONFIRMADA' ? 'CONFIRMADA' : payload.status, EVIDENCIA: movement.EVIDENCIA || '', DECISION: payload.status, MOTIVO: payload.reason || '', CREADO_EN: nowIso_(), CREADO_POR: user, DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: requestId });
  logEvent_('INFO', 'CONCILIACION_DECIDIDA', payload.movementId, before + ' → ' + payload.status, { invoiceId: payload.invoiceId || '' }, '', requestId, user);
  return bankImportById_(payload.importId);
}

function movementFromRow_(row) {
  return { id: String(row.MOVIMIENTO_ID || ''), importId: String(row.IMPORT_ID || ''), operationDate: String(row.FECHA_OPERACION || ''), valueDate: String(row.FECHA_VALOR || ''), concept: String(row.CONCEPTO || ''), amount: Number(row.IMPORTE || 0), currency: String(row.MONEDA || 'EUR'), reference: String(row.REFERENCIA || ''), type: String(row.TIPO || 'REVISIÓN'), status: String(row.ESTADO_CONCILIACION || 'REVISIÓN MANUAL'), candidateInvoiceId: String(row.FACTURA_CANDIDATA_ID || '') || undefined, evidence: String(row.EVIDENCIA || '') || undefined };
}

function bankImportById_(importId) {
  const rows = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); });
  if (!rows.length) return null;
  const first = rows[0];
  return { id: String(importId), fileName: String(first.ARCHIVO_NOMBRE || ''), fileHash: String(first.ARCHIVO_HASH || ''), source: String(first.FUENTE || ''), periodFrom: String(first.PERIODO_DESDE || ''), periodTo: String(first.PERIODO_HASTA || ''), coverage: String(first.COBERTURA || ''), status: String(first.ESTADO_IMPORTACION || 'PREVISUALIZACIÓN'), movementCount: rows.length, driveUrl: String(first.URL_DRIVE || '') || undefined, createdAt: String(first.CREADO_EN || ''), createdBy: String(first.CREADO_POR || ''), movements: rows.map(movementFromRow_) };
}

function allBankImports_() {
  const ids = [];
  safeRows_(APP.SHEETS.MOVEMENTS).forEach(function (row) { const id = String(row.IMPORT_ID || ''); if (id && ids.indexOf(id) === -1) ids.push(id); });
  return ids.map(bankImportById_).filter(Boolean).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
