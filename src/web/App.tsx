import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, BankImport, DocumentPreview, ExpenseCategory, InvoiceDocument, InvoiceRecord, MonthlyClose, ReconciliationLink, ReviewDraft, Supplier, TaxLine } from './types';
import { api } from './lib/api';
import { csvEscape, formatInvoiceFileName, invoiceArchivePath, metricsAverages, normalizeText } from './lib/domain';
import { Icon, type IconName } from './components/Icon';
import { Button, EmptyState, EvidenceChain, Field, Modal, SectionHeader, StatusBadge, formatCurrency, formatDate } from './components/UI';

type Page = 'home' | 'process' | 'review' | 'invoices' | 'suppliers' | 'bank' | 'close' | 'metrics' | 'history' | 'settings';

const navItems: { id: Page; label: string; icon: IconName; mobile?: boolean }[] = [
  { id: 'home', label: 'Inicio', icon: 'home', mobile: true },
  { id: 'process', label: 'Procesamiento', icon: 'process', mobile: true },
  { id: 'review', label: 'Revisión', icon: 'review', mobile: true },
  { id: 'invoices', label: 'Facturas', icon: 'invoice', mobile: true },
  { id: 'suppliers', label: 'Proveedores', icon: 'supplier' },
  { id: 'bank', label: 'Conciliación', icon: 'bank' },
  { id: 'close', label: 'Cierre mensual', icon: 'archive' },
  { id: 'metrics', label: 'Métricas', icon: 'metrics' },
  { id: 'history', label: 'Historial', icon: 'history' },
  { id: 'settings', label: 'Configuración', icon: 'settings' },
];

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileMore, setMobileMore] = useState(false);

  const refresh = async () => {
    setLoading(true); setError('');
    const result = await api.bootstrap();
    if (result.ok && result.data) setSnapshot(result.data); else setError(result.error?.message ?? 'No se pudo cargar la aplicación');
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  if (loading) return <LoadingScreen />;
  if (!snapshot || error) return <ErrorScreen message={error} retry={refresh} />;

  const updateSnapshot = (update: Partial<AppSnapshot>) => setSnapshot((current) => current ? { ...current, ...update } : current);
  const pageProps = { snapshot, updateSnapshot, navigate: setPage };
  const content = {
    home: <HomePage {...pageProps} />,
    process: <ProcessingPage {...pageProps} />,
    review: <ReviewPageV18 {...pageProps} />,
    invoices: <InvoicesPage {...pageProps} />,
    suppliers: <SuppliersPage {...pageProps} />,
    bank: <BankPageV18 {...pageProps} />,
    close: <MonthlyClosePage {...pageProps} />,
    metrics: <MetricsPage {...pageProps} />,
    history: <HistoryPage {...pageProps} />,
    settings: <SettingsPage {...pageProps} />,
  }[page];

  const extraItems = navItems.filter((item) => !item.mobile);
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img src="/reparapro-logo.jpg" alt="ReparaPRO · iPhone · Mac · iPad"/><span>Gastos</span></div>
      <nav aria-label="Navegación principal">{navItems.map((item) => <button key={item.id} className={page === item.id ? 'is-active' : ''} onClick={() => setPage(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'review' && snapshot.reviewCount > 0 && <b>{snapshot.reviewCount}</b>}</button>)}</nav>
      <div className="sidebar__footer"><span className={`mode-dot ${snapshot.settings.mode === 'DRY_RUN' ? 'is-dry' : ''}`}/><div><strong>{snapshot.settings.mode === 'DRY_RUN' ? 'Modo seco' : 'Producción'}</strong><small>{snapshot.settings.user}</small></div></div>
    </aside>
    <main className="main-content">{content}</main>
    <nav className="mobile-nav" aria-label="Navegación móvil">
      {navItems.filter((item) => item.mobile).map((item) => <button key={item.id} className={page === item.id ? 'is-active' : ''} onClick={() => { setPage(item.id); setMobileMore(false); }}><Icon name={item.icon}/><span>{item.label === 'Procesamiento' ? 'Procesar' : item.label}</span></button>)}
      <button className={extraItems.some((item) => item.id === page) ? 'is-active' : ''} onClick={() => setMobileMore((value) => !value)}><Icon name="menu"/><span>Más</span></button>
      {mobileMore && <div className="mobile-more">{extraItems.map((item) => <button key={item.id} onClick={() => { setPage(item.id); setMobileMore(false); }}><Icon name={item.icon}/>{item.label}</button>)}</div>}
    </nav>
  </div>;
}

type PageProps = { snapshot: AppSnapshot; updateSnapshot: (update: Partial<AppSnapshot>) => void; navigate: (page: Page) => void };

function HomePage({ snapshot, navigate }: PageProps) {
  const batch = snapshot.activeBatch;
  const servicesReady = Object.values(snapshot.settings.services).every(Boolean);
  return <>
    <SectionHeader eyebrow="Mesa de administración" title="Qué necesita atención hoy" description="Decide con evidencia. La aplicación no archiva ni confirma nada sin tu aprobación." action={<Button icon="process" onClick={() => navigate('process')}>Analizar correos</Button>}/>
    <div className={`system-strip ${servicesReady ? 'is-ready' : 'is-error'}`}><Icon name={servicesReady ? 'shield' : 'warning'}/><div><strong>{servicesReady ? 'Fuentes conectadas y preparadas' : 'Hay conexiones que requieren atención'}</strong><span>Gmail · ReparaPRO Docs · Drive de Contabilidad</span></div><button onClick={() => navigate('settings')}>Ver diagnóstico <Icon name="chevron" size={15}/></button></div>
    <section className="workbench">
      <div className="workbench__lead">
        <p className="eyebrow">Siguiente decisión</p>
        {batch ? <><div className="batch-marker"><span>{batch.id}</span><StatusBadge status={batch.status}/></div><h2>{batch.documents.filter((item) => item.phase === 'LISTO PARA APROBAR').length} documentos listos para cerrar</h2><p>El lote revisó {batch.reviewedEmails} correos y encontró {batch.pdfCount} PDF. Comprueba la cadena documental antes de aprobar.</p><EvidenceChain active={4}/><div className="workbench__actions"><Button icon="eye" onClick={() => navigate('process')}>Revisar lote</Button><Button variant="secondary" icon="review" onClick={() => navigate('review')}>Resolver excepciones</Button></div></> : <EmptyState icon="mail" title="No hay un lote activo">Inicia un análisis para localizar nuevos PDF en Gmail.</EmptyState>}
      </div>
      <div className="work-queues">
        <QueueItem label="Revisión manual" value={snapshot.reviewCount} detail="requieren criterio humano" icon="review" action={() => navigate('review')}/>
        <QueueItem label="Conciliación" value={snapshot.bankImports.flatMap((item) => item.movements).filter((item) => item.status === 'CANDIDATA PENDIENTE').length} detail="candidatas sin confirmar" icon="bank" action={() => navigate('bank')}/>
        <QueueItem label="Archivo controlado" value={snapshot.processedCount} detail="facturas procesadas" icon="archive" action={() => navigate('invoices')}/>
      </div>
    </section>
    <section className="recent-section"><div className="subhead"><div><p className="eyebrow">Trazabilidad reciente</p><h2>Últimas acciones</h2></div><button className="text-link" onClick={() => navigate('history')}>Ver todo <Icon name="arrow" size={15}/></button></div><div className="timeline">{snapshot.audit.slice(0, 3).map((event) => <div key={event.id}><span className={`timeline__dot timeline__dot--${event.level.toLowerCase()}`}/><div><strong>{event.action.replaceAll('_', ' ')}</strong><p>{event.detail}</p><small>{formatDate(event.timestamp, true)} · {event.user}</small></div></div>)}</div></section>
  </>;
}

function QueueItem({ label, value, detail, icon, action }: { label: string; value: number; detail: string; icon: IconName; action: () => void }) {
  return <button className="queue-item" onClick={action}><span className="queue-item__icon"><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div><Icon name="chevron" size={18}/></button>;
}

function ProcessingPage({ snapshot, updateSnapshot, navigate }: PageProps) {
  const [form, setForm] = useState({ dateFrom: snapshot.settings.startDate, dateTo: new Date().toISOString().slice(0, 10), maxEmails: 10 });
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState('');
  const batch = snapshot.activeBatch;
  const selected = batch?.documents.filter((item) => item.selected && item.phase !== 'FINALIZADO') ?? [];

  const start = async () => {
    setActionError('');
    setWorking(true); const result = await api.startBatch(form); setWorking(false);
    if (result.ok && result.data) updateSnapshot({ activeBatch: result.data }); else setActionError(result.error?.message ?? 'No se pudo iniciar el análisis');
  };
  const continueBatch = async () => {
    if (!batch) return; setActionError(''); setWorking(true); const result = await api.continueBatch(batch.id); setWorking(false);
    if (result.ok && result.data) updateSnapshot({ activeBatch: result.data }); else setActionError(result.error?.message ?? 'No se pudo continuar el análisis');
  };
  const toggle = (id: string) => {
    if (!batch) return;
    updateSnapshot({ activeBatch: { ...batch, documents: batch.documents.map((item) => item.id === id ? { ...item, selected: !item.selected } : item) } });
  };
  const approve = async () => {
    if (!batch) return; setActionError(''); setWorking(true);
    const result = await api.approveBatch(batch.id, selected.map((item) => item.id));
    setWorking(false); setConfirm(false);
    if (result.ok && result.data) updateSnapshot({ activeBatch: result.data }); else setActionError(result.error?.message ?? 'No se pudo aprobar la selección');
  };
  const cancel = async () => {
    if (!batch || !cancelReason.trim()) return; setActionError(''); setWorking(true);
    const result = await api.cancelBatch(batch.id, cancelReason.trim());
    setWorking(false);
    if (result.ok && result.data) { updateSnapshot({ activeBatch: result.data, reviewDocuments: snapshot.reviewDocuments.filter((item) => item.batchId !== batch.id), reviewCount: snapshot.reviewDocuments.filter((item) => item.batchId !== batch.id).length }); setCancelConfirm(false); setCancelReason(''); }
    else setActionError(result.error?.message ?? 'No se pudo cancelar el lote');
  };
  return <>
    <SectionHeader eyebrow="Procesamiento controlado" title="Analizar y aprobar un lote" description="Gmail se consulta en modo lectura. Solo la aprobación crea registros definitivos y archivos de factura."/>
    <section className="process-layout">
      <div className="setup-panel">
        <div className="panel-title"><span>1</span><div><h2>Alcance del análisis</h2><p>Máximo 20 correos; el servidor trabaja en bloques de 5.</p></div></div>
        <div className="form-grid"><Field label="Desde"><input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}/></Field><Field label="Hasta"><input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })}/></Field><Field label="Correos"><select value={form.maxEmails} onChange={(e) => setForm({ ...form, maxEmails: Number(e.target.value) })}><option value={10}>10 · piloto</option><option value={15}>15</option><option value={20}>20</option></select></Field></div>
        {batch && ['ANALIZANDO', 'INTERRUMPIDO'].includes(batch.status) ? <Button icon="refresh" disabled={working} onClick={continueBatch}>{working ? 'Analizando…' : `Continuar análisis · ${batch.progress}%`}</Button> : <Button icon={working ? 'refresh' : 'search'} disabled={working || Boolean(batch && !['COMPLETADO', 'CANCELADO'].includes(batch.status))} onClick={start}>{working ? 'Analizando…' : 'Iniciar análisis'}</Button>}
        {batch?.nextSearchDate && <p className="cursor-note"><Icon name="arrow" size={15}/>Siguiente fecha de búsqueda: {formatDate(batch.nextSearchDate)}</p>}
        {batch && !['COMPLETADO', 'CANCELADO'].includes(batch.status) && <p className="inline-note"><Icon name="warning" size={16}/>Ya existe un lote activo. Debe finalizarse antes de iniciar otro.</p>}
        {batch && !['COMPLETADO', 'COMPLETADO CON ERRORES', 'CANCELADO'].includes(batch.status) && <Button variant="danger" icon="close" disabled={working} onClick={() => setCancelConfirm(true)}>Cancelar lote sin escrituras</Button>}
        {actionError && <p className="inline-note"><Icon name="error" size={16}/>{actionError}</p>}
      </div>
      <div className="batch-panel">
        <div className="panel-title"><span>2</span><div><h2>Vista previa</h2><p>{batch ? `${batch.id} · ${batch.reviewedEmails} correos revisados` : 'Aún no hay resultados'}</p></div>{batch && <StatusBadge status={batch.status}/>}</div>
        {!batch ? <EmptyState icon="process" title="Previsualización vacía">Define el periodo e inicia un análisis. No se modificará Gmail.</EmptyState> : <>
          <div className="batch-summary"><SummaryNumber label="PDF" value={batch.pdfCount}/><SummaryNumber label="Listos" value={batch.documents.filter((item) => item.phase === 'LISTO PARA APROBAR').length}/><SummaryNumber label="Revisión" value={batch.documents.filter((item) => item.phase === 'EN REVISIÓN').length}/><SummaryNumber label="Errores" value={batch.documents.filter((item) => item.phase === 'ERROR').length}/></div>
          <div className="document-stack">{batch.documents.map((doc) => <article key={doc.id} className={`document-row ${doc.selected ? 'is-selected' : ''}`}><label className="check-control"><input type="checkbox" checked={doc.selected} disabled={doc.phase === 'EN REVISIÓN' || doc.phase === 'FINALIZADO' || doc.phase === 'CANCELADO'} onChange={() => toggle(doc.id)}/><span/></label><div className="document-row__main"><div><strong>{doc.originalName}</strong><small>{doc.emailDirection || 'ENTRANTE'} · {doc.sender} · {formatDate(doc.emailDate)}</small></div><div className="document-row__facts"><span>{doc.supplier || 'Sin proveedor'}</span><span>{doc.invoiceNumber || 'Sin número'}</span><span>{doc.total === null ? 'Sin importe' : formatCurrency(doc.total, doc.currency)}</span></div></div><div className="document-row__decision"><StatusBadge status={doc.phase === 'CANCELADO' ? 'CANCELADO' : doc.finalStatus ?? doc.proposedStatus}/>{doc.reviewReason && <small>{doc.reviewReason}</small>}</div><button className="icon-button" aria-label="Abrir detalle" onClick={() => navigate(doc.phase === 'FINALIZADO' || doc.phase === 'CANCELADO' ? 'invoices' : 'review')}><Icon name="eye"/></button></article>)}</div>
          <div className="approval-bar"><div><strong>{selected.length} documentos seleccionados</strong><span>{selected.filter((item) => item.proposedStatus === 'PROCESADA').length} {selected.filter((item) => item.proposedStatus === 'PROCESADA').length === 1 ? 'archivo se archivará' : 'archivos se archivarán'}; el resto solo se registrará.</span></div><Button icon="check" disabled={!selected.length || batch.status === 'COMPLETADO'} onClick={() => setConfirm(true)}>Aprobar selección</Button></div>
        </>}
      </div>
    </section>
    {confirm && batch && <Modal title="Confirmar aprobación" onClose={() => setConfirm(false)} footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Volver</Button><Button icon="check" disabled={working} onClick={approve}>{working ? 'Ejecutando…' : `Aprobar ${selected.length} documentos`}</Button></>}><div className="confirmation"><span><Icon name="shield" size={28}/></span><h3>Esta acción sí escribirá en Drive y Sheets</h3><p>Se crearán <strong>{selected.filter((item) => item.proposedStatus === 'PROCESADA').length} PDF archivados</strong> y {selected.length} registros definitivos. Gmail permanecerá intacto.</p><ul>{selected.map((item) => <li key={item.id}><StatusBadge status={item.proposedStatus}/><span>{item.originalName}</span></li>)}</ul></div></Modal>}
    {cancelConfirm && batch && <Modal title="Cancelar lote" onClose={() => setCancelConfirm(false)}><div className="confirmation confirmation--danger"><span><Icon name="warning" size={28}/></span><h3>No se crearán facturas ni archivos</h3><p>Los borradores técnicos quedarán marcados como cancelados para conservar la auditoría.</p><Field label="Motivo obligatorio"><textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)}/></Field><div className="inline-modal-actions"><Button variant="secondary" onClick={() => setCancelConfirm(false)}>Volver</Button><Button variant="danger" icon="close" disabled={working || !cancelReason.trim()} onClick={cancel}>{working ? 'Cancelando…' : 'Cancelar sin escrituras'}</Button></div></div></Modal>}
  </>;
}

function SummaryNumber({ label, value }: { label: string; value: number | string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function senderDomain(sender: string) {
  return sender.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() ?? '';
}

const reviewDecisions: { key: string; status: InvoiceDocument['proposedStatus']; label: string; creditNote?: boolean }[] = [
  { key: 'expense', status: 'PROCESADA', label: 'Factura de gasto' },
  { key: 'credit-note', status: 'PROCESADA', label: 'Nota de crédito', creditNote: true },
  { key: 'not-invoice', status: 'NO ES FACTURA', label: 'No es factura' },
  { key: 'sales-invoice', status: 'FACTURA DE VENTA', label: 'Factura de venta' },
  { key: 'review', status: 'REVISIÓN MANUAL', label: 'Mantener en revisión' },
];

function activeReviewDecision(document: InvoiceDocument) {
  return reviewDecisions.find((decision) => decision.status === document.proposedStatus && (decision.status !== 'PROCESADA' || Boolean(decision.creditNote) === Boolean(document.total !== null && document.total < 0)));
}

function pdfObjectUrl(preview: DocumentPreview) {
  const binary = window.atob(preview.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: preview.mimeType }));
}

function supplierDraftFromDocument(document: InvoiceDocument): Supplier {
  const detectedName = /^(sin proveedor|sin asociar)$/i.test(document.supplier.trim()) ? '' : document.supplier.trim();
  const sourceParts = [`PDF ${document.originalName}`, `correo recibido de ${document.sender}`];
  if (document.taxId.trim()) sourceParts.push(`CIF/NIF ${document.taxId.trim().toUpperCase()} mostrado en la revisión`);
  return { id: '', name: detectedName, domain: senderDomain(document.sender), taxId: document.taxId.trim().toUpperCase(), aliases: [], active: true, evidence: sourceParts.join('; ') + '.', updatedAt: '', updatedBy: '', invoiceCount: 0 };
}

function ReviewPage({ snapshot, updateSnapshot }: PageProps) {
  const activeReviews = snapshot.activeBatch?.documents.filter((item) => item.phase !== 'FINALIZADO' && item.phase !== 'CANCELADO') ?? [];
  const docs = [...snapshot.reviewDocuments, ...activeReviews.filter((item) => !snapshot.reviewDocuments.some((queued) => queued.id === item.id))];
  const [selected, setSelected] = useState<InvoiceDocument | null>(docs[0] ?? null);
  const [reason, setReason] = useState(selected?.reviewReason ?? '');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<Supplier | null>(null);
  const [supplierConfirmed, setSupplierConfirmed] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierError, setSupplierError] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string; gmailUrl?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);
  const syncDocument = (document: InvoiceDocument) => {
    const activeBatch = snapshot.activeBatch ? { ...snapshot.activeBatch, documents: snapshot.activeBatch.documents.map((item) => item.id === document.id ? document : item) } : null;
    const reviewDocuments = snapshot.reviewDocuments.some((item) => item.id === document.id) ? snapshot.reviewDocuments.map((item) => item.id === document.id ? document : item) : [document, ...snapshot.reviewDocuments];
    updateSnapshot({ activeBatch, reviewDocuments, reviewCount: reviewDocuments.length });
    setSelected(document); setReason(document.reviewReason);
  };
  const save = async () => {
    if (!selected) return;
    if (!reason.trim()) { setActionError('Indica el motivo de la decisión antes de guardarla.'); return; }
    setSaving(true); setActionError('');
    const result = await api.saveDocument(selected, reason);
    if (result.ok && result.data) {
      syncDocument(result.data);
    } else setActionError(result.error?.message ?? 'No se pudo guardar la revisión');
    setSaving(false);
  };
  const createSupplier = async () => {
    if (!selected || !supplierDraft || !supplierConfirmed || !supplierDraft.name.trim() || !supplierDraft.evidence.trim()) return;
    setSupplierSaving(true); setSupplierError('');
    const supplierResult = await api.saveSupplier(supplierDraft);
    if (!supplierResult.ok || !supplierResult.data) { setSupplierSaving(false); setSupplierError(supplierResult.error?.message ?? 'No se pudo crear el proveedor'); return; }
    const supplier = supplierResult.data;
    setSupplierDraft(supplier);
    const suppliers = [supplier, ...snapshot.suppliers.filter((item) => item.id !== supplier.id)];
    updateSnapshot({ suppliers });
    const associationReason = `Proveedor ${supplier.name} creado y asociado desde ${selected.originalName}. Evidencia: ${supplier.evidence}`;
    const documentResult = await api.saveDocument({ ...selected, supplierId: supplier.id, supplier: supplier.name, taxId: supplier.taxId || selected.taxId, nonRegularSupplier: false, proposedStatus: 'REVISIÓN MANUAL' }, associationReason);
    setSupplierSaving(false);
    if (!documentResult.ok || !documentResult.data) { setSupplierError(`El proveedor se creó, pero no pudo asociarse al documento: ${documentResult.error?.message ?? 'error desconocido'}`); return; }
    syncDocument(documentResult.data); setSupplierDraft(null); setSupplierConfirmed(false);
  };
  const approve = async () => {
    if (!selected) return; setActionError('');
    const result = await api.approveDocument(selected.id);
    if (result.ok && result.data) {
      const reviewDocuments = snapshot.reviewDocuments.filter((item) => item.id !== selected.id);
      const activeBatch = snapshot.activeBatch ? { ...snapshot.activeBatch, documents: snapshot.activeBatch.documents.map((item) => item.id === selected.id ? result.data! : item) } : null;
      updateSnapshot({ activeBatch, reviewDocuments, reviewCount: reviewDocuments.length });
      setSelected(reviewDocuments[0] ?? null);
      setReason(reviewDocuments[0]?.reviewReason ?? '');
    } else setActionError(result.error?.message ?? 'No se pudo finalizar el documento');
  };
  const openPreview = async () => {
    if (!selected || previewLoading) return;
    setPreviewLoading(true); setPreviewError('');
    const result = await api.getDocumentPreview(selected);
    setPreviewLoading(false);
    if (!result.ok || !result.data) { setPreviewError(result.error?.message ?? 'No se pudo cargar la vista previa del PDF.'); return; }
    try {
      setPreview({ name: result.data.originalName, url: pdfObjectUrl(result.data), gmailUrl: result.data.gmailUrl });
    } catch (_) {
      setPreviewError('El navegador no pudo preparar el PDF. Ábrelo desde el correo de origen.');
    }
  };
  const matchedSupplier = selected ? snapshot.suppliers.find((item) => item.active && (item.id === selected.supplierId || normalizeText(item.name) === normalizeText(selected.supplier))) : undefined;
  const nonRegularEligible = Boolean(selected && (!matchedSupplier || matchedSupplier.invoiceCount < 3));
  const frequencyReason = !matchedSupplier ? 'No existe un proveedor asociado en el catálogo.' : `Histórico actual: ${matchedSupplier.invoiceCount} de 3 facturas procesadas.`;
  return <>
    <SectionHeader eyebrow="Control humano" title="Revisión manual" description="Los casos dudosos permanecen aquí aunque el lote original ya se haya cerrado, hasta que exista una decisión explícita."/>
    {!docs.length ? <EmptyState icon="check" title="No hay revisiones pendientes">Los resultados finalizados siguen disponibles desde Facturas.</EmptyState> : <section className="review-layout">
      <div className="review-list"><div className="list-toolbar"><strong>{docs.length} pendientes</strong><button><Icon name="search" size={17}/> Filtrar</button></div>{docs.map((doc) => <button key={doc.id} className={selected?.id === doc.id ? 'is-active' : ''} onClick={() => { setSelected(doc); setReason(doc.reviewReason); setActionError(''); }}><span className="file-token"><Icon name="file"/></span><div><strong>{doc.originalName}</strong><p>{doc.supplier}</p><small>{doc.reviewReason}</small></div><Icon name="chevron" size={17}/></button>)}</div>
      {selected && <div className="review-detail"><div className="review-detail__head"><div><p className="eyebrow">Documento · {selected.id}</p><h2>{selected.originalName}</h2><p>{selected.subject}</p><small className="mail-route"><strong>{selected.emailDirection || 'ENTRANTE'}</strong> · De: {selected.sender}{selected.recipients ? ` · Para: ${selected.recipients}` : ''}</small></div><div className="review-detail__source-actions"><Button variant="secondary" icon="eye" disabled={previewLoading} onClick={openPreview}>{previewLoading ? 'Cargando PDF…' : 'Previsualizar PDF'}</Button><a className="button button--secondary" href={selected.gmailUrl} target="_blank" rel="noreferrer"><Icon name="mail" size={17}/>Abrir correo</a></div></div>{previewError && <p className="inline-note preview-error" role="alert"><Icon name="warning" size={16}/><span>{previewError} {selected.gmailUrl && <a href={selected.gmailUrl} target="_blank" rel="noreferrer">Abrir correo</a>}</span></p>}<EvidenceChain active={3}/>
        <div className="review-grid"><div className="supplier-association"><Field label="Proveedor"><select value={selected.supplierId ?? ''} onChange={(e) => { const supplier = snapshot.suppliers.find((item) => item.id === e.target.value); setSelected({ ...selected, supplierId: supplier?.id, supplier: supplier?.name ?? selected.supplier, taxId: supplier?.taxId || selected.taxId, nonRegularSupplier: supplier ? selected.nonRegularSupplier && supplier.invoiceCount < 3 : selected.nonRegularSupplier }); }}><option value="">Sin asociar</option>{snapshot.suppliers.filter((item) => item.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.invoiceCount} facturas</option>)}</select></Field>{!selected.supplierId && <Button variant="quiet" icon="plus" onClick={() => { setSupplierDraft(supplierDraftFromDocument(selected)); setSupplierConfirmed(false); setSupplierError(''); }}>Crear proveedor desde este PDF</Button>}{nonRegularEligible && <div className={`supplier-frequency-control ${selected.nonRegularSupplier ? 'is-selected' : ''}`}><label><input type="checkbox" checked={Boolean(selected.nonRegularSupplier)} onChange={(e) => setSelected({ ...selected, nonRegularSupplier: e.target.checked })}/><span><strong>Marcar como proveedor no habitual</strong><small>{frequencyReason} Esta factura podrá procesarse sin crear un proveedor permanente.</small></span></label>{selected.nonRegularSupplier && !matchedSupplier && <Field label="Nombre del proveedor en la factura" hint="Copia exactamente la razón social o el nombre acreditado en el PDF."><input value={selected.supplier} onChange={(e) => setSelected({ ...selected, supplier: e.target.value })}/></Field>}</div>}</div><Field label="CIF / NIF"><input value={selected.taxId} onChange={(e) => setSelected({ ...selected, taxId: e.target.value })}/></Field><Field label="Número de factura"><input value={selected.invoiceNumber} onChange={(e) => setSelected({ ...selected, invoiceNumber: e.target.value })}/></Field><Field label="Fecha de emisión"><input type="date" value={selected.invoiceDate} onChange={(e) => setSelected({ ...selected, invoiceDate: e.target.value })}/></Field><Field label="Total con impuestos" hint="En notas de crédito se guarda y archiva como importe negativo"><input type="number" step="0.01" value={selected.total ?? ''} onChange={(e) => setSelected({ ...selected, total: e.target.value ? Number(e.target.value) : null })}/></Field><Field label="Moneda"><input maxLength={3} value={selected.currency} onChange={(e) => setSelected({ ...selected, currency: e.target.value.toUpperCase() })}/></Field></div>
        <div className="evidence-panel"><h3>Evidencia extraída</h3>{selected.evidence.map((item, index) => <div key={`${item.field}-${index}`}><span>{item.source}</span><div><strong>{item.field}: {item.value}</strong><p>“{item.excerpt}”</p></div></div>)}</div>
        <Field label="Motivo de la decisión" hint="Obligatorio en toda corrección o reclasificación"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}/></Field>
        {actionError && <p className="inline-note"><Icon name="warning" size={16}/>{actionError}</p>}
        <div className="decision-control"><div className="decision-control__head"><strong>Clasificación</strong><span>Elige una opción y después guarda la decisión.</span></div><div className="decision-control__options" role="group" aria-label="Clasificación del documento">{reviewDecisions.map((decision) => { const active = activeReviewDecision(selected)?.key === decision.key; return <Button key={decision.key} variant={active ? 'primary' : 'secondary'} icon={active ? 'check' : undefined} aria-pressed={active} onClick={() => { const total = decision.creditNote ? selected.total === null ? null : -Math.abs(selected.total) : decision.status === 'PROCESADA' ? selected.total === null ? null : Math.abs(selected.total) : selected.total; setSelected({ ...selected, proposedStatus: decision.status, total }); setActionError(''); }}>{decision.label}</Button>; })}</div></div>
        <p className="decision-feedback" role="status" aria-live="polite"><Icon name="check" size={17}/><span><strong>Decisión preparada:</strong> {activeReviewDecision(selected)?.label}{selected.nonRegularSupplier ? ' · Proveedor no habitual' : ''}. Se aplicará al guardar.</span></p>
        <div className="review-actions"><Button icon="refresh" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar decisión'}</Button>{selected.phase === 'LISTO PARA APROBAR' && <Button icon="check" onClick={approve}>Aprobar documento</Button>}</div>
      </div>}
    </section>}
    {preview && <Modal title={`Vista previa · ${preview.name}`} size="wide" onClose={() => setPreview(null)} footer={<><a className="button button--secondary" href={preview.url} target="_blank" rel="noreferrer"><Icon name="eye" size={17}/>Abrir en otra pestaña</a>{preview.gmailUrl && <a className="button button--secondary" href={preview.gmailUrl} target="_blank" rel="noreferrer"><Icon name="mail" size={17}/>Ver correo de origen</a>}<Button onClick={() => setPreview(null)}>Cerrar</Button></>}><div className="pdf-preview"><iframe title={`PDF ${preview.name}`} src={preview.url}/><p>Si el PDF no aparece en el visor, ábrelo en otra pestaña o consulta el correo de origen.</p></div></Modal>}
    {supplierDraft && selected && <Modal title="Crear proveedor desde este documento" onClose={() => !supplierSaving && setSupplierDraft(null)} footer={<><Button variant="secondary" disabled={supplierSaving} onClick={() => setSupplierDraft(null)}>Cancelar</Button><Button icon="check" disabled={supplierSaving || !supplierConfirmed || !supplierDraft.name.trim() || !supplierDraft.evidence.trim()} onClick={createSupplier}>{supplierSaving ? 'Creando…' : 'Crear y asociar'}</Button></>}><div className="form-stack"><div className="source-evidence-card"><span><Icon name="search" size={18}/></span><div><strong>Fuente de los datos</strong><p>{selected.originalName} · {selected.sender}</p><small>La factura no se aprobará al crear el proveedor.</small></div></div><Field label="Nombre canónico"><input autoFocus value={supplierDraft.name} onChange={(e) => setSupplierDraft({ ...supplierDraft, name: e.target.value })}/></Field><div className="form-grid"><Field label="Dominio confirmado"><input placeholder="ejemplo.com" value={supplierDraft.domain} onChange={(e) => setSupplierDraft({ ...supplierDraft, domain: e.target.value.toLowerCase() })}/></Field><Field label="CIF / NIF"><input value={supplierDraft.taxId} onChange={(e) => setSupplierDraft({ ...supplierDraft, taxId: e.target.value.toUpperCase() })}/></Field></div><Field label="Aliases acreditados" hint="Marcas o nombres comerciales que aparecen en el PDF o correo; separados por punto y coma"><input value={supplierDraft.aliases.join('; ')} onChange={(e) => setSupplierDraft({ ...supplierDraft, aliases: e.target.value.split(';').map((value) => value.trim()).filter(Boolean) })}/></Field><Field label="Evidencia" hint="Indica documento, número de factura o fragmento donde aparecen el nombre y los datos fiscales"><textarea rows={3} value={supplierDraft.evidence} onChange={(e) => setSupplierDraft({ ...supplierDraft, evidence: e.target.value })}/></Field><label className="evidence-confirmation"><input type="checkbox" checked={supplierConfirmed} onChange={(e) => setSupplierConfirmed(e.target.checked)}/><span><strong>He comprobado los datos</strong><small>El nombre, dominio, CIF/NIF y aliases introducidos aparecen en el PDF o en el correo.</small></span></label>{supplierError && <p className="inline-note"><Icon name="error" size={16}/>{supplierError}</p>}</div></Modal>}
  </>;
}

function InvoicesPage({ snapshot }: PageProps) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('TODOS'); const [detail, setDetail] = useState<InvoiceRecord | null>(null); const [page, setPage] = useState(0);
  const invoices = useMemo(() => snapshot.invoices.filter((item) => (status === 'TODOS' || item.status === status) && [item.supplier, item.number, item.originalName].join(' ').toLowerCase().includes(query.toLowerCase())), [snapshot.invoices, query, status]);
  const pageSize = 50; const visibleInvoices = invoices.slice(page * pageSize, (page + 1) * pageSize);
  return <>
    <SectionHeader eyebrow="Archivo documental" title="Facturas y documentos" description="Consulta el resultado, el origen y la trazabilidad de cada documento registrado."/>
    <div className="table-toolbar"><label className="search-box"><Icon name="search" size={18}/><input placeholder="Buscar proveedor, número o archivo" value={query} onChange={(e) => setQuery(e.target.value)}/></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option>TODOS</option><option>PROCESADA</option><option>REVISIÓN MANUAL</option><option>DUPLICADO IGNORADO</option><option>NO ES FACTURA</option><option>FACTURA DE VENTA</option></select><span>{invoices.length} resultados</span></div>
    <div className="data-table"><table><thead><tr><th>Fecha</th><th>Proveedor / documento</th><th>Número</th><th className="numeric">Importe</th><th>Estado</th><th/></tr></thead><tbody>{visibleInvoices.map((invoice) => <tr key={invoice.id}><td>{formatDate(invoice.date)}</td><td><strong>{invoice.supplier}</strong><small>{invoice.originalName}</small>{invoice.nonRegularSupplier && <span className="supplier-frequency-tag">No habitual</span>}</td><td className="mono">{invoice.number || '—'}</td><td className="numeric">{formatCurrency(invoice.total, invoice.currency)}</td><td><StatusBadge status={invoice.status}/></td><td><button className="icon-button" aria-label="Ver detalle" onClick={() => setDetail(invoice)}><Icon name="eye"/></button></td></tr>)}</tbody></table></div><Pagination page={page} total={invoices.length} pageSize={pageSize} onPage={setPage}/>
    {detail && <Modal title="Cadena documental" onClose={() => setDetail(null)}><div className="invoice-detail"><div className="invoice-detail__hero"><span><Icon name="invoice" size={30}/></span><div><StatusBadge status={detail.status}/><h3>{detail.supplier}</h3><p>{detail.number} · {formatCurrency(detail.total, detail.currency)}</p></div></div><EvidenceChain active={detail.status === 'PROCESADA' ? 5 : 3}/><dl><div><dt>Fecha de emisión</dt><dd>{formatDate(detail.date)}</dd></div><div><dt>CIF / NIF</dt><dd>{detail.taxId || 'Sin dato acreditado'}</dd></div><div><dt>Frecuencia</dt><dd>{detail.nonRegularSupplier ? 'Proveedor no habitual' : 'Proveedor habitual'}</dd></div><div><dt>Archivo original</dt><dd>{detail.originalName}</dd></div><div><dt>Lote</dt><dd className="mono">{detail.batchId}</dd></div><div><dt>Huella</dt><dd className="mono">{detail.hash}</dd></div></dl><div className="link-row">{detail.gmailUrl && <a className="button button--secondary" href={detail.gmailUrl} target="_blank" rel="noreferrer"><Icon name="mail" size={17}/>Correo</a>}{detail.driveUrl && <a className="button button--primary" href={detail.driveUrl} target="_blank" rel="noreferrer"><Icon name="archive" size={17}/>Archivo en Drive</a>}</div></div></Modal>}
  </>;
}

function SuppliersPage({ snapshot, updateSnapshot }: PageProps) {
  const empty: Supplier = { id: '', name: '', domain: '', taxId: '', aliases: [], active: true, evidence: '', updatedAt: '', updatedBy: '', invoiceCount: 0 };
  const [editing, setEditing] = useState<Supplier | null>(null); const [merging, setMerging] = useState({ sourceId: '', targetId: '', reason: '' }); const [showMerge, setShowMerge] = useState(false); const [mergeError, setMergeError] = useState(''); const [showInactive, setShowInactive] = useState(false); const [query, setQuery] = useState('');
  const suppliers = snapshot.suppliers.filter((item) => (showInactive || item.active) && `${item.name} ${item.domain} ${item.taxId}`.toLowerCase().includes(query.toLowerCase()));
  const save = async () => { if (!editing?.name.trim()) return; const result = await api.saveSupplier(editing); if (result.ok && result.data) { const next = snapshot.suppliers.some((item) => item.id === result.data!.id) ? snapshot.suppliers.map((item) => item.id === result.data!.id ? result.data! : item) : [result.data, ...snapshot.suppliers]; updateSnapshot({ suppliers: next }); setEditing(null); } };
  const toggle = async (supplier: Supplier) => { const result = await api.toggleSupplier(supplier.id, !supplier.active); if (result.ok && result.data) updateSnapshot({ suppliers: snapshot.suppliers.map((item) => item.id === supplier.id ? result.data! : item) }); };
  const merge = async () => { setMergeError(''); const result = await api.mergeSuppliers(merging.sourceId, merging.targetId, merging.reason); if (result.ok && result.data) { updateSnapshot({ suppliers: snapshot.suppliers.map((item) => item.id === result.data!.source.id ? result.data!.source : item.id === result.data!.target.id ? result.data!.target : item) }); setShowMerge(false); setMerging({ sourceId: '', targetId: '', reason: '' }); } else setMergeError(result.error?.message ?? 'No se pudieron fusionar los proveedores'); };
  const exportCsv = () => { const rows = [['PROVEEDOR', 'DOMINIO', 'CIF_NIF'], ...suppliers.map((item) => [item.name, item.domain, item.taxId])]; const blob = new Blob(['\ufeff' + rows.map((row) => row.map(csvEscape).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'proveedores-reparapro.csv'; link.click(); URL.revokeObjectURL(link.href); };
  return <>
    <SectionHeader eyebrow="Catálogo acreditado" title="Proveedores" description="Solo los proveedores activos y respaldados por evidencia pueden identificar facturas automáticamente." action={<><Button variant="secondary" icon="download" onClick={exportCsv}>Exportar</Button><Button variant="secondary" icon="refresh" onClick={() => setShowMerge(true)}>Fusionar</Button><Button icon="plus" onClick={() => setEditing(empty)}>Añadir proveedor</Button></>}/>
    <div className="table-toolbar"><label className="search-box"><Icon name="search" size={18}/><input placeholder="Buscar proveedor, dominio o CIF" value={query} onChange={(e) => setQuery(e.target.value)}/></label><label className="switch-label"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}/><span/>Incluir inactivos</label><span>{suppliers.length} proveedores</span></div>
    <div className="supplier-grid">{suppliers.map((supplier) => <article key={supplier.id} className={!supplier.active ? 'is-inactive' : ''}><header><span className="supplier-mark">{supplier.name.slice(0, 2).toUpperCase()}</span><StatusBadge status={supplier.active ? 'ACTIVO' : 'INACTIVO'}/></header><h3>{supplier.name}</h3><dl><div><dt>Dominio</dt><dd>{supplier.domain || 'Sin dato acreditado'}</dd></div><div><dt>CIF / NIF</dt><dd>{supplier.taxId || 'Sin dato acreditado'}</dd></div><div><dt>Histórico</dt><dd>{supplier.invoiceCount} facturas</dd></div></dl>{supplier.aliases.length > 0 && <p className="aliases">También: {supplier.aliases.join(', ')}</p>}<footer><button onClick={() => setEditing(supplier)}><Icon name="edit" size={16}/>Editar</button><button onClick={() => toggle(supplier)}>{supplier.active ? 'Desactivar' : 'Reactivar'}</button></footer></article>)}</div>
    {editing && <Modal title={editing.id ? 'Editar proveedor' : 'Añadir proveedor'} onClose={() => setEditing(null)} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button icon="check" disabled={!editing.name.trim() || !editing.evidence.trim()} onClick={save}>Guardar proveedor</Button></>}><div className="form-stack"><Field label="Nombre canónico"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}/></Field><div className="form-grid"><Field label="Dominio confirmado"><input placeholder="ejemplo.com" value={editing.domain} onChange={(e) => setEditing({ ...editing, domain: e.target.value.toLowerCase() })}/></Field><Field label="CIF / NIF"><input value={editing.taxId} onChange={(e) => setEditing({ ...editing, taxId: e.target.value.toUpperCase() })}/></Field></div><Field label="Aliases acreditados" hint="Separados por punto y coma"><input value={editing.aliases.join('; ')} onChange={(e) => setEditing({ ...editing, aliases: e.target.value.split(';').map((value) => value.trim()).filter(Boolean) })}/></Field><Field label="Evidencia" hint="Ej.: Factura N 2026/003161 de ALAS COURIER S.L., CIF B78942877, recibida desde tip-sa.com"><textarea rows={3} placeholder="Documento y fragmento concreto que acreditan el nombre, dominio y CIF/NIF" value={editing.evidence} onChange={(e) => setEditing({ ...editing, evidence: e.target.value })}/></Field></div></Modal>}
    {showMerge && <Modal title="Fusionar proveedores" onClose={() => setShowMerge(false)} footer={<><Button variant="secondary" onClick={() => setShowMerge(false)}>Cancelar</Button><Button icon="check" disabled={!merging.sourceId || !merging.targetId || merging.sourceId === merging.targetId || !merging.reason.trim()} onClick={merge}>Confirmar fusión</Button></>}><div className="form-stack"><p className="inline-note"><Icon name="warning" size={16}/>El proveedor de origen se desactivará. El histórico permanecerá intacto y solo los documentos pendientes pasarán al proveedor de destino.</p><Field label="Proveedor de origen"><select value={merging.sourceId} onChange={(e) => setMerging({ ...merging, sourceId: e.target.value })}><option value="">Seleccionar</option>{snapshot.suppliers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Proveedor de destino"><select value={merging.targetId} onChange={(e) => setMerging({ ...merging, targetId: e.target.value })}><option value="">Seleccionar</option>{snapshot.suppliers.filter((item) => item.active && item.id !== merging.sourceId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Motivo y evidencia"><textarea rows={3} value={merging.reason} onChange={(e) => setMerging({ ...merging, reason: e.target.value })}/></Field>{mergeError && <p className="inline-note"><Icon name="error" size={16}/>{mergeError}</p>}</div></Modal>}
  </>;
}

function BankPage({ snapshot, updateSnapshot }: PageProps) {
  const [preview, setPreview] = useState<BankImport | null>(null); const [working, setWorking] = useState(false); const [form, setForm] = useState({ source: '', periodFrom: '2026-07-01', periodTo: '2026-07-20', coverage: 'Extracto parcial · 1 al 20 de julio de 2026', file: null as File | null });
  const [mappingInfo, setMappingInfo] = useState<{ headers: string[]; headerRow: number } | null>(null); const [mapping, setMapping] = useState<Record<string, number>>({}); const [importError, setImportError] = useState('');
  const [discarding, setDiscarding] = useState(false); const [discardReason, setDiscardReason] = useState('');
  const bankImport = preview ?? snapshot.bankImports[0];
  const loadFile = async () => {
    if (!form.file || !form.source || !form.coverage) return; setWorking(true); setImportError('');
    const base64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(form.file!); });
    const result = await api.previewBankImport({ fileName: form.file.name, base64, source: form.source, periodFrom: form.periodFrom, periodTo: form.periodTo, coverage: form.coverage, mapping: mappingInfo ? { ...mapping, headerRow: mappingInfo.headerRow } : undefined }); setWorking(false);
    if (result.ok && result.data) { setPreview(result.data); setMappingInfo(null); setMapping({}); }
    else { setImportError(result.error?.message ?? 'No se pudo leer el extracto'); if (result.error?.code === 'BANK_MAPPING_REQUIRED' && result.error.details) setMappingInfo(result.error.details as { headers: string[]; headerRow: number }); }
  };
  const confirm = async () => { if (!preview) return; setImportError(''); setWorking(true); const result = await api.confirmBankImport(preview); setWorking(false); if (result.ok && result.data) { updateSnapshot({ bankImports: [result.data, ...snapshot.bankImports] }); setPreview(null); } else setImportError(result.error?.message ?? 'No se pudo archivar el extracto'); };
  const discard = async () => { if (!preview || !discardReason.trim()) return; setImportError(''); setWorking(true); const result = await api.cancelBankImport(preview, discardReason.trim()); setWorking(false); if (result.ok && result.data) { updateSnapshot({ bankImports: [result.data, ...snapshot.bankImports.filter((item) => item.id !== result.data!.id)] }); setPreview(null); setDiscarding(false); setDiscardReason(''); } else setImportError(result.error?.message ?? 'No se pudo descartar la vista previa'); };
  const decide = async (movementId: string, status: string, invoiceId?: string) => { if (!bankImport) return; const result = await api.decideReconciliation(bankImport.id, movementId, status, invoiceId); if (result.ok && result.data) { if (preview) setPreview(result.data); else updateSnapshot({ bankImports: snapshot.bankImports.map((item) => item.id === result.data!.id ? result.data! : item) }); } };
  return <>
    <SectionHeader eyebrow="Control de cobertura" title="Conciliación bancaria" description="Compara evidencias. Una ausencia se informa con su cobertura, sin afirmar el estado del pago."/>
    <section className="bank-upload"><div className="panel-title"><span>1</span><div><h2>Importar extracto</h2><p>XLSX o CSV · el original se archiva solo al confirmar.</p></div></div><div className="form-grid bank-form"><Field label="Archivo"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setForm({ ...form, file: e.target.files?.[0] ?? null }); setMappingInfo(null); setImportError(''); }}/></Field><Field label="Cuenta o fuente"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}/></Field><Field label="Desde"><input type="date" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })}/></Field><Field label="Hasta"><input type="date" value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })}/></Field><Field label="Cobertura"><input placeholder="Ej. cuenta principal · julio completo" value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })}/></Field><Button icon="search" disabled={!form.file || !form.source || !form.coverage || working || Boolean(mappingInfo && (mapping.operationDate === undefined || mapping.concept === undefined || mapping.amount === undefined || mapping.currency === undefined))} onClick={loadFile}>{working ? 'Leyendo…' : mappingInfo ? 'Aplicar mapeo' : 'Previsualizar'}</Button></div>{importError && <p className="inline-note"><Icon name="warning" size={16}/>{importError}</p>}{mappingInfo && <div className="mapping-panel"><div><strong>Mapea las columnas del extracto</strong><p>La aplicación no adivinará un formato desconocido. Selecciona las columnas acreditadas.</p></div>{['operationDate', 'concept', 'amount', 'valueDate', 'currency', 'reference'].map((key) => <Field key={key} label={({ operationDate: 'Fecha operación *', concept: 'Concepto *', amount: 'Importe *', valueDate: 'Fecha valor', currency: 'Moneda *', reference: 'Referencia' } as Record<string, string>)[key]}><select value={mapping[key] ?? ''} onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}><option value="">Sin asignar</option>{mappingInfo.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}</select></Field>)}</div>}</section>
    {bankImport ? <section className="reconciliation"><div className="subhead"><div><p className="eyebrow">{bankImport.status}</p><h2>{bankImport.fileName}</h2><p>{bankImport.source} · {bankImport.coverage} · {bankImport.movementCount} movimientos</p>{bankImport.detectedPeriodFrom && <small className="detected-period">Periodo detectado: {formatDate(bankImport.detectedPeriodFrom)} → {formatDate(bankImport.detectedPeriodTo || '')}</small>}</div>{preview && <div><Button variant="secondary" onClick={() => setDiscarding(true)}>Descartar vista previa</Button><Button icon="archive" disabled={working} onClick={confirm}>Confirmar y archivar</Button></div>}</div>{Boolean(bankImport.warnings?.length) && <div className="warning-stack">{bankImport.warnings!.map((warning) => <p className="inline-note" key={warning}><Icon name="warning" size={16}/>{warning}</p>)}</div>}<div className="reconciliation-summary"><SummaryNumber label="Confirmadas" value={bankImport.movements.filter((item) => item.status === 'COINCIDENCIA CONFIRMADA').length}/><SummaryNumber label="Candidatas" value={bankImport.movements.filter((item) => item.status === 'CANDIDATA PENDIENTE').length}/><SummaryNumber label="Sin factura" value={bankImport.movements.filter((item) => item.status === 'MOVIMIENTO SIN FACTURA').length}/><SummaryNumber label="Excluidas" value={bankImport.movements.filter((item) => item.status.startsWith('EXCLUIDO')).length}/></div><div className="movement-list">{bankImport.movements.map((movement) => { const invoice = snapshot.invoices.find((item) => item.id === movement.candidateInvoiceId); return <article key={movement.id}><div className="movement-date"><strong>{new Date(movement.operationDate).getDate()}</strong><span>{new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(movement.operationDate))}</span></div><div className="movement-concept"><strong>{movement.concept}</strong><small>{movement.reference || 'Sin referencia'} · {movement.type}</small>{movement.evidence && <p><Icon name="search" size={14}/>{movement.evidence}</p>}</div><div className="movement-amount"><strong>{formatCurrency(movement.amount, movement.currency)}</strong><StatusBadge status={movement.status}/></div>{invoice && <div className="match-card"><span><Icon name="invoice"/></span><div><small>Factura candidata</small><strong>{invoice.supplier}</strong><p>{invoice.number} · {formatCurrency(invoice.total, invoice.currency)}</p></div></div>}<div className="movement-actions">{bankImport.status === 'CONFIRMADA' && movement.status === 'CANDIDATA PENDIENTE' && <><Button variant="quiet" onClick={() => decide(movement.id, 'REVISIÓN MANUAL', invoice?.id)}>Revisar</Button><Button icon="check" onClick={() => decide(movement.id, 'COINCIDENCIA CONFIRMADA', invoice?.id)}>Confirmar</Button></>}</div></article>; })}</div></section> : <EmptyState icon="bank" title="No hay extractos importados">Carga un XLSX o CSV e indica su cobertura para comenzar.</EmptyState>}
    {discarding && preview && <Modal title="Descartar vista previa bancaria" onClose={() => setDiscarding(false)}><div className="confirmation confirmation--danger"><span><Icon name="warning" size={28}/></span><h3>El extracto no se archivará</h3><p>Las filas técnicas quedarán canceladas y el archivo temporal podrá recuperarse desde la papelera de Drive.</p><Field label="Motivo obligatorio"><textarea rows={3} value={discardReason} onChange={(event) => setDiscardReason(event.target.value)}/></Field><div className="inline-modal-actions"><Button variant="secondary" onClick={() => setDiscarding(false)}>Volver</Button><Button variant="danger" icon="close" disabled={working || !discardReason.trim()} onClick={discard}>{working ? 'Descartando…' : 'Descartar y enviar temporal a papelera'}</Button></div></div></Modal>}
  </>;
}

function MetricsPage({ snapshot }: PageProps) {
  const averages = metricsAverages(snapshot.metrics); const max = Math.max(...snapshot.metrics.map((item) => item.count), 1); const total = snapshot.metrics.reduce((sum, item) => sum + item.count, 0);
  return <>
    <SectionHeader eyebrow="Carga administrativa" title="Facturas recibidas por mes" description="El recuento usa la fecha de emisión y solo incluye facturas con estado PROCESADA."/>
    <section className="metrics-hero"><div><p className="eyebrow">Periodo visible</p><strong>{total}</strong><span>facturas procesadas</span></div><div><p>Media de meses completos</p><strong>{averages.complete.toFixed(1)}</strong><small>Excluye el mes en curso</small></div><div><p>Media incluyendo parcial</p><strong>{averages.includingPartial.toFixed(1)}</strong><small>Incluye el mes en curso</small></div></section>
    <section className="chart-panel"><div className="subhead"><div><h2>Volumen mensual</h2><p>Cada barra permite identificar si el mes está completo.</p></div><span className="coverage-note"><i/> Mes parcial</span></div><div className="bar-chart">{snapshot.metrics.map((metric) => <div key={metric.month} className={!metric.complete ? 'is-partial' : ''}><div className="bar-chart__value">{metric.count}</div><div className="bar-chart__track"><span style={{ height: `${Math.max((metric.count / max) * 100, 5)}%` }}/></div><strong>{new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(`${metric.month}-01T12:00:00`))}</strong><small>{metric.complete ? 'Completo' : 'Parcial'}</small></div>)}</div></section>
    <section className="metric-table"><h2>Detalle y gasto documentado</h2>{snapshot.metrics.map((metric) => <div key={metric.month}><span>{new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(`${metric.month}-01T12:00:00`))}</span><strong>{metric.count} facturas</strong><b>{formatCurrency(metric.total)}</b><StatusBadge status={metric.complete ? 'MES COMPLETO' : 'MES PARCIAL'}/></div>)}</section>
  </>;
}

function HistoryPage({ snapshot }: PageProps) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(0); const events = snapshot.audit.filter((event) => `${event.action} ${event.object} ${event.detail} ${event.user}`.toLowerCase().includes(query.toLowerCase())); const pageSize = 25; const visibleEvents = events.slice(page * pageSize, (page + 1) * pageSize);
  return <>
    <SectionHeader eyebrow="Registro inmutable" title="Historial y auditoría" description="Cada decisión conserva actor, momento, objeto y resultado para poder reconstruir el proceso."/>
    <div className="table-toolbar"><label className="search-box"><Icon name="search" size={18}/><input placeholder="Buscar acción, lote, documento o usuario" value={query} onChange={(e) => setQuery(e.target.value)}/></label><span>{events.length} eventos</span></div>
    <div className="audit-list">{visibleEvents.map((event) => <article key={event.id}><span className={`audit-level audit-level--${event.level.toLowerCase()}`}><Icon name={event.level === 'ERROR' ? 'error' : event.level === 'WARN' ? 'warning' : 'check'}/></span><div><header><strong>{event.action.replaceAll('_', ' ')}</strong><StatusBadge status={event.level}/></header><p>{event.detail}</p><footer><span className="mono">{event.object}</span><span>{formatDate(event.timestamp, true)}</span><span>{event.user}</span></footer></div></article>)}</div><Pagination page={page} total={events.length} pageSize={pageSize} onPage={setPage}/>
  </>;
}

function SettingsPage({ snapshot, updateSnapshot }: PageProps) {
  const [settings, setSettings] = useState(snapshot.settings); const [saved, setSaved] = useState(false); const [productionConfirmed, setProductionConfirmed] = useState(false); const [settingsError, setSettingsError] = useState(''); const [setupResult, setSetupResult] = useState(''); const [settingUp, setSettingUp] = useState(false);
  const save = async () => { const needsConfirmation = settings.mode === 'PRODUCTION' && snapshot.settings.mode !== 'PRODUCTION'; if (needsConfirmation && !productionConfirmed) { setSettingsError('Confirma de forma explícita la activación de producción.'); return; } setSettingsError(''); const result = await api.updateSettings(settings, productionConfirmed); if (result.ok && result.data) { updateSnapshot({ settings: result.data }); setSettings(result.data); setProductionConfirmed(false); setSaved(true); setTimeout(() => setSaved(false), 2500); } else setSettingsError(result.error?.message ?? 'No se pudo guardar la configuración'); };
  const setup = async () => { setSettingUp(true); const result = await api.setupSchema(); setSettingUp(false); if (result.ok && result.data) { const next = { ...settings, schemaReady: true }; setSettings(next); updateSnapshot({ settings: next }); setSetupResult(`Copia creada: ${result.data.backup.name}`); } else setSetupResult(result.error?.message ?? 'No se pudo preparar la estructura'); };
  const legacyTriggers = (settings.triggers || []).filter((item) => ['procesarFacturasPendientes', 'myFunction'].includes(item.handler));
  const disableLegacy = async () => { setSettingsError(''); const result = await api.disableLegacyTriggers(); if (result.ok && result.data) { const next = { ...settings, triggers: result.data.remaining || [] }; setSettings(next); updateSnapshot({ settings: next }); setSetupResult(`${result.data.removed?.length || 0} activadores antiguos desactivados`); } else setSettingsError(result.error?.message ?? 'No se pudieron desactivar los activadores antiguos'); };
  return <>
    <SectionHeader eyebrow="Operación segura" title="Configuración" description="Parámetros visibles y auditables. Ninguna credencial se guarda en esta pantalla." action={<Button icon="check" onClick={save}>{saved ? 'Guardado' : 'Guardar cambios'}</Button>}/>
    <section className="settings-grid"><div className="settings-card"><header><span><Icon name="shield"/></span><div><h2>Acceso y modo</h2><p>Quién puede operar y dónde se permiten escrituras.</p></div></header>{settings.schemaReady === false && <div className="schema-callout"><Icon name="warning"/><div><strong>La estructura de la app aún no existe</strong><p>Se creará primero una copia de ReparaPRO Docs y después solo se añadirán columnas y pestañas.</p></div></div>}<div className="schema-callout"><Icon name="archive"/><div><strong>Copia de seguridad y estructura</strong><p>Crea una copia nueva de ReparaPRO Docs y aplica únicamente columnas y pestañas aditivas.</p></div><Button icon="archive" disabled={settingUp} onClick={setup}>{settingUp ? 'Preparando…' : 'Crear copia y actualizar estructura'}</Button></div>{setupResult && <p className="inline-note"><Icon name="check" size={16}/>{setupResult}</p>}<Field label="Modo"><select value={settings.mode} onChange={(e) => { setSettings({ ...settings, mode: e.target.value as typeof settings.mode }); setProductionConfirmed(false); }}><option value="DRY_RUN">Modo seco · sin archivos definitivos</option><option value="PRODUCTION">Producción · requiere aprobación</option></select></Field>{settings.mode === 'PRODUCTION' && snapshot.settings.mode !== 'PRODUCTION' && <label className="switch-label"><input type="checkbox" checked={productionConfirmed} onChange={(e) => setProductionConfirmed(e.target.checked)}/><span/>Confirmo que el piloto en modo seco ha sido revisado y autorizo escrituras definitivas</label>}{settingsError && <p className="inline-note"><Icon name="warning" size={16}/>{settingsError}</p>}<Field label="Usuarios autorizados" hint="Un correo por línea. La identidad siempre se valida en servidor."><textarea rows={4} value={settings.allowedUsers.join('\n')} onChange={(e) => setSettings({ ...settings, allowedUsers: e.target.value.split(/\s+/).filter(Boolean) })}/></Field><div className="identity-readout"><span>Usuario activo</span><strong>{settings.user}</strong><span>Usuario efectivo</span><strong>{settings.effectiveUser}</strong></div></div>
      <div className="settings-card"><header><span><Icon name="process"/></span><div><h2>Procesamiento</h2><p>Límites conservadores para respetar las cuotas.</p></div></header><div className="form-grid"><Field label="Tamaño máximo"><input type="number" min={1} max={20} value={settings.maxBatchSize} onChange={(e) => setSettings({ ...settings, maxBatchSize: Number(e.target.value) })}/></Field><Field label="Bloque interno"><input type="number" min={1} max={5} value={settings.sliceSize} onChange={(e) => setSettings({ ...settings, sliceSize: Number(e.target.value) })}/></Field><Field label="Fecha inicial"><input type="date" value={settings.startDate} onChange={(e) => setSettings({ ...settings, startDate: e.target.value })}/></Field><Field label="Zona horaria"><input value={settings.timezone} readOnly/></Field></div></div>
      <div className="settings-card settings-card--wide"><header><span><Icon name="settings"/></span><div><h2>Diagnóstico de fuentes</h2><p>La aplicación falla de forma cerrada si falta una dependencia obligatoria.</p></div></header><div className="service-grid"><Service name="Gmail" detail="compras@reparapro.com · solo lectura" ready={settings.services.gmail}/><Service name="Google Sheets" detail={settings.spreadsheetName} ready={settings.services.sheets}/><Service name="Drive facturas" detail={settings.invoiceFolderName} ready={settings.services.drive}/><Service name="Drive bancos" detail={settings.bankFolderName} ready={settings.services.drive}/></div><div className="trigger-diagnostic"><div><strong>Activadores del proyecto</strong><p>{settings.triggerDiagnosticAvailable === false ? 'Diagnóstico no disponible desde el web app; revísalo en Apps Script.' : settings.triggers?.length ? settings.triggers.map((item) => `${item.handler} · ${item.eventType}`).join(' · ') : 'No hay procesos programados.'}</p></div>{legacyTriggers.length > 0 && <Button variant="danger" icon="warning" onClick={disableLegacy}>Desactivar automatización antigua</Button>}</div></div>
    </section>
  </>;
}

function ReviewPageV18({ snapshot, updateSnapshot }: PageProps) {
  const active = snapshot.activeBatch?.documents.filter((item) => item.phase !== 'FINALIZADO' && item.phase !== 'CANCELADO') ?? [];
  const documents = [...snapshot.reviewDocuments, ...active.filter((item) => !snapshot.reviewDocuments.some((queued) => queued.id === item.id))];
  const storageKey = `reparapro-review-drafts:${snapshot.settings.user}`;
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Record<string, ReviewDraft>;
      return Object.fromEntries(Object.entries(stored).map(([id, draft]) => {
        const source = documents.find((item) => item.id === id);
        return source ? [id, { ...draft, document: { ...source, ...draft.document, evidence: source.evidence } }] : [id, draft];
      }));
    } catch (_) { return {}; }
  });
  const [selectedId, setSelectedId] = useState(documents[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string; gmailUrl?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<Supplier | null>(null);
  const [supplierConfirmed, setSupplierConfirmed] = useState(false);
  const selectedBase = documents.find((item) => item.id === selectedId) ?? documents[0] ?? null;
  const selected = selectedBase ? drafts[selectedBase.id]?.document ?? selectedBase : null;
  const selectedReason = selected ? drafts[selected.id]?.reason ?? selected.decisionReason ?? selected.reviewReason : '';
  const dirtyCount = Object.keys(drafts).length;

  useEffect(() => {
    const safe = Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, {
      ...draft,
      document: {
        id: draft.document.id, supplier: draft.document.supplier, supplierId: draft.document.supplierId,
        taxId: draft.document.taxId, invoiceNumber: draft.document.invoiceNumber, invoiceDate: draft.document.invoiceDate,
        operationDate: draft.document.operationDate, dueDate: draft.document.dueDate, categoryId: draft.document.categoryId,
        taxableBase: draft.document.taxableBase, taxLines: draft.document.taxLines, internalNote: draft.document.internalNote,
        total: draft.document.total, currency: draft.document.currency, proposedStatus: draft.document.proposedStatus,
        nonRegularSupplier: draft.document.nonRegularSupplier,
      },
    }]));
    if (Object.keys(safe).length) sessionStorage.setItem(storageKey, JSON.stringify(safe));
    else sessionStorage.removeItem(storageKey);
  }, [drafts, storageKey]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  const edit = (document: InvoiceDocument, reason = selectedReason) => {
    const base = documents.find((item) => item.id === document.id) ?? document;
    setDrafts((current) => ({ ...current, [document.id]: current[document.id]
      ? { ...current[document.id], document, reason, dirtyAt: new Date().toISOString() }
      : { document, reason, baseUpdatedAt: base.updatedAt ?? '', decisionId: crypto.randomUUID(), dirtyAt: new Date().toISOString() } }));
    setMessage('');
  };
  const syncSaved = (saved: InvoiceDocument[]) => {
    const savedMap = new Map(saved.map((item) => [item.id, item]));
    const activeBatch = snapshot.activeBatch ? { ...snapshot.activeBatch, documents: snapshot.activeBatch.documents.map((item) => savedMap.get(item.id) ?? item) } : null;
    const reviewDocuments = snapshot.reviewDocuments.map((item) => savedMap.get(item.id) ?? item);
    updateSnapshot({ activeBatch, reviewDocuments });
  };
  const saveIds = async (ids: string[]) => {
    const items = ids.map((id) => drafts[id]).filter(Boolean).slice(0, 20);
    if (!items.length) { setMessage('No hay cambios pendientes.'); return; }
    if (items.some((item) => !item.reason.trim())) { setMessage('Todos los cambios necesitan un motivo antes de guardarse.'); return; }
    setSaving(true); setMessage('');
    const result = await api.saveDocuments(items);
    setSaving(false);
    if (!result.ok || !result.data) { setMessage(result.error?.message ?? 'No se pudieron guardar las decisiones.'); return; }
    const saved = result.data.items.filter((item) => item.ok && item.document).map((item) => item.document!);
    syncSaved(saved);
    setDrafts((current) => {
      const next = { ...current };
      result.data!.items.filter((item) => item.ok).forEach((item) => delete next[item.documentId]);
      return next;
    });
    const conflicts = result.data.items.filter((item) => item.error?.code === 'REVIEW_CONFLICT').length;
    setMessage(`${result.data.saved} guardadas${result.data.failed ? ` · ${result.data.failed} pendientes de reintento` : ''}${conflicts ? ` · ${conflicts} conflictos por cambios concurrentes` : ''} · ${result.data.durationMs} ms`);
  };
  const approve = async () => {
    if (!selected) return;
    const result = await api.approveDocument(selected.id);
    if (!result.ok || !result.data) { setMessage(result.error?.message ?? 'No se pudo aprobar el documento.'); return; }
    const reviewDocuments = snapshot.reviewDocuments.filter((item) => item.id !== selected.id);
    const activeBatch = snapshot.activeBatch ? { ...snapshot.activeBatch, documents: snapshot.activeBatch.documents.map((item) => item.id === selected.id ? result.data! : item) } : null;
    updateSnapshot({ activeBatch, reviewDocuments, reviewCount: reviewDocuments.length });
    setDrafts((current) => { const next = { ...current }; delete next[selected.id]; return next; });
    setSelectedId(reviewDocuments[0]?.id ?? '');
  };
  const openPreview = async () => {
    if (!selected || previewLoading) return;
    setPreviewLoading(true); setMessage('');
    const result = await api.getDocumentPreview(selected);
    setPreviewLoading(false);
    if (!result.ok || !result.data) { setMessage(result.error?.message ?? 'No se pudo cargar el PDF.'); return; }
    setPreview({ name: result.data.originalName, url: pdfObjectUrl(result.data), gmailUrl: result.data.gmailUrl });
  };
  const createSupplier = async () => {
    if (!selected || !supplierDraft || !supplierConfirmed || !supplierDraft.name.trim() || !supplierDraft.evidence.trim()) return;
    setSaving(true); setMessage('');
    const result = await api.saveSupplier(supplierDraft);
    setSaving(false);
    if (!result.ok || !result.data) { setMessage(result.error?.message ?? 'No se pudo crear el proveedor.'); return; }
    const supplier = result.data;
    updateSnapshot({ suppliers: [supplier, ...snapshot.suppliers.filter((item) => item.id !== supplier.id)] });
    edit({ ...selected, supplierId: supplier.id, supplier: supplier.name, taxId: supplier.taxId || selected.taxId, nonRegularSupplier: false }, `Proveedor ${supplier.name} creado desde ${selected.originalName}. ${supplier.evidence}`);
    setSupplierDraft(null); setSupplierConfirmed(false);
  };
  const addTax = () => selected && edit({ ...selected, taxLines: [...(selected.taxLines ?? []), { id: crypto.randomUUID(), kind: 'IVA', rate: 21, base: 0, amount: 0 }] });
  const setTax = (index: number, patch: Partial<TaxLine>) => selected && edit({ ...selected, taxLines: (selected.taxLines ?? []).map((line, position) => position === index ? { ...line, ...patch } : line) });
  const removeTax = (index: number) => selected && edit({ ...selected, taxLines: (selected.taxLines ?? []).filter((_, position) => position !== index) });
  const matchedSupplier = selected ? snapshot.suppliers.find((item) => item.active && item.id === selected.supplierId) : undefined;

  return <>
    <SectionHeader eyebrow="Control humano · revisión rápida" title="Revisión manual" description="La clasificación manual se conserva aunque falten datos. Guardar una decisión nunca aprueba la factura." action={dirtyCount > 0 ? <Button icon="check" disabled={saving} onClick={() => saveIds(Object.keys(drafts))}>{saving ? 'Guardando…' : `Guardar todas (${dirtyCount})`}</Button> : undefined}/>
    {!documents.length ? <EmptyState icon="check" title="No hay revisiones pendientes">Los resultados finalizados siguen disponibles en Facturas.</EmptyState> : <section className="review-layout review-layout--v18">
      <div className="review-list"><div className="list-toolbar"><strong>{documents.length} pendientes</strong><span>{dirtyCount} sin guardar</span></div>{documents.map((source) => { const doc = drafts[source.id]?.document ?? source; return <button key={doc.id} className={(selected?.id === doc.id ? 'is-active ' : '') + (drafts[doc.id] ? 'is-dirty' : '')} onClick={() => { setSelectedId(doc.id); setMessage(''); }}><span className="file-token"><Icon name="file"/></span><div><strong>{doc.originalName}</strong><p>{doc.supplier || 'Proveedor sin asociar'}</p><small>{activeReviewDecision(doc)?.label ?? doc.proposedStatus}</small>{drafts[doc.id] && <em>Sin guardar</em>}</div><Icon name="chevron" size={17}/></button>; })}</div>
      {selected && <div className="review-detail"><div className="review-detail__head"><div><p className="eyebrow">Documento · {selected.id}</p><h2>{selected.originalName}</h2><p>{selected.subject}</p></div><div className="review-detail__source-actions"><Button variant="secondary" icon="eye" disabled={previewLoading} onClick={openPreview}>{previewLoading ? 'Cargando…' : 'Previsualizar PDF'}</Button>{selected.gmailUrl && <a className="button button--secondary" href={selected.gmailUrl} target="_blank" rel="noreferrer"><Icon name="mail" size={17}/>Abrir correo</a>}</div></div>
        <EvidenceChain active={3}/>
        <div className="review-grid review-grid--enriched">
          <div className="supplier-association"><Field label="Proveedor"><select value={selected.supplierId ?? ''} onChange={(event) => { const supplier = snapshot.suppliers.find((item) => item.id === event.target.value); edit({ ...selected, supplierId: supplier?.id, supplier: supplier?.name ?? selected.supplier, taxId: supplier?.taxId || selected.taxId, categoryId: selected.categoryId || snapshot.categories.find((category) => category.supplierIds.includes(supplier?.id ?? ''))?.id }); }}><option value="">Sin asociar</option>{snapshot.suppliers.filter((item) => item.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.invoiceCount} facturas</option>)}</select></Field>{!selected.supplierId && <Button variant="quiet" icon="plus" onClick={() => { setSupplierDraft(supplierDraftFromDocument(selected)); setSupplierConfirmed(false); }}>Crear proveedor desde este PDF</Button>}{(!matchedSupplier || matchedSupplier.invoiceCount < 3) && <label className="compact-check"><input type="checkbox" aria-label="Marcar como proveedor no habitual" checked={Boolean(selected.nonRegularSupplier)} onChange={(event) => edit({ ...selected, nonRegularSupplier: event.target.checked })}/><span>Marcar como proveedor no habitual</span></label>}{selected.nonRegularSupplier && !matchedSupplier && <Field label="Nombre del proveedor en la factura"><input value={selected.supplier} onChange={(event) => edit({ ...selected, supplier: event.target.value })}/></Field>}</div>
          <Field label="CIF / NIF"><input value={selected.taxId} onChange={(event) => edit({ ...selected, taxId: event.target.value })}/></Field>
          <Field label="Número de factura"><input value={selected.invoiceNumber} onChange={(event) => edit({ ...selected, invoiceNumber: event.target.value })}/></Field>
          <Field label="Fecha de emisión"><input type="date" value={selected.invoiceDate} onChange={(event) => edit({ ...selected, invoiceDate: event.target.value })}/></Field>
          <Field label="Fecha de operación" hint="Opcional"><input type="date" value={selected.operationDate ?? ''} onChange={(event) => edit({ ...selected, operationDate: event.target.value })}/></Field>
          <Field label="Fecha de vencimiento" hint="Opcional"><input type="date" value={selected.dueDate ?? ''} onChange={(event) => edit({ ...selected, dueDate: event.target.value })}/></Field>
          <Field label="Categoría"><select value={selected.categoryId ?? ''} onChange={(event) => edit({ ...selected, categoryId: event.target.value })}><option value="">Sin categoría</option>{snapshot.categories.filter((category) => category.active || category.id === selected.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="Base imponible"><input type="number" step="0.01" value={selected.taxableBase ?? ''} onChange={(event) => edit({ ...selected, taxableBase: event.target.value === '' ? null : Number(event.target.value) })}/></Field>
          <Field label="Total con impuestos"><input type="number" step="0.01" value={selected.total ?? ''} onChange={(event) => edit({ ...selected, total: event.target.value === '' ? null : Number(event.target.value) })}/></Field>
          <Field label="Moneda"><input maxLength={3} value={selected.currency} onChange={(event) => edit({ ...selected, currency: event.target.value.toUpperCase() })}/></Field>
        </div>
        <section className="tax-editor"><div className="subhead"><div><h3>Líneas fiscales</h3><p>Solo añade importes acreditados en la factura.</p></div><Button variant="secondary" icon="plus" onClick={addTax}>Añadir línea</Button></div>{(selected.taxLines ?? []).map((line, index) => <div className="tax-line" key={line.id}><select aria-label="Tipo de impuesto" value={line.kind} onChange={(event) => setTax(index, { kind: event.target.value as TaxLine['kind'] })}><option>IVA</option><option>IGIC</option><option value="RETENCION">Retención</option><option value="OTRO">Otro</option></select><input aria-label="Tipo porcentual" type="number" step="0.01" value={line.rate} onChange={(event) => setTax(index, { rate: Number(event.target.value) })}/><input aria-label="Base" type="number" step="0.01" value={line.base} onChange={(event) => setTax(index, { base: Number(event.target.value) })}/><input aria-label="Importe fiscal" type="number" step="0.01" value={line.amount} onChange={(event) => setTax(index, { amount: Number(event.target.value) })}/><button className="icon-button" aria-label="Eliminar línea fiscal" onClick={() => removeTax(index)}><Icon name="close"/></button></div>)}</section>
        <Field label="Nota interna acreditada" hint="No inventes información que no figure en el documento o correo"><textarea rows={2} value={selected.internalNote ?? ''} onChange={(event) => edit({ ...selected, internalNote: event.target.value })}/></Field>
        <Field label="Motivo de la decisión" hint="Obligatorio para guardar"><textarea rows={3} value={selectedReason} onChange={(event) => edit(selected, event.target.value)}/></Field>
        <div className="decision-control"><div className="decision-control__head"><strong>Clasificación manual</strong><span>Los errores de datos no cambiarán esta elección.</span></div><div className="decision-control__options">{reviewDecisions.map((decision) => <Button key={decision.key} variant={activeReviewDecision(selected)?.key === decision.key ? 'primary' : 'secondary'} aria-pressed={activeReviewDecision(selected)?.key === decision.key} onClick={() => { const total = decision.creditNote && selected.total !== null ? -Math.abs(selected.total) : selected.total; edit({ ...selected, proposedStatus: decision.status, total }); }}>{decision.label}</Button>)}</div></div>
        <p className="decision-feedback" role="status"><Icon name="check" size={17}/><span><strong>Decisión preparada:</strong> {activeReviewDecision(selected)?.label}{selected.nonRegularSupplier ? ' · Proveedor no habitual' : ''}. Se aplicará al guardar.</span></p>
        {Boolean(selected.validationErrors?.length) && <div className="validation-panel" role="alert"><strong>Datos que bloquean la aprobación</strong><ul>{selected.validationErrors!.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        {message && <p className="inline-note" role="status"><Icon name="warning" size={16}/>{message}</p>}
        <div className="review-actions"><Button variant="secondary" disabled={!drafts[selected.id] || saving} onClick={() => { setDrafts((current) => { const next = { ...current }; delete next[selected.id]; return next; }); setMessage('Cambios descartados.'); }}>Descartar cambios</Button><Button aria-label="Guardar decisión" icon="check" disabled={!drafts[selected.id] || saving} onClick={() => saveIds([selected.id])}>{saving ? 'Guardando…' : 'Guardar esta decisión'}</Button>{selected.phase === 'LISTO PARA APROBAR' && !drafts[selected.id] && <Button icon="archive" onClick={approve}>Aprobar documento</Button>}</div>
      </div>}
    </section>}
    {preview && <Modal title={`Vista previa · ${preview.name}`} size="wide" onClose={() => setPreview(null)} footer={<><a className="button button--secondary" href={preview.url} target="_blank" rel="noreferrer"><Icon name="eye" size={17}/>Abrir en otra pestaña</a>{preview.gmailUrl && <a className="button button--secondary" href={preview.gmailUrl} target="_blank" rel="noreferrer"><Icon name="mail" size={17}/>Ver correo de origen</a>}<Button onClick={() => setPreview(null)}>Cerrar</Button></>}><div className="pdf-preview"><iframe title={`PDF ${preview.name}`} src={preview.url}/></div></Modal>}
    {supplierDraft && selected && <Modal title="Crear proveedor desde este documento" onClose={() => !saving && setSupplierDraft(null)} footer={<><Button variant="secondary" disabled={saving} onClick={() => setSupplierDraft(null)}>Cancelar</Button><Button icon="check" disabled={saving || !supplierConfirmed || !supplierDraft.name.trim() || !supplierDraft.evidence.trim()} onClick={createSupplier}>{saving ? 'Creando…' : 'Crear y asociar'}</Button></>}><div className="form-stack"><div className="source-evidence-card"><span><Icon name="search" size={18}/></span><div><strong>Fuente de los datos</strong><p>{selected.originalName} · {selected.sender}</p><small>Crear el proveedor no aprueba la factura.</small></div></div><Field label="Nombre canónico"><input autoFocus value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })}/></Field><div className="form-grid"><Field label="Dominio confirmado"><input value={supplierDraft.domain} onChange={(event) => setSupplierDraft({ ...supplierDraft, domain: event.target.value.toLowerCase() })}/></Field><Field label="CIF / NIF"><input value={supplierDraft.taxId} onChange={(event) => setSupplierDraft({ ...supplierDraft, taxId: event.target.value.toUpperCase() })}/></Field></div><Field label="Aliases acreditados"><input value={supplierDraft.aliases.join('; ')} onChange={(event) => setSupplierDraft({ ...supplierDraft, aliases: event.target.value.split(';').map((value) => value.trim()).filter(Boolean) })}/></Field><Field label="Evidencia" hint="Documento y fragmento concreto que acreditan los datos"><textarea rows={3} value={supplierDraft.evidence} onChange={(event) => setSupplierDraft({ ...supplierDraft, evidence: event.target.value })}/></Field><label className="evidence-confirmation"><input type="checkbox" checked={supplierConfirmed} onChange={(event) => setSupplierConfirmed(event.target.checked)}/><span><strong>He comprobado los datos</strong><small>Los datos introducidos aparecen en el PDF o correo.</small></span></label></div></Modal>}
  </>;
}

function BankPageV18(props: PageProps) {
  return <><BankPage {...props}/><ReconciliationMatrix {...props}/></>;
}

function ReconciliationMatrix({ snapshot, updateSnapshot }: PageProps) {
  const confirmedImports = snapshot.bankImports.filter((item) => item.status === 'CONFIRMADA');
  const [importId, setImportId] = useState(confirmedImports[0]?.id ?? '');
  const [direction, setDirection] = useState<'MOVEMENT' | 'INVOICE'>('MOVEMENT');
  const [movementId, setMovementId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [allowDifference, setAllowDifference] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const bankImport = confirmedImports.find((item) => item.id === importId);
  const movement = bankImport?.movements.find((item) => item.id === movementId);
  const invoice = snapshot.invoices.find((item) => item.id === invoiceId);
  const allocated = Number(amount || 0);
  const total = direction === 'MOVEMENT' ? Math.abs(movement?.amount ?? 0) : Math.abs(invoice?.total ?? 0);
  const alreadyAssigned = direction === 'MOVEMENT' ? Math.abs(movement?.assignedAmount ?? 0) : Math.abs(invoice?.assignedAmount ?? 0);
  const difference = total - alreadyAssigned - Math.abs(allocated);
  const save = async () => {
    if (!bankImport || !movement || !invoice || allocated <= 0) { setMessage('Selecciona movimiento, factura e importe asignado.'); return; }
    setWorking(true); setMessage('');
    const result = await api.saveReconciliationLinks(bankImport.id, [{ movementId: movement.id, invoiceId: invoice.id, allocatedAmount: allocated, evidence: `Importe ${movement.amount} ${movement.currency}; factura ${invoice.number}; referencia ${movement.reference || 'sin referencia'}` }], reason, allowDifference);
    setWorking(false);
    if (!result.ok || !result.data) { setMessage(result.error?.message ?? 'No se pudo confirmar la relación.'); return; }
    updateSnapshot({ bankImports: snapshot.bankImports.map((item) => item.id === result.data!.id ? result.data! : item) });
    setAmount(''); setReason(''); setMessage('Relación confirmada y saldos recalculados.');
  };
  const undo = async (link: ReconciliationLink) => {
    const undoReason = window.prompt('Motivo para deshacer la conciliación');
    if (!undoReason?.trim() || !bankImport) return;
    const result = await api.undoReconciliation(bankImport.id, link.id, undoReason.trim());
    if (result.ok && result.data) updateSnapshot({ bankImports: snapshot.bankImports.map((item) => item.id === result.data!.id ? result.data! : item) });
    else setMessage(result.error?.message ?? 'No se pudo deshacer.');
  };
  const exclude = async (targetType: 'MOVEMENT' | 'INVOICE') => {
    const targetId = targetType === 'MOVEMENT' ? movementId : invoiceId;
    if (!bankImport || !targetId || !reason.trim()) { setMessage('Selecciona el elemento e indica un motivo para excluirlo.'); return; }
    setWorking(true);
    const result = await api.saveReconciliationException(bankImport.id, targetType, targetId, reason.trim());
    setWorking(false);
    if (result.ok && result.data) { updateSnapshot({ bankImports: snapshot.bankImports.map((item) => item.id === result.data!.id ? result.data! : item) }); setMessage(targetType === 'MOVEMENT' ? 'Movimiento marcado como excluido con motivo.' : 'Factura marcada como pagada fuera de este extracto.'); setReason(''); }
    else setMessage(result.error?.message ?? 'No se pudo guardar la excepción.');
  };
  return <section className="reconciliation reconciliation-matrix"><div className="subhead"><div><p className="eyebrow">Matriz avanzada</p><h2>Asignar pagos y facturas</h2><p>Las propuestas nunca se aplican solas. Puedes crear relaciones 1:1, 1:N o N:1.</p></div><div className="segmented"><button className={direction === 'MOVEMENT' ? 'is-active' : ''} onClick={() => setDirection('MOVEMENT')}>Movimiento → Factura</button><button className={direction === 'INVOICE' ? 'is-active' : ''} onClick={() => setDirection('INVOICE')}>Factura → Movimiento</button></div></div>
    {!confirmedImports.length ? <EmptyState icon="bank" title="Confirma un extracto para conciliar">Las vistas previas no admiten relaciones definitivas.</EmptyState> : <><div className="matrix-form"><Field label="Extracto"><select value={importId} onChange={(event) => setImportId(event.target.value)}>{confirmedImports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.coverage}</option>)}</select></Field><Field label="Movimiento"><select value={movementId} onChange={(event) => { setMovementId(event.target.value); const match = bankImport?.movements.find((item) => item.id === event.target.value); setAmount(match ? String(Math.abs(match.difference ?? match.amount)) : ''); }}><option value="">Seleccionar</option>{bankImport?.movements.filter((item) => item.type === 'CARGO' || item.type === 'REVISIÓN').map((item) => <option key={item.id} value={item.id}>{formatDate(item.operationDate)} · {item.concept} · {formatCurrency(item.amount, item.currency)}</option>)}</select></Field><Field label="Factura"><select value={invoiceId} onChange={(event) => { setInvoiceId(event.target.value); const match = snapshot.invoices.find((item) => item.id === event.target.value); if (match) setAmount(String(Math.abs(match.total - (match.assignedAmount ?? 0)))); }}><option value="">Seleccionar</option>{snapshot.invoices.filter((item) => item.status === 'PROCESADA').map((item) => <option key={item.id} value={item.id}>{item.supplier} · {item.number} · {formatCurrency(item.total, item.currency)}</option>)}</select></Field><Field label="Importe asignado"><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)}/></Field></div>
      <div className="allocation-summary"><SummaryNumber label="TOTAL" value={formatCurrency(total, movement?.currency || invoice?.currency || 'EUR')}/><SummaryNumber label="ASIGNADO" value={formatCurrency(alreadyAssigned + Math.abs(allocated), movement?.currency || invoice?.currency || 'EUR')}/><SummaryNumber label="DIFERENCIA" value={formatCurrency(difference, movement?.currency || invoice?.currency || 'EUR')}/></div>
      <div className="matrix-decision"><Field label="Motivo o diferencia justificada"><input placeholder="Comisión, redondeo, pago parcial…" value={reason} onChange={(event) => setReason(event.target.value)}/></Field><label className="compact-check"><input type="checkbox" checked={allowDifference} onChange={(event) => setAllowDifference(event.target.checked)}/><span>Confirmo una asignación que supera el saldo y dejo motivo</span></label><Button icon="check" disabled={working || !movementId || !invoiceId || allocated <= 0 || (difference < -0.01 && (!allowDifference || !reason.trim()))} onClick={save}>{working ? 'Confirmando…' : 'Confirmar relación'}</Button></div>
      <div className="exception-actions"><span>Excepciones justificadas</span><Button variant="secondary" disabled={working || !movementId || !reason.trim()} onClick={() => exclude('MOVEMENT')}>Movimiento sin factura</Button><Button variant="secondary" disabled={working || !invoiceId || !reason.trim()} onClick={() => exclude('INVOICE')}>Factura pagada fuera del extracto</Button></div>
      {message && <p className="inline-note"><Icon name="warning" size={16}/>{message}</p>}
      <div className="link-list">{(bankImport?.reconciliations ?? []).filter((link) => link.status === 'CONFIRMADA').map((link) => { const linkedMovement = bankImport?.movements.find((item) => item.id === link.movementId); const linkedInvoice = snapshot.invoices.find((item) => item.id === link.invoiceId); return <article key={link.id}><div><strong>{linkedMovement?.concept}</strong><small>{linkedInvoice?.supplier} · {linkedInvoice?.number}</small></div><b>{formatCurrency(link.allocatedAmount, linkedMovement?.currency)}</b><span>{link.evidence}</span><Button variant="quiet" onClick={() => undo(link)}>Deshacer</Button></article>; })}</div></>}
  </section>;
}

function MonthlyClosePage({ snapshot, updateSnapshot }: PageProps) {
  const initialPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(initialPeriod);
  const [close, setClose] = useState<MonthlyClose | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmExport, setConfirmExport] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const load = async () => { setLoading(true); setMessage(''); const result = await api.getMonthlyClose(period); setLoading(false); if (result.ok && result.data) setClose(result.data); else setMessage(result.error?.message ?? 'No se pudo calcular el cierre.'); };
  const createExport = async () => { if (!close) return; setLoading(true); setConfirmExport(false); const result = await api.createAccountantExport(period, close.coverage); setLoading(false); if (result.ok && result.data) { updateSnapshot({ exports: [result.data, ...(snapshot.exports ?? [])] }); setMessage(`Exportación completada: ${result.data.files.length} archivos.`); } else setMessage(result.error?.message ?? 'No se pudo generar la exportación.'); };
  const saveCategory = async () => { if (!editingCategory?.name.trim()) return; const result = await api.saveCategory(editingCategory); if (result.ok && result.data) { const categories = snapshot.categories.some((item) => item.id === result.data!.id) ? snapshot.categories.map((item) => item.id === result.data!.id ? result.data! : item) : [...snapshot.categories, result.data]; updateSnapshot({ categories }); setEditingCategory(null); } else setMessage(result.error?.message ?? 'No se pudo guardar la categoría.'); };
  return <>
    <SectionHeader eyebrow="Entrega controlada" title="Cierre mensual y gestoría" description="El cierre resume la cobertura disponible. Un extracto parcial nunca declara el mes cerrado." action={<div className="period-action"><input aria-label="Periodo" type="month" value={period} onChange={(event) => setPeriod(event.target.value)}/><Button icon="refresh" disabled={loading} onClick={load}>{loading ? 'Calculando…' : 'Calcular cierre'}</Button></div>}/>
    {!close ? <EmptyState icon="archive" title="Selecciona un periodo">Calcula el cierre antes de generar cualquier entrega.</EmptyState> : <><section className="close-summary"><SummaryNumber label="Facturas procesadas" value={close.invoices}/><SummaryNumber label="En revisión" value={close.reviews}/><SummaryNumber label="Conciliadas" value={close.reconciled}/><SummaryNumber label="Parciales" value={close.partial}/><SummaryNumber label="Sin justificante" value={close.movementsWithoutInvoice}/><SummaryNumber label="Sin movimiento" value={close.invoicesWithoutMovement}/></section>{close.warnings.map((warning) => <p className="inline-note" key={warning}><Icon name="warning" size={16}/>{warning}</p>)}<section className="close-financials"><div><span>Base imponible</span><strong>{formatCurrency(close.taxableBase)}</strong></div><div><span>Impuestos</span><strong>{formatCurrency(close.taxes)}</strong></div><div><span>Retenciones</span><strong>{formatCurrency(close.withholdings)}</strong></div><div><span>Total documentado</span><strong>{formatCurrency(close.total)}</strong></div></section><div className="data-table"><table><thead><tr><th>Categoría</th><th>Facturas</th><th className="numeric">Total</th></tr></thead><tbody>{close.byCategory.map((row) => <tr key={row.categoryId}><td>{row.category}</td><td>{row.count}</td><td className="numeric">{formatCurrency(row.total)}</td></tr>)}</tbody></table></div><div className="close-actions"><p><strong>Cobertura:</strong> {close.coverage}</p><Button icon="download" onClick={() => setConfirmExport(true)}>Preparar entrega a gestoría</Button></div></>}
    {message && <p className="inline-note"><Icon name="warning" size={16}/>{message}</p>}
    <section className="category-manager"><div className="subhead"><div><p className="eyebrow">Catálogo editable</p><h2>Categorías de gasto</h2><p>Renombrar o desactivar nunca altera el histórico.</p></div><Button icon="plus" onClick={() => setEditingCategory({ id: '', name: '', active: true, supplierIds: [], updatedAt: '', updatedBy: '' })}>Nueva categoría</Button></div><div className="category-list">{snapshot.categories.map((category) => <article key={category.id} className={category.active ? '' : 'is-inactive'}><div><strong>{category.name}</strong><small>{category.supplierIds.length} proveedores con sugerencia predeterminada</small></div><StatusBadge status={category.active ? 'ACTIVA' : 'INACTIVA'}/><Button variant="quiet" onClick={() => setEditingCategory(category)}>Editar</Button></article>)}</div></section>
    {editingCategory && <Modal title={editingCategory.id ? 'Editar categoría' : 'Nueva categoría'} onClose={() => setEditingCategory(null)} footer={<><Button variant="secondary" onClick={() => setEditingCategory(null)}>Cancelar</Button><Button icon="check" disabled={!editingCategory.name.trim()} onClick={saveCategory}>Guardar categoría</Button></>}><div className="form-stack"><Field label="Nombre"><input autoFocus value={editingCategory.name} onChange={(event) => setEditingCategory({ ...editingCategory, name: event.target.value })}/></Field><label className="compact-check"><input type="checkbox" checked={editingCategory.active} onChange={(event) => setEditingCategory({ ...editingCategory, active: event.target.checked })}/><span>Categoría activa</span></label><Field label="Proveedores con esta sugerencia"><select multiple size={8} value={editingCategory.supplierIds} onChange={(event) => setEditingCategory({ ...editingCategory, supplierIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{snapshot.suppliers.filter((item) => item.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field></div></Modal>}
    {confirmExport && close && <Modal title="Confirmar entrega a gestoría" onClose={() => setConfirmExport(false)} footer={<><Button variant="secondary" onClick={() => setConfirmExport(false)}>Cancelar</Button><Button icon="archive" onClick={createExport}>Generar exportación</Button></>}><div className="confirmation"><span><Icon name="archive" size={28}/></span><h3>{period}</h3><p>Se crearán XLSX, manifiesto con hashes y ZIP con los PDFs en EXPORTACIONES GESTORÍA. Los originales no se modificarán.</p><p><strong>Cobertura:</strong> {close.coverage}</p></div></Modal>}
  </>;
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <nav className="pagination" aria-label="Paginación"><Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {pages}</span><Button variant="secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Siguiente</Button></nav>;
}

function Service({ name, detail, ready }: { name: string; detail: string; ready: boolean }) { return <div><span><Icon name={ready ? 'check' : 'error'} size={17}/></span><div><strong>{name}</strong><p>{detail}</p></div><StatusBadge status={ready ? 'CONECTADO' : 'NO DISPONIBLE'}/></div>; }

function LoadingScreen() { return <div className="full-state"><img src="/reparapro-logo.jpg" alt="ReparaPRO"/><div className="spinner"/><strong>Preparando tu mesa de administración</strong><p>Comprobando Gmail, Drive y ReparaPRO Docs…</p></div>; }
function ErrorScreen({ message, retry }: { message: string; retry: () => void }) { return <div className="full-state"><span className="full-state__error"><Icon name="error" size={34}/></span><strong>No se puede abrir ReparaPRO Gastos</strong><p>{message || 'El servidor no devolvió un estado válido.'}</p><Button icon="refresh" onClick={retry}>Reintentar</Button></div>; }
