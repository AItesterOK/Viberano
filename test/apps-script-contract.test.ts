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
});
