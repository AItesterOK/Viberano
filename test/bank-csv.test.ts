import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const bankSource = fs.readFileSync(new URL('../src/apps-script/BankService.js', import.meta.url), 'utf8');

function normalizeText(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseNumber(value: unknown) {
  const compact = String(value ?? '').replace(/[^\d,.-]/g, '');
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  const normalized = comma > dot ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown) {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function runtime(formats: unknown[] = []) {
  const context = vm.createContext({
    normalizeText_: normalizeText,
    parseNumber_: parseNumber,
    parseDate_: parseDate,
    bankFormats_: () => formats,
    appError_: (code: string, message: string, retryable?: boolean, details?: unknown) => Object.assign(new Error(message), { code, retryable, details }),
  });
  vm.runInContext(bankSource, context);
  return context as unknown as { normalizeBankRows_: (values: string[][], mapping: Record<string, unknown> | null, context: Record<string, unknown>) => { rows: { amount: number; currency: string; operationDate: string }[]; profile?: { id: string; name: string } } };
}

describe('importación bancaria CSV', () => {
  const caixaRows = [
    ['Concepto', 'Fecha', 'Importe', 'Saldo'],
    ['FACTURA DEMO 100', '20/07/2026', '-1.150,00EUR', '-9.999,99EUR'],
    ['TRANSFERENCIA DEMO', '18/07/2026', '+271,00EUR', '-25.229,25EUR'],
    ['COMISIÓN DEMO', '01/07/2026', '-0,30EUR', '-24.958,25EUR'],
  ];

  it('reconoce el perfil nativo de CaixaBank y la moneda integrada', () => {
    const result = runtime().normalizeBankRows_(caixaRows, null, { source: 'CaixaBank', extension: 'csv', separator: ';' });
    expect(result.profile).toMatchObject({ id: 'NATIVE-CAIXABANK-CSV', name: 'CaixaBank CSV' });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => [row.amount, row.currency])).toEqual([[-1150, 'EUR'], [271, 'EUR'], [-0.3, 'EUR']]);
    expect(result.rows.at(-1)?.operationDate).toBe('2026-07-01');
  });

  it('mantiene el mapeo de moneda en columna para formatos tipo Santander', () => {
    const rows = [['Fecha operación', 'Concepto', 'Importe', 'Moneda'], ['20/07/2026', 'PAGO DEMO', '-12,34', 'EUR']];
    const result = runtime().normalizeBankRows_(rows, null, { source: 'Santander', extension: 'xlsx', separator: '' });
    expect(result.rows[0]).toMatchObject({ amount: -12.34, currency: 'EUR', operationDate: '2026-07-20' });
  });

  it('rechaza moneda integrada ausente o contradictoria', () => {
    const noCurrency = [['Concepto', 'Fecha', 'Importe'], ['PAGO DEMO', '20/07/2026', '-12,34']];
    expect(() => runtime().normalizeBankRows_(noCurrency, { headerRow: 0, concept: 0, operationDate: 1, amount: 2, currencyMode: 'EMBEDDED' }, { source: 'Otro', extension: 'csv', separator: ';' })).toThrow(/moneda vacía/i);
    expect(() => runtime().normalizeBankRows_(caixaRows, { headerRow: 0, concept: 0, operationDate: 1, amount: 2, currencyMode: 'FIXED', fixedCurrency: 'USD' }, { source: 'Otro', extension: 'csv', separator: ';' })).toThrow(/contiene EUR.*fija USD/i);
  });

  it('reutiliza un perfil guardado solo para la misma fuente y firma', () => {
    const format = { id: 'BF-DEMO', name: 'Banco demo CSV', source: 'banco demo', extension: 'csv', separator: ';', headerSignature: 'detalle|fecha|cantidad', headerRow: 0, mapping: { concept: 0, operationDate: 1, amount: 2 }, currencyMode: 'FIXED', fixedCurrency: 'EUR', active: true };
    const rows = [['Detalle', 'Fecha', 'Cantidad'], ['PAGO DEMO', '20/07/2026', '-12,34']];
    const result = runtime([format]).normalizeBankRows_(rows, null, { source: 'Banco Demo', extension: 'csv', separator: ';' });
    expect(result.profile).toMatchObject({ id: 'BF-DEMO' });
    expect(result.rows[0]).toMatchObject({ amount: -12.34, currency: 'EUR' });
    expect(() => runtime([format]).normalizeBankRows_(rows, null, { source: 'Banco distinto', extension: 'csv', separator: ';' })).toThrow(/mapear/i);
  });
});
