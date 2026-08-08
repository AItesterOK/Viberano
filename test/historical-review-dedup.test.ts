import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const appsRoot = path.resolve(process.cwd(), 'src/apps-script');
const source = ['Core.js', 'InvoiceService.js']
  .map((name) => fs.readFileSync(path.join(appsRoot, name), 'utf8'))
  .join('\n');

function matcher() {
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.__match = invoiceMatchesDocumentSource_;`, context);
  return (context as unknown as { __match: (invoice: Record<string, unknown>, document: Record<string, unknown>) => boolean }).__match;
}

describe('deduplicación de revisiones históricas', () => {
  it('reconoce el identificador actual de origen', () => {
    const matches = matcher();
    expect(matches(
      { ID_UNICO: 'message|attachment|factura.pdf' },
      { SOURCE_KEY: 'message|attachment|factura.pdf', MESSAGE_ID: 'message', NOMBRE_ORIGINAL: 'factura.pdf' },
    )).toBe(true);
  });

  it('reconoce una fila histórica por mensaje Gmail y nombre de archivo', () => {
    const matches = matcher();
    const document = { SOURCE_KEY: '19bb71657af5f90d|new-attachment|G354441 - Factura M222TFIZLE5.pdf', MESSAGE_ID: '19bb71657af5f90d', NOMBRE_ORIGINAL: 'G354441 - Factura M222TFIZLE5.pdf' };
    expect(matches({
      REFERENCIA_CORREO: 'https://mail.google.com/mail/#all/19bb71657af5f90d',
      ID_UNICO: 'gmail:19bb71657af5f90d|G354441 - Factura M222TFIZLE5.pdf',
      NOMBRE_ORIGINAL: 'G354441 - Factura M222TFIZLE5.pdf',
    }, document)).toBe(true);
  });

  it('no une adjuntos distintos del mismo correo', () => {
    const matches = matcher();
    expect(matches(
      { REFERENCIA_CORREO: 'https://mail.google.com/mail/#all/abc123', NOMBRE_ORIGINAL: 'factura-1.pdf' },
      { MESSAGE_ID: 'abc123', NOMBRE_ORIGINAL: 'factura-2.pdf' },
    )).toBe(false);
  });
});
