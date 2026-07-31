import { Children, cloneElement, isValidElement, useId, type PropsWithChildren, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('procesada') || normalized.includes('confirmada') || normalized.includes('completado') ? 'success'
    : normalized.includes('revisión') || normalized.includes('pendiente') || normalized.includes('candidata') ? 'warning'
      : normalized.includes('error') ? 'danger'
        : normalized.includes('duplicado') || normalized.includes('no es') || normalized.includes('venta') || normalized.includes('excluido') ? 'neutral' : 'info';
  const icon: IconName = tone === 'success' ? 'check' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'error' : 'file';
  return <span className={`status status--${tone}`}><Icon name={icon} size={14}/>{status}</span>;
}

export function Button({ children, variant = 'primary', icon, ...props }: PropsWithChildren<{ variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; icon?: IconName } & React.ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button className={`button button--${variant}`} {...props}>{icon && <Icon name={icon} size={17}/>}<span>{children}</span></button>;
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="section-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="section-header__action">{action}</div>}</header>;
}

export function EmptyState({ icon, title, children }: PropsWithChildren<{ icon: IconName; title: string }>) {
  return <div className="empty-state"><span className="empty-state__icon"><Icon name={icon} size={26}/></span><h3>{title}</h3><p>{children}</p></div>;
}

export function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  const generatedId = useId();
  const hintId = hint ? `${generatedId}-hint` : undefined;
  const child = Children.only(children);
  const control = isValidElement(child) ? cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string }>, { id: (child.props as { id?: string }).id ?? generatedId, 'aria-describedby': hintId }) : child;
  const controlId = isValidElement(control) ? (control.props as { id?: string }).id : generatedId;
  return <div className="field"><label className="field__label" htmlFor={controlId}>{label}</label>{control}{hint && <span className="field__hint" id={hintId}>{hint}</span>}</div>;
}

export function Modal({ title, onClose, children, footer }: PropsWithChildren<{ title: string; onClose: () => void; footer?: ReactNode }>) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close"/></button></header><div className="modal__body">{children}</div>{footer && <footer>{footer}</footer>}</section></div>;
}

export function EvidenceChain({ active = 3 }: { active?: number }) {
  const nodes: { icon: IconName; label: string }[] = [
    { icon: 'mail', label: 'Correo' }, { icon: 'file', label: 'PDF' }, { icon: 'search', label: 'Evidencia' }, { icon: 'supplier', label: 'Proveedor' }, { icon: 'check', label: 'Aprobación' }, { icon: 'archive', label: 'Archivo' }, { icon: 'bank', label: 'Banco' },
  ];
  return <div className="evidence-chain" aria-label="Cadena de evidencia">{nodes.map((node, index) => <div className={`evidence-chain__node ${index <= active ? 'is-active' : ''}`} key={node.label}><span><Icon name={node.icon} size={16}/></span><small>{node.label}</small>{index < nodes.length - 1 && <i><Icon name="arrow" size={13}/></i>}</div>)}</div>;
}

export function formatCurrency(value: number, currency = 'EUR') {
  if (!/^[A-Z]{3}$/.test(currency)) return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' · moneda no acreditada';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
}

export function formatDate(value: string, includeTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value));
}
