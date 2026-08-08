import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

type Provider = { id: string; name: string; domain: string; taxId: string; aliases: string[] };
type InvoiceRow = { ESTADO: string; REMITENTE: string; PROVEEDOR: string; CIF_NIF: string };

const appsRoot = path.resolve(process.cwd(), 'src/apps-script');
const source = ['Core.js', 'GmailService.js'].map((name) => fs.readFileSync(path.join(appsRoot, name), 'utf8')).join('\n');

const providers: Provider[] = [
  { id: 'orange', name: 'Orange', domain: 'orange.es', taxId: '', aliases: [] },
  { id: 'utopya', name: 'UTOPYA', domain: '', taxId: '', aliases: [] },
  { id: 'rphone', name: 'Componentes Digital-Cxin SL (Rphone)', domain: '', taxId: '', aliases: ['Rphone'] },
  { id: 'ltronics', name: 'LTronics', domain: '', taxId: 'DE123456789', aliases: [] },
];

const historical: InvoiceRow[] = [
  { ESTADO: 'PROCESADA', REMITENTE: 'Team UTOPYA <noreply@utopya.fr>', PROVEEDOR: 'UTOPYA', CIF_NIF: 'FR84791460660' },
  { ESTADO: 'PROCESADA', REMITENTE: 'CONTABILIDAD RPHONE B2B <contabilidad.rphoneb2b@outlook.es>', PROVEEDOR: 'Componentes Digital-Cxin SL (posible Rphone)', CIF_NIF: 'B10535169' },
];

const badRules = [
  { PROVEEDOR: 'Orange', CAMPO: 'importe', 'TEXTO_O_PATRÓN': 'importe total', PRIORIDAD: 1, ACTIVA: true },
  { PROVEEDOR: 'Orange', CAMPO: 'numero', 'TEXTO_O_PATRÓN': 'número de factura', PRIORIDAD: 1, ACTIVA: true },
];

function extractor() {
  const context = vm.createContext({
    APP: { TIMEZONE: 'Europe/Madrid', OWNER_EMAIL: 'compras@reparapro.com', SHEETS: { INVOICES: 'FACTURAS', RULES: 'REGLAS' } },
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    getRows_: (sheet: string) => sheet === 'FACTURAS' ? historical : sheet === 'REGLAS' ? badRules : [],
    activeProviders_: () => providers,
    toBoolean_: (value: unknown) => Boolean(value),
  });
  vm.runInContext(`${source}\nthis.__extractor = { classifyInvoiceText_ };`, context);
  return (context as unknown as { __extractor: { classifyInvoiceText_: (...args: string[]) => any } }).__extractor.classifyInvoiceText_;
}

describe('extracción documental de facturas', () => {
  let classify: ReturnType<typeof extractor>;

  beforeEach(() => { classify = extractor(); });

  it('ignora reglas genéricas de importe que antes asignaban Orange', () => {
    const result = classify(
      'AVOIR\nDate de facturation : 27/07/2026\nTotal TTC 13,60 EUR',
      'Team UTOPYA <noreply@utopya.fr>',
      'Confirmation de votre commande UTOPYA',
      'avoir-CN-5003840.pdf',
      '2026-07-27T12:00:00Z',
    );
    expect(result.status).toBe('PROCESADA');
    expect(result.fields).toMatchObject({ supplier: 'UTOPYA', taxId: 'FR84791460660', invoiceNumber: 'CN-5003840', invoiceDate: '2026-07-27', total: -13.6, currency: 'EUR' });
  });

  it('no clasifica como albarán una factura acreditada por nombre y campos', () => {
    const result = classify(
      'FACTURA\nFecha de emisión: 29/07/2026\nImporte total: 123,45 EUR\nAlbarán de entrega 9981',
      'CONTABILIDAD RPHONE B2B <contabilidad.rphoneb2b@outlook.es>',
      'COMPONENTES DIGITAL-CXIN SL',
      'Factura 1-008299 ReparaPRO Julio.pdf',
      '2026-07-29T15:00:00Z',
    );
    expect(result.status).toBe('PROCESADA');
    expect(result.fields).toMatchObject({ supplier: 'Componentes Digital-Cxin SL (Rphone)', taxId: 'B10535169', invoiceNumber: '1-008299', invoiceDate: '2026-07-29', total: 123.45, currency: 'EUR' });
  });

  it('no convierte un protocolo que menciona facturas en factura de venta', () => {
    const result = classify(
      'REPARAPRO CIF B09740036\nProtocolo para tramitar una factura con la financiera',
      'Cofidis <info@cofidis.es>',
      'Protocolo de colaboración',
      'PROTOCOLO COFIDIS REPARAPRO.pdf',
      '2026-07-27T12:00:00Z',
    );
    expect(result.status).toBe('REVISIÓN MANUAL');
  });

  it('reconoce etiquetas italianas de número, fecha y total', () => {
    const result = classify(
      'LTRONICS\nFattura n. AS68039\nData emissione: 28/07/2026\nTotale fattura: 88,50 EUR',
      'LTronics <billing@example.it>',
      'Fattura AS68039',
      'fattura-AS68039.pdf',
      '2026-07-28T12:00:00Z',
    );
    expect(result.status).toBe('PROCESADA');
    expect(result.fields).toMatchObject({ supplier: 'LTronics', invoiceNumber: 'AS68039', invoiceDate: '2026-07-28', total: 88.5, currency: 'EUR' });
  });

  it('reconoce un total sin sufijo y una fecha con el mes escrito', () => {
    const result = classify(
      'FACTURA\nFecha de emisión: 20 de julio de 2026\nTOTAL: 44,90 €\nAlbarán relacionado 22',
      'CONTABILIDAD RPHONE B2B <contabilidad.rphoneb2b@outlook.es>',
      'COMPONENTES DIGITAL-CXIN SL',
      'Factura 1-008568 ReparaPRO Julio.pdf',
      '2026-07-29T15:00:00Z',
    );
    expect(result.status).toBe('PROCESADA');
    expect(result.fields).toMatchObject({ invoiceNumber: '1-008568', invoiceDate: '2026-07-20', total: 44.9, currency: 'EUR' });
  });

  it('clasifica un BON-LIVRAISON por el nombre aunque el OCR no diga albarán', () => {
    const result = classify('UTOPYA\nCommande ES022483', 'Team UTOPYA <noreply@utopya.fr>', 'Votre commande est expédiée', 'BON-LIVRAISON-ES022483.pdf', '2026-07-29T12:00:00Z');
    expect(result.status).toBe('NO ES FACTURA');
  });
});
