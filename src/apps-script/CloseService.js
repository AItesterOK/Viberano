function saveCategory_(payload, user, requestId) {
  const input = payload.category || {};
  const name = String(input.name || '').trim();
  if (!name) throw appError_('CATEGORY_NAME_REQUIRED', 'El nombre de la categoría es obligatorio.');
  const rows = safeRows_(APP.SHEETS.CATEGORIES);
  const existing = rows.find(function (row) { return String(row.CATEGORIA_ID) === String(input.id || ''); });
  const duplicate = rows.find(function (row) { return row.__row !== (existing && existing.__row) && normalizeText_(row.NOMBRE) === normalizeText_(name); });
  if (duplicate) throw appError_('CATEGORY_ALREADY_EXISTS', 'Ya existe una categoría con ese nombre.');
  const id = existing ? String(existing.CATEGORIA_ID) : 'CAT-' + uuid_();
  const data = { CATEGORIA_ID: id, NOMBRE: name, ACTIVA: input.active !== false, PROVEEDORES_JSON: JSON.stringify(input.supplierIds || []), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId };
  if (existing) updateObjectRow_(APP.SHEETS.CATEGORIES, existing.__row, data); else appendObject_(APP.SHEETS.CATEGORIES, data);
  logEvent_('INFO', existing ? 'CATEGORIA_ACTUALIZADA' : 'CATEGORIA_CREADA', id, name, {}, '', requestId, user);
  return categoryFromRow_(safeRows_(APP.SHEETS.CATEGORIES).find(function (row) { return String(row.CATEGORIA_ID) === id; }));
}

function buildMonthlyClose_(period) {
  const month = String(period || '').match(/^\d{4}-\d{2}$/) ? String(period) : Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM');
  const invoices = safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_).filter(function (invoice) { return invoice.status === 'PROCESADA' && invoice.date.slice(0, 7) === month; });
  const documents = safeRows_(APP.SHEETS.DOCUMENTS).map(documentFromRow_).filter(function (document) { return (document.invoiceDate || document.emailDate).slice(0, 7) === month && document.phase !== 'FINALIZADO' && document.phase !== 'CANCELADO'; });
  const movements = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.FECHA_OPERACION || '').slice(0, 7) === month && String(row.ESTADO_IMPORTACION) === 'CONFIRMADA'; });
  const categoryMap = categories_().reduce(function (map, category) { map[category.id] = category.name; return map; }, {});
  const grouped = {};
  invoices.forEach(function (invoice) { const id = invoice.categoryId || ''; if (!grouped[id]) grouped[id] = { categoryId: id, category: categoryMap[id] || 'Sin categoría', count: 0, total: 0 }; grouped[id].count += 1; grouped[id].total += Number(invoice.total || 0); });
  const taxSummary = invoices.reduce(function (sum, invoice) { sum.base += Number(invoice.taxableBase || 0); (invoice.taxLines || []).forEach(function (line) { if (String(line.kind) === 'RETENCION') sum.withholdings += Math.abs(Number(line.amount || 0)); else sum.taxes += Number(line.amount || 0); }); sum.total += Number(invoice.total || 0); return sum; }, { base: 0, taxes: 0, withholdings: 0, total: 0 });
  const reconciled = invoices.filter(function (invoice) { return invoice.reconciliationStatus === 'CONCILIADA'; }).length;
  const partial = invoices.filter(function (invoice) { return invoice.reconciliationStatus === 'PARCIALMENTE CONCILIADA'; }).length;
  const excluded = movements.filter(function (row) { return String(row.ESTADO_CONCILIACION) === 'EXCLUIDA CON MOTIVO'; }).length;
  const withoutInvoice = movements.filter(function (row) { return ['MOVIMIENTO SIN FACTURA', 'SIN CONCILIAR'].indexOf(String(row.ESTADO_CONCILIACION)) !== -1; }).length;
  const warnings = [];
  const coverages = movements.map(function (row) { return String(row.COBERTURA || ''); });
  if (coverages.some(function (coverage) { return normalizeText_(coverage).indexOf('parcial') !== -1; })) warnings.push('El periodo contiene al menos un extracto de cobertura parcial.');
  if (documents.length) warnings.push(documents.length + ' documentos siguen en revisión.');
  if (withoutInvoice) warnings.push(withoutInvoice + ' movimientos no tienen justificante asociado.');
  if (invoices.some(function (invoice) { return !invoice.categoryId; })) warnings.push('Hay facturas sin categoría de gasto.');
  return { period: month, coverage: coverages.length ? coverages[0] : 'Sin extracto confirmado', invoices: invoices.length, reviews: documents.length, reconciled: reconciled, partial: partial, excluded: excluded, movementsWithoutInvoice: withoutInvoice, invoicesWithoutMovement: invoices.filter(function (invoice) { return !invoice.reconciliationStatus || invoice.reconciliationStatus === 'SIN CONCILIAR'; }).length, taxableBase: centsNumber_(taxSummary.base), taxes: centsNumber_(taxSummary.taxes), withholdings: centsNumber_(taxSummary.withholdings), total: centsNumber_(taxSummary.total), warnings: warnings, byCategory: Object.keys(grouped).map(function (id) { grouped[id].total = centsNumber_(grouped[id].total); return grouped[id]; }) };
}

function createAccountantExport_(payload, user, requestId) {
  if (String(payload.confirmation || '') !== 'GENERAR_EXPORTACION_GESTORIA') throw appError_('CONFIRMATION_REQUIRED', 'Confirma la generación de la entrega para gestoría.');
  const period = String(payload.period || '');
  if (!/^\d{4}-\d{2}$/.test(period)) throw appError_('INVALID_PERIOD', 'El periodo debe tener formato AAAA-MM.');
  const prior = safeRows_(APP.SHEETS.EXPORTS).find(function (row) { return String(row.REQUEST_ID) === String(requestId); });
  if (prior) return exportFromRow_(prior);
  const exportId = 'EXP-' + period.replace('-', '') + '-' + uuid_().slice(0, 6);
  const createdAt = nowIso_();
  appendObject_(APP.SHEETS.EXPORTS, { EXPORTACION_ID: exportId, PERIODO: period, COBERTURA: String(payload.coverage || ''), ESTADO: 'GENERANDO', CREADO_EN: createdAt, CREADO_POR: user, REQUEST_ID: requestId });
  try {
    const invoices = safeRows_(APP.SHEETS.INVOICES).map(invoiceFromRow_).filter(function (invoice) { return invoice.status === 'PROCESADA' && invoice.date.slice(0, 7) === period; });
    const movements = safeRows_(APP.SHEETS.MOVEMENTS).filter(function (row) { return String(row.FECHA_OPERACION || '').slice(0, 7) === period && String(row.ESTADO_IMPORTACION) === 'CONFIRMADA'; });
    const links = safeRows_(APP.SHEETS.RECONCILIATIONS).filter(function (row) { return String(row.ESTADO) === 'CONFIRMADA' && String(row.DECIDIDO_EN || row.CREADO_EN).slice(0, 7) === period; });
    const close = buildMonthlyClose_(period);
    const spreadsheet = SpreadsheetApp.create('ReparaPRO - Gestoría - ' + period);
    writeExportSheet_(spreadsheet.getSheets()[0], 'Facturas', ['Fecha', 'Proveedor', 'CIF/NIF', 'Número', 'Categoría', 'Base', 'Total', 'Moneda', 'Conciliación'], invoices.map(function (invoice) { return [invoice.date, invoice.supplier, invoice.taxId, invoice.number, invoice.categoryId, invoice.taxableBase || '', invoice.total, invoice.currency, invoice.reconciliationStatus || 'SIN CONCILIAR']; }));
    writeExportSheet_(spreadsheet.insertSheet(), 'Impuestos', ['Factura', 'Tipo', 'Base', 'Tipo %', 'Cuota'], invoices.reduce(function (rows, invoice) { (invoice.taxLines || []).forEach(function (line) { rows.push([invoice.number, line.kind, line.base, line.rate, line.amount]); }); return rows; }, []));
    writeExportSheet_(spreadsheet.insertSheet(), 'Conciliaciones', ['Movimiento', 'Factura', 'Importe asignado', 'Estado', 'Motivo'], links.map(function (row) { return [row.MOVIMIENTO_ID, row.FACTURA_ID, Number(row.IMPORTE_ASIGNADO || 0), row.ESTADO, row.MOTIVO || '']; }));
    writeExportSheet_(spreadsheet.insertSheet(), 'Sin justificante', ['Fecha', 'Concepto', 'Importe', 'Moneda', 'Estado'], movements.filter(function (row) { return ['MOVIMIENTO SIN FACTURA', 'SIN CONCILIAR'].indexOf(String(row.ESTADO_CONCILIACION)) !== -1; }).map(function (row) { return [row.FECHA_OPERACION, row.CONCEPTO, row.IMPORTE, row.MONEDA, row.ESTADO_CONCILIACION]; }));
    writeExportSheet_(spreadsheet.insertSheet(), 'Resumen', ['Categoría', 'Facturas', 'Total'], close.byCategory.map(function (item) { return [item.category, item.count, item.total]; }));
    SpreadsheetApp.flush();
    const rootMeta = Drive.Files.get(APP.SPREADSHEET_ID, { fields: 'parents' });
    const accountingRoot = rootMeta.parents && rootMeta.parents[0] ? rootMeta.parents[0] : APP.BANK_FOLDER_ID;
    let folder = ensureFolder_(accountingRoot, 'EXPORTACIONES GESTORÍA'); folder = ensureFolder_(folder, period.slice(0, 4)); folder = ensureFolder_(folder, period.slice(5, 7));
    const xlsxBlob = Drive.Files.export(spreadsheet.getId(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setName('ReparaPRO - Gestoría - ' + period + '.xlsx');
    const manifest = { exportId: exportId, period: period, coverage: String(payload.coverage || close.coverage), generatedAt: createdAt, generatedBy: user, invoices: invoices.map(function (invoice) { return { id: invoice.id, hash: invoice.hash, file: invoice.originalName }; }), warnings: close.warnings };
    const manifestText = JSON.stringify(manifest, null, 2);
    const manifestHash = bytesHash_(Utilities.newBlob(manifestText).getBytes());
    const blobs = [xlsxBlob, Utilities.newBlob(manifestText, 'application/json', 'manifest-' + period + '.json')];
    invoices.forEach(function (invoice) { if (invoice.driveUrl) { const match = String(invoice.driveUrl).match(/[-\w]{25,}/); if (match) try { blobs.push(DriveApp.getFileById(match[0]).getBlob().setName(invoice.originalName || invoice.number + '.pdf')); } catch (_) {} } });
    const files = [];
    splitBlobs_(blobs, 35 * 1024 * 1024).forEach(function (part, index) { const zip = Utilities.zip(part, 'ReparaPRO-Gestoria-' + period + (part.length === blobs.length ? '' : '-parte-' + (index + 1)) + '.zip'); const file = Drive.Files.create({ name: zip.getName(), parents: [folder], mimeType: 'application/zip' }, zip, { fields: 'id,name,size,webViewLink' }); files.push({ name: file.name, url: file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view', size: Number(file.size || zip.getBytes().length) }); });
    try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (_) {}
    const exportRow = safeRows_(APP.SHEETS.EXPORTS).find(function (row) { return String(row.EXPORTACION_ID) === exportId; });
    const folderUrl = 'https://drive.google.com/drive/folders/' + folder;
    updateObjectRow_(APP.SHEETS.EXPORTS, exportRow.__row, { ESTADO: 'COMPLETADA', CARPETA_ID: folder, CARPETA_URL: folderUrl, ARCHIVOS_JSON: JSON.stringify(files), MANIFEST_HASH: manifestHash, ERROR: '' });
    logEvent_('INFO', 'EXPORTACION_GESTORIA_CREADA', exportId, period, { files: files.length, invoices: invoices.length, manifestHash: manifestHash }, '', requestId, user);
    return exportFromRow_(safeRows_(APP.SHEETS.EXPORTS).find(function (row) { return String(row.EXPORTACION_ID) === exportId; }));
  } catch (error) {
    const failed = safeRows_(APP.SHEETS.EXPORTS).find(function (row) { return String(row.EXPORTACION_ID) === exportId; });
    if (failed) updateObjectRow_(APP.SHEETS.EXPORTS, failed.__row, { ESTADO: 'ERROR', ERROR: error.message || String(error) });
    throw error;
  }
}

function writeExportSheet_(sheet, name, headers, rows) { sheet.setName(name); sheet.clear(); sheet.getRange(1, 1, 1, headers.length).setValues([headers]); if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows); sheet.setFrozenRows(1); }
function splitBlobs_(blobs, maxBytes) { const parts = []; let current = []; let size = 0; blobs.forEach(function (blob) { const bytes = blob.getBytes().length; if (current.length && size + bytes > maxBytes) { parts.push(current); current = []; size = 0; } current.push(blob); size += bytes; }); if (current.length) parts.push(current); return parts; }
function centsNumber_(value) { return Math.round(Number(value || 0) * 100) / 100; }
