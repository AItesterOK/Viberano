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
  let bankFile;
  try { bankFile = readBankValues_(bytes, payload.fileName, raw.id); }
  catch (error) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw error; }
  let normalized;
  try { normalized = normalizeBankRows_(bankFile.values, payload.mapping || null, { fileName: payload.fileName, source: payload.source, extension: bankFile.extension, separator: bankFile.separator, forceManual: Boolean(payload.forceManual) }); }
  catch (error) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw error; }
  if (!normalized.rows.length) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw appError_('EMPTY_BANK_FILE', 'No se encontraron movimientos válidos.'); }
  if (payload.mapping && payload.mapping.rememberProfile) {
    try { normalized.profile = saveBankFormat_(normalized, payload.mapping, payload.source, bankFile, user, requestId); }
    catch (error) { try { DriveApp.getFileById(raw.id).setTrashed(true); } catch (_) {} throw error; }
  }
  const warnings = bankPeriodWarnings_(normalized.detectedPeriodFrom, normalized.detectedPeriodTo, parseDate_(payload.periodFrom), parseDate_(payload.periodTo), String(payload.coverage || ''));
  const invoices = safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_).filter(function (invoice) { return invoice.status === 'PROCESADA'; });
  normalized.rows.forEach(function (movement, index) {
    const candidates = findBankCandidates_(movement, invoices);
    let reconciliationStatus = movement.type === 'INGRESO' ? 'EXCLUIDO: INGRESO' : movement.type === 'TRASPASO' ? 'EXCLUIDO: TRASPASO' : candidates.length === 1 ? 'CANDIDATA PENDIENTE' : candidates.length > 1 ? 'REVISIÓN MANUAL' : 'MOVIMIENTO SIN FACTURA';
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const movementId = importId + '-M' + ('0000' + (index + 1)).slice(-4);
    const evidence = candidate ? bankEvidence_(movement, candidate) : candidates.length > 1 ? candidates.length + ' facturas candidatas con evidencia insuficiente para elegir' : '';
    appendObject_(APP.SHEETS.MOVEMENTS, { MOVIMIENTO_ID: movementId, IMPORT_ID: importId, ARCHIVO_NOMBRE: payload.fileName, ARCHIVO_HASH: hash, RAW_FILE_ID: raw.id, URL_DRIVE: '', FUENTE: payload.source, PERIODO_DESDE: parseDate_(payload.periodFrom), PERIODO_HASTA: parseDate_(payload.periodTo), PERIODO_DETECTADO_DESDE: normalized.detectedPeriodFrom, PERIODO_DETECTADO_HASTA: normalized.detectedPeriodTo, ADVERTENCIAS_JSON: JSON.stringify(warnings), COBERTURA: payload.coverage, ESTADO_IMPORTACION: 'PREVISUALIZACIÓN', FECHA_OPERACION: movement.operationDate, FECHA_VALOR: movement.valueDate, CONCEPTO: movement.concept, IMPORTE: movement.amount, MONEDA: movement.currency, REFERENCIA: movement.reference, TIPO: movement.type, ESTADO_CONCILIACION: reconciliationStatus, FACTURA_CANDIDATA_ID: candidate ? candidate.id : '', EVIDENCIA: evidence, CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId, FORMATO_BANCARIO_ID: normalized.profile ? normalized.profile.id : '', FORMATO_BANCARIO_NOMBRE: normalized.profile ? normalized.profile.name : '' });
    if (candidate) appendObject_(APP.SHEETS.RECONCILIATIONS, { CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: importId, MOVIMIENTO_ID: movementId, FACTURA_ID: candidate.id, ESTADO: 'PROPUESTA', EVIDENCIA: evidence, DECISION: '', MOTIVO: '', CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
  });
  if (normalized.profile) logEvent_('INFO', 'FORMATO_BANCARIO_APLICADO', normalized.profile.id, normalized.profile.name, { importId: importId, source: payload.source, headerSignature: normalized.headerSignature }, '', requestId + '-format', user);
  logEvent_('INFO', 'BANCO_PREVISUALIZADO', importId, payload.fileName, { movements: normalized.rows.length, headerRow: normalized.headerRow, detectedPeriodFrom: normalized.detectedPeriodFrom, detectedPeriodTo: normalized.detectedPeriodTo, warnings: warnings, bankFormatId: normalized.profile ? normalized.profile.id : '', bankFormatName: normalized.profile ? normalized.profile.name : '' }, '', requestId, user);
  return bankImportById_(importId);
}

function readBankValues_(bytes, fileName, rawId) {
  if (/\.csv$/i.test(fileName)) {
    const text = Utilities.newBlob(bytes).getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const separator = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return { values: Utilities.parseCsv(text, separator), extension: 'csv', separator: separator };
  }
  if (!/\.xlsx?$/i.test(fileName)) throw appError_('UNSUPPORTED_BANK_FILE', 'Solo se admiten archivos XLSX, XLS o CSV.');
  const converted = Drive.Files.copy({ name: '_CONVERSION ' + uuid_(), mimeType: 'application/vnd.google-apps.spreadsheet' }, rawId, { fields: 'id,name' });
  try { return { values: SpreadsheetApp.openById(converted.id).getSheets()[0].getDataRange().getDisplayValues(), extension: /\.xls$/i.test(fileName) ? 'xls' : 'xlsx', separator: '' }; }
  finally { try { DriveApp.getFileById(converted.id).setTrashed(true); } catch (_) {} }
}

function bankHeaderSignature_(headers) { return (headers || []).map(function (value) { return normalizeText_(value); }).join('|'); }

function embeddedCurrency_(value) {
  const match = String(value || '').trim().toUpperCase().match(/([A-Z]{3})\s*$/);
  return match ? match[1] : '';
}

function findBankHeaderRow_(values, signature) {
  for (let index = 0; index < Math.min(values.length, 30); index += 1) if (bankHeaderSignature_(values[index]) === signature) return index;
  return -1;
}

function bankProfileFor_(values, context) {
  const caixaSignature = 'concepto|fecha|importe|saldo';
  const caixaHeader = findBankHeaderRow_(values, caixaSignature);
  if (context.extension === 'csv' && context.separator === ';' && caixaHeader >= 0) {
    const samples = values.slice(caixaHeader + 1, caixaHeader + 6).filter(function (row) { return String(row[2] || '').trim(); });
    if (samples.length && samples.every(function (row) { return Boolean(embeddedCurrency_(row[2])); })) return { id: 'NATIVE-CAIXABANK-CSV', name: 'CaixaBank CSV', source: 'caixabank', extension: 'csv', separator: ';', headerSignature: caixaSignature, headerRow: caixaHeader, mapping: { operationDate: 1, valueDate: 1, concept: 0, amount: 2 }, currencyMode: 'EMBEDDED', fixedCurrency: '', active: true, native: true };
  }
  const source = normalizeText_(context.source);
  const candidates = bankFormats_(true).filter(function (profile) { return profile.source === source && profile.extension === context.extension && profile.separator === context.separator; });
  for (let index = 0; index < candidates.length; index += 1) {
    const headerRow = findBankHeaderRow_(values, candidates[index].headerSignature);
    if (headerRow >= 0) { candidates[index].headerRow = headerRow; return candidates[index]; }
  }
  return null;
}

function bankCurrencyForRow_(row, mapping, index) {
  const mode = String(mapping.currencyMode || (mapping.currency === undefined ? '' : 'COLUMN')).toUpperCase();
  let currency = '';
  if (mode === 'COLUMN') currency = String(row[mapping.currency] || '').trim().toUpperCase();
  else if (mode === 'EMBEDDED') currency = embeddedCurrency_(row[mapping.amount]);
  else if (mode === 'FIXED') {
    currency = String(mapping.fixedCurrency || '').trim().toUpperCase();
    const embedded = embeddedCurrency_(row[mapping.amount]);
    if (embedded && embedded !== currency) throw appError_('BANK_CURRENCY_CONFLICT', 'La fila ' + (index + 1) + ' contiene ' + embedded + ', pero el perfil fija ' + currency + '.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw appError_('INVALID_BANK_CURRENCY', 'La fila ' + (index + 1) + ' contiene una moneda vacía o no válida. Selecciona una columna, indica que está integrada en el importe o fija una moneda acreditada; no se asumirá EUR.');
  return currency;
}

function normalizeBankRows_(values, explicitMapping, context) {
  if (!values || !values.length) return { rows: [], headerRow: -1 };
  const aliases = {
    operationDate: ['fecha', 'fecha operacion', 'f operacion', 'fecha de operacion'], valueDate: ['fecha valor', 'f valor', 'fecha de valor'], concept: ['concepto', 'descripcion', 'detalle'], amount: ['importe', 'cantidad', 'amount'], currency: ['divisa', 'moneda', 'currency'], reference: ['referencia', 'referencia 1', 'referencia adicional', 'informacion adicional'],
  };
  let headerRow = -1;
  let mapping = explicitMapping ? Object.assign({}, explicitMapping) : null;
  let profile = null;
  if (!mapping && context && context.forceManual) {
    let manualHeader = 0;
    for (let probe = 1; probe < Math.min(values.length, 30); probe += 1) if ((values[probe] || []).filter(function (value) { return String(value || '').trim(); }).length > (values[manualHeader] || []).filter(function (value) { return String(value || '').trim(); }).length) manualHeader = probe;
    const manualAmount = (values[manualHeader] || []).map(normalizeText_).indexOf('importe');
    const manualSamples = manualAmount >= 0 ? values.slice(manualHeader + 1, manualHeader + 6).filter(function (row) { return String(row[manualAmount] || '').trim(); }) : [];
    throw appError_('BANK_MAPPING_REQUIRED', 'Selecciona las columnas y cómo se obtiene la moneda.', false, { headers: (values[manualHeader] || []).map(String), headerRow: manualHeader, headerSignature: bankHeaderSignature_(values[manualHeader]), extension: context.extension || '', separator: context.separator || '', suggestedCurrencyMode: manualSamples.length && manualSamples.every(function (row) { return Boolean(embeddedCurrency_(row[manualAmount])); }) ? 'EMBEDDED' : 'COLUMN' });
  }
  if (!mapping) {
    profile = bankProfileFor_(values, context || {});
    if (profile) { headerRow = profile.headerRow; mapping = Object.assign({}, profile.mapping, { currencyMode: profile.currencyMode, fixedCurrency: profile.fixedCurrency }); }
  }
  if (!mapping) {
    for (let rowIndex = 0; rowIndex < Math.min(values.length, 30); rowIndex += 1) {
      const headers = values[rowIndex].map(normalizeText_);
      const detected = {};
      Object.keys(aliases).forEach(function (key) { const index = headers.findIndex(function (header) { return aliases[key].indexOf(header) !== -1; }); if (index >= 0) detected[key] = index; });
      if (detected.operationDate !== undefined && detected.concept !== undefined && detected.amount !== undefined) {
        if (detected.currency !== undefined) { detected.currencyMode = 'COLUMN'; headerRow = rowIndex; mapping = detected; break; }
        const samples = values.slice(rowIndex + 1, rowIndex + 6).filter(function (row) { return String(row[detected.amount] || '').trim(); });
        if (samples.length && samples.every(function (row) { return Boolean(embeddedCurrency_(row[detected.amount])); })) { detected.currencyMode = 'EMBEDDED'; headerRow = rowIndex; mapping = detected; break; }
      }
    }
  } else if (headerRow < 0) headerRow = Number(explicitMapping.headerRow || 0);
  const validCurrencyMapping = mapping && (String(mapping.currencyMode || '').toUpperCase() === 'EMBEDDED' || (String(mapping.currencyMode || '').toUpperCase() === 'FIXED' && /^[A-Z]{3}$/.test(String(mapping.fixedCurrency || '').toUpperCase())) || mapping.currency !== undefined);
  if (!mapping || mapping.operationDate === undefined || mapping.concept === undefined || mapping.amount === undefined || !validCurrencyMapping) {
    let candidate = 0;
    for (let probe = 1; probe < Math.min(values.length, 30); probe += 1) if ((values[probe] || []).filter(function (value) { return String(value || '').trim(); }).length > (values[candidate] || []).filter(function (value) { return String(value || '').trim(); }).length) candidate = probe;
    const amountIndex = (values[candidate] || []).map(normalizeText_).indexOf('importe');
    const samples = amountIndex >= 0 ? values.slice(candidate + 1, candidate + 6).filter(function (row) { return String(row[amountIndex] || '').trim(); }) : [];
    throw appError_('BANK_MAPPING_REQUIRED', 'No se reconoce el formato. Debes mapear fecha de operación, concepto, importe y cómo se obtiene la moneda.', false, { headers: (values[candidate] || []).map(String), headerRow: candidate, headerSignature: bankHeaderSignature_(values[candidate]), extension: context && context.extension || '', separator: context && context.separator || '', suggestedCurrencyMode: samples.length && samples.every(function (row) { return Boolean(embeddedCurrency_(row[amountIndex])); }) ? 'EMBEDDED' : 'COLUMN' });
  }
  mapping.currencyMode = String(mapping.currencyMode || (mapping.currency === undefined ? '' : 'COLUMN')).toUpperCase();
  const rows = [];
  for (let index = headerRow + 1; index < values.length; index += 1) {
    const row = values[index];
    const amount = parseNumber_(row[mapping.amount]);
    const operationDate = parseDate_(row[mapping.operationDate]);
    const concept = String(row[mapping.concept] || '').trim();
    if (amount === null || !operationDate || !concept) continue;
    const valueDate = mapping.valueDate === undefined ? operationDate : (parseDate_(row[mapping.valueDate]) || operationDate);
    const currency = bankCurrencyForRow_(row, mapping, index);
    const referenceIndexes = Array.isArray(mapping.reference) ? mapping.reference : mapping.reference === undefined ? [] : [mapping.reference];
    const reference = referenceIndexes.map(function (column) { return String(row[column] || '').trim(); }).filter(Boolean).join(' · ');
    rows.push({ operationDate: operationDate, valueDate: valueDate, concept: concept, amount: amount, currency: currency, reference: reference, type: classifyBankMovement_(amount, concept) });
  }
  const dates = rows.map(function (row) { return row.operationDate; }).sort();
  return { rows: rows, headerRow: headerRow, headerSignature: bankHeaderSignature_(values[headerRow] || []), mapping: mapping, profile: profile, detectedPeriodFrom: dates[0] || '', detectedPeriodTo: dates[dates.length - 1] || '' };
}

function saveBankFormat_(normalized, input, source, bankFile, user, requestId) {
  const name = String(input.profileName || '').trim();
  if (!name) throw appError_('BANK_FORMAT_NAME_REQUIRED', 'Pon un nombre al formato antes de guardarlo.');
  const sourceNormalized = normalizeText_(source);
  const existing = bankFormats_(false).find(function (item) { return item.source === sourceNormalized && item.extension === bankFile.extension && item.separator === bankFile.separator && item.headerSignature === normalized.headerSignature; });
  const id = existing ? existing.id : 'BF-' + uuid_();
  const mapping = {};
  ['operationDate', 'valueDate', 'concept', 'amount', 'currency', 'reference'].forEach(function (key) { if (normalized.mapping[key] !== undefined) mapping[key] = normalized.mapping[key]; });
  const data = { FORMATO_ID: id, NOMBRE: name, FUENTE_NORMALIZADA: sourceNormalized, EXTENSION: bankFile.extension, SEPARADOR: bankFile.separator, FIRMA_CABECERAS: normalized.headerSignature, FILA_CABECERA: normalized.headerRow, MAPEO_JSON: JSON.stringify(mapping), MODO_MONEDA: normalized.mapping.currencyMode, MONEDA_FIJA: String(normalized.mapping.fixedCurrency || '').toUpperCase(), ACTIVO: true, NATIVO: false, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId };
  if (existing) updateObjectRow_(APP.SHEETS.BANK_FORMATS, existing.__row, data);
  else { data.CREADO_EN = nowIso_(); data.CREADO_POR = user; appendObject_(APP.SHEETS.BANK_FORMATS, data); }
  logEvent_('INFO', existing ? 'FORMATO_BANCARIO_ACTUALIZADO' : 'FORMATO_BANCARIO_CREADO', id, name, { source: sourceNormalized, extension: bankFile.extension, separator: bankFile.separator, headerSignature: normalized.headerSignature, currencyMode: normalized.mapping.currencyMode }, '', requestId + '-profile', user);
  const saved = bankFormats_(false).find(function (item) { return item.id === id; });
  delete saved.__row;
  return saved;
}

function deactivateBankFormat_(payload, user, requestId) {
  const id = String(payload.formatId || '');
  const row = safeRows_(APP.SHEETS.BANK_FORMATS).find(function (item) { return String(item.FORMATO_ID || '') === id; });
  if (!row) throw appError_('BANK_FORMAT_NOT_FOUND', 'No se encuentra el formato bancario.');
  if (!toBoolean_(row.ACTIVO)) { const inactive = bankFormatFromRow_(row); delete inactive.__row; return inactive; }
  updateObjectRow_(APP.SHEETS.BANK_FORMATS, row.__row, { ACTIVO: false, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
  logEvent_('WARN', 'FORMATO_BANCARIO_DESACTIVADO', id, String(row.NOMBRE || ''), {}, '', requestId, user);
  const updated = bankFormatFromRow_(safeRows_(APP.SHEETS.BANK_FORMATS).find(function (item) { return item.__row === row.__row; }));
  delete updated.__row;
  return updated;
}

function listedBankFormats_(activeOnly) {
  const nativeProfile = { id: 'NATIVE-CAIXABANK-CSV', name: 'CaixaBank CSV', source: 'caixabank', extension: 'csv', separator: ';', headerSignature: 'concepto|fecha|importe|saldo', headerRow: 0, mapping: { operationDate: 1, valueDate: 1, concept: 0, amount: 2 }, currencyMode: 'EMBEDDED', fixedCurrency: '', active: true, native: true, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' };
  return [nativeProfile].concat(bankFormats_(activeOnly).map(function (item) { delete item.__row; return item; }));
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
  movementIds.filter(function (id, index, list) { return list.indexOf(id) === index; }).forEach(function (id) { const row = movements.find(function (candidate) { return String(candidate.MOVIMIENTO_ID) === String(id); }); if (!row) return; const assignedCents = links.filter(function (link) { return String(link.MOVIMIENTO_ID) === String(id); }).reduce(function (sum, link) { return sum + Math.abs(toCents_(link.IMPORTE_ASIGNADO)); }, 0); const totalCents = Math.abs(toCents_(row.IMPORTE)); const status = assignedCents === 0 ? 'SIN CONCILIAR' : Math.abs(totalCents - assignedCents) <= 1 ? 'CONCILIADA' : 'PARCIALMENTE CONCILIADA'; updateObjectRow_(APP.SHEETS.MOVEMENTS, row.__row, { ESTADO_CONCILIACION: status, CREADO_POR: user, REQUEST_ID: requestId }); });
  const invoices = safeRows_(APP.SHEETS.INVOICES);
  invoiceIds.filter(function (id, index, list) { return list.indexOf(id) === index; }).forEach(function (id) { const row = invoices.find(function (candidate) { return String(candidate.ID_UNICO || '') === String(id); }); if (!row) return; const assignedCents = links.filter(function (link) { return String(link.FACTURA_ID) === String(id); }).reduce(function (sum, link) { return sum + Math.abs(toCents_(link.IMPORTE_ASIGNADO)); }, 0); const totalCents = Math.abs(toCents_(row.IMPORTE_TOTAL)); const status = assignedCents === 0 ? 'SIN CONCILIAR' : Math.abs(totalCents - assignedCents) <= 1 ? 'CONCILIADA' : 'PARCIALMENTE CONCILIADA'; updateObjectRow_(APP.SHEETS.INVOICES, row.__row, { ESTADO_CONCILIACION: status, IMPORTE_ASIGNADO: assignedCents / 100 }); });
}

function movementFromRow_(row, allLinks) {
  const links = (allLinks || safeRows_(APP.SHEETS.RECONCILIATIONS)).filter(function (link) { return String(link.MOVIMIENTO_ID) === String(row.MOVIMIENTO_ID) && String(link.ESTADO) === 'CONFIRMADA'; });
  const assignedCents = links.reduce(function (sum, link) { return sum + Math.abs(toCents_(link.IMPORTE_ASIGNADO)); }, 0);
  const totalCents = Math.abs(toCents_(row.IMPORTE));
  return { id: String(row.MOVIMIENTO_ID || ''), importId: String(row.IMPORT_ID || ''), operationDate: String(row.FECHA_OPERACION || ''), valueDate: String(row.FECHA_VALOR || ''), concept: String(row.CONCEPTO || ''), amount: Number(row.IMPORTE || 0), currency: String(row.MONEDA || ''), reference: String(row.REFERENCIA || ''), type: String(row.TIPO || 'REVISIÓN'), status: String(row.ESTADO_CONCILIACION || 'SIN CONCILIAR'), candidateInvoiceId: String(row.FACTURA_CANDIDATA_ID || '') || undefined, evidence: String(row.EVIDENCIA || '') || undefined, assignedAmount: assignedCents / 100, difference: (totalCents - assignedCents) / 100 };
}

function bankImportById_(importId) {
  const rows = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); });
  if (!rows.length) return null;
  const first = rows[0];
  const links = safeRows_(APP.SHEETS.RECONCILIATIONS).filter(function (row) { return String(row.IMPORT_ID) === String(importId); }).map(function (row) { return { id: String(row.CONCILIACION_ID || ''), importId: String(row.IMPORT_ID || ''), movementId: String(row.MOVIMIENTO_ID || ''), invoiceId: String(row.FACTURA_ID || ''), allocatedAmount: Number(row.IMPORTE_ASIGNADO || 0), status: String(row.ESTADO || 'PROPUESTA'), evidence: String(row.EVIDENCIA || ''), reason: String(row.MOTIVO || ''), createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), decidedAt: String(row.DECIDIDO_EN || '') || undefined, decidedBy: String(row.DECIDIDO_POR || '') || undefined }; });
  return { id: String(importId), fileName: String(first.ARCHIVO_NOMBRE || ''), fileHash: String(first.ARCHIVO_HASH || ''), source: String(first.FUENTE || ''), periodFrom: String(first.PERIODO_DESDE || ''), periodTo: String(first.PERIODO_HASTA || ''), detectedPeriodFrom: String(first.PERIODO_DETECTADO_DESDE || '') || undefined, detectedPeriodTo: String(first.PERIODO_DETECTADO_HASTA || '') || undefined, warnings: safeJsonParse_(first.ADVERTENCIAS_JSON, []), coverage: String(first.COBERTURA || ''), status: String(first.ESTADO_IMPORTACION || 'PREVISUALIZACIÓN'), movementCount: rows.length, bankFormatId: String(first.FORMATO_BANCARIO_ID || '') || undefined, bankFormatName: String(first.FORMATO_BANCARIO_NOMBRE || '') || undefined, driveUrl: String(first.URL_DRIVE || '') || undefined, createdAt: String(first.CREADO_EN || ''), createdBy: String(first.CREADO_POR || ''), movements: rows.map(function (row) { return movementFromRow_(row, links); }), reconciliations: links };
}

function allBankImports_() {
  const ids = [];
  safeRows_(APP.SHEETS.MOVEMENTS).forEach(function (row) { const id = String(row.IMPORT_ID || ''); if (id && ids.indexOf(id) === -1) ids.push(id); });
  return ids.map(bankImportById_).filter(Boolean).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
