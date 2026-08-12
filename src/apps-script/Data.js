function spreadsheet_() { return SpreadsheetApp.openById(APP.SPREADSHEET_ID); }

function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw appError_('SHEET_MISSING', 'No existe la pestaña obligatoria ' + name + '.');
  return sheet;
}

function getRows_(name) {
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (!lastRow || !lastColumn) return [];
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  return values.slice(1).filter(function (row) { return row.some(function (value) { return value !== '' && value !== null; }); }).map(function (row, index) {
    const object = { __row: index + 2 };
    headers.forEach(function (header, column) { if (header) object[header] = row[column]; });
    return object;
  });
}

function appendObject_(name, object) {
  const sheet = sheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const rowNumber = sheet.getLastRow() + 1;
  const values = headers.map(function (header) { return object[header] === undefined ? '' : object[header]; });
  preserveInvoiceNumberAsText_(name, sheet, headers, rowNumber, [object], [values]);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  return rowNumber;
}

function appendObjects_(name, objects) {
  if (!objects || !objects.length) return [];
  const sheet = sheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const firstRow = sheet.getLastRow() + 1;
  const values = objects.map(function (object) { return headers.map(function (header) { return object[header] === undefined ? '' : object[header]; }); });
  preserveInvoiceNumberAsText_(name, sheet, headers, firstRow, objects, values);
  sheet.getRange(firstRow, 1, values.length, headers.length).setValues(values);
  return values.map(function (_, index) { return firstRow + index; });
}

function updateObjectRow_(name, rowNumber, updates) {
  const sheet = sheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  headers.forEach(function (header, index) { if (Object.prototype.hasOwnProperty.call(updates, header)) values[index] = updates[header]; });
  preserveInvoiceNumberAsText_(name, sheet, headers, rowNumber, [updates], [values]);
  range.setValues([values]);
}

function updateObjectRows_(name, changes) {
  if (!changes || !changes.length) return;
  const sheet = sheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const ordered = changes.slice().sort(function (a, b) { return Number(a.rowNumber) - Number(b.rowNumber); });
  const groups = [];
  ordered.forEach(function (change) {
    const rowNumber = Number(change.rowNumber);
    const current = groups[groups.length - 1];
    if (!current || rowNumber !== current.end + 1) groups.push({ start: rowNumber, end: rowNumber, changes: [change] });
    else { current.end = rowNumber; current.changes.push(change); }
  });
  groups.forEach(function (group) {
    const range = sheet.getRange(group.start, 1, group.end - group.start + 1, headers.length);
    const values = range.getValues();
    group.changes.forEach(function (change) {
      const row = values[Number(change.rowNumber) - group.start];
      headers.forEach(function (header, index) { if (Object.prototype.hasOwnProperty.call(change.updates, header)) row[index] = change.updates[header]; });
    });
    preserveInvoiceNumberAsText_(name, sheet, headers, group.start, group.changes.map(function (change) { return change.updates; }), values, group.changes.map(function (change) { return Number(change.rowNumber); }));
    range.setValues(values);
  });
}

function preserveInvoiceNumberAsText_(name, sheet, headers, firstRow, objects, values, rowNumbers) {
  const header = name === APP.SHEETS.DOCUMENTS ? 'NUMERO_FACTURA' : name === APP.SHEETS.INVOICES ? 'NÚMERO_FACTURA' : '';
  const column = header ? headers.indexOf(header) : -1;
  if (column === -1) return;
  objects.forEach(function (object, index) {
    if (!Object.prototype.hasOwnProperty.call(object, header)) return;
    const rowIndex = rowNumbers ? rowNumbers[index] - firstRow : index;
    const value = object[header];
    values[rowIndex][column] = value === '' || value === null || value === undefined ? '' : String(value);
    sheet.getRange(firstRow + rowIndex, column + 1).setNumberFormat('@');
  });
}

function ensureSheetHeaders_(name, expected) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String).filter(Boolean);
  const missing = expected.filter(function (header) { return existing.indexOf(header) === -1; });
  if (!existing.length) sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  else if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  sheet.setFrozenRows(1);
  return { name: name, added: missing };
}

function getConfigMap_() {
  try {
    return getRows_(APP.SHEETS.CONFIG).reduce(function (map, row) { map[String(row.CLAVE)] = row.VALOR; return map; }, {});
  } catch (_) {
    return { APP_ALLOWED_USERS: APP.OWNER_EMAIL, APP_MODE: 'DRY_RUN' };
  }
}

function effectiveStartDate_(config) {
  const configured = parseDate_((config || {}).APP_START_DATE) || APP.START_DATE;
  return configured < APP.START_DATE ? APP.START_DATE : configured;
}

function upsertConfig_(key, value, description) {
  const rows = getRows_(APP.SHEETS.CONFIG);
  const existing = rows.find(function (row) { return String(row.CLAVE) === key; });
  if (existing) updateObjectRow_(APP.SHEETS.CONFIG, existing.__row, { VALOR: value, 'DESCRIPCIÓN': description || existing['DESCRIPCIÓN'] });
  else appendObject_(APP.SHEETS.CONFIG, { CLAVE: key, VALOR: value, 'DESCRIPCIÓN': description || '' });
}

function setupSchema_(user, requestId) {
  const repeatedEvent = eventByRequest_(requestId, 'SCHEMA_MIGRATED');
  if (repeatedEvent) {
    const repeatedData = safeJsonParse_(repeatedEvent.DATOS_JSON, {});
    const repeatedBackup = Drive.Files.get(String(repeatedData.backupId || ''), { fields: 'id,name,webViewLink' });
    return { backup: { id: repeatedBackup.id, name: repeatedBackup.name, url: repeatedBackup.webViewLink || ('https://docs.google.com/spreadsheets/d/' + repeatedBackup.id) }, report: repeatedData.report || [] };
  }
  const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd HHmmss');
  const backup = Drive.Files.copy({ name: 'ReparaPRO Docs - Copia previa app - ' + stamp }, APP.SPREADSHEET_ID, { fields: 'id,name,webViewLink' });
  const report = [];
  Object.keys(HEADERS).forEach(function (key) { report.push(ensureSheetHeaders_(APP.SHEETS[key] || key, HEADERS[key])); });
  DEFAULT_CONFIG.forEach(function (row) {
    const config = getConfigMap_();
    if (config[row[0]] === undefined || config[row[0]] === '') upsertConfig_(row[0], row[1], row[2]);
  });
  upsertConfig_('APP_VERSION', APP.VERSION, 'Versión de ReparaPRO Gastos');
  if (!getRows_(APP.SHEETS.CATEGORIES).length) {
    DEFAULT_CATEGORIES.forEach(function (name) {
      appendObject_(APP.SHEETS.CATEGORIES, { CATEGORIA_ID: 'CAT-' + uuid_(), NOMBRE: name, ACTIVA: true, PROVEEDORES_JSON: '[]', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    });
  }
  logEvent_('INFO', 'SCHEMA_MIGRATED', APP.SPREADSHEET_ID, 'Migración aditiva completada', { backupId: backup.id, report: report }, '', requestId, user);
  return { backup: { id: backup.id, name: backup.name, url: backup.webViewLink || ('https://docs.google.com/spreadsheets/d/' + backup.id) }, report: report };
}

function logEvent_(level, action, objectId, detail, data, batchId, requestId, explicitUser) {
  const user = explicitUser || getActiveEmail_() || getEffectiveEmail_() || 'sistema';
  appendObjects_(APP.SHEETS.LOG, [logEventObject_(level, action, objectId, detail, data, batchId, requestId, user)]);
}

function logEventObject_(level, action, objectId, detail, data, batchId, requestId, user) {
  return { FECHA_HORA: nowIso_(), NIVEL: level, 'ACCIÓN': action, DOCUMENTO: objectId || '', DETALLE: detail || '', DATOS_JSON: JSON.stringify(data || {}), USUARIO: user || 'sistema', LOTE_ID: batchId || '', ID_EVENTO: requestId || uuid_() };
}

function activeProviders_() {
  return getRows_(APP.SHEETS.PROVIDERS).filter(function (row) { return toBoolean_(row.ACTIVO); }).map(providerFromRow_);
}

function providerFromRow_(row) {
  const frequency = String(row.FRECUENCIA_ESPERADA || 'NONE').toUpperCase();
  return {
    id: String(row.ID_PROVEEDOR || ('legacy-' + row.__row)), name: String(row.PROVEEDOR || ''), domain: String(row.DOMINIO || ''), taxId: String(row.CIF_NIF || ''),
    aliases: String(row.ALIASES || '').split(';').map(function (value) { return value.trim(); }).filter(Boolean), active: toBoolean_(row.ACTIVO), evidence: String(row.EVIDENCIA || row.OBSERVACIONES || ''),
    updatedAt: row.FECHA_ACTUALIZACION ? String(row.FECHA_ACTUALIZACION) : '', updatedBy: String(row.ACTUALIZADO_POR || ''), invoiceCount: 0,
    recurrent: frequency !== 'NONE', frequency: frequency,
    schedule: { supplierId: String(row.ID_PROVEEDOR || ('legacy-' + row.__row)), frequency: frequency, expectedDay: row.DIA_ESPERADO === '' || row.DIA_ESPERADO === undefined ? undefined : Number(row.DIA_ESPERADO), anchorMonth: row.MES_ANCLA === '' || row.MES_ANCLA === undefined ? undefined : Number(row.MES_ANCLA), excludedPeriods: safeJsonParse_(row.PERIODOS_EXCLUIDOS_JSON, []), evidence: String(row.EVIDENCIA_FRECUENCIA || '') },
    recurrenceSuggested: false, __row: row.__row,
  };
}

function documentFromRow_(row) {
  return {
    id: String(row.DOCUMENTO_ID || ''), batchId: String(row.LOTE_ID || ''), messageId: String(row.MESSAGE_ID || ''), attachmentId: String(row.ATTACHMENT_ID || ''), originalName: String(row.NOMBRE_ORIGINAL || ''),
    sender: String(row.REMITENTE || ''), recipients: String(row.DESTINATARIOS || ''), emailDirection: String(row.DIRECCION_CORREO || '') || undefined, subject: String(row.ASUNTO || ''), emailDate: String(row.FECHA_CORREO || ''), invoiceDate: parseDate_(row.FECHA_FACTURA), operationDate: parseDate_(row.FECHA_OPERACION), dueDate: parseDate_(row.FECHA_VENCIMIENTO), categoryId: String(row.CATEGORIA_ID || ''), taxableBase: row.BASE_IMPONIBLE === '' ? null : Number(row.BASE_IMPONIBLE), taxLines: safeJsonParse_(row.IMPUESTOS_JSON, []), internalNote: String(row.NOTA_INTERNA || ''), supplier: String(row.PROVEEDOR || ''), supplierId: String(row.PROVEEDOR_ID || ''), taxId: String(row.CIF_NIF || ''), invoiceNumber: String(row.NUMERO_FACTURA || ''), total: row.IMPORTE_TOTAL === '' ? null : Number(row.IMPORTE_TOTAL), currency: String(row.MONEDA || ''), phase: String(row.FASE || 'PENDIENTE'), proposedStatus: String(row.ESTADO_PROPUESTO || 'REVISIÓN MANUAL'), finalStatus: String(row.ESTADO_FINAL || '') || undefined, reviewReason: String(row.MOTIVO_REVISION || ''), decisionReason: String(row.MOTIVO_DECISION || ''), validationErrors: safeJsonParse_(row.ERRORES_VALIDACION_JSON, []), updatedAt: String(row.ACTUALIZADO_EN || ''), evidence: safeJsonParse_(row.EVIDENCIA_JSON, []), hash: String(row.HASH_PDF || ''), gmailUrl: String(row.GMAIL_URL || ''), driveUrl: String(row.URL_DRIVE || '') || undefined, selected: toBoolean_(row.SELECCIONADO), nonRegularSupplier: toBoolean_(row.PROVEEDOR_NO_HABITUAL), error: String(row.ERROR || ''), __row: row.__row,
  };
}

function invoiceFromRow_(row) {
  return { id: String(row.ID_UNICO || ('invoice-row-' + row.__row)), date: parseDate_(row.FECHA_FACTURA), operationDate: parseDate_(row.FECHA_OPERACION), dueDate: parseDate_(row.FECHA_VENCIMIENTO), categoryId: String(row.CATEGORIA_ID || ''), taxableBase: row.BASE_IMPONIBLE === '' ? null : Number(row.BASE_IMPONIBLE), taxLines: safeJsonParse_(row.IMPUESTOS_JSON, []), internalNote: String(row.NOTA_INTERNA || ''), reconciliationStatus: String(row.ESTADO_CONCILIACION || 'SIN CONCILIAR'), assignedAmount: Number(row.IMPORTE_ASIGNADO || 0), supplier: String(row.PROVEEDOR || ''), taxId: String(row.CIF_NIF || ''), number: String(row['NÚMERO_FACTURA'] || ''), total: Number(row.IMPORTE_TOTAL || 0), currency: String(row.MONEDA || ''), status: String(row.ESTADO || ''), driveUrl: String(row.URL_DRIVE || ''), gmailUrl: String(row.REFERENCIA_CORREO || ''), originalName: String(row.NOMBRE_ORIGINAL || ''), batchId: String(row.LOTE_ID || ''), hash: String(row.HASH_PDF || ''), nonRegularSupplier: toBoolean_(row.PROVEEDOR_NO_HABITUAL), __row: row.__row };
}

function categoryFromRow_(row) {
  return { id: String(row.CATEGORIA_ID || ''), name: String(row.NOMBRE || ''), active: toBoolean_(row.ACTIVA), supplierIds: safeJsonParse_(row.PROVEEDORES_JSON, []), updatedAt: String(row.ACTUALIZADO_EN || ''), updatedBy: String(row.ACTUALIZADO_POR || ''), __row: row.__row };
}

function categories_() { return safeRows_(APP.SHEETS.CATEGORIES).map(categoryFromRow_); }

function bankFormatFromRow_(row) {
  return {
    id: String(row.FORMATO_ID || ''), name: String(row.NOMBRE || ''), source: String(row.FUENTE_NORMALIZADA || ''),
    extension: String(row.EXTENSION || ''), separator: String(row.SEPARADOR || ''), headerSignature: String(row.FIRMA_CABECERAS || ''),
    headerRow: Number(row.FILA_CABECERA || 0), mapping: safeJsonParse_(row.MAPEO_JSON, {}), currencyMode: String(row.MODO_MONEDA || 'COLUMN'),
    fixedCurrency: String(row.MONEDA_FIJA || ''), active: toBoolean_(row.ACTIVO), native: toBoolean_(row.NATIVO),
    createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), updatedAt: String(row.ACTUALIZADO_EN || ''), updatedBy: String(row.ACTUALIZADO_POR || ''),
    __row: row.__row,
  };
}

function bankFormats_(activeOnly) {
  return safeRows_(APP.SHEETS.BANK_FORMATS).map(bankFormatFromRow_).filter(function (item) { return !activeOnly || item.active; });
}

function supplierRuleFromRow_(row) {
  return {
    id: String(row.REGLA_ID || ''), supplierId: String(row.PROVEEDOR_ID || ''), type: String(row.TIPO || ''),
    pattern: String(row.PATRON || ''), value: String(row.VALOR || ''), active: toBoolean_(row.ACTIVA), evidence: String(row.EVIDENCIA || ''),
    createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), updatedAt: String(row.ACTUALIZADO_EN || ''), updatedBy: String(row.ACTUALIZADO_POR || ''),
    deactivatedAt: String(row.DESACTIVADO_EN || '') || undefined, deactivatedBy: String(row.DESACTIVADO_POR || '') || undefined, deactivationReason: String(row.MOTIVO_DESACTIVACION || '') || undefined,
    __row: row.__row,
  };
}

function supplierRules_(supplierId, activeOnly, rows) {
  return (rows || safeRows_(APP.SHEETS.SUPPLIER_RULES)).map(supplierRuleFromRow_).filter(function (rule) {
    return (!supplierId || rule.supplierId === String(supplierId)) && (!activeOnly || rule.active);
  });
}

function coverageFromRow_(row) {
  return {
    id: String(row.COBERTURA_ID || ''), sourceType: String(row.TIPO_FUENTE || ''), sourceId: String(row.FUENTE_ID || ''), sourceName: String(row.FUENTE_NOMBRE || ''),
    from: parseDate_(row.DESDE), to: parseDate_(row.HASTA), status: String(row.ESTADO || 'PARCIAL'), detail: String(row.DETALLE || ''),
    batchIds: safeJsonParse_(row.LOTE_IDS_JSON, []), importId: String(row.IMPORT_ID || '') || undefined, movementCount: Number(row.MOVIMIENTOS || 0),
    createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), __row: row.__row,
  };
}

function exportFromRow_(row) {
  return { id: String(row.EXPORTACION_ID || ''), period: String(row.PERIODO || ''), status: String(row.ESTADO || ''), folderUrl: String(row.CARPETA_URL || '') || undefined, files: safeJsonParse_(row.ARCHIVOS_JSON, []), manifestHash: String(row.MANIFEST_HASH || '') || undefined, createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), error: String(row.ERROR || '') || undefined };
}

function batchFromRow_(row, documentRows) {
  const documents = (documentRows || getRows_(APP.SHEETS.DOCUMENTS)).filter(function (doc) { return String(doc.LOTE_ID) === String(row.LOTE_ID); }).map(documentFromRow_);
  return { id: String(row.LOTE_ID || ''), status: String(row.ESTADO || ''), dateFrom: parseDate_(row.FECHA_DESDE), dateTo: parseDate_(row.FECHA_HASTA), requestedEmails: Number(row.MAX_CORREOS || 0), reviewedEmails: Number(row.CORREOS_REVISADOS || 0), pdfCount: Number(row.PDF_ENCONTRADOS || 0), progress: Number(row.PROGRESO || 0), createdAt: String(row.CREADO_EN || ''), createdBy: String(row.CREADO_POR || ''), approvedAt: String(row.APROBADO_EN || '') || undefined, approvedBy: String(row.APROBADO_POR || '') || undefined, cursor: String(row.CURSOR || ''), nextSearchDate: parseDate_(row.FECHA_BUSQUEDA) || undefined, cancelReason: String(row.MOTIVO_CANCELACION || '') || undefined, documents: documents, error: String(row.ERROR || '') || undefined, __row: row.__row };
}

function getActiveBatch_(batchRows, documentRows) {
  const activeStates = ['BORRADOR', 'ANALIZANDO', 'PENDIENTE DE APROBACIÓN', 'EJECUTANDO', 'INTERRUMPIDO', 'COMPLETADO CON ERRORES'];
  const rows = (batchRows || getRows_(APP.SHEETS.BATCHES)).filter(function (row) { return String(row.TIPO || 'GMAIL') === 'GMAIL' && activeStates.indexOf(String(row.ESTADO)) !== -1; });
  return rows.length ? batchFromRow_(rows[rows.length - 1], documentRows) : null;
}

function reviewDocuments_() {
  const documentRows = arguments[0];
  return (documentRows || getRows_(APP.SHEETS.DOCUMENTS)).filter(function (row) {
    const phase = String(row.FASE || '');
    return phase === 'EN REVISIÓN' || phase === 'ERROR' || phase === 'LISTO PARA APROBAR';
  }).map(documentFromRow_);
}

function eventByRequest_(requestId, actions) {
  if (!requestId) return null;
  actions = Array.isArray(actions) ? actions : [actions];
  return getRows_(APP.SHEETS.LOG).find(function (row) { return String(row.ID_EVENTO || '') === String(requestId) && actions.indexOf(String(row['ACCIÓN'] || '')) !== -1; }) || null;
}

function uniqueRequestExists_(requestId) {
  if (!requestId) return false;
  return getRows_(APP.SHEETS.LOG).some(function (row) { return String(row.ID_EVENTO || '') === requestId; });
}
