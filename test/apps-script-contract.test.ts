import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src/apps-script');
const source = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(source('appsscript.json')) as { oauthScopes: string[]; webapp: { access: string; executeAs: string } };

describe('contrato de seguridad de Apps Script', () => {
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

  it('fusiona proveedores sin borrar el histórico', () => {
    const api = source('Api.js');
    const mergeStart = api.indexOf('function apiMergeSuppliers');
    const mergeSource = api.slice(mergeStart);
    expect(mergeStart).toBeGreaterThan(-1);
    expect(mergeSource).toContain('ACTIVO: false');
    expect(mergeSource).toContain("String(row.FASE || '') !== 'FINALIZADO'");
    expect(mergeSource).not.toContain("APP.SHEETS.INVOICES, row.__row");
  });

  it('no inventa moneda y conserva compatibilidad con REGLAS', () => {
    const gmail = source('GmailService.js');
    expect(gmail).toContain("if (!currency) errors.push('Moneda ausente o ambigua')");
    expect(gmail).toContain('function providerFromRules_');
    expect(gmail).toContain('APP.SHEETS.RULES');
    expect(gmail).not.toContain("fields.currency || 'EUR'");
    expect(source('InvoiceService.js')).not.toContain("MONEDA: row.MONEDA || 'EUR'");
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

  it('exige confirmación separada para activar producción', () => {
    const api = source('Api.js');
    expect(api).toContain("payload.confirmation || '') !== 'ACTIVAR_PRODUCCION'");
    expect(api).toContain("appError_('PRODUCTION_CONFIRMATION_REQUIRED'");
  });
});
