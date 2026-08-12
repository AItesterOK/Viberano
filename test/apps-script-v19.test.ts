import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../src/apps-script/WorkbenchService.js', import.meta.url), 'utf8');

function parseDate(value: unknown) {
  const match = String(value ?? '').match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
  const spanish = String(value ?? '').match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  return spanish ? [spanish[3], spanish[2].padStart(2, '0'), spanish[1].padStart(2, '0')].join('-') : '';
}

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function runtime() {
  const context = vm.createContext({
    APP: { START_DATE: '2026-01-01', TIMEZONE: 'Europe/Madrid', SHEETS: { BATCHES: 'LOTES', DOCUMENTS: 'DOCUMENTOS', LOG: 'LOG', COVERAGES: 'COBERTURAS', MOVEMENTS: 'MOVIMIENTOS', INVOICES: 'FACTURAS', RECONCILIATIONS: 'CONCILIACIONES', SUPPLIER_RULES: 'REGLAS_PROVEEDOR', PROVIDERS: 'PROVEEDORES', CATEGORIES: 'CATEGORIAS' } },
    Utilities: { formatDate: () => '2026-08-12' },
    parseDate_: parseDate,
    normalizeText_: normalize,
    safeJsonParse_: (value: unknown, fallback: unknown) => { try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } },
    toBoolean_: (value: unknown) => value === true || String(value).toUpperCase() === 'TRUE',
    toCents_: (value: unknown) => Math.round(Number(value || 0) * 100),
    appError_: (code: string, message: string) => Object.assign(new Error(message), { code }),
    safeRows_: () => [],
    nowIso_: () => '2026-08-12T12:00:00Z',
    supplierRuleFromRow_: (row: Record<string, unknown>) => ({ id: String(row.REGLA_ID || ''), supplierId: String(row.PROVEEDOR_ID || ''), type: String(row.TIPO || ''), pattern: String(row.PATRON || ''), value: String(row.VALOR || ''), active: row.ACTIVA === true, evidence: String(row.EVIDENCIA || '') }),
    coverageFromRow_: (row: Record<string, unknown>) => row,
    movementFromRow_: (row: Record<string, unknown>) => ({ id: String(row.MOVIMIENTO_ID), importId: String(row.IMPORT_ID), operationDate: String(row.FECHA_OPERACION), valueDate: String(row.FECHA_VALOR || row.FECHA_OPERACION), concept: String(row.CONCEPTO || ''), amount: Number(row.IMPORTE), currency: String(row.MONEDA), reference: String(row.REFERENCIA || ''), type: String(row.TIPO || 'CARGO'), status: String(row.ESTADO_CONCILIACION || 'SIN CONCILIAR'), assignedAmount: 0, difference: Math.abs(Number(row.IMPORTE)) }),
    invoiceFromRow_: (row: Record<string, unknown>) => ({ id: String(row.ID_UNICO), date: String(row.FECHA_FACTURA), dueDate: String(row.FECHA_VENCIMIENTO || '') || undefined, supplier: String(row.PROVEEDOR), taxId: String(row.CIF_NIF || ''), number: String(row['NÚMERO_FACTURA'] || ''), total: Number(row.IMPORTE_TOTAL), currency: String(row.MONEDA), status: String(row.ESTADO), originalName: '', batchId: '', hash: '', __row: row.__row }),
  });
  vm.runInContext(source, context);
  return context as unknown as {
    buildCoverageMap_: (payload: unknown, seed: unknown) => any;
    v19MergeCoverage_: (segments: any[]) => any[];
    applySupplierRules_: (context: unknown, providers: any[], rules: any[]) => any;
    listReconciliationCandidates_: (payload: unknown, seed: unknown) => any;
    buildWeeklyWorkbench_: (payload: unknown, seed: unknown) => any;
  };
}

describe('ReparaPRO Gastos 1.9 backend', () => {
  it('mantiene separados los recorridos de enero-febrero y julio y conserva el cursor real', () => {
    const result = runtime().buildCoverageMap_({ from: '2026-01-01', to: '2026-08-12' }, {
      batchRows: [
        { LOTE_ID: 'JUL', TIPO: 'GMAIL', ESTADO: 'COMPLETADO', FECHA_DESDE: '2026-07-18', FECHA_HASTA: '2026-07-29', FECHA_BUSQUEDA: '2026-07-30', CREADO_EN: '2026-08-08T10:00:00Z' },
        { LOTE_ID: 'HIST', TIPO: 'GMAIL', ESTADO: 'COMPLETADO', FECHA_DESDE: '2026-01-01', FECHA_HASTA: '2026-08-12', FECHA_BUSQUEDA: '2026-02-10', PENDING_MESSAGE_IDS_JSON: '["mail-2"]', CREADO_EN: '2026-08-11T10:00:00Z' },
      ],
      documentRows: [], coverageRows: [], movementRows: [],
      logRows: [{ LOTE_ID: 'JUL', 'ACCIÓN': 'LOTE_ANALIZADO', DATOS_JSON: '{"exhaustedRange":true}' }, { LOTE_ID: 'HIST', 'ACCIÓN': 'LOTE_ANALIZADO', DATOS_JSON: '{"exhaustedRange":false}' }],
    });
    const gmail = result.lanes[0].segments;
    expect(gmail).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '2026-01-01', to: '2026-02-10', status: 'PARCIAL' }),
      expect.objectContaining({ from: '2026-02-11', to: '2026-07-17', status: 'SIN REVISAR' }),
      expect.objectContaining({ from: '2026-07-18', to: '2026-07-29', status: 'COMPLETA' }),
    ]));
    expect(result.nextGmailCursor).toMatchObject({ date: '2026-02-10', pendingMessages: 1 });
  });

  it('una revisión completa corrige solo su subintervalo sin degradar el resto', () => {
    const merged = runtime().v19MergeCoverage_([
      { id: 'partial', sourceId: 'gmail', sourceType: 'GMAIL', sourceName: 'Gmail', from: '2026-01-01', to: '2026-02-10', status: 'PARCIAL', batchIds: ['A'] },
      { id: 'complete', sourceId: 'gmail', sourceType: 'GMAIL', sourceName: 'Gmail', from: '2026-01-01', to: '2026-01-31', status: 'COMPLETA', batchIds: ['B'] },
    ]);
    expect(merged).toEqual([
      expect.objectContaining({ from: '2026-01-01', to: '2026-01-31', status: 'COMPLETA' }),
      expect.objectContaining({ from: '2026-02-01', to: '2026-02-10', status: 'PARCIAL' }),
    ]);
  });

  it('muestra huecos bancarios antes y después de una cobertura parcial', () => {
    const result = runtime().buildCoverageMap_({ from: '2026-07-01', to: '2026-07-31' }, {
      batchRows: [], documentRows: [], logRows: [], coverageRows: [],
      movementRows: [{ IMPORT_ID: 'CAIXA', ESTADO_IMPORTACION: 'CONFIRMADA', FUENTE: 'CaixaBank', PERIODO_DETECTADO_DESDE: '2026-07-05', PERIODO_DETECTADO_HASTA: '2026-07-20', COBERTURA: 'Extracto parcial', ADVERTENCIAS_JSON: '[]' }],
    });
    expect(result.lanes[1].segments).toEqual([
      expect.objectContaining({ from: '2026-07-01', to: '2026-07-04', status: 'SIN REVISAR' }),
      expect.objectContaining({ from: '2026-07-05', to: '2026-07-20', status: 'PARCIAL' }),
      expect.objectContaining({ from: '2026-07-21', to: '2026-07-31', status: 'SIN REVISAR' }),
    ]);
  });

  it('las reglas confirmadas identifican proveedor y proponen categoría y moneda, sin ejecutar decisiones', () => {
    const providers = [{ id: 'SUP-1', name: 'Proveedor Uno', active: true }];
    const rules = [
      { REGLA_ID: 'R1', PROVEEDOR_ID: 'SUP-1', TIPO: 'EMAIL_DOMAIN', PATRON: 'proveedor.test', VALOR: '', ACTIVA: true },
      { REGLA_ID: 'R2', PROVEEDOR_ID: 'SUP-1', TIPO: 'DEFAULT_CATEGORY', PATRON: '', VALOR: 'CAT-1', ACTIVA: true },
      { REGLA_ID: 'R3', PROVEEDOR_ID: 'SUP-1', TIPO: 'DEFAULT_CURRENCY', PATRON: '', VALOR: 'EUR', ACTIVA: true },
    ];
    expect(runtime().applySupplierRules_({ senderEmail: 'facturas@proveedor.test' }, providers, rules)).toMatchObject({ provider: providers[0], defaultCategoryId: 'CAT-1', usualCurrency: 'EUR' });
  });

  it('lista únicamente extractos confirmados y explica la confianza de la candidata', () => {
    const movement = { MOVIMIENTO_ID: 'M1', IMPORT_ID: 'I1', ESTADO_IMPORTACION: 'CONFIRMADA', FUENTE: 'Banco', FECHA_OPERACION: '2026-07-20', CONCEPTO: 'PAGO PROVEEDOR UNO FACT 100', IMPORTE: -100, MONEDA: 'EUR', TIPO: 'CARGO', ESTADO_CONCILIACION: 'CANDIDATA PENDIENTE' };
    const preview = { ...movement, MOVIMIENTO_ID: 'M2', IMPORT_ID: 'I2', ESTADO_IMPORTACION: 'PREVISUALIZACIÓN' };
    const invoice = { ID_UNICO: 'F1', ESTADO: 'PROCESADA', FECHA_FACTURA: '2026-07-15', PROVEEDOR: 'Proveedor Uno', PROVEEDOR_ID: 'SUP-1', 'NÚMERO_FACTURA': 'FACT 100', IMPORTE_TOTAL: 100, MONEDA: 'EUR' };
    const result = runtime().listReconciliationCandidates_({}, { movementRows: [movement, preview], invoiceRows: [invoice], reconciliationRows: [], providerRows: [{ ID_PROVEEDOR: 'SUP-1', PROVEEDOR: 'Proveedor Uno' }], ruleRows: [{ REGLA_ID: 'R1', PROVEEDOR_ID: 'SUP-1', TIPO: 'BANK_CONCEPT', PATRON: 'PAGO PROVEEDOR UNO', ACTIVA: true }] });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ importId: 'I1', status: 'PENDING', confidence: 'ALTA', canBulkDecide: true });
    expect(result.items[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'RULE', matched: true })]));
  });

  it('usa lenguaje seguro cuando no hay factura en la cobertura', () => {
    const result = runtime().listReconciliationCandidates_({}, { movementRows: [{ MOVIMIENTO_ID: 'M1', IMPORT_ID: 'I1', ESTADO_IMPORTACION: 'CONFIRMADA', FUENTE: 'Banco', FECHA_OPERACION: '2026-07-20', CONCEPTO: 'CARGO SIN REFERENCIA', IMPORTE: -10, MONEDA: 'EUR', TIPO: 'CARGO', ESTADO_CONCILIACION: 'MOVIMIENTO SIN FACTURA' }], invoiceRows: [], reconciliationRows: [], providerRows: [], ruleRows: [] });
    expect(result.items[0].safeStatusLabel).toBe('SIN COINCIDENCIA EN ESTA COBERTURA');
    expect(JSON.stringify(result)).not.toMatch(/impagad/i);
  });
});
