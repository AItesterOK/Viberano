import { describe, expect, it } from 'vitest';
import { buildMonthlyMetrics, classifyMovement, findReconciliationCandidates, formatInvoiceFileName, invoiceArchivePath, invoiceIdentityKey, metricsAverages, parseMoney, validateInvoice } from '../src/web/lib/domain';
import { mockInvoices, mockSuppliers } from '../src/web/lib/mockData';

describe('reglas documentales', () => {
  it('interpreta importes españoles e internacionales', () => {
    expect(parseMoney('1.234,56 €')).toBe(1234.56);
    expect(parseMoney('$ 1,234.56')).toBe(1234.56);
    expect(parseMoney('sin importe')).toBeNull();
  });

  it('construye nombre y ruta sin sobrescribir significado', () => {
    const doc = { invoiceDate: '2026-07-16', supplier: 'Proveedor Demo / España', total: 143.85, currency: 'EUR', invoiceNumber: 'DEMO:00125' };
    expect(formatInvoiceFileName(doc)).toBe('2026-07-16 - Proveedor Demo - España - 143.85 EUR - DEMO-00125.pdf');
    expect(invoiceArchivePath(doc.invoiceDate)).toEqual(['2026', '3er. Trimestre', '07 - Julio']);
  });

  it('exige proveedor activo y todos los campos esenciales', () => {
    const document = { id: 'd', batchId: 'b', messageId: 'm', originalName: 'x.pdf', sender: '', subject: '', emailDate: '', invoiceDate: '2026-07-16', supplier: 'Componentes Demo Europa BV', supplierId: 'sup-europa', taxId: '', invoiceNumber: 'DEMO-1', total: 10, currency: 'EUR', phase: 'LISTO PARA APROBAR', proposedStatus: 'PROCESADA', reviewReason: '', evidence: [], hash: 'h', selected: true } as import('../src/web/types').InvoiceDocument;
    expect(validateInvoice(document, mockSuppliers)).toEqual([]);
    expect(validateInvoice({ ...document, invoiceNumber: '', total: 0 }, mockSuppliers)).toEqual(expect.arrayContaining(['Número de factura ausente', 'Importe total inválido']));
  });

  it('acepta notas de crédito acreditadas y conserva el importe negativo en el nombre', () => {
    const credit = { id: 'cn', batchId: 'b', messageId: 'm', originalName: 'avoir-CN-5003713.pdf', sender: '', subject: 'Credit note', emailDate: '', invoiceDate: '2026-07-21', supplier: 'Componentes Demo Europa BV', supplierId: 'sup-europa', taxId: '', invoiceNumber: 'CN-5003713', total: -21.5, currency: 'EUR', phase: 'LISTO PARA APROBAR', proposedStatus: 'PROCESADA', reviewReason: 'Nota de crédito acreditada', evidence: [{ field: 'documentType', value: 'NOTA DE CRÉDITO', source: 'PDF', excerpt: 'avoir' }], hash: 'h-cn', selected: true } as import('../src/web/types').InvoiceDocument;
    expect(validateInvoice(credit, mockSuppliers)).toEqual([]);
    expect(formatInvoiceFileName(credit)).toBe('2026-07-21 - Componentes Demo Europa BV - -21.50 EUR - CN-5003713.pdf');
    expect(validateInvoice({ ...credit, total: 21.5 }, mockSuppliers)).toContain('Importe total inválido');
    expect(validateInvoice({ ...credit, originalName: 'documento.pdf', subject: '', reviewReason: '', evidence: [] }, mockSuppliers)).toContain('Importe total inválido');
  });

  it('forma una identidad contable estable', () => {
    const a = { supplier: 'Próveedor Demo', invoiceNumber: 'DEMO / 01', invoiceDate: '2026-07-01', total: 10, currency: 'eur' };
    const b = { ...a, supplier: 'Proveedor-Demo', currency: 'EUR' };
    expect(invoiceIdentityKey(a)).toBe(invoiceIdentityKey(b));
  });
});

describe('métricas y banco', () => {
  it('solo cuenta PROCESADA y separa el mes parcial', () => {
    const metrics = buildMonthlyMetrics(mockInvoices, new Date('2026-07-31T12:00:00Z'));
    expect(metrics.find((item) => item.month === '2026-07')?.count).toBe(3);
    expect(metrics.find((item) => item.month === '2026-07')?.complete).toBe(false);
    const averages = metricsAverages(metrics);
    expect(averages.complete).toBeGreaterThan(0);
    expect(averages.includingPartial).toBeGreaterThan(0);
  });

  it('excluye ingresos y traspasos', () => {
    expect(classifyMovement(10, 'Ingreso cliente')).toBe('INGRESO');
    expect(classifyMovement(-10, 'Traspaso entre cuentas')).toBe('TRASPASO');
    expect(classifyMovement(-10, 'Compra proveedor')).toBe('CARGO');
  });

  it('propone coincidencia solo con importe, moneda y contexto suficientes', () => {
    const candidates = findReconciliationCandidates({ amount: -106.89, currency: 'EUR', concept: 'PAGO LOGISTICA DEMO 1204', operationDate: '2026-07-18' }, mockInvoices);
    expect(candidates.map((item) => item.id)).toEqual(['inv-1']);
    expect(findReconciliationCandidates({ amount: -106.9, currency: 'EUR', concept: 'PAGO LOGISTICA DEMO', operationDate: '2026-07-18' }, mockInvoices)).toEqual([]);
  });
});
