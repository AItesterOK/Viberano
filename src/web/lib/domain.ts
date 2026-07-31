import type { BankMovement, InvoiceDocument, InvoiceRecord, MonthlyMetric, Supplier } from '../types';

export const REQUIRED_INVOICE_FIELDS = ['supplier', 'invoiceNumber', 'invoiceDate', 'total', 'currency'] as const;

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseMoney(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const compact = value.replace(/[^\d,.-]/g, '');
  if (!compact) return null;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma > lastDot) normalized = compact.replace(/\./g, '').replace(',', '.');
  else normalized = compact.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function invoiceIdentityKey(input: Pick<InvoiceDocument, 'supplier' | 'invoiceNumber' | 'invoiceDate' | 'total' | 'currency'>): string {
  return [normalizeText(input.supplier), normalizeText(input.invoiceNumber), input.invoiceDate, input.total?.toFixed(2) ?? '', input.currency.toUpperCase()].join('|');
}

export function validateInvoice(input: InvoiceDocument, activeSuppliers: Supplier[]): string[] {
  const errors: string[] = [];
  if (!input.supplier.trim()) errors.push('Proveedor ausente');
  if (!input.invoiceNumber.trim()) errors.push('Número de factura ausente');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) errors.push('Fecha de emisión inválida');
  if (input.total === null || input.total <= 0) errors.push('Importe total inválido');
  if (!/^[A-Z]{3}$/.test(input.currency)) errors.push('Moneda no identificada');
  const supplier = activeSuppliers.find((item) => item.active && (item.id === input.supplierId || normalizeText(item.name) === normalizeText(input.supplier)));
  if (!supplier) errors.push('Proveedor desconocido o inactivo');
  return errors;
}

export function formatInvoiceFileName(input: Pick<InvoiceDocument, 'invoiceDate' | 'supplier' | 'total' | 'currency' | 'invoiceNumber'>): string {
  const safe = (value: string) => value.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
  return `${input.invoiceDate} - ${safe(input.supplier)} - ${(input.total ?? 0).toFixed(2)} ${input.currency} - ${safe(input.invoiceNumber)}.pdf`;
}

export function quarterForMonth(month: number): string {
  return [`1er. Trimestre`, `2do. Trimestre`, `3er. Trimestre`, `4to. Trimestre`][Math.floor((month - 1) / 3)];
}

export function invoiceArchivePath(date: string): string[] {
  const [year, month] = date.split('-').map(Number);
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return [String(year), quarterForMonth(month), `${String(month).padStart(2, '0')} - ${monthNames[month - 1]}`];
}

export function buildMonthlyMetrics(invoices: InvoiceRecord[], now = new Date()): MonthlyMetric[] {
  const grouped = new Map<string, { count: number; total: number }>();
  invoices.filter((item) => item.status === 'PROCESADA').forEach((invoice) => {
    const month = invoice.date.slice(0, 7);
    const current = grouped.get(month) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += invoice.total;
    grouped.set(month, current);
  });
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({
    month,
    count: value.count,
    total: Number(value.total.toFixed(2)),
    complete: month < currentMonth,
  }));
}

export function metricsAverages(metrics: MonthlyMetric[]): { complete: number; includingPartial: number } {
  const complete = metrics.filter((item) => item.complete);
  return {
    complete: complete.length ? complete.reduce((sum, item) => sum + item.count, 0) / complete.length : 0,
    includingPartial: metrics.length ? metrics.reduce((sum, item) => sum + item.count, 0) / metrics.length : 0,
  };
}

export function classifyMovement(amount: number, concept: string): BankMovement['type'] {
  const normalized = normalizeText(concept);
  if (amount > 0) return 'INGRESO';
  if (/traspaso|transferencia interna|entre cuentas|liquidacion tarjeta/.test(normalized)) return 'TRASPASO';
  if (amount < 0) return 'CARGO';
  return 'REVISIÓN';
}

export function findReconciliationCandidates(movement: Pick<BankMovement, 'amount' | 'currency' | 'concept' | 'operationDate'>, invoices: InvoiceRecord[]): InvoiceRecord[] {
  if (movement.amount >= 0) return [];
  const amount = Math.abs(movement.amount);
  const concept = normalizeText(movement.concept);
  return invoices.filter((invoice) => {
    if (invoice.status !== 'PROCESADA' || invoice.currency !== movement.currency) return false;
    if (Math.abs(invoice.total - amount) > 0.01) return false;
    const days = Math.abs(new Date(movement.operationDate).getTime() - new Date(invoice.date).getTime()) / 86_400_000;
    const supplierMatch = concept.includes(normalizeText(invoice.supplier)) || normalizeText(invoice.supplier).split(' ').some((token) => token.length > 4 && concept.includes(token));
    return days <= 62 && (supplierMatch || days <= 14);
  });
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[";,\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
