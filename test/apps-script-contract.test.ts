import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src/apps-script');
const source = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(source('appsscript.json')) as { oauthScopes: string[]; webapp: { access: string; executeAs: string } };

describe('contrato de seguridad de Apps Script', () => {
  it('no bloquea el arranque si el web app no puede leer activadores', () => {
    expect(source('Core.js')).toContain('catch (_)');
    expect(source('Core.js')).toContain('return null;');
    expect(source('Api.js')).toContain('triggerDiagnosticAvailable: triggers !== null');
  });

  it('fija la continuación cronológica en el 18 de julio de 2026', () => {
    expect(source('Config.js')).toContain("START_DATE: '2026-07-18'");
    expect(source('GmailService.js')).toContain('const minimumDate = effectiveStartDate_(config)');
    expect(source('Data.js')).toContain('configured < APP.START_DATE ? APP.START_DATE : configured');
  });

  it('no confunde a ReparaPRO cliente con el emisor de una venta', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain('const reparaProAsBuyer =');
    expect(gmail).toContain('reparaProAsIssuer && !reparaProAsBuyer');
    expect(gmail).toContain('total\\s+(?:a\\s+pagar|factura|bruto|con\\s+impuestos)');
  });

  it('restringe el despliegue al dominio y a la identidad del propietario', () => {
    expect(manifest.webapp).toEqual({ access: 'DOMAIN', executeAs: 'USER_DEPLOYING' });
    const core = source('Core.js');
    expect(core).toContain("if (!active) throw appError_('IDENTITY_UNAVAILABLE'");
    expect(core).toContain("if (effective !== APP.OWNER_EMAIL) throw appError_('INVALID_DEPLOYER'");
    expect(core).toContain("if (allowed.indexOf(active) === -1) throw appError_('ACCESS_DENIED'");
  });

  it('mantiene Gmail estrictamente en solo lectura', () => {
    expect(manifest.oauthScopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(manifest.oauthScopes.some((scope) => scope === 'https://mail.google.com/' || scope.endsWith('/gmail.modify'))).toBe(false);
    expect(source('GmailService.js')).not.toMatch(/Gmail\.Users\.(Messages|Threads)\.(modify|delete|trash|untrash|send)/);
  });

  it('hace una copia antes de ejecutar la migración aditiva', () => {
    const data = source('Data.js');
    const setupAt = data.indexOf('function setupSchema_');
    const backupAt = data.indexOf('Drive.Files.copy', setupAt);
    const firstSchemaWriteAt = data.indexOf('ensureSheetHeaders_', backupAt);
    expect(backupAt).toBeGreaterThan(-1);
    expect(firstSchemaWriteAt).toBeGreaterThan(backupAt);
  });

  it('no califica como impagada una ausencia de conciliación', () => {
    const allServerSource = fs.readdirSync(root).filter((name) => name.endsWith('.js')).map(source).join('\n');
    expect(allServerSource.toUpperCase()).not.toContain('IMPAGADA');
  });

  it('conserva cursor por mensaje y una cola de revisión recuperable', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain('PENDING_MESSAGE_IDS_JSON');
    expect(gmail).toContain('CORREOS_PROCESADOS_JSON');
    expect(gmail).toContain('processedIds.indexOf(messageId)');
    expect(source('Data.js')).toContain('function reviewDocuments_()');
    expect(source('Api.js')).toContain('function apiApproveDocument');
  });

  it('no infiere silenciosamente la moneda bancaria', () => {
    const bank = source('BankService.js');
    expect(bank).toContain("mapping.currency === undefined");
    expect(bank).toContain("appError_('INVALID_BANK_CURRENCY'");
    expect(bank).toContain('no se asumirá EUR');
  });

  it('recupera una escritura parcial sin duplicar el registro definitivo', () => {
    const invoice = source('InvoiceService.js');
    expect(invoice).toContain('const sameSource = existingRows.find');
    expect(invoice).toContain("if (sameSource)");
    expect(invoice.indexOf('if (sameSource)')).toBeLessThan(invoice.indexOf("writeInvoiceRegister_(row, 'DUPLICADO IGNORADO'"));
  });

  it('mantiene las excepciones justificadas fuera de la aprobación', () => {
    const invoice = source('InvoiceService.js');
    expect(invoice).toContain("const keepInReview = input.proposedStatus === 'REVISIÓN MANUAL'");
    expect(invoice).toContain("errors.length || keepInReview ? 'EN REVISIÓN' : 'LISTO PARA APROBAR'");
    expect(invoice).toContain("SELECCIONADO: phase === 'LISTO PARA APROBAR'");
  });

  it('archiva notas de crédito acreditadas con importe negativo', () => {
    const gmail = source('GmailService.js');
    const invoice = source('InvoiceService.js');
    const core = source('Core.js');
    expect(gmail).toContain("const total = creditNoteTerm && extractedTotal !== null ? -Math.abs(extractedTotal) : extractedTotal");
    expect(gmail).toContain("value: 'NOTA DE CRÉDITO'");
    expect(gmail).toContain("'Nota de crédito acreditada; se archivará en gastos con importe negativo.'");
    expect(core).toContain('function isCreditNoteDocument_');
    expect(core).toContain('creditNote ? amount < 0 : amount > 0');
    expect(invoice).toContain('isValidInvoiceAmount_(input.total, input, payload.reason)');
    expect(invoice).toContain('isValidInvoiceAmount_(row.IMPORTE_TOTAL, row)');
  });

  it('acota el historial enviado durante el arranque', () => {
    const api = source('Api.js');
    expect(api).toContain("safeRows_(APP.SHEETS.LOG).slice(-50).reverse()");
    expect(api).toContain("detail: String(row.DETALLE || '').slice(0, 1000)");
  });

  it('normaliza todas las respuestas para google.script.run', () => {
    const core = source('Core.js');
    expect(core).toContain('JSON.parse(JSON.stringify(data))');
    expect(core).toContain('data === undefined ? null');
  });

  it('fusiona proveedores sin borrar el histórico', () => {
    const api = source('Api.js');
    const mergeStart = api.indexOf('function apiMergeSuppliers');
    const mergeSource = api.slice(mergeStart);
    expect(mergeStart).toBeGreaterThan(-1);
    expect(mergeSource).toContain('ACTIVO: false');
    expect(mergeSource).toContain("String(row.FASE || '') !== 'FINALIZADO'");
    expect(mergeSource).not.toContain("APP.SHEETS.INVOICES, row.__row");
  });

  it('impide crear proveedores duplicados por nombre o CIF', () => {
    const api = source('Api.js');
    expect(api).toContain("appError_('SUPPLIER_ALREADY_EXISTS'");
    expect(api).toContain('normalizeText_(row.PROVEEDOR) === normalizeText_(input.name)');
    expect(api).toContain("String(row.CIF_NIF || '').trim().toUpperCase()");
  });

  it('no inventa moneda y conserva compatibilidad con REGLAS', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain("if (!currency) errors.push('Moneda ausente o ambigua')");
    expect(gmail).toContain('function providerFromRules_');
    expect(gmail).toContain('APP.SHEETS.RULES');
    expect(gmail).not.toContain("fields.currency || 'EUR'");
    expect(source('InvoiceService.js')).not.toContain("MONEDA: row.MONEDA || 'EUR'");
  });

  it('vacía los campos contables de los documentos que no son facturas de gasto', () => {
    const invoice = source('InvoiceService.js');
    expect(invoice).toContain("const keepAccountingFields = proposed === 'PROCESADA' || proposed === 'REVISIÓN MANUAL'");
    expect(invoice).toContain("FECHA_FACTURA: keepAccountingFields ? parseDate_(input.invoiceDate) : ''");
    expect(invoice).toContain("IMPORTE_TOTAL: keepAccountingFields && Number.isFinite(Number(row.IMPORTE_TOTAL)) ? Number(row.IMPORTE_TOTAL) : ''");
    expect(invoice).toContain("PROVEEDOR: keepAccountingFields ? row.PROVEEDOR || '' : ''");
  });

  it('elimina la conversión OCR también cuando falla la lectura', () => {
    const gmail = source('GmailService.js');
    const failureCleanup = "if (!text && lastError) { try { DriveApp.getFileById(created.id).setTrashed(true); }";
    expect(gmail).toContain(failureCleanup);
  });

  it('detiene de forma controlada al alcanzar cuotas', () => {
    const core = source('Core.js');
    expect(core).toContain("'QUOTA_LIMIT'");
    expect(core).toContain('conservando el punto de continuación');
  });

  it('normaliza las fechas que Google Sheets devuelve como objetos Date', () => {
    const gmail = source('GmailService.js');
    const data = source('Data.js');
    const invoice = source('InvoiceService.js');
    const core = source('Core.js');
    expect(gmail).toContain('const minimumDate = effectiveStartDate_(config)');
    expect(gmail).toContain('const batchDateFrom = parseDate_(batchRow.FECHA_DESDE)');
    expect(gmail).toContain('const batchDateTo = parseDate_(batchRow.FECHA_HASTA)');
    expect(gmail).not.toContain("String(batchRow.FECHA_DESDE) + 'T00:00:00+02:00'");
    expect(data).toContain('invoiceDate: parseDate_(row.FECHA_FACTURA)');
    expect(data).toContain('date: parseDate_(row.FECHA_FACTURA)');
    expect(invoice).toContain("FECHA_FACTURA: keepAccountingFields ? parseDate_(input.invoiceDate) : ''");
    expect(invoice).toContain('const invoiceDate = parseDate_(row.FECHA_FACTURA)');
    expect(invoice).toContain("FECHA_FACTURA: keepAccountingFields ? parseDate_(row.FECHA_FACTURA) : ''");
    expect(core).toContain("const parts = parseDate_(dateText).split('-').map(Number)");
  });

  it('descodifica adjuntos Gmail como Base64 URL-safe sin convertir el alfabeto', () => {
    const core = source('Core.js');
    expect(core).toContain('if (Array.isArray(value)) return value');
    expect(core).toContain("appError_('ATTACHMENT_DATA_EMPTY'");
    expect(core).toContain("const padded = text + '='.repeat((4 - text.length % 4) % 4)");
    expect(core).toContain('Utilities.base64DecodeWebSafe(padded)');
    expect(core).toContain("Utilities.base64Decode(padded.replace(/-/g, '+').replace(/_/g, '/'))");
    expect(core).toContain("appError_('ATTACHMENT_DECODE_FAILED'");
  });

  it('exige confirmación separada para activar producción', () => {
    const api = source('Api.js');
    expect(api).toContain("payload.confirmation || '') !== 'ACTIVAR_PRODUCCION'");
    expect(api).toContain("appError_('PRODUCTION_CONFIRMATION_REQUIRED'");
  });

  it('filtra correo saliente y conserva un cursor cronológico por día', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain("(message.labelIds || []).indexOf('SENT')");
    expect(gmail).toContain('isEligibleIncomingMessage_');
    expect(gmail).toContain('FECHA_BUSQUEDA');
    expect(gmail).toContain('PENDING_SCAN_IDS_JSON');
    expect(gmail).toContain('CANDIDATOS_DIA_JSON');
    expect(gmail).toContain('candidates.sort');
    expect(gmail).toContain('nextDate_');
  });

  it('cancela lotes sin crear facturas ni archivos definitivos', () => {
    const gmail = source('GmailService.js');
    const start = gmail.indexOf('function cancelBatch_');
    const end = gmail.indexOf('function analyzeBatchSlice_', start);
    const cancel = gmail.slice(start, end);
    expect(cancel).toContain("FASE: 'CANCELADO'");
    expect(cancel).toContain("ESTADO: 'CANCELADO'");
    expect(cancel).toContain('definitiveWrites: 0');
    expect(cancel).not.toContain('APP.SHEETS.INVOICES');
    expect(cancel).not.toContain('Drive.Files.create');
    expect(source('Api.js')).toContain('function apiCancelBatch');
  });

  it('permite reanalizar documentos procedentes de un lote cancelado', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain("String(row.FASE || '') !== 'CANCELADO'");
    expect(gmail).toContain("batchStates[String(row.LOTE_ID || '')] !== 'CANCELADO'");
    expect(gmail).toContain('const duplicate = registeredDuplicate || activeTechnicalDuplicate');
  });

  it('descarta vistas previas bancarias y bloquea decisiones prematuras', () => {
    const bank = source('BankService.js');
    expect(bank).toContain('function cancelBankImport_');
    expect(bank).toContain("ESTADO_IMPORTACION: 'CANCELADA'");
    expect(bank).toContain('setTrashed(true)');
    expect(bank).toContain("appError_('BANK_IMPORT_NOT_CONFIRMED'");
    expect(bank).toContain('PERIODO_DETECTADO_DESDE');
    expect(source('Api.js')).toContain('function apiCancelBankImport');
  });

  it('permite inventariar y retirar solo activadores antiguos confirmados', () => {
    const core = source('Core.js');
    expect(core).toContain('function projectTriggers_');
    expect(core).toContain("['procesarFacturasPendientes', 'myFunction']");
    expect(core).toContain("'DESACTIVAR_AUTOMATIZACION_ANTIGUA'");
    expect(core).toContain('ScriptApp.deleteTrigger(trigger)');
  });
});
