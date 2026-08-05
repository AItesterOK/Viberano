function nowIso_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function uuid_() { return Utilities.getUuid(); }

function apiOk_(data, requestId) {
  // google.script.run solo admite valores JSON seguros. Una fecha de Sheets,
  // un undefined o un número no finito puede convertir toda la respuesta en null.
  const serializable = data === undefined ? null : JSON.parse(JSON.stringify(data));
  return { ok: true, data: serializable, requestId: requestId || uuid_() };
}

function apiError_(error, requestId) {
  const message = error && error.message ? error.message : String(error);
  const quota = /quota|too many requests|rate limit|service invoked too many times|límite de servicio/i.test(message);
  const code = error && error.code ? error.code : quota ? 'QUOTA_LIMIT' : 'SERVER_ERROR';
  const safeMessage = quota ? 'Google ha alcanzado temporalmente una cuota. La operación se ha detenido conservando el punto de continuación.' : message;
  return { ok: false, error: { code: code, message: safeMessage, retryable: quota || Boolean(error && error.retryable), details: error && error.details ? error.details : undefined }, requestId: requestId || uuid_() };
}

function withApi_(payload, callback, options) {
  const requestId = payload && payload.requestId ? payload.requestId : uuid_();
  try {
    const user = assertAuthorized_();
    if (options && options.lock) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) throw appError_('CONCURRENT_OPERATION', 'Hay otra operación de escritura en curso. Reintenta en unos segundos.', true);
      try { return apiOk_(callback(user, requestId), requestId); } finally { lock.releaseLock(); }
    }
    return apiOk_(callback(user, requestId), requestId);
  } catch (error) {
    try { logEvent_('ERROR', 'API_ERROR', '', error.message || String(error), { code: error.code || 'SERVER_ERROR', details: error.details || {} }, '', requestId); } catch (_) {}
    return apiError_(error, requestId);
  }
}

function appError_(code, message, retryable, details) {
  const error = new Error(message);
  error.code = code;
  error.retryable = Boolean(retryable);
  error.details = details;
  return error;
}

function getActiveEmail_() { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
function getEffectiveEmail_() { return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); }

// Ejecutar manualmente una sola vez desde el editor antes del primer acceso web.
// Fuerza el consentimiento de todos los servicios sin modificar Gmail, Drive o Sheets.
function authorizeApplication() {
  return {
    activeUser: Session.getActiveUser().getEmail(),
    effectiveUser: Session.getEffectiveUser().getEmail(),
    gmailAddress: Gmail.Users.getProfile('me').emailAddress,
    spreadsheetName: SpreadsheetApp.openById(APP.SPREADSHEET_ID).getName(),
    invoiceFolderId: Drive.Files.get(APP.INVOICE_FOLDER_ID, { fields: 'id' }).id,
  };
}

function projectTriggers_() {
  try {
    return ScriptApp.getProjectTriggers().map(function (trigger) {
      return { id: trigger.getUniqueId(), handler: trigger.getHandlerFunction(), eventType: String(trigger.getEventType()), source: String(trigger.getTriggerSource()) };
    });
  } catch (_) {
    return null;
  }
}

function disableLegacyTriggers_(payload, user, requestId) {
  if (String(payload.confirmation || '') !== 'DESACTIVAR_AUTOMATIZACION_ANTIGUA') throw appError_('CONFIRMATION_REQUIRED', 'Debes confirmar la retirada de los activadores antiguos.');
  const legacyHandlers = ['procesarFacturasPendientes', 'myFunction'];
  const removed = [];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (legacyHandlers.indexOf(trigger.getHandlerFunction()) === -1) return;
    removed.push({ id: trigger.getUniqueId(), handler: trigger.getHandlerFunction(), eventType: String(trigger.getEventType()), source: String(trigger.getTriggerSource()) });
    ScriptApp.deleteTrigger(trigger);
  });
  logEvent_('WARN', 'ACTIVADORES_ANTIGUOS_DESACTIVADOS', 'TRIGGERS', removed.length + ' activadores retirados', { removed: removed }, '', requestId, user);
  return { removed: removed, remaining: projectTriggers_() || [] };
}

function assertAuthorized_() {
  const active = getActiveEmail_();
  const effective = getEffectiveEmail_();
  if (!active) throw appError_('IDENTITY_UNAVAILABLE', 'Google no ha identificado al usuario activo. Acceso denegado por seguridad.');
  if (effective !== APP.OWNER_EMAIL) throw appError_('INVALID_DEPLOYER', 'El despliegue debe ejecutarse como compras@reparapro.com.');
  const config = getConfigMap_();
  const allowed = String(config.APP_ALLOWED_USERS || APP.OWNER_EMAIL).split(/[;,\s]+/).map(function (value) { return value.trim().toLowerCase(); }).filter(Boolean);
  if (allowed.indexOf(active) === -1) throw appError_('ACCESS_DENIED', 'Tu cuenta no está incluida en la lista de usuarios autorizados.');
  return active;
}

function bytesHash_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function (value) { const normalized = value < 0 ? value + 256 : value; return ('0' + normalized.toString(16)).slice(-2); }).join('');
}

function normalizeText_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function safeJsonParse_(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function toBoolean_(value) { return value === true || String(value).toUpperCase() === 'TRUE'; }

function base64UrlDecode_(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || '').replace(/\s+/g, '');
  if (!text) throw appError_('ATTACHMENT_DATA_EMPTY', 'Gmail no devolvió bytes para el adjunto.', false, { valueType: typeof value, isArray: Array.isArray(value) });
  const padded = text + '='.repeat((4 - text.length % 4) % 4);
  try {
    return Utilities.base64DecodeWebSafe(padded);
  } catch (webSafeError) {
    try {
      return Utilities.base64Decode(padded.replace(/-/g, '+').replace(/_/g, '/'));
    } catch (standardError) {
      throw appError_('ATTACHMENT_DECODE_FAILED', 'Gmail devolvió un adjunto que no se pudo descodificar.', false, {
        valueType: typeof value,
        length: text.length,
        remainder: text.length % 4,
        urlSafeAlphabet: /^[A-Za-z0-9_-]+={0,2}$/.test(text),
      });
    }
  }
}

function sanitizeFileName_(value) { return String(value || '').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim(); }

function escapeDriveQuery_(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function parseNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const compact = String(value || '').replace(/[^\d,.-]/g, '');
  if (!compact) return null;
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  const normalized = comma > dot ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  const number = Number(normalized);
  return isFinite(number) ? number : null;
}

function parseDate_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return [match[1], ('0' + match[2]).slice(-2), ('0' + match[3]).slice(-2)].join('-');
  match = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (match) return [match[3], ('0' + match[2]).slice(-2), ('0' + match[1]).slice(-2)].join('-');
  const date = new Date(text);
  return isNaN(date.getTime()) ? '' : Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd');
}

function formatInvoiceName_(doc) {
  return [doc.invoiceDate, sanitizeFileName_(doc.supplier), Number(doc.total).toFixed(2) + ' ' + doc.currency, sanitizeFileName_(doc.invoiceNumber)].join(' - ') + '.pdf';
}

function monthInfo_(dateText) {
  const parts = dateText.split('-').map(Number);
  const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const quarters = ['1er. Trimestre', '2do. Trimestre', '3er. Trimestre', '4to. Trimestre'];
  return { year: String(parts[0]), quarter: quarters[Math.floor((parts[1] - 1) / 3)], month: ('0' + parts[1]).slice(-2) + ' - ' + names[parts[1] - 1] };
}
