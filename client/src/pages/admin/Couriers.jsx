import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { time, whatsappUrl } from '../../lib/format';
import { courierColor } from '../../lib/maps';
import { Avatar, CourierBadge, Empty, Field, Modal, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import Icon from '../../components/Icon';
import { CredentialsModal, generatePassword, TempPasswordField } from '../../components/TempPassword';
import { can, useApp } from '../../context/AppContext';

function RouteEditor({ courier, onClose }) {
  const { user } = useApp();
  const { data, loading, setData } = useAsync(() => api.get(`/api/couriers/${courier.id}`), [courier.id]);
  const [busy, run] = useAction();
  const orders = (data?.orders || []).slice().sort((a, b) => (a.route_order ?? 999) - (b.route_order ?? 999));
  const move = (i, dir) => {
    const list = [...orders];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setData({ ...data, orders: list.map((o, k) => ({ ...o, route_order: k + 1 })) });
  };
  return (
    <Modal
      title={`Ruta de ${courier.name}`}
      onClose={onClose}
      footer={can(user, 'orders.assign') && orders.length > 1 ? <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post('/api/orders/route-order', { order_ids: orders.map((o) => o.id) }), 'Orden de ruta guardado. El mensajero lo verá al instante.')}>Guardar orden</button> : null}
    >
      {loading ? <Spinner center /> : orders.length === 0 ? <Empty title="Sin pedidos asignados" /> : (
        <div className="stack-sm">
          <p className="small muted">Define el orden de visita. El mensajero verá sus entregas en este orden (preparado para optimización automática de rutas).</p>
          {orders.map((o, i) => (
            <div key={o.id} className="card row" style={{ padding: 10 }}>
              <strong className="mono" style={{ width: 24 }}>{i + 1}</strong>
              <div className="spacer">
                <div className="bold">#{o.order_number} · {o.customer_name}</div>
                <div className="tiny muted">{o.sector_name || o.address}</div>
              </div>
              <StatusBadge status={o.status} />
              <div className="stack-sm" style={{ gap: 2 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} aria-label="Subir" disabled={i === 0}>▲</button>
                <button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} aria-label="Bajar" disabled={i === orders.length - 1}>▼</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function NewCourier({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: generatePassword(), vehicle: '', plate: '' });
  const [created, setCreated] = useState(false);
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  if (created) return <CredentialsModal name={form.name} email={form.email} password={form.password} phone={form.phone} onClose={onCreated} />;
  return (
    <Modal title="Nuevo mensajero" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="new-courier" disabled={busy}>Crear</button></>}>
      <form id="new-courier" className="form-grid" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/api/users', { ...form, role: 'courier', must_change_password: true }); setCreated(true); }, 'Mensajero creado.'); }}>
        <Field label="Nombre completo"><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Teléfono"><input className="input" type="tel" value={form.phone} onChange={set('phone')} required /></Field>
        <Field label="Correo (usuario)"><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
        <TempPasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} />
        <Field label="Vehículo"><input className="input" value={form.vehicle} onChange={set('vehicle')} placeholder="Motor, carro…" /></Field>
        <Field label="Placa"><input className="input" value={form.plate} onChange={set('plate')} /></Field>
      </form>
    </Modal>
  );
}

export default function Couriers() {
  const { user } = useApp();
  const { data, loading, reload, setData } = useAsync(() => api.get('/api/couriers'), []);
  const [route, setRoute] = useState(null);
  const [creating, setCreating] = useState(false);
  useSocketEvent('courier:updated', (c) => c && setData((list) => list?.map((x) => (x.id === c.id ? c : x))));
  useSocketEvent('courier:location', (p) => setData((list) => list?.map((c) => (c.id === p.courier_id ? { ...c, location: { ...p } } : c))));

  return (
    <div>
      <div className="page-header">
        <div><h1>Mensajeros</h1><p>Jornada, ubicación y entregas pendientes de cada mensajero</p></div>
        <div className="row-wrap">
          <Link to="/admin/seguimiento" className="btn"><Icon name="map" /> Ver en el mapa</Link>
          {can(user, 'users.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nuevo mensajero</button>}
        </div>
      </div>
      <div className="card">
        {loading && !data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mensajero</th><th>Estado</th><th>Jornada</th><th>Ubicación</th><th>Se dirige a</th><th className="num">Pendientes</th><th className="num">Entregados</th><th /></tr></thead>
              <tbody>
                {(data || []).map((c) => (
                  <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                    <td>
                      <span className="cell-person">
                        <Avatar name={c.name} color={courierColor(c.status)} />
                        <span><span className="bold" style={{ display: 'block' }}>{c.name}</span><span className="tiny muted mono">{c.phone || c.vehicle || '—'}</span></span>
                      </span>
                    </td>
                    <td><CourierBadge status={c.status} /></td>
                    <td className="small">{c.shift_active ? `Desde ${time(c.shift_started_at)}` : '—'}</td>
                    <td className="small">{c.shift_active && c.sharing_location ? <span className="row" style={{ gap: 6 }}><span className="kpi-dot" style={{ background: 'var(--success)' }} /><strong>Activa</strong></span> : <span className="row muted" style={{ gap: 6 }}><span className="kpi-dot" style={{ background: 'var(--border-strong)' }} />Inactiva</span>}</td>
                    <td className="small">{c.current_order ? <Link to={`/admin/pedidos/${c.current_order.id}`} style={{ color: 'inherit' }}>Hacia: {c.current_order.customer_name} #{c.current_order.order_number}</Link> : <span className="muted">{c.shift_active ? 'Sin destino asignado' : 'Sin jornada activa'}</span>}</td>
                    <td className="num bold">{c.pending_count}</td>
                    <td className="num">{c.delivered_today}</td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => setRoute(c)}>Ruta</button>{' '}
                      {c.phone && <a className="btn btn-sm btn-ghost" href={`tel:${c.phone}`} aria-label="Llamar"><Icon name="phone" /></a>}
                      {c.phone && <a className="btn btn-sm btn-ghost" href={whatsappUrl(c.phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp"><Icon name="whatsapp" /></a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.length === 0 && <Empty icon="truck" title="No hay mensajeros registrados" />}
          </div>
        )}
      </div>
      {route && <RouteEditor courier={route} onClose={() => setRoute(null)} />}
      {creating && <NewCourier onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
