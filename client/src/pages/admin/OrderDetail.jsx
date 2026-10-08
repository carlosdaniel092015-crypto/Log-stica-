import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { distance, duration, fullDateTime, money, PAYMENT_METHODS, PAYMENT_STATUS, time, whatsappUrl } from '../../lib/format';
import { courierColor, initials } from '../../lib/maps';
import { auditText } from '../../lib/auditText';
import { Avatar, Empty, ErrorAlert, Field, Modal, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import { MapView } from '../../components/Map';
import AddressPicker from '../../components/AddressPicker';
import ShareDialog from '../../components/ShareDialog';
import Icon from '../../components/Icon';
import InvoiceButtons from '../../components/InvoiceButtons';
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
  const [busy, run] = useAction();
  const options = config?.transitions?.[order.status] || [];
  const change = (to) => {
    if (!to) return;
    const final = ['cancelled', 'delivered', 'failed'].includes(to);
    const note = final ? window.prompt(`Nota para "${config.statuses[to]}" (opcional):`, '') : '';
    if (note === null) return;
    run(async () => onChanged(await api.post(`/api/orders/${order.id}/status`, { status: to, note: note || undefined })), 'Estado actualizado.');
  };
  return (
    <Field label="Cambiar estado">
      <select className="select" value={order.status} disabled={busy || !options.length} onChange={(e) => change(e.target.value)}>
        <option value={order.status}>{config?.statuses?.[order.status]}</option>
        {options.map((s) => <option key={s} value={s}>{config.statuses[s]}</option>)}
      </select>
    </Field>
  );
}

const HIST_COLORS = { new: 'var(--st-new)', preparing: 'var(--st-preparing)', ready: 'var(--st-ready)', assigned: 'var(--st-assigned)', en_route: 'var(--st-en_route)', arriving: 'var(--st-arriving)', arrived: 'var(--st-arrived)', delivered: 'var(--st-delivered)', failed: 'var(--st-failed)', customer_unavailable: 'var(--st-customer_unavailable)', rescheduled: 'var(--st-rescheduled)', cancelled: 'var(--st-cancelled)' };

export default function OrderDetail() {
  const { id } = useParams();
  const { user, currency, config } = useApp();
  const { data: order, loading, error, reload, setData } = useAsync(() => api.get(`/api/orders/${id}`), [id]);
  const couriers = useAsync(() => api.get('/api/couriers?active=true'), []);
  const audit = useAsync(() => (can(user, 'audit.view') ? api.get(`/api/audit?order_id=${id}&limit=100`) : Promise.resolve([])), [id]);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [courierPos, setCourierPos] = useState(null);
  const [courierInfo, setCourierInfo] = useState(null);
  const [busy, run] = useAction();
  const mapRef = useRef(null);
  const fitted = useRef(false);

  useSocketEvent('order:updated', (o) => {
    if (o.id === id) {
      reload(true);
      audit.reload(true);
    }
  });
  useSocketEvent('courier:location', (p) => {
    if (order && p.courier_id === order.courier_id) setCourierPos({ lat: p.lat, lng: p.lng, updated_at: p.updated_at });
  });

  useEffect(() => {
    if (!order?.courier_id) {
      setCourierInfo(null);
      setCourierPos(null);
      return;
    }
    api.get(`/api/couriers/${order.courier_id}`).then((c) => {
      setCourierInfo(c);
      setCourierPos(['en_route', 'arriving', 'arrived', 'assigned'].includes(order.status) ? c.location : null);
    }).catch(() => {});
  }, [order?.courier_id, order?.status]);

  const drawMap = useCallback(() => {
    const h = mapRef.current;
    if (!h || !order) return;
    const dest = order.lat != null ? { lat: order.lat, lng: order.lng } : null;
    const items = [];
    if (dest) items.push({ id: 'dest', ...dest, kind: 'dest', color: '#dc2626', size: 32, title: order.address });
    if (courierPos) items.push({ id: 'courier', lat: courierPos.lat, lng: courierPos.lng, kind: 'courier', color: courierColor('en_route'), label: initials(order.courier_name), pulse: true, title: order.courier_name });
    for (const p of order.proofs || []) if (p.lat != null) items.push({ id: `proof-${p.id}`, lat: p.lat, lng: p.lng, kind: 'dest', color: p.outcome === 'delivered' ? '#16a34a' : '#ea580c', label: '✓', size: 24, title: `Evidencia: ${p.outcome_label}` });
    h.setMarkers(items);
    h.setLines(dest && courierPos && ['en_route', 'arriving'].includes(order.status) ? [{ id: 'route', from: [courierPos.lat, courierPos.lng], to: [dest.lat, dest.lng], color: '#2563eb' }] : []);
    if (!fitted.current) {
      fitted.current = true;
      h.fit([dest, courierPos], { maxZoom: 16 });
    }
  }, [order, courierPos]);

  useEffect(drawMap, [drawMap]);

  if (loading && !order) return <Spinner center />;
  if (error) return <ErrorAlert error={error} />;
  if (!order) return null;
  const closed = ['delivered', 'cancelled'].includes(order.status);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/admin/pedidos" className="small"><Icon name="back" size={14} /> Pedidos</Link>
          <h1 className="row" style={{ marginTop: 6 }}>Pedido #{order.order_number} <StatusBadge status={order.status} /></h1>
          <p>Creado {fullDateTime(order.created_at)}</p>
        </div>
        <div className="row-wrap">
          {can(user, 'orders.manage') && !closed && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Editar</button>}
          <InvoiceButtons order={order} />
          {closed
            ? <span className="small muted">Seguimiento cerrado: el enlace del cliente venció al {order.status === 'delivered' ? 'entregar' : 'cancelar'}.</span>
            : <button className="btn btn-primary" onClick={() => setSharing(true)}><Icon name="share" /> Compartir seguimiento</button>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', alignItems: 'start' }} data-responsive="detail">
        <div className="stack">
          <div className="card">
            <div className="card-title"><h3>Cliente y entrega</h3></div>
            <dl className="kv card-body">
              <dt>Cliente</dt><dd className="bold"><Link to={`/admin/clientes/${order.customer_id}`} style={{ color: 'inherit' }}>{order.customer_name}</Link></dd>
              <dt>Teléfono</dt><dd className="row-wrap mono">{order.phone} <a className="btn btn-sm btn-icon" href={`tel:${order.phone}`} aria-label="Llamar"><Icon name="phone" /></a> <a className="btn btn-sm btn-icon" href={whatsappUrl(order.customer_whatsapp || order.phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp"><Icon name="whatsapp" /></a></dd>
              <dt>Dirección</dt><dd>{order.address}</dd>
              <dt>Referencia</dt><dd>{order.reference || '—'}</dd>
              <dt>Sector</dt><dd>{[order.sector_name, order.municipality_name, order.province_name].filter(Boolean).join(', ') || '—'}</dd>
              <dt>Zona tarifaria</dt><dd>{order.zone_name || 'Sin zona'} · {money(order.delivery_fee, currency)} {order.fee_overridden && <span className="badge no-dot" style={{ '--c': 'var(--warning)' }}>Modificado</span>}</dd>
              <dt>Ubicación</dt><dd>{order.location_confirmed ? <span className="badge" style={{ '--c': 'var(--success)' }}>Confirmada por el cliente</span> : <span className="badge" style={{ '--c': 'var(--muted)' }}>Sin confirmar</span>}</dd>
              {order.notes && <><dt>Notas</dt><dd>{order.notes}</dd></>}
            </dl>
          </div>

          <div className="card">
            <div className="card-title"><h3>Productos y pago</h3><span className="small muted">{PAYMENT_METHODS[order.payment_method]} · {PAYMENT_STATUS[order.payment_status]}</span></div>
            {order.items?.length > 0 && (
              <table className="table">
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.product_id}>
                      <td className="mono small muted" style={{ width: 90 }}>{i.sku}</td>
                      <td>{i.quantity}× {i.name}</td>
                      <td className="num muted">{money(i.unit_price, currency)}</td>
                      <td className="num bold">{money(i.quantity * i.unit_price, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="card-body stack-sm" style={{ borderTop: order.items?.length ? '1px solid var(--border)' : 0 }}>
              <div className="row"><span className="spacer muted">Subtotal</span><span className="mono">{money(order.subtotal, currency)}</span></div>
              <div className="row"><span className="spacer muted">Delivery{order.zone_name ? ` (${order.zone_name})` : ''}</span><span className="mono">{money(order.delivery_fee, currency)}</span></div>
              <div className="row" style={{ fontSize: '1.1rem' }}><strong className="spacer">{order.payment_status === 'paid' ? 'Total' : 'Total a cobrar'}</strong><strong className="mono">{money(order.total, currency)}</strong></div>
              {order.inventory_requests?.map((r) => (
                <div key={r.id} className="small">
                  Inventario: <Link to="/admin/inventario">solicitud #{r.request_number}</Link>{' '}
                  <span className="badge" style={{ '--c': r.status === 'approved' ? 'var(--success)' : r.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>{r.status_label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>Mapa</h3>{order.eta_seconds != null && ['en_route', 'arriving'].includes(order.status) && <span className="small muted">Llegada estimada: {duration(order.eta_seconds)} · {distance(order.eta_distance_m)}</span>}</div>
            <MapView className="map map-sm" style={{ borderRadius: 0 }} onReady={(h) => { mapRef.current = h; drawMap(); }} zoom={13} center={order.lat != null ? { lat: order.lat, lng: order.lng } : undefined} />
          </div>

          <div className="card">
            <div className="card-title"><h3>Prueba de entrega</h3></div>
            <div className="card-body stack">
              {order.proofs.length === 0 && <p className="small muted">Se completa cuando el mensajero marca el pedido como Entregado: foto, firma con el dedo y nombre de quien recibió.</p>}
              {order.proofs.map((p) => (
                <div key={p.id} className="stack-sm">
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
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-title"><h3>Mensajero y estado</h3></div>
            <div className="card-body stack">
              {order.courier_name && (
                <div className="cell-person">
                  <Avatar name={order.courier_name} soft size="lg" />
                  <div>
                    <div className="bold">{order.courier_name}</div>
                    <div className="small muted mono">{[order.courier_phone, courierInfo?.vehicle].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              )}
              {can(user, 'orders.assign') && !closed && (
                <Field label="Mensajero">
                  <select className="select" value={order.courier_id || ''} disabled={busy} onChange={(e) => run(async () => setData(await api.post(`/api/orders/${order.id}/assign`, { courier_id: e.target.value || null })), 'Asignación actualizada.')}>
                    <option value="">Sin asignar</option>
                    {(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} — {c.status_label}</option>)}
                  </select>
                </Field>
              )}
              {can(user, 'orders.manage') && <StatusChanger order={order} onChanged={setData} />}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>Historial</h3></div>
            <ul className="hist card-body">
              {order.history.slice().reverse().map((h) => (
                <li key={h.id} style={{ '--c': HIST_COLORS[h.to_status] || 'var(--muted)' }}>
                  <span className="ring" />
                  <div className="bold">{h.from_status === h.to_status ? 'Actualización' : h.to_label}</div>
                  <div className="small muted">{time(h.created_at)} · {h.user_name || (h.actor_role === 'customer' ? 'Cliente' : h.actor_role === 'system' ? 'Sistema' : '—')}</div>
                  {h.note && <div className="small">{h.note}</div>}
                </li>
              ))}
            </ul>
          </div>

          {can(user, 'audit.view') && (
            <div className="card">
              <div className="card-title"><h3>Auditoría</h3></div>
              {(audit.data || []).map((a) => {
                const t = auditText(a, config?.statuses);
                return (
                  <div key={a.id} className="list-item" style={{ display: 'block' }}>
                    <div className="small"><strong>{a.user_name || 'Sistema'}</strong> · {t.action}</div>
                    <div className="tiny muted">{time(a.created_at)}{t.detail ? ` · ${t.detail}` : ''}</div>
                  </div>
                );
              })}
              {audit.data?.length === 0 && <Empty title="Sin registros" />}
            </div>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 1000px) { [data-responsive="detail"] { grid-template-columns: 1fr !important; } }`}</style>

      {editing && <EditOrder order={order} onClose={() => setEditing(false)} onSaved={(o) => { setData(o); setEditing(false); }} />}
      {sharing && <ShareDialog orderId={order.id} orderNumber={order.order_number} onClose={() => { setSharing(false); reload(true); }} />}
    </div>
  );
}
