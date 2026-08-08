function startBatch_(payload, user, requestId) {
  const repeated = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.REQUEST_ID || '') === String(requestId); });
  if (repeated) return batchFromRow_(repeated);
  const existing = getActiveBatch_();
  if (existing) throw appError_('ACTIVE_BATCH_EXISTS', 'Ya existe un lote activo: ' + existing.id + '.');
  const config = getConfigMap_();
  const max = Math.min(Math.max(Number(payload.maxEmails || 10), 1), Math.min(Number(config.APP_MAX_BATCH_SIZE || APP.MAX_BATCH_SIZE), APP.MAX_BATCH_SIZE));
  const minimumDate = effectiveStartDate_(config);
  const dateFrom = parseDate_(payload.dateFrom) || minimumDate;
  const dateTo = parseDate_(payload.dateTo) || Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  if (dateFrom < minimumDate) throw appError_('DATE_OUT_OF_RANGE', 'La fecha inicial no puede ser anterior a ' + minimumDate + '.');
  if (dateFrom > dateTo) throw appError_('INVALID_DATE_RANGE', 'La fecha inicial debe ser anterior o igual a la final.');
  const id = 'LOT-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + uuid_().slice(0, 6);
  appendObject_(APP.SHEETS.BATCHES, { LOTE_ID: id, TIPO: 'GMAIL', ESTADO: 'ANALIZANDO', FECHA_DESDE: dateFrom, FECHA_HASTA: dateTo, MAX_CORREOS: max, CORREOS_REVISADOS: 0, PDF_ENCONTRADOS: 0, CURSOR: dateFrom, PENDING_MESSAGE_IDS_JSON: '[]', PENDING_NEXT_CURSOR: '', CORREOS_PROCESADOS_JSON: '[]', PROGRESO: 0, CREADO_EN: nowIso_(), CREADO_POR: user, REQUEST_ID: requestId, FECHA_BUSQUEDA: dateFrom, CURSOR_DIA: '', PENDING_SCAN_IDS_JSON: '[]', CANDIDATOS_DIA_JSON: '[]', ESCANEO_DIA_COMPLETO: false });
  logEvent_('INFO', 'LOTE_INICIADO', id, 'Análisis iniciado', { dateFrom: dateFrom, dateTo: dateTo, maxEmails: max }, id, requestId, user);
  return analyzeBatchSlice_(id, user, requestId);
}

function continueBatch_(batchId, user, requestId) {
  const row = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  if (!row) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote solicitado.');
  if (['PENDIENTE DE APROBACIÓN', 'COMPLETADO', 'CANCELADO'].indexOf(String(row.ESTADO)) !== -1) return batchFromRow_(row);
  return analyzeBatchSlice_(batchId, user, requestId);
}

function cancelBatch_(payload, user, requestId) {
  const repeated = eventByRequest_(requestId, 'LOTE_CANCELADO');
  if (repeated) {
    const repeatedRow = getRows_(APP.SHEETS.BATCHES).find(function (row) { return String(row.LOTE_ID) === String(repeated.DOCUMENTO || ''); });
    if (repeatedRow) return batchFromRow_(repeatedRow);
  }
  const batchId = String(payload.batchId || '');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw appError_('REASON_REQUIRED', 'Indica el motivo de la cancelación.');
  const row = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === batchId; });
  if (!row) throw appError_('BATCH_NOT_FOUND', 'No se encuentra el lote solicitado.');
  if (String(row.ESTADO) === 'CANCELADO') return batchFromRow_(row);
  if (['COMPLETADO', 'COMPLETADO CON ERRORES'].indexOf(String(row.ESTADO)) !== -1) throw appError_('BATCH_ALREADY_FINAL', 'Un lote ya ejecutado no se puede cancelar.');
  getRows_(APP.SHEETS.DOCUMENTS).filter(function (doc) { return String(doc.LOTE_ID) === batchId && String(doc.FASE) !== 'FINALIZADO'; }).forEach(function (doc) {
    updateObjectRow_(APP.SHEETS.DOCUMENTS, doc.__row, { FASE: 'CANCELADO', SELECCIONADO: false, MOTIVO_REVISION: reason, ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '', REQUEST_ID: requestId });
  });
  updateObjectRow_(APP.SHEETS.BATCHES, row.__row, { ESTADO: 'CANCELADO', CANCELADO_EN: nowIso_(), CANCELADO_POR: user, MOTIVO_CANCELACION: reason, ERROR: '', REQUEST_ID: requestId });
  logEvent_('WARN', 'LOTE_CANCELADO', batchId, reason, { definitiveWrites: 0 }, batchId, requestId, user);
  return batchFromRow_(getRows_(APP.SHEETS.BATCHES).find(function (item) { return item.__row === row.__row; }));
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
  const batchDateFrom = parseDate_(batchRow.FECHA_DESDE);
  const batchDateTo = parseDate_(batchRow.FECHA_HASTA);
  if (!batchDateFrom || !batchDateTo) throw appError_('INVALID_BATCH_DATES', 'El lote no contiene un rango de fechas válido.');
  const batchStates = getRows_(APP.SHEETS.BATCHES).reduce(function (map, row) { map[String(row.LOTE_ID || '')] = String(row.ESTADO || ''); return map; }, {});
  const knownMessageIds = getRows_(APP.SHEETS.DOCUMENTS).filter(function (row) { return String(row.LOTE_ID || '') !== String(batchId) && batchStates[String(row.LOTE_ID || '')] !== 'CANCELADO'; }).map(function (row) { return String(row.MESSAGE_ID || ''); });
  let searchDate = parseDate_(batchRow.FECHA_BUSQUEDA) || batchDateFrom;
  let cursorDay = String(batchRow.CURSOR_DIA || '');
  let scanIds = safeJsonParse_(batchRow.PENDING_SCAN_IDS_JSON, []);
  let candidates = safeJsonParse_(batchRow.CANDIDATOS_DIA_JSON, []);
  let scanComplete = toBoolean_(batchRow.ESCANEO_DIA_COMPLETO);
  let pendingIds = safeJsonParse_(batchRow.PENDING_MESSAGE_IDS_JSON, []);
  let pdfCount = Number(batchRow.PDF_ENCONTRADOS || 0);
  let reviewed = alreadyReviewed;
  let processedThisSlice = 0;
  let exhausted = false;
  while (processedThisSlice < sliceSize && Date.now() - started <= APP.EXECUTION_BUDGET_MS) {
    if (searchDate > batchDateTo) { exhausted = true; break; }
    if (!pendingIds.length && !scanComplete) {
      if (!scanIds.length) {
        const nextDate = nextDate_(searchDate);
        const afterEpoch = Math.floor(Utilities.parseDate(searchDate, APP.TIMEZONE, 'yyyy-MM-dd').getTime() / 1000) - 1;
        const beforeEpoch = Math.floor(Utilities.parseDate(nextDate, APP.TIMEZONE, 'yyyy-MM-dd').getTime() / 1000);
        const query = 'after:' + afterEpoch + ' before:' + beforeEpoch + ' has:attachment filename:pdf -in:spam -in:trash';
        const response = Gmail.Users.Messages.list('me', { q: query, maxResults: 25, pageToken: cursorDay || undefined, includeSpamTrash: false });
        scanIds = (response.messages || []).map(function (message) { return String(message.id); });
        cursorDay = String(response.nextPageToken || '');
        updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { PENDING_SCAN_IDS_JSON: JSON.stringify(scanIds), CURSOR_DIA: cursorDay, CANDIDATOS_DIA_JSON: JSON.stringify(candidates), CURSOR: searchDate });
        if (!scanIds.length && !cursorDay) scanComplete = true;
      }
      while (scanIds.length && Date.now() - started <= APP.EXECUTION_BUDGET_MS) {
        const scanId = String(scanIds[0]);
        const scanMessage = Gmail.Users.Messages.get('me', scanId, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Delivered-To', 'Subject'] });
        const scanMetadata = messageMetadata_(scanMessage);
        if (isEligibleIncomingMessage_(scanMessage, scanMetadata) && knownMessageIds.indexOf(scanId) === -1) candidates.push({ id: scanId, timestamp: Number(scanMessage.internalDate || 0) });
        scanIds.shift();
        updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { PENDING_SCAN_IDS_JSON: JSON.stringify(scanIds), CURSOR_DIA: cursorDay, CANDIDATOS_DIA_JSON: JSON.stringify(candidates) });
      }
      if (scanIds.length) break;
      if (cursorDay) continue;
      scanComplete = true;
      candidates.sort(function (a, b) { return Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.id).localeCompare(String(b.id)); });
      pendingIds = candidates.map(function (candidate) { return String(candidate.id); });
      candidates = [];
      updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), CANDIDATOS_DIA_JSON: '[]', ESCANEO_DIA_COMPLETO: true });
    }
    if (!pendingIds.length && scanComplete) {
      searchDate = nextDate_(searchDate);
      cursorDay = '';
      scanIds = [];
      candidates = [];
      scanComplete = false;
      updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { FECHA_BUSQUEDA: searchDate, CURSOR: searchDate, CURSOR_DIA: '', PENDING_SCAN_IDS_JSON: '[]', CANDIDATOS_DIA_JSON: '[]', ESCANEO_DIA_COMPLETO: false, PENDING_MESSAGE_IDS_JSON: '[]' });
      continue;
    }
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
    processedThisSlice += 1;
    reviewed = processedIds.length;
    updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { CORREOS_REVISADOS: reviewed, PDF_ENCONTRADOS: pdfCount, PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), CORREOS_PROCESADOS_JSON: JSON.stringify(processedIds), FECHA_BUSQUEDA: searchDate, CURSOR: searchDate });
    if (reviewed >= Number(batchRow.MAX_CORREOS || 0)) break;
  }
  const done = reviewed >= Number(batchRow.MAX_CORREOS || 0) || exhausted;
  const status = done ? 'PENDIENTE DE APROBACIÓN' : 'ANALIZANDO';
  const progress = Number(batchRow.MAX_CORREOS || 0) ? Math.min(Math.round(reviewed / Number(batchRow.MAX_CORREOS) * 100), 100) : 100;
  updateObjectRow_(APP.SHEETS.BATCHES, batchRow.__row, { ESTADO: status, CORREOS_REVISADOS: reviewed, PDF_ENCONTRADOS: pdfCount, CURSOR: done ? '' : searchDate, PENDING_MESSAGE_IDS_JSON: JSON.stringify(pendingIds), CORREOS_PROCESADOS_JSON: JSON.stringify(processedIds), FECHA_BUSQUEDA: searchDate, CURSOR_DIA: cursorDay, PENDING_SCAN_IDS_JSON: JSON.stringify(scanIds), CANDIDATOS_DIA_JSON: JSON.stringify(candidates), ESCANEO_DIA_COMPLETO: scanComplete, PROGRESO: done ? 100 : progress });
  if (done) logEvent_('INFO', 'LOTE_ANALIZADO', batchId, 'Vista previa preparada', { reviewedEmails: reviewed, pdfCount: pdfCount, exhaustedRange: exhausted, nextDate: searchDate }, batchId, requestId, user);
  const updated = getRows_(APP.SHEETS.BATCHES).find(function (item) { return String(item.LOTE_ID) === String(batchId); });
  return batchFromRow_(updated);
}

function messageMetadata_(message) {
  const headers = (message.payload && message.payload.headers) || [];
  const value = function (name) { const found = headers.find(function (header) { return String(header.name).toLowerCase() === name.toLowerCase(); }); return found ? String(found.value || '') : ''; };
  const recipients = [value('To'), value('Cc'), value('Delivered-To')].filter(Boolean).join(', ');
  const sent = (message.labelIds || []).indexOf('SENT') !== -1;
  return { sender: value('From'), recipients: recipients, subject: value('Subject'), date: new Date(Number(message.internalDate || Date.now())).toISOString(), gmailUrl: 'https://mail.google.com/mail/u/0/#all/' + message.id, direction: sent ? (normalizeText_(recipients).indexOf(normalizeText_(APP.OWNER_EMAIL)) !== -1 ? 'REENVIO RECIBIDO' : 'SALIENTE') : 'ENTRANTE' };
}

function isEligibleIncomingMessage_(message, metadata) {
  const sent = (message.labelIds || []).indexOf('SENT') !== -1;
  return !sent || normalizeText_(metadata.recipients).indexOf(normalizeText_(APP.OWNER_EMAIL)) !== -1;
}

function nextDate_(dateText) {
  const date = Utilities.parseDate(dateText, APP.TIMEZONE, 'yyyy-MM-dd');
  date.setDate(date.getDate() + 1);
  return Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd');
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
  const batchStates = getRows_(APP.SHEETS.BATCHES).reduce(function (map, row) { map[String(row.LOTE_ID || '')] = String(row.ESTADO || ''); return map; }, {});
  const registeredDuplicate = getRows_(APP.SHEETS.INVOICES).some(function (row) { return String(row.HASH_PDF || '') === hash || String(row.ID_UNICO || '') === sourceKey; });
  const activeTechnicalDuplicate = getRows_(APP.SHEETS.DOCUMENTS).some(function (row) { return String(row.HASH_PDF || '') === hash && String(row.FASE || '') !== 'CANCELADO' && batchStates[String(row.LOTE_ID || '')] !== 'CANCELADO'; });
  const duplicate = registeredDuplicate || activeTechnicalDuplicate;
  let extracted = { text: '', tempId: '' };
  let decision;
  try {
    extracted = ocrPdf_(bytes, attachment.filename);
    decision = duplicate ? { status: 'DUPLICADO IGNORADO', phase: 'LISTO PARA APROBAR', reason: 'La huella SHA-256 ya existe en el registro', fields: {}, evidence: [{ field: 'duplicate', value: hash, source: 'PDF', excerpt: 'Coincidencia exacta de bytes' }] } : classifyInvoiceText_(extracted.text, metadata.sender, metadata.subject, attachment.filename, metadata.date);
  } catch (error) {
    decision = { status: 'REVISIÓN MANUAL', phase: 'EN REVISIÓN', reason: 'No se pudo extraer texto fiable: ' + (error.message || error), fields: {}, evidence: [] };
  } finally {
    if (extracted.tempId) try { DriveApp.getFileById(extracted.tempId).setTrashed(true); } catch (_) {}
  }
  const fields = decision.fields || {};
  const id = 'DOC-' + uuid_();
  appendObject_(APP.SHEETS.DOCUMENTS, {
    DOCUMENTO_ID: id, LOTE_ID: batchId, MESSAGE_ID: messageId, ATTACHMENT_ID: attachment.attachmentId, SOURCE_KEY: sourceKey, NOMBRE_ORIGINAL: attachment.filename,
    REMITENTE: metadata.sender, DESTINATARIOS: metadata.recipients || '', DIRECCION_CORREO: metadata.direction || 'ENTRANTE', ASUNTO: metadata.subject, FECHA_CORREO: metadata.date, FECHA_FACTURA: fields.invoiceDate || '', PROVEEDOR: fields.supplier || '', PROVEEDOR_ID: fields.supplierId || '', CIF_NIF: fields.taxId || '', NUMERO_FACTURA: fields.invoiceNumber || '', IMPORTE_TOTAL: fields.total === undefined || fields.total === null ? '' : fields.total, MONEDA: fields.currency || '', FASE: decision.phase, ESTADO_PROPUESTO: decision.status, ESTADO_FINAL: '', MOTIVO_REVISION: decision.reason || '', EVIDENCIA_JSON: JSON.stringify(decision.evidence || []), HASH_PDF: hash, GMAIL_URL: metadata.gmailUrl, SELECCIONADO: decision.phase === 'LISTO PARA APROBAR', ACTUALIZADO_EN: nowIso_(), ACTUALIZADO_POR: user, ERROR: '', REQUEST_ID: requestId, PROVEEDOR_NO_HABITUAL: false,
  });
  logEvent_('INFO', 'DOCUMENTO_ANALIZADO', id, attachment.filename, { status: decision.status, hash: hash }, batchId, requestId, user);
}

function ocrPdf_(bytes, fileName) {
  const blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  let created;
  let createError;
  for (let createAttempt = 0; createAttempt < 3; createAttempt += 1) {
    try {
      created = Drive.Files.create({ name: 'OCR TEMP ' + uuid_(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'es', fields: 'id,name' });
      break;
    } catch (error) {
      createError = error;
      Utilities.sleep(Math.pow(2, createAttempt) * 1200);
    }
  }
  if (!created) throw createError || appError_('OCR_CREATE_FAILED', 'No se pudo iniciar el OCR.');
  let text = '';
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { text = DocumentApp.openById(created.id).getBody().getText(); if (text) break; } catch (error) { lastError = error; Utilities.sleep(Math.pow(2, attempt) * 900); }
  }
  if (!text && lastError) { try { DriveApp.getFileById(created.id).setTrashed(true); } catch (_) {} throw lastError; }
  return { text: text, tempId: created.id };
}

function classifyInvoiceText_(text, sender, subject, fileName, emailDate) {
  const normalized = normalizeText_(text);
  const documentContext = normalizeText_([fileName || '', subject || '', text].join('\n'));
  const evidence = [];
  const negative = ['presupuesto', 'propuesta comercial', 'propuesta de servicio', 'albaran', 'nota de entrega', 'shipment slip', 'confirmacion de pedido', 'etiqueta de devolucion'];
  const invoiceSignals = ['factura', 'facture', 'fattura', 'invoice', 'tax invoice', 'numero de factura', 'invoice number', 'iva', 'vat', 'importe total', 'grand total', 'amount due', 'total ttc', 'totale fattura'];
  const negativeHits = negative.filter(function (term) { return normalized.indexOf(term) !== -1; });
  const signalHits = invoiceSignals.filter(function (term) { return normalized.indexOf(term) !== -1; });
  const strongInvoiceContext = isStrongInvoiceContext_(text, subject, fileName);
  const explicitNonInvoiceFile = /^(?:order[_ -]|bon[-_ ]livraison|entrega[_ -]|shipment[-_ ]slip|rmas?[_ -])/i.test(String(fileName || ''));
  if (explicitNonInvoiceFile && !strongInvoiceContext) return { status: 'NO ES FACTURA', phase: 'LISTO PARA APROBAR', reason: 'El nombre y contenido identifican un documento de entrega, pedido o devolución', fields: {}, evidence: [{ field: 'classification', value: 'NO ES FACTURA', source: 'NOMBRE DE ARCHIVO', excerpt: String(fileName || '') }] };
  if (negativeHits.length && !strongInvoiceContext && (explicitNonInvoiceFile || signalHits.length < 2)) return { status: 'NO ES FACTURA', phase: 'LISTO PARA APROBAR', reason: 'El contenido identifica ' + negativeHits[0], fields: {}, evidence: [{ field: 'classification', value: 'NO ES FACTURA', source: 'PDF', excerpt: negativeHits.join(', ') }] };
  const reparaProAsBuyer = /(?:cliente|facturar a|bill to|customer|n\.?i\.?f\.? cliente)[\s\S]{0,400}(?:reparapro|b09740036)/.test(normalized);
  const reparaProAsIssuer = /reparapro[\s\S]{0,180}(?:cif|nif|vat)[\s:#-]*(?:es)?b09740036/.test(normalized.slice(0, 700));
  if (reparaProAsIssuer && !reparaProAsBuyer && strongInvoiceContext) return { status: 'FACTURA DE VENTA', phase: 'LISTO PARA APROBAR', reason: 'Documento emitido por ReparaPRO', fields: {}, evidence: [{ field: 'issuer', value: 'ReparaPRO', source: 'PDF', excerpt: 'CIF de ReparaPRO acreditado como emisor' }] };
  if (!strongInvoiceContext && signalHits.length < 2) return { status: 'REVISIÓN MANUAL', phase: 'EN REVISIÓN', reason: 'No hay señales suficientes para identificar una factura', fields: {}, evidence: [{ field: 'classification', value: signalHits.join(', '), source: 'PDF', excerpt: 'Señales detectadas insuficientes' }] };
  const creditNoteTerm = ['credit note', 'nota de credito', 'abono', 'avoir'].find(function (term) { return documentContext.indexOf(term) !== -1; });
  const rectificativeTerm = ['factura rectificativa', 'rectificativa', 'corrective invoice'].find(function (term) { return documentContext.indexOf(term) !== -1; });
  const providers = activeProviders_();
  const domainMatch = String(sender || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  const senderDomain = domainMatch ? domainMatch[1].replace(/[>\s].*$/, '') : '';
  const ruleMatch = providerFromRules_(text, sender, subject, providers);
  const historyMatch = providerFromHistory_(sender, providers);
  const providerMatch = ruleMatch || historyMatch || providerFromDocument_(text, sender, fileName, providers);
  const provider = providerMatch ? enrichProviderTaxId_(providerMatch.provider) : null;
  const numberResult = extractInvoiceNumber_(text, fileName, !!creditNoteTerm);
  const invoiceNumber = numberResult.value;
  const distinctNumbers = numberResult.strongValues;
  const dateResult = extractInvoiceDate_(text, fileName, emailDate);
  const totalResult = extractInvoiceTotal_(text);
  const extractedTotal = totalResult.value;
  const total = creditNoteTerm && extractedTotal !== null ? -Math.abs(extractedTotal) : extractedTotal;
  const currency = inferInvoiceCurrency_(text, totalResult.currencyToken);
  const fields = { supplier: provider ? provider.name : '', supplierId: provider ? provider.id : '', taxId: provider ? provider.taxId : '', invoiceNumber: invoiceNumber, invoiceDate: dateResult.value, total: total, currency: currency };
  if (creditNoteTerm) evidence.push({ field: 'documentType', value: 'NOTA DE CRÉDITO', source: 'PDF', excerpt: creditNoteTerm + (fileName ? ' · ' + fileName : '') });
  if (provider) evidence.push({ field: 'supplier', value: provider.name, source: providerMatch.source, excerpt: providerMatch.evidence });
  if (fields.invoiceNumber) evidence.push({ field: 'invoiceNumber', value: fields.invoiceNumber, source: numberResult.source, excerpt: numberResult.excerpt });
  if (fields.invoiceDate) evidence.push({ field: 'invoiceDate', value: fields.invoiceDate, source: dateResult.source, excerpt: dateResult.excerpt });
  if (total !== null) evidence.push({ field: 'total', value: total + ' ' + currency, source: 'PDF', excerpt: totalResult.excerpt });
  const errors = [];
  if (rectificativeTerm && !creditNoteTerm) errors.push('Documento ' + rectificativeTerm + ': tratamiento contable pendiente');
  if (!creditNoteTerm && distinctNumbers.length > 1) errors.push('El PDF contiene varias facturas o números de factura distintos');
  if (!provider) errors.push('Proveedor desconocido o inactivo' + (senderDomain ? ' (' + senderDomain + ')' : ''));
  if (!fields.invoiceNumber) errors.push('Número de factura ausente o ambiguo');
  if (!fields.invoiceDate) errors.push('Fecha de emisión ausente o inválida');
  if (total === null || total === 0) errors.push('Importe total ausente o inválido');
  if (!currency) errors.push('Moneda ausente o ambigua');
  const reason = errors.length ? errors.join('; ') : creditNoteTerm ? 'Nota de crédito acreditada; se archivará en gastos con importe negativo.' : '';
  return { status: errors.length ? 'REVISIÓN MANUAL' : 'PROCESADA', phase: errors.length ? 'EN REVISIÓN' : 'LISTO PARA APROBAR', reason: reason, fields: fields, evidence: evidence };
}

function isStrongInvoiceContext_(text, subject, fileName) {
  const file = normalizeText_(String(fileName || '').replace(/\.pdf$/i, ''));
  const header = normalizeText_(String(text || '').slice(0, 1400));
  const subjectText = normalizeText_(subject || '');
  return /^(?:factura|facture|fattura|invoice|avoir|credit note)\b/.test(file) || /\b(?:factura|facture|fattura|invoice|avoir|credit note|nota de credito)\s*(?:n|no|num|numero|number|#|[-_:])/.test(header) || /\b(?:factura|invoice|avoir|credit note)\b/.test(subjectText);
}

function senderEmail_(sender) {
  const match = String(sender || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : '';
}

function providerFromHistory_(sender, providers) {
  const email = senderEmail_(sender);
  if (!email) return null;
  const counts = {};
  getRows_(APP.SHEETS.INVOICES).forEach(function (row) {
    if (String(row.ESTADO || '') !== 'PROCESADA' || senderEmail_(row.REMITENTE) !== email) return;
    const name = String(row.PROVEEDOR || '');
    if (name) counts[name] = (counts[name] || 0) + 1;
  });
  const winner = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  if (!winner) return null;
  const normalizedWinner = normalizeText_(winner);
  const provider = providers.find(function (item) { return [item.name].concat(item.aliases || []).some(function (name) { return providerNamesOverlap_(normalizeText_(name), normalizedWinner); }); });
  return provider ? { provider: provider, source: 'HISTÓRICO', evidence: email + ' · ' + counts[winner] + ' factura(s) procesada(s)' } : null;
}

function providerFromDocument_(text, sender, fileName, providers) {
  const normalized = normalizeText_(text);
  const senderDomainMatch = String(sender || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  const senderDomain = senderDomainMatch ? senderDomainMatch[1].replace(/[>\s].*$/, '') : '';
  const file = normalizeText_(fileName || '');
  const candidates = [];
  providers.forEach(function (item) {
    let score = 0;
    let evidence = '';
    if (item.domain && senderDomain && senderDomain.endsWith(String(item.domain).toLowerCase())) { score = 100; evidence = senderDomain; }
    if (item.taxId && normalized.indexOf(normalizeText_(item.taxId)) !== -1 && score < 95) { score = 95; evidence = item.taxId; }
    [item.name, String(item.name || '').split('(')[0]].concat(item.aliases || []).forEach(function (name) {
      const needle = normalizeText_(name);
      if (!needle || needle.length < 4) return;
      if (file.indexOf(needle) !== -1 && score < 80) { score = 80; evidence = fileName; }
      if (needle.length >= 8 && normalized.indexOf(needle) !== -1 && score < 60) { score = 60; evidence = name; }
    });
    if (score) candidates.push({ provider: item, score: score, source: score >= 95 ? 'CORREO/PDF' : 'PDF', evidence: evidence });
  });
  candidates.sort(function (a, b) { return b.score - a.score; });
  return candidates.length && (!candidates[1] || candidates[0].score > candidates[1].score) ? candidates[0] : null;
}

function enrichProviderTaxId_(provider) {
  if (!provider || provider.taxId) return provider;
  const target = normalizeText_(provider.name);
  const historical = getRows_(APP.SHEETS.INVOICES).find(function (row) { return String(row.ESTADO || '') === 'PROCESADA' && providerNamesOverlap_(normalizeText_(row.PROVEEDOR), target) && String(row.CIF_NIF || '').trim(); });
  if (!historical) return provider;
  const enriched = {};
  Object.keys(provider).forEach(function (key) { enriched[key] = provider[key]; });
  enriched.taxId = String(historical.CIF_NIF || '');
  return enriched;
}

function providerNamesOverlap_(left, right) {
  left = String(left || '').replace(/\bposible\b/g, '').replace(/\s+/g, ' ').trim();
  right = String(right || '').replace(/\bposible\b/g, '').replace(/\s+/g, ' ').trim();
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 10 && (left.indexOf(right) === 0 || right.indexOf(left) === 0));
}

function addExtractionCandidate_(list, value, score, source, excerpt) {
  const clean = String(value || '').trim().replace(/^[#:\s-]+|[.,;:\s]+$/g, '');
  if (!clean || /^(?:fecha|date|factura|invoice|numero|number)$/i.test(clean)) return;
  const existing = list.find(function (item) { return normalizeText_(item.value) === normalizeText_(clean); });
  if (!existing || score > existing.score) {
    if (existing) list.splice(list.indexOf(existing), 1);
    list.push({ value: clean, score: score, source: source, excerpt: excerpt || clean });
  }
}

function extractInvoiceNumber_(text, fileName, creditNote) {
  const candidates = [];
  const labelled = /(?:invoice\s*(?:number|no\.?|#)|n[uú]mero\s+(?:de\s+)?factura|n[ºo°.]?\s*(?:de\s+)?factura|factura\s*(?:n[ºo°.]|#|num(?:ero)?\.?|number)|facture\s*(?:n[ºo°.]|#)|numero\s+fattura|fattura\s*(?:n[ºo°.]|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/_-]{2,})/gi;
  Array.from(String(text || '').matchAll(labelled)).forEach(function (match) { addExtractionCandidate_(candidates, match[1], 100, 'PDF', match[0]); });
  const fileBase = String(fileName || '').replace(/\.pdf$/i, '');
  const filePatterns = creditNote ? [/\b(?:CN|NC)[-_\/]?\d[A-Z0-9\/_-]*/i, /\bA[-_\/]\d[A-Z0-9\/_-]*/i] : [/\b(?:INV|GOP|E\d{2}OR|FA|AS|A|S)[-_\/]?\d[A-Z0-9\/_-]*/i, /(?:factura|facture|fattura|invoice)[-_ ]+([A-Z0-9]+(?:[-_\/]\d[A-Z0-9\/_-]*)+)/i];
  filePatterns.forEach(function (pattern) { const match = fileBase.match(pattern); if (match) addExtractionCandidate_(candidates, match[1] || match[0], 90, 'NOMBRE DE ARCHIVO', fileName); });
  if (creditNote) { const match = [fileBase, String(text || '')].map(function (value) { return value.match(/\b(?:CN|NC)[-_\/]?\d[A-Z0-9\/_-]*/i); }).find(Boolean); if (match) addExtractionCandidate_(candidates, match[0], 110, 'NOMBRE DE ARCHIVO/PDF', match[0]); }
  candidates.sort(function (a, b) { return b.score - a.score; });
  const top = candidates[0] || { value: '', source: 'PDF', excerpt: '', score: 0 };
  const strongValues = candidates.filter(function (item) { return item.score >= 100; }).map(function (item) { return normalizeText_(item.value); }).filter(function (value, index, list) { return value && list.indexOf(value) === index; });
  return { value: top.value, source: top.source, excerpt: top.excerpt, confidence: top.score, strongValues: strongValues };
}

function extractInvoiceDate_(text, fileName, emailDate) {
  const candidates = [];
  const dateLabel = '(?:fecha(?:\\s+(?:de\\s+)?(?:emisi[oó]n|expedici[oó]n|factura))?|facturado\\s+el|invoice\\s+date|date\\s+(?:de\\s+facture|facture|de\\s+facturation|de\\s+cr[ée]ation|d[\'’]?[ée]mission)|data(?:\\s+(?:della\\s+fattura|emissione))?|date)';
  const labelled = new RegExp(dateLabel + '\\s*[:#-]?\\s*(20\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]20\\d{2})', 'gi');
  Array.from(String(text || '').matchAll(labelled)).forEach(function (match) { const value = parseDate_(match[1]); if (isPlausibleInvoiceDate_(value, emailDate)) candidates.push({ value: value, score: 100, source: 'PDF', excerpt: match[0] }); });
  const monthDate = new RegExp(dateLabel + '\\s*[:#-]?\\s*(\\d{1,2}\\s+(?:de\\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\\s+(?:de\\s+)?20\\d{2})', 'gi');
  Array.from(String(text || '').matchAll(monthDate)).forEach(function (match) { const value = parseNamedMonthDate_(match[1]); if (isPlausibleInvoiceDate_(value, emailDate)) candidates.push({ value: value, score: 100, source: 'PDF', excerpt: match[0] }); });
  if (!candidates.length) {
    const header = String(text || '').slice(0, 1600);
    const dates = Array.from(header.matchAll(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/g));
    const valid = dates.map(function (match) { return { value: parseDate_(match[1]), excerpt: match[0] }; }).filter(function (item) { return isPlausibleInvoiceDate_(item.value, emailDate); });
    const unique = valid.filter(function (item, index, list) { return list.findIndex(function (other) { return other.value === item.value; }) === index; });
    if (unique.length === 1) candidates.push({ value: unique[0].value, score: 70, source: 'PDF', excerpt: unique[0].excerpt });
  }
  candidates.sort(function (a, b) { return b.score - a.score; });
  return candidates[0] || { value: '', score: 0, source: 'PDF', excerpt: '' };
}

function parseNamedMonthDate_(value) {
  const normalized = normalizeText_(value).replace(/\bde\b/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(20\d{2})$/);
  if (!match) return '';
  const months = { enero: 1, janvier: 1, gennaio: 1, febrero: 2, fevrier: 2, febbraio: 2, marzo: 3, mars: 3, abril: 4, avril: 4, aprile: 4, mayo: 5, mai: 5, maggio: 5, junio: 6, juin: 6, giugno: 6, julio: 7, juillet: 7, luglio: 7, agosto: 8, aout: 8, septembre: 9, septiembre: 9, settembre: 9, octubre: 10, octobre: 10, ottobre: 10, noviembre: 11, novembre: 11, dicembre: 12, diciembre: 12, decembre: 12 };
  const month = months[match[2]];
  return month ? [match[3], ('0' + month).slice(-2), ('0' + match[1]).slice(-2)].join('-') : '';
}

function isPlausibleInvoiceDate_(value, emailDate) {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  if (isNaN(date.getTime()) || date.getUTCFullYear() < 2018) return false;
  const received = emailDate ? new Date(emailDate) : null;
  return !received || isNaN(received.getTime()) || date.getTime() <= received.getTime() + 7 * 86400000;
}

function extractInvoiceTotal_(text) {
  const candidates = [];
  const pattern = /(?:grand\s+total|importe\s+total|amount\s+due|net\s+[aà]\s+payer|total(?:\s+(?:a\s+pagar|factura|bruto|con\s+impuestos|ttc|due))?|totale(?:\s+(?:fattura|da\s+pagare))?)\s*(?:\([^)]{0,20}\))?\s*[:\s]*(?:EUR|USD|GBP|CHF|PLN|CAD|AUD|€|\$)?\s*([-+]?\d[\d., ]*)\s*(EUR|USD|GBP|CHF|PLN|CAD|AUD|€|\$)?/gi;
  Array.from(String(text || '').matchAll(pattern)).forEach(function (match) {
    const value = parseNumber_(match[1]);
    if (value !== null) candidates.push({ value: value, currencyToken: match[2] || (match[0].indexOf('€') !== -1 ? '€' : ''), excerpt: match[0] });
  });
  return candidates.length ? candidates[candidates.length - 1] : { value: null, currencyToken: '', excerpt: '' };
}

function inferInvoiceCurrency_(text, token) {
  const value = String(token || '').trim();
  if (value === '€') return 'EUR';
  if (/^[A-Z]{3}$/i.test(value)) return value.toUpperCase();
  const explicit = String(text || '').match(/\b(EUR|USD|GBP|CHF|PLN|CAD|AUD)\b/i);
  if (explicit) return explicit[1].toUpperCase();
  return String(text || '').indexOf('€') !== -1 ? 'EUR' : '';
}

function providerFromRules_(text, sender, subject, providers) {
  const rows = getRows_(APP.SHEETS.RULES).filter(function (row) { return toBoolean_(row.ACTIVA); }).sort(function (a, b) { return Number(b.PRIORIDAD || 0) - Number(a.PRIORIDAD || 0); });
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const field = normalizeText_(row.CAMPO || 'pdf');
    if (!/(?:proveedor|dominio|remitente|correo|asunto|pdf)/.test(field) || /(?:importe|total|numero|fecha|moneda)/.test(field)) continue;
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
    if (provider) return { provider: provider, source: 'REGLA', evidence: String(row.CAMPO || 'PDF') + ': ' + pattern };
  }
  return null;
}
