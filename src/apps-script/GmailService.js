function startBatch_(payload, user, requestId) {
  const repeated = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.REQUEST_ID || '') === String(requestId); });
  if (repeated) return batchFromRow_(repeated);
  const existing = getActiveBatch_();
  if (existing) throw appError_('ACTIVE_BATCH_EXISTS', 'Ya existe un lote activo: ' + existing.id + '.');
  const config = getConfigMap_();
  const max = Math.min(Math.max(Number(payload.maxEmails || 10), 1), Math.min(Number(config.APP_MAX_BATCH_SIZE || APP.MAX_BATCH_SIZE), APP.MAX_BATCH_SIZE));
  const dateFrom = parseDate_(payload.dateFrom) || String(config.APP_START_DATE || APP.START_DATE);
  const dateTo = parseDate_(payload.dateTo) || Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  if (dateFrom < String(config.APP_START_DATE || APP.START_DATE)) throw appError_('DATE_OUT_OF_RANGE', 'La fecha inicial no puede ser anterior a ' + (config.APP_START_DATE || APP.START_DATE) + '.');
  if (dateFrom > dateTo) throw appError_('INVALID_DATE_RANGE', 'La fecha inicial debe ser anterior o igual a la final.');
  const id = 'LOT-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + uuid_().slice(0, 6);
  appendObject_(APP.SHEETS.BATCHES, { LOTE_ID: id, TIPO: 'GMAIL', ESTADO: 'ANALIZANDO', FECHA_DESDE: dateFrom, FECHA_HASTA: dateTo, MAX_CORREOS: max, CORREOS_REVISADOS: 0, PDF_ENCONTRADOS: 0, CURSOR: '', PENDING_MESSAGE_IDS_JSON: '[]', PENDING_NEXT_CURSOR: '', CORREOS_PROCESADOS_JSON: '[]', PROGRESO: 0, CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId });
  logEvent_('INFO', 'LOTE_INICIADO', id, 'Análisis iniciado', { dateFrom: dateFrom, dateTo: dateTo, maxEmails: max }, id, requestId, user);
  return analyzeBatchSlice_(id, user, requestId);
}

function continueBatch_(batchId, user, requestId) {
  const row = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  if (!row) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote solicitado.');
  if (['PENDIENTE DE APROBACIÓN', 'COMPLETADO', 'CANCELADO'].indexOf(String(row.ESTADO)) !== -1) return batchFromRow_(row);
  return analyzeBatchSlice_(batchId, user, requestId);
}

function analyzeBatchSlice_(batchId, user, requestId) {
  const started = Date.now();
  const batchRow = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  if (!batchRow) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote solicitado.');
  const processedIds = safeJsonParse_(batchRow.CORREOS_PROCESADOS_JSON, []);
  const alreadyReviewed = processedIds.length || Number(batchRow.CORREOS_REVISADOS || 0);
  const remaining = Math.max(Number(batchRow.MAX_CORREOS || 0) - alreadyReviewed, 0);
  const config = getConfigMap_();
  const sliceSize = Math.min(Number(config.APP_SLICE_SIZE || APP.SLICE_SIZE), APP.SLICE_SIZE, remaining);
  if (!sliceSize) {
    updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { ESTADO: 'PENDIENTE DE APROBACIÓN', PROGRESO: 100 });
    return batchFromRow_(Object.assign({}, batchRow, { ESTADO: 'PENDIENTE DE APROBACIÓN', PROGRESO: 100 }));
  }
  const afterEpoch = Math.floor(new Date(String(batchRow.FECHA_DESDE) + 'T00:00:00+02:00').getTime() / 1000);
  const beforeEpoch = Math.floor(new Date(String(batchRow.FECHA_HASTA) + 'T23:59:59+02:00').getTime() / 1000) + 1;
  const query = 'after:' + afterEpoch + ' before:' + beforeEpoch + ' has:attachment filename:pdf -in:spam -in:trash';
  let pendingIds = safeJsonParse_(batchRow.PENDING_MESSAGE_IDS_JSON, []);
  let nextCursor = String(batchRow.PENDING_NEXT_CURSOR || '');
  let fetchedAny = pendingIds.length > 0;
  if (!pendingIds.length) {
    const response = Gmail.Users.Messages.list('me', { q: query, maxResults: sliceSize, pageToken: String(batchRow.CURSOR || '') || undefined, includeSpamTrash: false });
    pendingIds = (response.messages || []).map(function (message) { return String(message.id); });
    nextCursor = String(response.nextPageToken || '');
    fetchedAny = pendingIds.length > 0;
    updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), PENDING_NEXT_CURSOR: nextCursor });
  }
  let pdfCount = Number(batchRow.PDF_ENCONTRADOS || 0);
  let reviewed = alreadyReviewed;
  while (pendingIds.length) {
    if (Date.now() - started > APP.EXECUTION_BUDGET_MS) break;
    const messageId = String(pendingIds[0]);
    if (processedIds.indexOf(messageId) !== -1) { pendingIds.shift(); continue; }
    const message = Gmail.Users.Messages.get('me', messageId, { format: 'full' });
    const metadata = messageMetadata_(message);
    const attachments = collectPdfAttachments_(message.payload);
    attachments.forEach(function (attachment) {
      const sourceKey = message.id + '|' + attachment.attachmentId + '|' + attachment.filename;
      const existing = getRows_(APP.SHEETS.DOCUMENTS).find(function (row) { return String(row.SOURCE_KEY) === sourceKey; });
      if (existing) return;
      pdfCount += 1;
      analyzeAttachment_(batchId, message.id, attachment, metadata, sourceKey, user, requestId);
    });
    processedIds.push(messageId);
    pendingIds.shift();
    reviewed = processedIds.length;
    updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { CORREOS_REVISADOS: reviewed, PDF_ENCONTRADOS: pdfCount, PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), CORREOS_PROCESADOS_JSON: JSON.stringify(processedIds) });
  }
  if (!pendingIds.length) {
    updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { CURSOR: nextCursor, PENDING_MESSAGE_IDS_JSON: '[]', PENDING_NEXT_CURSOR: '' });
  }
  const done = reviewed >= Number(batchRow.MAX_CORREOS || 0) || (!pendingIds.length && !nextCursor) || (!fetchedAny && !pendingIds.length);
  const status = done ? 'PENDIENTE DE APROBACIÓN' : 'ANALIZANDO';
  const progress = Number(batchRow.MAX_CORREOS || 0) ? Math.min(Math.round(reviewed / Number(batchRow.MAX_CORREOS) * 100), 100) : 100;
  updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { ESTADO: status, CORREOS_REVISADOS: reviewed, PDF_ENCONTRADOS: pdfCount, CURSOR: done ? '' : (pendingIds.length ? String(batchRow.CURSOR || '') : nextCursor), PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), PENDING_NEXT_CURSOR: pendingIds.length ? nextCursor : '', CORREOS_PROCESADOS_JSON: JSON.stringify(processedIds), PROGRESO: done ? 100 : progress });
  if (done) logEvent_('INFO', 'LOTE_ANALIZADO', batchId, 'Vista previa preparada', { reviewedEmails: reviewed, pdfCount: pdfCount }, batchId, requestId, user);
  const updated = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  return batchFromRow_(updated);
}

function messageMetadata_(message) {
  const headers = (message.payload && message.payload.headers) || [];
  const value = function (name) { const found = headers.find(function (header) { return String(header.name).toLowerCase() === name.toLowerCase(); }); return found ? String(found.value || '') : ''; };
  return { sender: value('From'), subject: value('Subject'), date: new Date(Number(message.internalDate || Date.now())).toISOString(), gmailUrl: 'https://mail.google.com/mail/u/0/#all/' + message.id };
}

function collectPdfAttachments_(part, output) {
  output = output || [];
  if (!part) return output;
  const filename = String(part.filename || '');
  if (part.body && part.body.attachmentId && (/\.pdf$/i.test(filename) || String(part.mimeType).toLowerCase() === 'application/pdf')) output.push({ attachmentId: part.body.attachmentId, filename: filename || 'documento.pdf', size: Number(part.body.size || 0) });
  (part.parts || []).forEach(function (child) { collectPdfAttachments_(child, output); });
  return output;
}

function analyzeAttachment_(batchId, messageId, attachment, metadata, sourceKey, user, requestId) {
  const raw = Gmail.Users.Messages.Attachments.get('me', messageId, attachment.attachmentId);
  const bytes = base64UrlDecode_(raw.data);
  const hash = bytesHash_(bytes);
  const duplicate = getRows_(APP.SHEETS.INVOICES).some(function (row) { return String(row.HASH_PDF || '') === hash || String(row.ID_UNICO || '') === sourceKey; }) || getRows_(APP.SHEETS.DOCUMENTS).some(function (row) { return String(row.HASH_PDF || '') === hash; });
  let extracted = { text: '', tempId: '' };
  let decision;
  try {
    extracted = ocrPdf_(bytes, attachment.filename);
    decision = duplicate ? { status: 'DUPLICADO IGNORADO', phase: 'LISTO PARA APROBAR', reason: 'La huella SHA-256 ya existe en el registro', fields: {}, evidence: [{ field: 'duplicate', value: hash, source: 'PDF', excerpt: 'Coincidencia exacta de bytes' }] } : classifyInvoiceText_(extracted.text, metadata.sender, metadata.subject);
  } catch (error) {
    decision = { status: 'REVISIÓN MANUAL', phase: 'EN REVISIÓN', reason: 'No se pudo extraer texto fiable: ' + (error.message || error), fields: {}, evidence: [] };
  } finally {
    if (extracted.tempId) try { DriveApp.getFileById(extracted.tempId).setTrashed(true); } catch (_) {}
  }
  const fields = decision.fields || {};
  const id = 'DOC-' + uuid_();
  appendObject_(APP.SHEETS.DOCUMENTS, {
    DOCUMENTO_ID: id, LOTE_ID: batchId, MESSAGE_ID: messageId, ATTACHMENT_ID: attachment.attachmentId, SOURCE_KEY: sourceKey, NOMBRE_ORIGINAL: attachment.filename,
    REMITENTE: metadata.sender, ASUNTO: metadata.subject, FECHA_CORREO: metadata.date, FECHA_FACTURA: fields.invoiceDate || '', PROVEEDOR: fields.supplier || '', PROVEEDOR_ID: fields.supplierId || '', CIF_NIF: fields.taxId || '', NUMERO_FACTURA: fields.invoiceNumber || '', IMPORTE_TOTAL: fields.total === undefined || fields.total === null ? '' : fields.total, MONEDA: fields.currency || '', FASE: decision.phase, ESTADO_PROPUESTO: decision.status, ESTADO_FINAL: '', MOTIVO_REVISION: decision.reason || '', EVIDENCIA_JSON: JSON.stringify(decision.evidence || []), HASH_PDF: hash, GMAIL_URL: metadata.gmailUrl, SELECCIONADO: decision.phase === 'LISTO PARA APROBAR', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '', REQUEST_ID: requestId,
  });
  logEvent_('INFO', 'DOCUMENTO_ANALIZADO', id, attachment.filename, { status: decision.status, hash: hash }, batchId, requestId, user);
}

function ocrPdf_(bytes, fileName) {
  const blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  const created = Drive.Files.create({ name: 'OCR TEMP ' + uuid_(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'es', fields: 'id,name' });
  let text = '';
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { text = DocumentApp.openById(created.id).getBody().getText(); if (text) break; } catch (error) { lastError = error; Utilities.sleep(Math.pow(2, attempt) * 900); }
  }
  if (!text && lastError) { try { DriveApp.getFileById(created.id).setTrashed(true); } catch (_) {} throw lastError; }
  return { text: text, tempId: created.id };
}

function classifyInvoiceText_(text, sender, subject) {
  const normalized = normalizeText_(text);
  const evidence = [];
  const negative = ['presupuesto', 'propuesta comercial', 'propuesta de servicio', 'albaran', 'nota de entrega', 'shipment slip', 'confirmacion de pedido', 'etiqueta de devolucion'];
  const invoiceSignals = ['factura', 'invoice', 'tax invoice', 'numero de factura', 'invoice number', 'iva', 'vat', 'importe total', 'grand total', 'amount due'];
  const negativeHits = negative.filter(function (term) { return normalized.indexOf(term) !== -1; });
  const signalHits = invoiceSignals.filter(function (term) { return normalized.indexOf(term) !== -1; });
  if (negativeHits.length && signalHits.length < 3) return { status: 'NO ES FACTURA', phase: 'LISTO PARA APROBAR', reason: 'El contenido identifica ' + negativeHits[0], fields: {}, evidence: [{ field: 'classification', value: 'NO ES FACTURA', source: 'PDF', excerpt: negativeHits.join(', ') }] };
  if ((normalized.indexOf('reparapro sociedad limitada') !== -1 || normalized.indexOf('reparapro iphone mac ipad') !== -1) && /factura|invoice/.test(normalized)) return { status: 'FACTURA DE VENTA', phase: 'LISTO PARA APROBAR', reason: 'Documento emitido por ReparaPRO', fields: {}, evidence: [{ field: 'issuer', value: 'ReparaPRO', source: 'PDF', excerpt: 'Emisor identificado como ReparaPRO' }] };
  if (signalHits.length < 3) return { status: 'REVISIÓN MANUAL', phase: 'EN REVISIÓN', reason: 'No hay señales suficientes para identificar una factura', fields: {}, evidence: [{ field: 'classification', value: signalHits.join(', '), source: 'PDF', excerpt: 'Señales detectadas insuficientes' }] };
  const complex = ['factura rectificativa', 'rectificativa', 'credit note', 'nota de credito', 'abono', 'corrective invoice'].find(function (term) { return normalized.indexOf(term) !== -1; });
  const providers = activeProviders_();
  const domainMatch = String(sender || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  const senderDomain = domainMatch ? domainMatch[1].replace(/[>\s].*$/, '') : '';
  const ruleMatch = providerFromRules_(text, sender, subject, providers);
  const provider = ruleMatch ? ruleMatch.provider : providers.find(function (item) {
    const names = [item.name].concat(item.aliases || []).map(normalizeText_).filter(Boolean);
    return (item.domain && senderDomain && senderDomain.endsWith(item.domain.toLowerCase())) || names.some(function (name) { return name.length > 3 && normalized.indexOf(name) !== -1; }) || (item.taxId && normalized.indexOf(normalizeText_(item.taxId)) !== -1);
  });
  const numberPattern = /(?:invoice\s*(?:number|no\.?|#)|n[uú]mero\s+de\s+factura|factura\s*(?:n[ºo°.]|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/_-]{2,})/gi;
  const numberMatches = Array.from(text.matchAll(numberPattern));
  const numberMatch = numberMatches.length ? numberMatches[0] : null;
  const distinctNumbers = numberMatches.map(function (match) { return normalizeText_(match[1]); }).filter(function (value, index, list) { return value && list.indexOf(value) === index; });
  const dateMatch = text.match(/(?:fecha(?:\s+de\s+emisi[oó]n)?|invoice\s+date|date)\s*[:#-]?\s*(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i);
  const totalMatches = Array.from(text.matchAll(/(?:grand\s+total|importe\s+total|total\s+(?:a\s+pagar|factura)|amount\s+due)\s*[:€$]?\s*([\d.,]+)\s*(EUR|USD|GBP|€|\$)?/gi));
  const totalMatch = totalMatches.length ? totalMatches[totalMatches.length - 1] : null;
  const total = totalMatch ? parseNumber_(totalMatch[1]) : null;
  const explicitCurrency = text.match(/\b(EUR|USD|GBP|CHF|PLN|CAD|AUD)\b/i);
  const totalToken = totalMatch && totalMatch[2] ? totalMatch[2] : '';
  const currency = totalToken === '€' ? 'EUR' : /^[A-Z]{3}$/i.test(totalToken) ? totalToken.toUpperCase() : explicitCurrency ? explicitCurrency[1].toUpperCase() : '';
  const fields = { supplier: provider ? provider.name : '', supplierId: provider ? provider.id : '', taxId: provider ? provider.taxId : '', invoiceNumber: numberMatch ? numberMatch[1] : '', invoiceDate: dateMatch ? parseDate_(dateMatch[1]) : '', total: total, currency: currency };
  if (provider) evidence.push({ field: 'supplier', value: provider.name, source: ruleMatch ? 'REGLA' : provider.domain && senderDomain.endsWith(provider.domain) ? 'CORREO' : 'PDF', excerpt: ruleMatch ? ruleMatch.evidence : provider.domain && senderDomain.endsWith(provider.domain) ? senderDomain : provider.name });
  if (fields.invoiceNumber) evidence.push({ field: 'invoiceNumber', value: fields.invoiceNumber, source: 'PDF', excerpt: numberMatch[0] });
  if (fields.invoiceDate) evidence.push({ field: 'invoiceDate', value: fields.invoiceDate, source: 'PDF', excerpt: dateMatch[0] });
  if (total !== null) evidence.push({ field: 'total', value: total + ' ' + currency, source: 'PDF', excerpt: totalMatch[0] });
  const errors = [];
  if (complex) errors.push('Documento ' + complex + ': tratamiento contable pendiente');
  if (distinctNumbers.length > 1) errors.push('El PDF contiene varias facturas o números de factura distintos');
  if (!provider) errors.push('Proveedor desconocido o inactivo' + (senderDomain ? ' (' + senderDomain + ')' : ''));
  if (!fields.invoiceNumber) errors.push('Número de factura ausente o ambiguo');
  if (!fields.invoiceDate) errors.push('Fecha de emisión ausente o inválida');
  if (total === null || total <= 0) errors.push('Importe total ausente o inválido');
  if (!currency) errors.push('Moneda ausente o ambigua');
  return { status: errors.length ? 'REVISIÓN MANUAL' : 'PROCESADA', phase: errors.length ? 'EN REVISIÓN' : 'LISTO PARA APROBAR', reason: errors.join('; '), fields: fields, evidence: evidence };
}

function providerFromRules_(text, sender, subject, providers) {
  const rows = getRows_(APP.SHEETS.RULES).filter(function (row) { return toBoolean_(row.ACTIVA); }).sort(function (a, b) { return Number(b.PRIORIDAD || 0) - Number(a.PRIORIDAD || 0); });
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const field = normalizeText_(row.CAMPO || 'pdf');
    const pattern = String(row['TEXTO_O_PATRÓN'] || '').trim();
    if (!pattern) continue;
    const haystack = /dominio|remitente|correo/.test(field) ? String(sender || '') : /asunto/.test(field) ? String(subject || '') : String(text || '');
    let matches = false;
    try {
      const delimited = pattern.match(/^\/(.*)\/([gimsuy]*)$/);
      matches = delimited ? new RegExp(delimited[1], delimited[2].replace(/g/g, '')).test(haystack) : normalizeText_(haystack).indexOf(normalizeText_(pattern)) !== -1;
    } catch (_) { matches = false; }
    if (!matches) continue;
    const providerName = normalizeText_(row.PROVEEDOR || '');
    const provider = providers.find(function (item) { return [item.name].concat(item.aliases || []).some(function (name) { return normalizeText_(name) === providerName; }); });
    if (provider) return { provider: provider, evidence: String(row.CAMPO || 'PDF') + ': ' + pattern };
  }
  return null;
}
