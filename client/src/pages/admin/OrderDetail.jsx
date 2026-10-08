import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { distance, duration, fullDateTime, money, PAYMENT_METHODS, PAYMENT_STATUS, whatsappUrl } from '../../lib/format';
import { courierColor, initials, pinElement } from '../../lib/maps';
import { Empty, ErrorAlert, Field, Modal, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import { MapView, fitTo, syncMarkers } from '../../components/Map';
import AddressPicker from '../../components/AddressPicker';
import ShareDialog from '../../components/ShareDialog';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

function EditOrder({ order, onClose, onSaved }) {
  const { user, currency } = useApp();
  const [form, setForm] = useState({
    customer_name: order.customer_name, phone: order.phone, subtotal: order.subtotal, payment_method: order.payment_method,
    payment_status: order.payment_status, priority: order.priority, notes: order.notes || '', reference: order.reference || '',
  });
  const [fee, setFee] = useState(order.delivery_fee);
  const [address, setAddress] = useState(null);
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...form, subtotal: Number(form.subtotal) || 0, priority: Number(form.priority) || 0, notes: form.notes || null, reference: form.reference || null };
      if (can(user, 'orders.override_fee') && Number(fee) !== order.delivery_fee) body.delivery_fee = Number(fee);
      if (address) body.address = { ...address, reference: form.reference || address.reference || null };
      onSaved(await api.put(`/api/orders/${order.id}`, body));
    }, 'Pedido actualizado.');
  };
  return (
    <Modal title={`Editar pedido #${order.order_number}`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="edit-order" disabled={busy}>Guardar</button></>}>
      <form id="edit-order" className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Cliente"><input className="input" value={form.customer_name} onChange={set('customer_name')} required /></Field>
          <Field label="Teléfono"><input className="input" value={form.phone} onChange={set('phone')} required /></Field>
          <Field label={`Subtotal (${currency})`}><input className="input" type="number" min="0" step="0.01" value={form.subtotal} onChange={set('subtotal')} /></Field>
          <Field label={`Costo de envío (${currency})`} hint={can(user, 'orders.override_fee') ? 'Cambiarlo lo marca como modificado manualmente.' : 'Sin permiso para modificarlo.'}>
            <input className="input" type="number" min="0" step="1" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!can(user, 'orders.override_fee')} />
          </Field>
          <Field label="Método de pago"><select className="select" value={form.payment_method} onChange={set('payment_method')}>{Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Estado del pago"><select className="select" value={form.payment_status} onChange={set('payment_status')}>{Object.entries(PAYMENT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Prioridad"><select className="select" value={form.priority} onChange={set('priority')}><option value={0}>Normal</option><option value={5}>Alta</option><option value={10}>Urgente</option></select></Field>
          <Field label="Referencia"><input className="input" value={form.reference} onChange={set('reference')} /></Field>
          <Field label="Notas" className="full"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
        </div>
        {address ? (
          <div className="stack-sm">
            <h3>Nueva dirección</h3>
            <AddressPicker value={address} onChange={setAddress} showReference={false} />
            <div className="small muted">Al cambiar la dirección se recalcula la zona y, si el costo no fue modificado manualmente, el precio.</div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAddress({ formatted_address: order.address, lat: order.lat, lng: order.lng, province_id: order.province_id, municipality_id: order.municipality_id, sector_id: order.sector_id })}>
            <Icon name="pin" /> Cambiar dirección
          </button>
        )}
      </form>
    </Modal>
  );
}

function StatusChanger({ order, onChanged }) {
  const { config } = useApp();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const options = config?.transitions?.[order.status] || [];
  if (!options.length) return null;
  return (
    <div className="stack-sm">
      <div className="label">Cambiar estado</div>
      <div className="input-group">
        <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Seleccionar…</option>
          {options.map((s) => <option key={s} value={s}>{config.statuses[s]}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!to || busy} onClick={() => run(async () => { onChanged(await api.post(`/api/orders/${order.id}/status`, { status: to, note: note || undefined })); setTo(''); setNote(''); }, 'Estado actualizado.')}>Aplicar</button>
      </div>
      {to && <input className="input" placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user, currency } = useApp();
  const { data: order, loading, error, reload, setData } = useAsync(() => api.get(`/api/orders/${id}`), [id]);
  const couriers = useAsync(() => api.get('/api/couriers?active=true'), []);
  const audit = useAsync(() => (can(user, 'audit.view') ? api.get(`/api/audit?order_id=${id}&limit=100`) : Promise.resolve([])), [id]);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [courierPos, setCourierPos] = useState(null);
  const [busy, run] = useAction();
  const mapRef = useRef(null);
  const markers = useRef(new Map());

  useSocketEvent('order:updated', (o) => o.id === id && reload(true));
  useSocketEvent('courier:location', (p) => {
    if (order && p.courier_id === order.courier_id) setCourierPos({ lat: p.lat, lng: p.lng, updated_at: p.updated_at });
  });

  useEffect(() => {
    if (order?.courier_id && ['en_route', 'arriving', 'arrived', 'assigned'].includes(order.status)) {
      api.get(`/api/couriers/${order.courier_id}`).then((c) => c.location && setCourierPos(c.location)).catch(() => {});
    } else setCourierPos(null);
  }, [order?.courier_id, order?.status]);

  const drawMap = useCallback(() => {
    const m = mapRef.current;
    if (!m || !order) return;
    const items = [];
    if (order.lat != null) items.push({ id: 'dest', position: { lat: order.lat, lng: order.lng }, content: pinElement({ color: '#dc2626', label: '' }), title: order.address });
    if (courierPos) items.push({ id: 'courier', position: { lat: courierPos.lat, lng: courierPos.lng }, content: pinElement({ color: courierColor('en_route'), label: initials(order.courier_name), pulse: true }), title: order.courier_name, zIndex: 10 });
    for (const p of order.proofs || []) if (p.lat != null) items.push({ id: `proof-${p.id}`, position: { lat: p.lat, lng: p.lng }, content: pinElement({ color: p.outcome === 'delivered' ? '#16a34a' : '#ea580c', label: '✓', size: 26 }), title: `Evidencia: ${p.outcome_label}` });
    syncMarkers(markers.current, m.map, m.gm, items);
  }, [order, courierPos]);

  useEffect(drawMap, [drawMap]);

  if (loading && !order) return <Spinner center />;
  if (error) return <ErrorAlert error={error} />;
  if (!order) return null;

  const onReady = (m) => {
    mapRef.current = m;
    drawMap();
    fitTo(m.map, m.gm, [order.lat != null ? { lat: order.lat, lng: order.lng } : null, courierPos], { maxZoom: 16 });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-header">
        <div>
          <Link to="/admin/pedidos" className="small"><Icon name="back" size={14} /> Pedidos</Link>
          <h1 className="row" style={{ marginTop: 6 }}>Pedido #{order.order_number} <StatusBadge status={order.status} /></h1>
          <p>Creado {fullDateTime(order.created_at)}</p>
        </div>
        <div className="row-wrap">
          {['delivered', 'cancelled'].includes(order.status)
            ? <span className="small muted">Seguimiento cerrado: el enlace del cliente venció al {order.status === 'delivered' ? 'entregar' : 'cancelar'}.</span>
            : <button className="btn" onClick={() => setSharing(true)}><Icon name="share" /> Enlace de seguimiento</button>}
          {can(user, 'orders.manage') && !['delivered', 'cancelled'].includes(order.status) && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Editar</button>}
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card card-body stack">
            <h3>Cliente y entrega</h3>
            <dl className="kv">
              <dt>Cliente</dt><dd><Link to={`/admin/clientes/${order.customer_id}`}>{order.customer_name}</Link></dd>
              <dt>Teléfono</dt><dd className="row-wrap">{order.phone} <a className="btn btn-sm" href={`tel:${order.phone}`}><Icon name="phone" /></a> <a className="btn btn-sm" href={whatsappUrl(order.customer_whatsapp || order.phone)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /></a></dd>
              <dt>Dirección</dt><dd>{order.address}</dd>
              <dt>Referencia</dt><dd>{order.reference || '—'}</dd>
              <dt>Ubicación</dt><dd>{order.lat != null ? `${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}` : 'Sin coordenadas'} {order.location_confirmed ? <span className="badge" style={{ '--c': 'var(--success)' }}>Confirmada por el cliente</span> : <span className="badge" style={{ '--c': 'var(--muted)' }}>Sin confirmar</span>}</dd>
              <dt>Provincia</dt><dd>{order.province_name || '—'}</dd>
              <dt>Municipio</dt><dd>{order.municipality_name || '—'}</dd>
              <dt>Sector</dt><dd>{order.sector_name || '—'}</dd>
              <dt>Zona tarifaria</dt><dd>{order.zone_name || 'Sin zona'}</dd>
              <dt>Notas</dt><dd>{order.notes || '—'}</dd>
            </dl>
          </div>
          <div className="card card-body stack">
            <h3>Pago</h3>
            <dl className="kv">
              <dt>Subtotal</dt><dd className="mono">{money(order.subtotal, currency)}</dd>
              <dt>Envío</dt><dd className="mono">{money(order.delivery_fee, currency)} {order.fee_overridden && <span className="badge no-dot" style={{ '--c': 'var(--warning)' }}>Modificado manualmente</span>}</dd>
              <dt>Total</dt><dd className="mono bold">{money(order.total, currency)}</dd>
              <dt>Método</dt><dd>{PAYMENT_METHODS[order.payment_method]}</dd>
              <dt>Estado del pago</dt><dd>{PAYMENT_STATUS[order.payment_status]}</dd>
            </dl>
          </div>
        </div>

        <div className="stack">
          <div className="card card-body stack">
            <h3>Mensajero y estado</h3>
            {can(user, 'orders.assign') && !['delivered', 'cancelled'].includes(order.status) && (
              <div className="stack-sm">
                <div className="label">Mensajero asignado</div>
                <select className="select" value={order.courier_id || ''} disabled={busy} onChange={(e) => run(async () => setData(await api.post(`/api/orders/${order.id}/assign`, { courier_id: e.target.value || null })), 'Asignación actualizada.')}>
                  <option value="">Sin asignar</option>
                  {(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} — {c.status_label}</option>)}
                </select>
              </div>
            )}
            {order.courier_name && (
              <div className="small">
                <strong>{order.courier_name}</strong> {order.courier_phone && <a href={`tel:${order.courier_phone}`}>· {order.courier_phone}</a>}
                {order.eta_seconds != null && ['en_route', 'arriving'].includes(order.status) && (
                  <div className="muted">Llegada estimada: {duration(order.eta_seconds)} ({distance(order.eta_distance_m)})</div>
                )}
              </div>
            )}
            {can(user, 'orders.manage') && <StatusChanger order={order} onChanged={setData} />}
            <dl className="kv small">
              <dt>Asignado</dt><dd>{fullDateTime(order.assigned_at)}</dd>
              <dt>Salida</dt><dd>{fullDateTime(order.departed_at)}</dd>
              <dt>Llegada</dt><dd>{fullDateTime(order.arrived_at)}</dd>
              <dt>Entrega</dt><dd>{fullDateTime(order.delivered_at)}</dd>
            </dl>
          </div>
          <MapView className="map map-sm" onReady={onReady} zoom={13} center={order.lat != null ? { lat: order.lat, lng: order.lng } : undefined} />
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card card-body">
          <h3 style={{ marginBottom: 12 }}>Historial de estados</h3>
          <ul className="timeline">
            {order.history.map((h) => (
              <li key={h.id} className="done">
                <span className="dot">✓</span>
                <div className="tl-title">{h.from_status === h.to_status ? 'Actualización' : h.to_label}</div>
                <div className="small muted">{fullDateTime(h.created_at)} · {h.user_name || (h.actor_role === 'customer' ? 'Cliente' : h.actor_role === 'system' ? 'Sistema' : '—')}</div>
                {h.note && <div className="small">{h.note}</div>}
                {h.lat != null && <div className="tiny muted mono">📍 {h.lat.toFixed(5)}, {h.lng.toFixed(5)}</div>}
              </li>
            ))}
          </ul>
          {order.assignments.length > 0 && (
            <>
              <div className="divider" />
              <h3 style={{ marginBottom: 8 }}>Asignaciones</h3>
              {order.assignments.map((a) => (
                <div key={a.id} className="small" style={{ marginBottom: 6 }}>
                  <strong>{a.courier_name}</strong> — {fullDateTime(a.assigned_at)} por {a.assigned_by_name || '—'}
                  {a.unassigned_at && <span className="muted"> · retirado {fullDateTime(a.unassigned_at)} ({a.reason})</span>}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="stack">
          <div className="card card-body stack">
            <h3>Pruebas de entrega</h3>
            {order.proofs.length === 0 && <Empty icon="camera" title="Sin evidencias registradas" />}
            {order.proofs.map((p) => (
              <div key={p.id} className="stack-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div className="row"><StatusBadge status={p.outcome} /> <span className="small muted">{fullDateTime(p.created_at)}</span></div>
                {p.receiver_name && <div className="small">Recibió: <strong>{p.receiver_name}</strong></div>}
                {p.notes && <div className="small">{p.notes}</div>}
                {p.lat != null && <div className="tiny muted mono">Coordenadas: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}{p.accuracy ? ` (±${Math.round(p.accuracy)} m)` : ''}</div>}
                <div className="grid grid-2" style={{ gap: 8 }}>
                  {p.photo_url && <a href={p.photo_url} target="_blank" rel="noreferrer"><img className="photo-preview" src={p.photo_url} alt="Fotografía de entrega" /></a>}
                  {p.signature_url && <img className="photo-preview" style={{ background: '#fff', objectFit: 'contain' }} src={p.signature_url} alt="Firma de quien recibió" />}
                </div>
              </div>
            ))}
          </div>
          {can(user, 'audit.view') && (
            <div className="card card-body">
              <h3 style={{ marginBottom: 8 }}>Auditoría del pedido</h3>
              {(audit.data || []).map((a) => (
                <div key={a.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <strong>{a.action}</strong> · {a.user_name || 'Sistema'} · <span className="muted">{fullDateTime(a.created_at)}</span>
                  {(a.old_value || a.new_value) && <div className="tiny muted mono" style={{ overflowWrap: 'anywhere' }}>{a.old_value ? `${JSON.stringify(a.old_value)} → ` : ''}{JSON.stringify(a.new_value)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && <EditOrder order={order} onClose={() => setEditing(false)} onSaved={(o) => { setData(o); setEditing(false); }} />}
      {sharing && <ShareDialog orderId={order.id} orderNumber={order.order_number} onClose={() => { setSharing(false); reload(true); }} />}
    </div>
  );
}
