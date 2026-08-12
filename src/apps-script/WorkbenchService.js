function v19DateShift_(value, days) {
  const parsed = parseDate_(value);
  if (!parsed) return '';
  const parts = parsed.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)));
  return [date.getUTCFullYear(), ('0' + (date.getUTCMonth() + 1)).slice(-2), ('0' + date.getUTCDate()).slice(-2)].join('-');
}

function v19Today_() { return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd'); }

function v19WeekStart_(value) {
  const parsed = parseDate_(value) || v19Today_();
  const parts = parsed.split('-').map(Number);
  const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return v19DateShift_(parsed, day === 0 ? -6 : 1 - day);
}

function v19LastDayOfMonth_(value) {
  const parsed = parseDate_(value);
  if (!parsed) return '';
  const parts = parsed.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1], 0));
  return [date.getUTCFullYear(), ('0' + (date.getUTCMonth() + 1)).slice(-2), ('0' + date.getUTCDate()).slice(-2)].join('-');
}

function v19ClipSegment_(segment, from, to) {
  const start = segment.from < from ? from : segment.from;
  const end = segment.to > to ? to : segment.to;
  if (!start || !end || start > end) return null;
  return Object.assign({}, segment, { from: start, to: end });
}

function v19CoveragePriority_(status) {
  return { 'COMPLETA': 4, 'PARCIAL': 3, 'CON HUECOS': 2, 'SIN REVISAR': 1 }[String(status || '').toUpperCase()] || 0;
}

function v19MergeCoverage_(segments) {
  const ordered = (segments || []).filter(function (item) { return item && item.from && item.to; }).sort(function (a, b) { return a.from.localeCompare(b.from) || a.to.localeCompare(b.to); });
  if (!ordered.length) return [];
  const merged = [];
  let cursor = ordered[0].from;
  const end = ordered.reduce(function (latest, segment) { return segment.to > latest ? segment.to : latest; }, ordered[0].to);
  while (cursor <= end) {
    const matches = ordered.filter(function (segment) { return segment.from <= cursor && segment.to >= cursor; }).sort(function (a, b) { return v19CoveragePriority_(b.status) - v19CoveragePriority_(a.status) || String(b.createdAt || b.id || '').localeCompare(String(a.createdAt || a.id || '')); });
    if (!matches.length) { cursor = v19DateShift_(cursor, 1); continue; }
    const segment = Object.assign({}, matches[0], { from: cursor, to: cursor, batchIds: matches.filter(function (item) { return item.status === matches[0].status; }).reduce(function (ids, item) { return ids.concat(item.batchIds || []); }, []).filter(function (id, index, list) { return id && list.indexOf(id) === index; }) });
    const current = merged[merged.length - 1];
    const sameSourceRecord = String(current && current.importId || '') === String(segment.importId || '');
    if (!current || current.status !== segment.status || !sameSourceRecord || segment.from !== v19DateShift_(current.to, 1)) {
      merged.push(Object.assign({}, segment, { batchIds: (segment.batchIds || []).slice() }));
    } else {
      current.to = segment.to;
      current.batchIds = current.batchIds.concat(segment.batchIds || []).filter(function (id, index, list) { return id && list.indexOf(id) === index; });
    }
    cursor = v19DateShift_(cursor, 1);
  }
  return merged;
}

function v19InsertCoverageGaps_(segments, from, to, sourceId, sourceType, sourceName, includeEdges) {
  const result = [];
  let cursor = includeEdges ? from : (segments.length ? segments[0].from : '');
  (segments || []).forEach(function (segment) {
    if (cursor && cursor < segment.from) result.push({ id: 'GAP-' + sourceId + '-' + cursor, sourceId: sourceId, sourceType: sourceType, sourceName: sourceName, from: cursor, to: v19DateShift_(segment.from, -1), status: 'SIN REVISAR', detail: 'No hay una cobertura acreditada para este intervalo.', batchIds: [], route: sourceType === 'GMAIL' ? 'process' : 'bank' });
    result.push(segment);
    cursor = v19DateShift_(segment.to, 1);
  });
  if (includeEdges && cursor && cursor <= to) result.push({ id: 'GAP-' + sourceId + '-' + cursor, sourceId: sourceId, sourceType: sourceType, sourceName: sourceName, from: cursor, to: to, status: 'SIN REVISAR', detail: 'No hay una cobertura acreditada para este intervalo.', batchIds: [], route: sourceType === 'GMAIL' ? 'process' : 'bank' });
  return result;
}

function v19GmailCoverage_(from, to, seed) {
  const batches = seed && seed.batchRows || safeRows_(APP.SHEETS.BATCHES);
  const documents = seed && seed.documentRows || safeRows_(APP.SHEETS.DOCUMENTS);
  const logs = seed && seed.logRows || safeRows_(APP.SHEETS.LOG);
  const completionByBatch = {};
  logs.forEach(function (row) {
    if (String(row['ACCIÓN'] || '') !== 'LOTE_ANALIZADO') return;
    const data = safeJsonParse_(row.DATOS_JSON, {});
    completionByBatch[String(row.LOTE_ID || '')] = Boolean(data.exhaustedRange);
  });
  const documentsByBatch = {};
  documents.forEach(function (row) {
    const id = String(row.LOTE_ID || '');
    const date = parseDate_(row.FECHA_CORREO);
    if (id && date && (!documentsByBatch[id] || date > documentsByBatch[id])) documentsByBatch[id] = date;
  });
  const raw = [];
  batches.forEach(function (row) {
    if (String(row.TIPO || 'GMAIL') !== 'GMAIL' || normalizeText_(row.ESTADO) === 'cancelado') return;
    const batchId = String(row.LOTE_ID || '');
    const batchFrom = parseDate_(row.FECHA_DESDE);
    const batchTo = parseDate_(row.FECHA_HASTA);
    if (!batchFrom || !batchTo) return;
    const searchDate = parseDate_(row.FECHA_BUSQUEDA) || documentsByBatch[batchId] || batchFrom;
    const exhausted = completionByBatch[batchId] || searchDate > batchTo;
    const coveredTo = exhausted ? batchTo : (searchDate > batchTo ? batchTo : searchDate);
    const normalizedState = normalizeText_(row.ESTADO);
    const status = /error|interrumpido/.test(normalizedState) ? 'CON HUECOS' : exhausted ? 'COMPLETA' : 'PARCIAL';
    const clipped = v19ClipSegment_({ id: 'GMAIL-' + batchId, sourceId: 'gmail', sourceType: 'GMAIL', sourceName: 'Gmail', from: batchFrom, to: coveredTo, status: status, detail: exhausted ? 'Rango recorrido por completo.' : 'El recorrido se detuvo dentro del intervalo y debe continuar desde el cursor.', batchIds: [batchId], route: 'process' }, from, to);
    if (clipped) raw.push(clipped);
  });
  (seed && seed.coverageRows || safeRows_(APP.SHEETS.COVERAGES)).map(coverageFromRow_).filter(function (item) { return item.sourceType === 'GMAIL'; }).forEach(function (item) {
    const clipped = v19ClipSegment_(Object.assign({}, item, { sourceId: item.sourceId || 'gmail', sourceName: item.sourceName || 'Gmail', route: 'process' }), from, to);
    if (clipped) raw.push(clipped);
  });
  return v19InsertCoverageGaps_(v19MergeCoverage_(raw), from, to, 'gmail', 'GMAIL', 'Gmail', true);
}

function v19BankCoverage_(from, to, seed) {
  const rows = seed && seed.movementRows || safeRows_(APP.SHEETS.MOVEMENTS);
  const imports = {};
  rows.forEach(function (row) {
    const importId = String(row.IMPORT_ID || '');
    if (!importId || String(row.ESTADO_IMPORTACION || '') === 'CANCELADA') return;
    if (!imports[importId]) imports[importId] = { first: row, count: 0 };
    imports[importId].count += 1;
  });
  const lanes = {};
  Object.keys(imports).forEach(function (importId) {
    const entry = imports[importId];
    const row = entry.first;
    const sourceName = String(row.FUENTE || 'Banco');
    const sourceId = normalizeText_(sourceName).replace(/\s+/g, '-') || 'banco';
    const periodFrom = parseDate_(row.PERIODO_DETECTADO_DESDE) || parseDate_(row.PERIODO_DESDE);
    const periodTo = parseDate_(row.PERIODO_DETECTADO_HASTA) || parseDate_(row.PERIODO_HASTA);
    const warnings = safeJsonParse_(row.ADVERTENCIAS_JSON, []);
    const partial = normalizeText_(row.COBERTURA).indexOf('parcial') !== -1;
    const completeMonth = periodFrom && periodTo && periodFrom.slice(-2) === '01' && periodTo === v19LastDayOfMonth_(periodTo);
    const confirmed = String(row.ESTADO_IMPORTACION || '') === 'CONFIRMADA';
    const status = warnings.length ? 'CON HUECOS' : confirmed && !partial && completeMonth ? 'COMPLETA' : 'PARCIAL';
    const clipped = v19ClipSegment_({ id: 'BANK-' + importId, sourceId: sourceId, sourceType: 'BANK', sourceName: sourceName, from: periodFrom, to: periodTo, status: status, detail: confirmed ? String(row.COBERTURA || 'Extracto archivado') : 'Vista previa pendiente de archivo; todavía no acredita el cierre.', batchIds: [], importId: importId, movementCount: entry.count, route: 'bank' }, from, to);
    if (!clipped) return;
    if (!lanes[sourceId]) lanes[sourceId] = { id: sourceId, name: sourceName, segments: [] };
    lanes[sourceId].segments.push(clipped);
  });
  (seed && seed.coverageRows || safeRows_(APP.SHEETS.COVERAGES)).map(coverageFromRow_).filter(function (item) { return item.sourceType === 'BANK'; }).forEach(function (item) {
    const sourceName = item.sourceName || 'Banco';
    const sourceId = item.sourceId || normalizeText_(sourceName).replace(/\s+/g, '-') || 'banco';
    const clipped = v19ClipSegment_(Object.assign({}, item, { sourceId: sourceId, sourceName: sourceName, route: 'bank' }), from, to);
    if (!clipped) return;
    if (!lanes[sourceId]) lanes[sourceId] = { id: sourceId, name: sourceName, segments: [] };
    lanes[sourceId].segments.push(clipped);
  });
  return Object.keys(lanes).sort().map(function (key) {
    const lane = lanes[key];
    lane.segments = v19InsertCoverageGaps_(v19MergeCoverage_(lane.segments), from, to, lane.id, 'BANK', lane.name, true);
    return lane;
  });
}

function buildCoverageMap_(payload, seed) {
  payload = payload || {};
  const from = parseDate_(payload.from) || APP.START_DATE;
  const to = parseDate_(payload.to) || v19Today_();
  if (from > to) throw appError_('INVALID_COVERAGE_RANGE', 'La fecha inicial de cobertura debe ser anterior o igual a la final.');
  const gmailSegments = v19GmailCoverage_(from, to, seed);
  const bankLanes = v19BankCoverage_(from, to, seed);
  const lanes = [{ id: 'gmail', type: 'GMAIL', name: 'Gmail', segments: gmailSegments }].concat(bankLanes.map(function (lane) { return { id: lane.id, type: 'BANK', name: lane.name, segments: lane.segments }; }));
  const batches = seed && seed.batchRows || safeRows_(APP.SHEETS.BATCHES);
  const activeStates = ['borrador', 'analizando', 'pendiente de aprobacion', 'ejecutando', 'interrumpido', 'completado con errores'];
  const active = batches.filter(function (row) { return String(row.TIPO || 'GMAIL') === 'GMAIL' && activeStates.indexOf(normalizeText_(row.ESTADO)) !== -1; }).slice(-1)[0];
  const firstGap = gmailSegments.find(function (segment) { return segment.status === 'SIN REVISAR' || segment.status === 'CON HUECOS' || segment.status === 'PARCIAL'; });
  const pending = active ? safeJsonParse_(active.PENDING_MESSAGE_IDS_JSON, []) : [];
  const latestBatch = batches.filter(function (row) { return String(row.TIPO || 'GMAIL') === 'GMAIL' && normalizeText_(row.ESTADO) !== 'cancelado'; }).sort(function (a, b) { return String(b.CREADO_EN || '').localeCompare(String(a.CREADO_EN || '')); })[0];
  const latestLog = latestBatch ? (seed && seed.logRows || safeRows_(APP.SHEETS.LOG)).filter(function (row) { return String(row.LOTE_ID || '') === String(latestBatch.LOTE_ID || '') && String(row['ACCIÓN'] || '') === 'LOTE_ANALIZADO'; }).slice(-1)[0] : null;
  const latestExhausted = latestLog ? Boolean(safeJsonParse_(latestLog.DATOS_JSON, {}).exhaustedRange) : false;
  const latestPending = latestBatch ? safeJsonParse_(latestBatch.PENDING_MESSAGE_IDS_JSON, []) : [];
  const continuationBatch = !active && latestBatch && !latestExhausted ? latestBatch : null;
  const nextGmailCursor = active ? { date: parseDate_(active.FECHA_BUSQUEDA) || parseDate_(active.FECHA_DESDE), batchId: String(active.LOTE_ID || ''), pendingMessageId: pending.length ? String(pending[0]) : undefined, pendingMessages: pending.length, label: pending.length ? 'Continuar con el siguiente correo pendiente de este día.' : 'Continuar el recorrido cronológico desde este día.' } : continuationBatch ? { date: parseDate_(continuationBatch.FECHA_BUSQUEDA) || parseDate_(continuationBatch.FECHA_DESDE), pendingMessages: latestPending.length, label: latestPending.length ? 'Iniciar el siguiente lote con los correos pendientes de este día.' : 'Iniciar el siguiente lote desde el cursor alcanzado por el último recorrido.' } : firstGap ? { date: firstGap.from, pendingMessages: 0, label: 'Iniciar el siguiente lote en el primer intervalo sin revisar.' } : null;
  const warnings = [];
  if (gmailSegments.some(function (segment) { return segment.status === 'SIN REVISAR'; })) warnings.push('Gmail contiene intervalos sin revisar; las fechas cubiertas se muestran por separado.');
  if (gmailSegments.some(function (segment) { return segment.status === 'PARCIAL' || segment.status === 'CON HUECOS'; })) warnings.push('Existe al menos un recorrido de Gmail parcial o interrumpido.');
  bankLanes.forEach(function (lane) { if (lane.segments.some(function (segment) { return segment.status !== 'COMPLETA'; })) warnings.push(lane.name + ' no acredita una cobertura completa para todos sus intervalos visibles.'); });
  return { from: from, to: to, lanes: lanes, nextGmailCursor: nextGmailCursor, warnings: warnings };
}

function v19SupplierInvoiceCount_(providerRow, invoiceRows) {
  const names = [String(providerRow.PROVEEDOR || '')].concat(String(providerRow.ALIASES || '').split(';')).map(normalizeText_).filter(Boolean);
  const taxId = String(providerRow.CIF_NIF || '').trim().toUpperCase();
  return (invoiceRows || []).filter(function (row) {
    if (String(row.ESTADO || '') !== 'PROCESADA') return false;
    return names.indexOf(normalizeText_(row.PROVEEDOR)) !== -1 || Boolean(taxId && String(row.CIF_NIF || '').trim().toUpperCase() === taxId);
  }).length;
}

function v19LatestSupplierInvoiceMonth_(providerRow, invoiceRows) {
  const names = [String(providerRow.PROVEEDOR || '')].concat(String(providerRow.ALIASES || '').split(';')).map(normalizeText_).filter(Boolean);
  const taxId = String(providerRow.CIF_NIF || '').trim().toUpperCase();
  const dates = (invoiceRows || []).filter(function (invoice) {
    if (String(invoice.ESTADO || '') !== 'PROCESADA') return false;
    return names.indexOf(normalizeText_(invoice.PROVEEDOR)) !== -1 || Boolean(taxId && String(invoice.CIF_NIF || '').trim().toUpperCase() === taxId);
  }).map(function (invoice) { return parseDate_(invoice.FECHA_FACTURA); }).filter(Boolean).sort();
  return dates.length ? Number(dates[dates.length - 1].slice(5, 7)) : 0;
}

function v19ScheduleApplies_(frequency, anchorMonth, month) {
  if (frequency === 'MONTHLY') return true;
  if (!anchorMonth) return false;
  if (frequency === 'QUARTERLY') return (month - anchorMonth + 12) % 3 === 0;
  if (frequency === 'ANNUAL') return month === anchorMonth;
  return false;
}

function v19ExpectedDocuments_(weekStart, weekEnd, seed) {
  const providers = seed && seed.providerRows || safeRows_(APP.SHEETS.PROVIDERS);
  const invoices = seed && seed.invoiceRows || safeRows_(APP.SHEETS.INVOICES);
  const periods = [];
  let period = weekStart.slice(0, 7);
  const finalPeriod = weekEnd.slice(0, 7);
  while (period <= finalPeriod) {
    periods.push(period);
    const next = v19DateShift_(period + '-01', 32).slice(0, 7);
    period = next;
  }
  const result = [];
  providers.filter(function (row) { return toBoolean_(row.ACTIVO); }).forEach(function (provider) {
    const frequency = String(provider.FRECUENCIA_ESPERADA || 'NONE').toUpperCase();
    const day = Number(provider.DIA_ESPERADO || 0);
    const anchor = Number(provider.MES_ANCLA || 0);
    if (frequency === 'NONE' || day < 1 || day > 31) return;
    const excluded = safeJsonParse_(provider.PERIODOS_EXCLUIDOS_JSON, []);
    periods.forEach(function (monthKey) {
      const month = Number(monthKey.slice(5, 7));
      if (!v19ScheduleApplies_(frequency, anchor, month)) return;
      const expectedDate = monthKey + '-' + ('0' + Math.min(day, Number(v19LastDayOfMonth_(monthKey + '-01').slice(-2)))).slice(-2);
      if (expectedDate > weekEnd) return;
      const names = [String(provider.PROVEEDOR || '')].concat(String(provider.ALIASES || '').split(';')).map(normalizeText_).filter(Boolean);
      const received = invoices.filter(function (row) { return String(row.ESTADO || '') === 'PROCESADA' && parseDate_(row.FECHA_FACTURA).slice(0, 7) === monthKey && names.indexOf(normalizeText_(row.PROVEEDOR)) !== -1; });
      const status = excluded.indexOf(monthKey) !== -1 ? 'SKIPPED' : received.length ? 'RECEIVED' : 'EXPECTED';
      result.push({ id: 'EXPECTED-' + String(provider.ID_PROVEEDOR || ('legacy-' + provider.__row)) + '-' + monthKey, supplierId: String(provider.ID_PROVEEDOR || ('legacy-' + provider.__row)), supplierName: String(provider.PROVEEDOR || ''), expectedDate: expectedDate, dueDate: received.length ? parseDate_(received[0].FECHA_VENCIMIENTO) || undefined : undefined, frequency: frequency, status: status, detail: status === 'RECEIVED' ? 'Documento localizado en el histórico procesado.' : status === 'SKIPPED' ? 'Marcado como no esperado para este periodo.' : 'Documento recurrente esperado y todavía no localizado.' });
    });
  });
  return result.sort(function (a, b) { return a.expectedDate.localeCompare(b.expectedDate) || a.supplierName.localeCompare(b.supplierName); });
}

function buildWeeklyWorkbench_(payload, seed) {
  payload = payload || {};
  const weekStart = v19WeekStart_(payload.weekStart);
  const weekEnd = v19DateShift_(weekStart, 6);
  const documentRows = seed && seed.documentRows || safeRows_(APP.SHEETS.DOCUMENTS);
  const movementRows = seed && seed.movementRows || safeRows_(APP.SHEETS.MOVEMENTS);
  const batchRows = seed && seed.batchRows || safeRows_(APP.SHEETS.BATCHES);
  const reviewRows = documentRows.filter(function (row) { return ['EN REVISIÓN', 'ERROR', 'LISTO PARA APROBAR'].indexOf(String(row.FASE || '')) !== -1; });
  const invalidInvoices = reviewRows.filter(function (row) { return String(row.FASE || '') === 'ERROR' || safeJsonParse_(row.ERRORES_VALIDACION_JSON, []).length > 0; }).length;
  const unidentifiedSuppliers = reviewRows.filter(function (row) { return !String(row.PROVEEDOR_ID || '') && String(row.ESTADO_PROPUESTO || '') !== 'NO ES FACTURA' && String(row.ESTADO_PROPUESTO || '') !== 'FACTURA DE VENTA'; }).length;
  const pendingReconciliations = movementRows.filter(function (row) { return String(row.ESTADO_IMPORTACION || '') === 'CONFIRMADA' && String(row.ESTADO_CONCILIACION || '') === 'CANDIDATA PENDIENTE'; }).length;
  const movementsWithoutInvoice = movementRows.filter(function (row) { return String(row.ESTADO_IMPORTACION || '') === 'CONFIRMADA' && ['MOVIMIENTO SIN FACTURA', 'SIN COINCIDENCIA EN ESTA COBERTURA'].indexOf(String(row.ESTADO_CONCILIACION || '')) !== -1; }).length;
  const activeStates = ['borrador', 'analizando', 'pendiente de aprobacion', 'ejecutando', 'interrumpido', 'completado con errores'];
  const active = batchRows.filter(function (row) { return String(row.TIPO || 'GMAIL') === 'GMAIL' && activeStates.indexOf(normalizeText_(row.ESTADO)) !== -1; }).slice(-1)[0];
  const pendingIds = active ? safeJsonParse_(active.PENDING_MESSAGE_IDS_JSON, []).concat(safeJsonParse_(active.PENDING_SCAN_IDS_JSON, []), safeJsonParse_(active.CANDIDATOS_DIA_JSON, [])) : [];
  const expectedDocuments = v19ExpectedDocuments_(weekStart, weekEnd, seed);
  const expectedMissing = expectedDocuments.filter(function (item) { return item.status === 'EXPECTED'; });
  const coverage = buildCoverageMap_({ from: APP.START_DATE, to: weekEnd }, seed);
  const coverageBlockers = coverage.lanes.reduce(function (count, lane) { return count + lane.segments.filter(function (segment) { return segment.to >= weekStart.slice(0, 7) + '-01' && segment.status !== 'COMPLETA'; }).length; }, 0);
  const closeBlockers = reviewRows.length + pendingReconciliations + movementsWithoutInvoice + coverageBlockers;
  const counters = { emailsPendingAnalysis: pendingIds.length, invalidInvoices: invalidInvoices, unidentifiedSuppliers: unidentifiedSuppliers, pendingReconciliations: pendingReconciliations, movementsWithoutInvoice: movementsWithoutInvoice, monthlyCloseBlockers: closeBlockers };
  const tasks = [];
  if (active) tasks.push({ id: 'CAPTURE-' + String(active.LOTE_ID || ''), step: 'CAPTURE', priority: 'HIGH', title: 'Continuar el lote de correo', detail: coverage.nextGmailCursor ? coverage.nextGmailCursor.label + ' Fecha: ' + coverage.nextGmailCursor.date + '.' : 'El lote conserva un punto de continuación.', count: Math.max(pendingIds.length, 1), route: 'process', actionLabel: 'Continuar análisis', entityId: String(active.LOTE_ID || '') });
  if (expectedMissing.length) tasks.push({ id: 'EXPECTED-DOCUMENTS', step: 'CAPTURE', priority: 'MEDIUM', title: 'Buscar documentos recurrentes esperados', detail: expectedMissing.length + ' documentos esperados todavía no se han localizado.', count: expectedMissing.length, route: 'process', actionLabel: 'Buscar en Gmail' });
  if (reviewRows.length) tasks.push({ id: 'VALIDATE-DOCUMENTS', step: 'VALIDATE', priority: 'HIGH', title: 'Resolver la bandeja de validación', detail: invalidInvoices + ' documentos tienen datos inválidos y ' + unidentifiedSuppliers + ' no tienen proveedor identificado.', count: reviewRows.length, route: 'review', actionLabel: 'Abrir revisión' });
  if (pendingReconciliations) tasks.push({ id: 'RECONCILE-CANDIDATES', step: 'RECONCILE', priority: 'MEDIUM', title: 'Decidir propuestas de conciliación', detail: 'Las propuestas necesitan confirmación humana.', count: pendingReconciliations, route: 'bank', actionLabel: 'Revisar propuestas' });
  if (movementsWithoutInvoice) tasks.push({ id: 'RECONCILE-UNMATCHED', step: 'RECONCILE', priority: 'MEDIUM', title: 'Revisar movimientos sin justificante', detail: 'No se encontró coincidencia dentro de la cobertura disponible; esto no permite afirmar su estado de pago.', count: movementsWithoutInvoice, route: 'bank', actionLabel: 'Revisar movimientos' });
  tasks.push({ id: 'MONTHLY-CLOSE', step: 'CLOSE', priority: closeBlockers ? 'LOW' : 'MEDIUM', title: closeBlockers ? 'El cierre mensual tiene bloqueos' : 'El periodo está listo para comprobar el cierre', detail: closeBlockers ? closeBlockers + ' comprobaciones siguen pendientes.' : 'No hay bloqueos calculados; revisa el resumen antes de exportar.', count: closeBlockers, route: 'close', actionLabel: closeBlockers ? 'Ver bloqueos' : 'Preparar cierre' });
  const stepCounts = { CAPTURE: (active ? Math.max(pendingIds.length, 1) : 0) + expectedMissing.length, VALIDATE: reviewRows.length, RECONCILE: pendingReconciliations + movementsWithoutInvoice, CLOSE: closeBlockers };
  const steps = [
    { id: 'CAPTURE', label: 'Capturar', count: stepCounts.CAPTURE, status: stepCounts.CAPTURE ? 'READY' : 'DONE', route: 'process' },
    { id: 'VALIDATE', label: 'Validar', count: stepCounts.VALIDATE, status: stepCounts.VALIDATE ? 'READY' : 'DONE', route: 'review' },
    { id: 'RECONCILE', label: 'Conciliar', count: stepCounts.RECONCILE, status: stepCounts.RECONCILE ? 'READY' : 'DONE', route: 'bank' },
    { id: 'CLOSE', label: 'Cerrar', count: stepCounts.CLOSE, status: stepCounts.CLOSE ? 'BLOCKED' : 'READY', route: 'close' },
  ];
  return { weekStart: weekStart, weekEnd: weekEnd, generatedAt: nowIso_(), nextAction: tasks.find(function (task) { return task.step !== 'CLOSE' || !closeBlockers; }) || tasks[0] || null, steps: steps, counters: counters, tasks: tasks, expectedDocuments: expectedDocuments };
}

function v19Evidence_(kind, label, detail, matched) { return { kind: kind, label: label, detail: detail, matched: Boolean(matched) }; }

function applySupplierRules_(context, providers, ruleRows) {
  context = context || {};
  const email = String(context.senderEmail || '').trim().toLowerCase();
  const domain = email.indexOf('@') === -1 ? '' : email.split('@').pop();
  const activeRules = (ruleRows || safeRows_(APP.SHEETS.SUPPLIER_RULES)).map(supplierRuleFromRow_).filter(function (rule) { return rule.active; });
  const identityMatches = activeRules.filter(function (rule) {
    const pattern = String(rule.pattern || '').trim().toLowerCase();
    if (rule.type === 'SENDER_EMAIL') return Boolean(email && pattern && email === pattern);
    if (rule.type === 'EMAIL_DOMAIN') return Boolean(domain && pattern && (domain === pattern || domain.slice(-(pattern.length + 1)) === '.' + pattern));
    return false;
  });
  const supplierIds = identityMatches.map(function (rule) { return rule.supplierId; }).filter(function (id, index, list) { return id && list.indexOf(id) === index; });
  if (supplierIds.length !== 1) return null;
  const supplier = (providers || []).find(function (item) { return item.id === supplierIds[0] && item.active !== false; });
  if (!supplier) return null;
  const defaults = activeRules.filter(function (rule) { return rule.supplierId === supplier.id; });
  const categoryRule = defaults.find(function (rule) { return rule.type === 'DEFAULT_CATEGORY'; });
  const currencyRule = defaults.find(function (rule) { return rule.type === 'DEFAULT_CURRENCY'; });
  return { provider: supplier, source: 'REGLA CONFIRMADA', evidence: identityMatches.map(function (rule) { return rule.type + ': ' + rule.pattern; }).join(' · '), defaultCategoryId: categoryRule ? categoryRule.value : '', usualCurrency: currencyRule ? currencyRule.value : '', matchedRules: identityMatches.concat([categoryRule, currencyRule].filter(Boolean)).map(function (rule) { return rule.id; }) };
}

function v19ReconciliationRank_(movementRow, invoiceRow, assignedByInvoice, ruleRows) {
  const movementAmount = Math.abs(toCents_(movementRow.IMPORTE));
  const invoiceAmount = Math.abs(toCents_(invoiceRow.IMPORTE_TOTAL));
  const invoiceId = String(invoiceRow.ID_UNICO || '');
  const remaining = Math.max(invoiceAmount - Number(assignedByInvoice[invoiceId] || 0), 0);
  if (!movementAmount || !remaining || String(movementRow.MONEDA || '') !== String(invoiceRow.MONEDA || '')) return null;
  const movementSign = Math.sign(Number(movementRow.IMPORTE || 0));
  const invoiceSign = Math.sign(Number(invoiceRow.IMPORTE_TOTAL || 0));
  if (!movementSign || !invoiceSign || movementSign === invoiceSign) return null;
  const operationDate = parseDate_(movementRow.FECHA_OPERACION);
  const invoiceDate = parseDate_(invoiceRow.FECHA_FACTURA);
  const days = operationDate && invoiceDate ? Math.round(Math.abs(new Date(operationDate + 'T12:00:00Z').getTime() - new Date(invoiceDate + 'T12:00:00Z').getTime()) / 86400000) : 9999;
  const haystack = normalizeText_([movementRow.CONCEPTO, movementRow.REFERENCIA].join(' '));
  const supplier = normalizeText_(invoiceRow.PROVEEDOR);
  const supplierWords = supplier.split(' ').filter(function (word) { return word.length >= 4; });
  const supplierMatch = Boolean(supplier && (haystack.indexOf(supplier) !== -1 || supplierWords.some(function (word) { return haystack.indexOf(word) !== -1; })));
  const number = normalizeText_(invoiceRow['NÚMERO_FACTURA']);
  const referenceMatch = Boolean(number && number.length >= 4 && haystack.indexOf(number) !== -1);
  const supplierId = String(invoiceRow.PROVEEDOR_ID || '');
  const conceptRules = (ruleRows || []).map(supplierRuleFromRow_).filter(function (rule) { return rule.active && rule.type === 'BANK_CONCEPT' && Boolean(supplierId) && rule.supplierId === supplierId; });
  const matchedRule = conceptRules.find(function (rule) { const pattern = normalizeText_(rule.pattern || rule.value); return pattern.length >= 3 && haystack.indexOf(pattern) !== -1; });
  const difference = movementAmount - remaining;
  const exact = Math.abs(difference) <= 1;
  const partial = movementAmount < remaining - 1;
  if (!exact && !(partial && days <= 180 && (supplierMatch || referenceMatch || matchedRule))) return null;
  let score = 10;
  score += exact ? 45 : 20;
  score += days <= 14 ? 20 : days <= 62 ? 10 : days <= 120 ? 5 : 0;
  if (supplierMatch) score += 20;
  if (referenceMatch) score += 15;
  if (matchedRule) score += 25;
  const confidence = score >= 80 ? 'ALTA' : score >= 55 ? 'MEDIA' : 'BAJA';
  const evidence = [
    v19Evidence_('CURRENCY', 'Moneda', exact || partial ? 'Coincide ' + String(movementRow.MONEDA || '') + '.' : 'La moneda no coincide.', true),
    v19Evidence_('AMOUNT', 'Importe', exact ? 'Importe pendiente exacto.' : 'El movimiento podría ser un pago parcial; quedan ' + ((remaining - movementAmount) / 100).toFixed(2) + ' ' + String(movementRow.MONEDA || '') + '.', exact),
    v19Evidence_('DATE', 'Fecha', days === 9999 ? 'No hay fechas comparables.' : 'Diferencia de ' + days + ' días.', days <= 62),
    v19Evidence_('SUPPLIER', 'Proveedor', supplierMatch ? 'El proveedor aparece en el concepto o la referencia.' : 'El texto bancario no identifica al proveedor.', supplierMatch),
    v19Evidence_('REFERENCE', 'Número de factura', referenceMatch ? 'La referencia contiene el número de factura.' : 'No aparece el número de factura.', referenceMatch),
  ];
  if (matchedRule) evidence.push(v19Evidence_('RULE', 'Regla confirmada', 'Coincide con el texto bancario acreditado «' + String(matchedRule.pattern || matchedRule.value) + '». La regla solo propone esta relación.', true));
  return { invoiceRow: invoiceRow, confidence: confidence, score: score, evidence: evidence, difference: difference / 100, remaining: remaining / 100, exact: exact };
}

function v19CandidateStatus_(movementRow, reconciliationRow, candidateCount) {
  const reconciliationState = normalizeText_(reconciliationRow && reconciliationRow.ESTADO);
  const movementState = normalizeText_(movementRow.ESTADO_CONCILIACION);
  if (reconciliationState === 'confirmada') return 'CONFIRMED';
  if (!reconciliationRow && candidateCount === 1 && (movementState === 'conciliada' || movementState === 'coincidencia confirmada')) return 'CONFIRMED';
  if (reconciliationState === 'rechazada' || /excluid/.test(movementState)) return 'EXCLUDED';
  if (candidateCount !== 1 || /revision|parcial/.test(movementState)) return 'COMPLEX';
  return 'PENDING';
}

function v19SafeReconciliationLabel_(status, movementRow, invoice) {
  if (status === 'CONFIRMED') return String(movementRow.ESTADO_CONCILIACION || '') === 'PARCIALMENTE CONCILIADA' ? 'PARCIALMENTE CONCILIADA' : 'COINCIDENCIA CONFIRMADA';
  if (status === 'EXCLUDED') return 'PROPUESTA RECHAZADA O EXCLUIDA CON MOTIVO';
  if (!invoice) return 'SIN COINCIDENCIA EN ESTA COBERTURA';
  if (invoice.dueDate && invoice.dueDate < v19Today_()) return 'PAGO NO CONFIRMADO';
  return status === 'COMPLEX' ? 'REVISIÓN MANUAL' : 'CANDIDATA PENDIENTE';
}

function listReconciliationCandidates_(payload, seed) {
  payload = payload || {};
  const movementRows = seed && seed.movementRows || safeRows_(APP.SHEETS.MOVEMENTS);
  const invoiceRows = (seed && seed.invoiceRows || safeRows_(APP.SHEETS.INVOICES)).filter(function (row) { return String(row.ESTADO || '') === 'PROCESADA'; });
  const reconciliationRows = seed && seed.reconciliationRows || safeRows_(APP.SHEETS.RECONCILIATIONS);
  const ruleRows = seed && seed.ruleRows || safeRows_(APP.SHEETS.SUPPLIER_RULES);
  const providers = seed && seed.providerRows || safeRows_(APP.SHEETS.PROVIDERS);
  const providerByName = {};
  providers.forEach(function (row) {
    const id = String(row.ID_PROVEEDOR || ('legacy-' + row.__row));
    [String(row.PROVEEDOR || '')].concat(String(row.ALIASES || '').split(';')).map(normalizeText_).filter(Boolean).forEach(function (name) { providerByName[name] = id; });
  });
  invoiceRows.forEach(function (row) { if (!row.PROVEEDOR_ID) row.PROVEEDOR_ID = providerByName[normalizeText_(row.PROVEEDOR)] || ''; });
  const activeLinks = reconciliationRows.filter(function (row) { return String(row.ESTADO || '') === 'CONFIRMADA'; });
  const assignedByInvoice = {};
  activeLinks.forEach(function (row) { const id = String(row.FACTURA_ID || ''); assignedByInvoice[id] = Number(assignedByInvoice[id] || 0) + Math.abs(toCents_(row.IMPORTE_ASIGNADO)); });
  const requestedImport = String(payload.importId || '');
  let movements = movementRows.filter(function (row) { return String(row.ESTADO_IMPORTACION || '') === 'CONFIRMADA' && (!requestedImport || String(row.IMPORT_ID || '') === requestedImport); });
  const items = [];
  movements.forEach(function (movementRow) {
    const movementReconciliations = reconciliationRows.filter(function (row) { return String(row.MOVIMIENTO_ID || '') === String(movementRow.MOVIMIENTO_ID || '') && String(row.ESTADO || '') !== 'DESHECHA'; });
    const ranked = invoiceRows.map(function (invoiceRow) { return v19ReconciliationRank_(movementRow, invoiceRow, assignedByInvoice, ruleRows); }).filter(Boolean).sort(function (a, b) { return b.score - a.score || Math.abs(a.difference) - Math.abs(b.difference); }).slice(0, 3);
    movementReconciliations.forEach(function (row) {
      if (!row.FACTURA_ID || ranked.some(function (candidate) { return String(candidate.invoiceRow.ID_UNICO || '') === String(row.FACTURA_ID || ''); })) return;
      const invoiceRow = invoiceRows.find(function (candidate) { return String(candidate.ID_UNICO || '') === String(row.FACTURA_ID || ''); });
      if (!invoiceRow) return;
      ranked.push({ invoiceRow: invoiceRow, confidence: 'MEDIA', score: 55, evidence: [v19Evidence_('AUDIT', 'Propuesta registrada', String(row.EVIDENCIA || 'La relación existe en el histórico de conciliación.'), true)], difference: (Math.abs(toCents_(movementRow.IMPORTE)) - Math.abs(toCents_(invoiceRow.IMPORTE_TOTAL))) / 100, remaining: Math.abs(Number(invoiceRow.IMPORTE_TOTAL || 0)), exact: Math.abs(Math.abs(toCents_(movementRow.IMPORTE)) - Math.abs(toCents_(invoiceRow.IMPORTE_TOTAL))) <= 1 });
    });
    if (!ranked.length) {
      const status = /excluid/.test(normalizeText_(movementRow.ESTADO_CONCILIACION)) ? 'EXCLUDED' : 'COMPLEX';
      const movement = movementFromRow_(movementRow, activeLinks);
      movement.source = String(movementRow.FUENTE || '');
      movement.coverage = String(movementRow.COBERTURA || '');
      movement.importStatus = String(movementRow.ESTADO_IMPORTACION || '');
      items.push({ id: 'CAND-' + String(movementRow.MOVIMIENTO_ID || '') + '-NONE', importId: String(movementRow.IMPORT_ID || ''), status: status, confidence: 'BAJA', safeStatusLabel: v19SafeReconciliationLabel_(status, movementRow, null), movement: movement, invoice: null, evidence: [v19Evidence_('COVERAGE', 'Cobertura', 'No se localizó una factura dentro de la cobertura y los criterios disponibles.', false)], difference: Math.abs(Number(movementRow.IMPORTE || 0)), assignedAmount: movement.assignedAmount || 0, canBulkDecide: false });
      return;
    }
    ranked.forEach(function (rank) {
      const invoiceId = String(rank.invoiceRow.ID_UNICO || '');
      const reconciliation = movementReconciliations.find(function (row) { return String(row.FACTURA_ID || '') === invoiceId; });
      const status = v19CandidateStatus_(movementRow, reconciliation, ranked.length);
      const movement = movementFromRow_(movementRow, activeLinks);
      movement.source = String(movementRow.FUENTE || '');
      movement.coverage = String(movementRow.COBERTURA || '');
      movement.importStatus = String(movementRow.ESTADO_IMPORTACION || '');
      const invoice = invoiceFromRow_(rank.invoiceRow);
      delete invoice.__row;
      const pairAssigned = activeLinks.filter(function (row) { return String(row.MOVIMIENTO_ID || '') === String(movementRow.MOVIMIENTO_ID || '') && String(row.FACTURA_ID || '') === invoiceId; }).reduce(function (sum, row) { return sum + Math.abs(Number(row.IMPORTE_ASIGNADO || 0)); }, 0);
      items.push({ id: reconciliation && reconciliation.CONCILIACION_ID ? String(reconciliation.CONCILIACION_ID) : 'CAND-' + String(movementRow.MOVIMIENTO_ID || '') + '-' + invoiceId, importId: String(movementRow.IMPORT_ID || ''), status: status, confidence: rank.confidence, safeStatusLabel: v19SafeReconciliationLabel_(status, movementRow, invoice), movement: movement, invoice: invoice, evidence: rank.evidence, difference: Number(rank.difference.toFixed(2)), assignedAmount: Number(pairAssigned.toFixed(2)), canBulkDecide: status === 'PENDING' && rank.confidence === 'ALTA' && rank.exact && String(movementRow.ESTADO_IMPORTACION || '') === 'CONFIRMADA', reconciliationId: reconciliation && reconciliation.CONCILIACION_ID ? String(reconciliation.CONCILIACION_ID) : undefined });
    });
  });
  const requestedStatus = String(payload.status || '').toUpperCase();
  const filters = payload.filters || {};
  const query = normalizeText_(filters.query || '');
  const filtered = items.filter(function (item) {
    if (requestedStatus && item.status !== requestedStatus) return false;
    if (filters.confidence && item.confidence !== String(filters.confidence)) return false;
    if (filters.source && normalizeText_(item.movement.source) !== normalizeText_(filters.source)) return false;
    if (query && normalizeText_([item.movement.concept, item.movement.reference, item.invoice && item.invoice.supplier, item.invoice && item.invoice.number].join(' ')).indexOf(query) === -1) return false;
    return true;
  }).sort(function (a, b) { return String(b.movement.operationDate || '').localeCompare(String(a.movement.operationDate || '')) || a.id.localeCompare(b.id); });
  const offset = Math.max(Number(payload.cursor || 0), 0);
  const limit = Math.min(Math.max(Number(payload.limit || 50), 1), 100);
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, nextCursor: offset + limit < filtered.length ? String(offset + limit) : undefined };
}

function saveReconciliationDecisions_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, 'CONCILIACIONES_MASIVAS_GUARDADAS');
  if (repeated) return safeJsonParse_(repeated.DATOS_JSON, {}).response || { results: [], saved: 0, failed: 0 };
  if ((payload.items || []).length > 20) throw appError_('TOO_MANY_RECONCILIATION_DECISIONS', 'Guarda como máximo 20 decisiones cada vez.');
  const inputs = (payload.items || []).slice(0, 20);
  if (!inputs.length) throw appError_('EMPTY_RECONCILIATION_DECISIONS', 'Selecciona al menos una propuesta para guardar.');
  const movements = safeRows_(APP.SHEETS.MOVEMENTS);
  const invoices = safeRows_(APP.SHEETS.INVOICES);
  const reconciliations = safeRows_(APP.SHEETS.RECONCILIATIONS);
  const active = reconciliations.filter(function (row) { return String(row.ESTADO || '') === 'CONFIRMADA'; });
  const assignedMovements = {};
  const assignedInvoices = {};
  active.forEach(function (row) {
    assignedMovements[String(row.MOVIMIENTO_ID || '')] = Number(assignedMovements[String(row.MOVIMIENTO_ID || '')] || 0) + Math.abs(toCents_(row.IMPORTE_ASIGNADO));
    assignedInvoices[String(row.FACTURA_ID || '')] = Number(assignedInvoices[String(row.FACTURA_ID || '')] || 0) + Math.abs(toCents_(row.IMPORTE_ASIGNADO));
  });
  const creates = [];
  const changes = [];
  const movementChanges = [];
  const audit = [];
  const affectedMovementIds = [];
  const affectedInvoiceIds = [];
  const confirmedMovementIds = {};
  const results = [];
  inputs.forEach(function (input, index) {
    const decision = String(input.decision || '').toUpperCase();
    const movementId = String(input.movementId || '');
    const invoiceId = String(input.invoiceId || '');
    const itemRequestId = requestId + '-' + index;
    try {
      if (['CONFIRM', 'REJECT'].indexOf(decision) === -1) throw appError_('INVALID_RECONCILIATION_DECISION', 'La decisión debe ser confirmar o rechazar.');
      const movement = movements.find(function (row) { return String(row.MOVIMIENTO_ID || '') === movementId; });
      const invoice = invoices.find(function (row) { return String(row.ID_UNICO || '') === invoiceId; });
      if (!movement || !invoice) throw appError_('RECONCILIATION_TARGET_MISSING', 'La factura o el movimiento ya no están disponibles.');
      const replay = reconciliations.find(function (row) { return String(row.REQUEST_ID || '') === itemRequestId; });
      if (replay) { results.push({ movementId: movementId, invoiceId: invoiceId, status: 'SAVED', decision: decision }); return; }
      if (String(movement.ESTADO_IMPORTACION || '') !== 'CONFIRMADA') throw appError_('BANK_IMPORT_NOT_CONFIRMED', 'Archiva primero el extracto antes de decidir conciliaciones.');
      const pair = reconciliations.find(function (row) { return String(row.MOVIMIENTO_ID || '') === movementId && String(row.FACTURA_ID || '') === invoiceId && ['DESHECHA', 'CANCELADA'].indexOf(String(row.ESTADO || '')) === -1; });
      if (decision === 'REJECT') {
        const reason = String(input.reason || '').trim();
        if (!reason) throw appError_('REASON_REQUIRED', 'Indica por qué se rechaza la propuesta.');
        const data = { ESTADO: 'RECHAZADA', DECISION: 'RECHAZADA', MOTIVO: reason, DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: itemRequestId };
        if (pair && String(pair.ESTADO || '') !== 'CONFIRMADA') changes.push({ rowNumber: pair.__row, updates: data });
        else if (pair) throw appError_('CONFIRMED_LINK_REQUIRES_UNDO', 'Deshaz primero la conciliación confirmada.');
        else creates.push(Object.assign({ CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: String(movement.IMPORT_ID || ''), MOVIMIENTO_ID: movementId, FACTURA_ID: invoiceId, IMPORTE_ASIGNADO: 0, EVIDENCIA: String(input.evidence || ''), CREADO_EN: nowIso_(), CREADO_POR: user }, data));
        if (!assignedMovements[movementId] && !confirmedMovementIds[movementId]) movementChanges.push({ rowNumber: movement.__row, updates: { ESTADO_CONCILIACION: 'REVISIÓN MANUAL', CREADO_POR: user, REQUEST_ID: itemRequestId } });
        audit.push(logEventObject_('INFO', 'PROPUESTA_CONCILIACION_RECHAZADA', movementId, reason, { invoiceId: invoiceId }, '', itemRequestId, user));
        results.push({ movementId: movementId, invoiceId: invoiceId, status: 'SAVED', decision: decision });
        return;
      }
      if (String(movement.MONEDA || '') !== String(invoice.MONEDA || '')) throw appError_('CURRENCY_MISMATCH', 'Factura y movimiento deben tener la misma moneda.');
      if (Math.sign(Number(movement.IMPORTE || 0)) === Math.sign(Number(invoice.IMPORTE_TOTAL || 0))) throw appError_('PAYMENT_DIRECTION_MISMATCH', 'El signo del movimiento no corresponde con el documento contable.');
      const alreadyConfirmed = reconciliations.find(function (row) { return String(row.MOVIMIENTO_ID || '') === movementId && String(row.FACTURA_ID || '') === invoiceId && String(row.ESTADO || '') === 'CONFIRMADA'; });
      if (alreadyConfirmed) { results.push({ movementId: movementId, invoiceId: invoiceId, status: 'SAVED', decision: decision }); return; }
      const movementRemaining = Math.max(Math.abs(toCents_(movement.IMPORTE)) - Number(assignedMovements[movementId] || 0), 0);
      const invoiceRemaining = Math.max(Math.abs(toCents_(invoice.IMPORTE_TOTAL)) - Number(assignedInvoices[invoiceId] || 0), 0);
      const explicitAllocation = Math.abs(toCents_(input.allocatedAmount));
      const requested = explicitAllocation > 0 ? explicitAllocation : Math.min(movementRemaining, invoiceRemaining);
      if (!requested) throw appError_('INVALID_ALLOCATION', 'El importe asignado debe ser mayor que cero.');
      if (requested > movementRemaining + 1 || requested > invoiceRemaining + 1) throw appError_('ALLOCATION_EXCEEDS_BALANCE', 'La asignación supera el saldo pendiente; usa la matriz avanzada e indica el motivo.');
      const data = { IMPORTE_ASIGNADO: requested / 100, ESTADO: 'CONFIRMADA', EVIDENCIA: String(input.evidence || ''), DECISION: 'CONCILIADA', MOTIVO: String(input.reason || ''), DECIDIDO_EN: nowIso_(), DECIDIDO_POR: user, REQUEST_ID: itemRequestId };
      if (pair && String(pair.ESTADO || '') !== 'CONFIRMADA') changes.push({ rowNumber: pair.__row, updates: data });
      else creates.push(Object.assign({ CONCILIACION_ID: 'REC-' + uuid_(), IMPORT_ID: String(movement.IMPORT_ID || ''), MOVIMIENTO_ID: movementId, FACTURA_ID: invoiceId, CREADO_EN: nowIso_(), CREADO_POR: user }, data));
      assignedMovements[movementId] = Number(assignedMovements[movementId] || 0) + requested;
      assignedInvoices[invoiceId] = Number(assignedInvoices[invoiceId] || 0) + requested;
      confirmedMovementIds[movementId] = true;
      affectedMovementIds.push(movementId);
      affectedInvoiceIds.push(invoiceId);
      audit.push(logEventObject_('INFO', 'PROPUESTA_CONCILIACION_CONFIRMADA', movementId, (requested / 100).toFixed(2) + ' ' + String(movement.MONEDA || ''), { invoiceId: invoiceId }, '', itemRequestId, user));
      results.push({ movementId: movementId, invoiceId: invoiceId, status: 'SAVED', decision: decision });
    } catch (error) {
      results.push({ movementId: movementId, invoiceId: invoiceId || undefined, status: 'ERROR', decision: decision === 'REJECT' ? 'REJECT' : 'CONFIRM', error: error && error.message ? error.message : String(error) });
    }
  });
  if (creates.length) appendObjects_(APP.SHEETS.RECONCILIATIONS, creates);
  if (changes.length) updateObjectRows_(APP.SHEETS.RECONCILIATIONS, changes);
  if (affectedMovementIds.length || affectedInvoiceIds.length) recalculateReconciliationState_(affectedMovementIds, affectedInvoiceIds, user, requestId);
  const safeMovementChanges = movementChanges.filter(function (change) { const row = movements.find(function (movement) { return movement.__row === change.rowNumber; }); return row && !confirmedMovementIds[String(row.MOVIMIENTO_ID || '')]; });
  if (safeMovementChanges.length) updateObjectRows_(APP.SHEETS.MOVEMENTS, safeMovementChanges);
  if (audit.length) appendObjects_(APP.SHEETS.LOG, audit);
  const response = { results: results, saved: results.filter(function (item) { return item.status === 'SAVED'; }).length, failed: results.filter(function (item) { return item.status === 'ERROR'; }).length };
  logEvent_('INFO', 'CONCILIACIONES_MASIVAS_GUARDADAS', String(payload.importId || ''), response.saved + ' decisiones guardadas; ' + response.failed + ' con error', { response: response }, '', requestId, user);
  return response;
}

function listSupplierRules_(payload) {
  payload = payload || {};
  return supplierRules_(String(payload.supplierId || ''), payload.activeOnly === true).map(function (rule) { delete rule.__row; return rule; });
}

function v19ValidateSupplierRule_(input) {
  const allowed = ['EMAIL_DOMAIN', 'SENDER_EMAIL', 'BANK_CONCEPT', 'DEFAULT_CATEGORY', 'DEFAULT_CURRENCY'];
  const type = String(input.type || '').toUpperCase();
  const pattern = String(input.pattern || '').trim();
  const value = String(input.value || '').trim();
  if (allowed.indexOf(type) === -1) throw appError_('INVALID_SUPPLIER_RULE_TYPE', 'El tipo de regla no es válido.');
  if (!String(input.evidence || '').trim()) throw appError_('RULE_EVIDENCE_REQUIRED', 'La regla necesita evidencia acreditada.');
  if (['EMAIL_DOMAIN', 'SENDER_EMAIL', 'BANK_CONCEPT'].indexOf(type) !== -1 && !pattern) throw appError_('RULE_PATTERN_REQUIRED', 'Indica el texto acreditado que debe proponer el proveedor.');
  if (type === 'EMAIL_DOMAIN' && !/^[a-z0-9.-]+$/i.test(pattern)) throw appError_('INVALID_EMAIL_DOMAIN', 'El dominio de la regla no es válido.');
  if (type === 'SENDER_EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pattern)) throw appError_('INVALID_SENDER_EMAIL', 'El remitente de la regla no es válido.');
  if (type === 'BANK_CONCEPT' && normalizeText_(pattern).length < 3) throw appError_('BANK_CONCEPT_TOO_SHORT', 'El texto bancario debe tener al menos tres caracteres significativos.');
  if (type === 'DEFAULT_CATEGORY') {
    const category = safeRows_(APP.SHEETS.CATEGORIES).find(function (row) { return String(row.CATEGORIA_ID || '') === value && toBoolean_(row.ACTIVA); });
    if (!category) throw appError_('CATEGORY_NOT_FOUND', 'La categoría predeterminada no existe o está inactiva.');
  }
  if (type === 'DEFAULT_CURRENCY' && !/^[A-Z]{3}$/.test(value.toUpperCase())) throw appError_('INVALID_CURRENCY', 'La moneda habitual debe ser un código ISO de tres letras.');
  return { type: type, pattern: type === 'EMAIL_DOMAIN' || type === 'SENDER_EMAIL' ? pattern.toLowerCase() : pattern, value: type === 'DEFAULT_CURRENCY' ? value.toUpperCase() : value };
}

function saveSupplierRule_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, ['REGLA_PROVEEDOR_CREADA', 'REGLA_PROVEEDOR_ACTUALIZADA']);
  if (repeated) { const prior = safeRows_(APP.SHEETS.SUPPLIER_RULES).find(function (row) { return String(row.REGLA_ID || '') === String(repeated.DOCUMENTO || ''); }); if (prior) { const serialized = supplierRuleFromRow_(prior); delete serialized.__row; return serialized; } }
  const input = payload.rule || {};
  const supplierId = String(input.supplierId || '');
  const supplier = safeRows_(APP.SHEETS.PROVIDERS).find(function (row) { return String(row.ID_PROVEEDOR || ('legacy-' + row.__row)) === supplierId; });
  if (!supplier) throw appError_('SUPPLIER_NOT_FOUND', 'No se encuentra el proveedor.');
  if (!toBoolean_(supplier.ACTIVO) && input.active !== false) throw appError_('SUPPLIER_INACTIVE', 'Activa el proveedor antes de crear reglas que generen propuestas.');
  const normalized = v19ValidateSupplierRule_(input);
  const rows = safeRows_(APP.SHEETS.SUPPLIER_RULES);
  const existing = rows.find(function (row) { return String(row.REGLA_ID || '') === String(input.id || ''); });
  const duplicate = !existing && rows.find(function (row) { return String(row.PROVEEDOR_ID || '') === supplierId && String(row.TIPO || '') === normalized.type && normalizeText_(row.PATRON || row.VALOR) === normalizeText_(normalized.pattern || normalized.value) && toBoolean_(row.ACTIVA); });
  if (duplicate) throw appError_('SUPPLIER_RULE_ALREADY_EXISTS', 'Ya existe una regla activa equivalente para este proveedor.');
  const id = existing ? String(existing.REGLA_ID || '') : 'SR-' + uuid_();
  const data = { PROVEEDOR_ID: supplierId, TIPO: normalized.type, PATRON: normalized.pattern, VALOR: normalized.value, ACTIVA: input.active !== false, EVIDENCIA: String(input.evidence || '').trim(), ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId, DESACTIVADO_EN: '', DESACTIVADO_POR: '', MOTIVO_DESACTIVACION: '' };
  if (existing) updateObjectRow_(APP.SHEETS.SUPPLIER_RULES, existing.__row, data);
  else appendObject_(APP.SHEETS.SUPPLIER_RULES, Object.assign({ REGLA_ID: id, CREADO_EN: nowIso_(), CREADO_POR: user }, data));
  logEvent_('INFO', existing ? 'REGLA_PROVEEDOR_ACTUALIZADA' : 'REGLA_PROVEEDOR_CREADA', id, normalized.type, { supplierId: supplierId, pattern: normalized.pattern, value: normalized.value, evidence: data.EVIDENCIA, effect: 'PROPOSAL_ONLY' }, '', requestId, user);
  const saved = supplierRuleFromRow_(safeRows_(APP.SHEETS.SUPPLIER_RULES).find(function (row) { return String(row.REGLA_ID || '') === id; }));
  delete saved.__row;
  return saved;
}

function deactivateSupplierRule_(payload, user, requestId) {
  const ruleId = String(payload.ruleId || '');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw appError_('REASON_REQUIRED', 'Indica el motivo para desactivar la regla.');
  const repeated = eventByRequest_(requestId, 'REGLA_PROVEEDOR_DESACTIVADA');
  const rows = safeRows_(APP.SHEETS.SUPPLIER_RULES);
  const row = rows.find(function (item) { return String(item.REGLA_ID || '') === (repeated ? String(repeated.DOCUMENTO || '') : ruleId); });
  if (!row) throw appError_('SUPPLIER_RULE_NOT_FOUND', 'No se encuentra la regla del proveedor.');
  if (toBoolean_(row.ACTIVA)) {
    updateObjectRow_(APP.SHEETS.SUPPLIER_RULES, row.__row, { ACTIVA: false, DESACTIVADO_EN: nowIso_(), DESACTIVADO_POR: user, MOTIVO_DESACTIVACION: reason, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId });
    logEvent_('WARN', 'REGLA_PROVEEDOR_DESACTIVADA', ruleId, reason, { supplierId: String(row.PROVEEDOR_ID || '') }, '', requestId, user);
  }
  const saved = supplierRuleFromRow_(safeRows_(APP.SHEETS.SUPPLIER_RULES).find(function (item) { return item.__row === row.__row; }));
  delete saved.__row;
  return saved;
}

function saveSupplierSchedule_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, 'FRECUENCIA_PROVEEDOR_ACTUALIZADA');
  const supplierId = String(payload.supplierId || (repeated && repeated.DOCUMENTO) || '');
  const rows = safeRows_(APP.SHEETS.PROVIDERS);
  const row = rows.find(function (item) { return String(item.ID_PROVEEDOR || ('legacy-' + item.__row)) === supplierId; });
  if (!row) throw appError_('SUPPLIER_NOT_FOUND', 'No se encuentra el proveedor.');
  if (repeated) return v19ProviderWithHistory_(row);
  const frequency = String(payload.frequency || 'NONE').toUpperCase();
  if (['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].indexOf(frequency) === -1) throw appError_('INVALID_SUPPLIER_FREQUENCY', 'La frecuencia del proveedor no es válida.');
  const evidence = String(payload.evidence || '').trim();
  if (!evidence) throw appError_('SCHEDULE_EVIDENCE_REQUIRED', 'La frecuencia necesita evidencia acreditada.');
  const expectedDay = frequency === 'NONE' ? null : Number(payload.expectedDay || 0);
  if (frequency !== 'NONE' && (!Number.isInteger(expectedDay) || expectedDay < 1 || expectedDay > 31)) throw appError_('INVALID_EXPECTED_DAY', 'Indica un día esperado entre 1 y 31.');
  let anchorMonth = frequency === 'NONE' || frequency === 'MONTHLY' ? null : Number(payload.anchorMonth || 0);
  if ((frequency === 'QUARTERLY' || frequency === 'ANNUAL') && (!Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12)) anchorMonth = v19LatestSupplierInvoiceMonth_(row, safeRows_(APP.SHEETS.INVOICES));
  if ((frequency === 'QUARTERLY' || frequency === 'ANNUAL') && (!anchorMonth || anchorMonth < 1 || anchorMonth > 12)) throw appError_('ANCHOR_MONTH_REQUIRED', 'No hay una factura histórica con la que derivar el mes de referencia; indícalo expresamente.');
  const excluded = (payload.excludedPeriods || []).map(String).filter(function (period) { return /^20\d{2}-(0[1-9]|1[0-2])$/.test(period); }).filter(function (period, index, list) { return list.indexOf(period) === index; }).sort();
  if (excluded.length !== (payload.excludedPeriods || []).length) throw appError_('INVALID_EXCLUDED_PERIOD', 'Los periodos no esperados deben usar el formato AAAA-MM y no repetirse.');
  const updates = { FRECUENCIA_ESPERADA: frequency, DIA_ESPERADO: expectedDay === null ? '' : expectedDay, MES_ANCLA: anchorMonth === null ? '' : anchorMonth, PERIODOS_EXCLUIDOS_JSON: JSON.stringify(excluded), EVIDENCIA_FRECUENCIA: evidence, FECHA_ACTUALIZACION: nowIso_(), ACTUALIZADO_POR: user, REQUEST_ID: requestId };
  updateObjectRow_(APP.SHEETS.PROVIDERS, row.__row, updates);
  logEvent_('INFO', 'FRECUENCIA_PROVEEDOR_ACTUALIZADA', supplierId, frequency, { before: { frequency: String(row.FRECUENCIA_ESPERADA || 'NONE'), expectedDay: row.DIA_ESPERADO || null, anchorMonth: row.MES_ANCLA || null, excludedPeriods: safeJsonParse_(row.PERIODOS_EXCLUIDOS_JSON, []) }, after: { frequency: frequency, expectedDay: expectedDay, anchorMonth: anchorMonth, excludedPeriods: excluded }, evidence: evidence }, '', requestId, user);
  return v19ProviderWithHistory_(safeRows_(APP.SHEETS.PROVIDERS).find(function (item) { return item.__row === row.__row; }));
}

function v19ProviderWithHistory_(row) {
  const provider = providerFromRow_(row);
  provider.invoiceCount = v19SupplierInvoiceCount_(row, safeRows_(APP.SHEETS.INVOICES));
  provider.recurrenceSuggested = !provider.recurrent && provider.invoiceCount >= 3;
  delete provider.__row;
  return provider;
}
