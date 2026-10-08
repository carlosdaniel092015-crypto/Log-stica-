import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, fullDateTime, money, PAYMENT_METHODS } from '../../lib/format';
import { Empty, Field, Modal, Spinner, StatusBadge, useAction, useAsync } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import { InstallBanner, PushButton } from '../../components/pwa';
import Icon from '../../components/Icon';
import { useApp } from '../../context/AppContext';

function Receipt({ orderId, onClose }) {
  const { currency } = useApp();
  const { data } = useAsync(() => api.get(`/api/me/orders/${orderId}/receipt`), [orderId]);
  return (
    <Modal title="Comprobante de entrega" onClose={onClose} footer={<button className="btn" onClick={() => window.print()}><Icon name="download" /> Imprimir / PDF</button>}>
      {!data ? <Spinner center /> : (
        <div className="stack">
          <dl className="kv">
            <dt>Pedido</dt><dd>#{data.order_number}</dd>
            <dt>Fecha</dt><dd>{fullDateTime(data.created_at)}</dd>
            <dt>Entregado</dt><dd>{fullDateTime(data.delivered_at)}</dd>
            <dt>Recibió</dt><dd>{data.receiver_name || '—'}</dd>
            <dt>Dirección</dt><dd>{data.address}</dd>
            <dt>Productos</dt><dd className="mono">{money(data.subtotal, currency)}</dd>
            <dt>Envío</dt><dd className="mono">{money(data.delivery_fee, currency)}</dd>
            <dt>Total</dt><dd className="mono bold">{money(data.total, currency)}</dd>
            <dt>Pago</dt><dd>{PAYMENT_METHODS[data.payment_method]} · {data.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}</dd>
          </dl>
          <div>{data.history.map((h, i) => <div key={i} className="small row"><span className="spacer">{h.label}</span><span className="muted">{fullDateTime(h.at)}</span></div>)}</div>
        </div>
      )}
    </Modal>
  );
}

function MyOrders() {
  const { currency } = useApp();
  const { data, loading } = useAsync(() => api.get('/api/me/orders'), []);
  const [receipt, setReceipt] = useState(null);
  if (loading) return <Spinner center />;
  const active = (data || []).filter((o) => !['delivered', 'cancelled'].includes(o.status));
  const past = (data || []).filter((o) => ['delivered', 'cancelled'].includes(o.status));
  const card = (o) => (
    <div key={o.id} className="card" style={{ padding: 14 }}>
      <div className="row"><strong className="spacer">Pedido #{o.order_number}</strong><StatusBadge status={o.status} /></div>
      <div className="small muted">{o.address}</div>
      <div className="small">{dateTime(o.created_at)} · Total {money(o.total, currency)}</div>
      <div className="row-wrap" style={{ marginTop: 8 }}>
        {o.tracking_path && <Link className="btn btn-primary btn-sm" to={o.tracking_path}><Icon name="navigation" /> Ver seguimiento</Link>}
        {o.status === 'delivered' && <button className="btn btn-sm" onClick={() => setReceipt(o.id)}><Icon name="receipt" /> Comprobante</button>}
      </div>
    </div>
  );
  return (
    <div className="stack">
      <h2>Pedidos activos</h2>
      {active.length ? active.map(card) : <Empty title="No tienes pedidos activos" />}
      <h2>Pedidos anteriores</h2>
      {past.length ? past.map(card) : <Empty title="Aún no hay historial" />}
      {receipt && <Receipt orderId={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Addresses() {
  const { data, loading, setData } = useAsync(() => api.get('/api/me/addresses'), []);
  const [editing, setEditing] = useState(null);
  const [label, setLabel] = useState('');
  const [busy, run] = useAction();
  if (loading) return <Spinner center />;
  const open = (a) => { setEditing(a); setLabel(a.label || ''); };
  const save = () => run(async () => {
    const a = editing;
    const body = { label: label || null, formatted_address: a.formatted_address, lat: a.lat ?? null, lng: a.lng ?? null, place_id: a.place_id || null, reference: a.reference || null, province_id: a.province_id || null, municipality_id: a.municipality_id || null, sector_id: a.sector_id || null, components: a.components, is_default: !!a.is_default };
    setData(a.id ? await api.put(`/api/me/addresses/${a.id}`, body) : await api.post('/api/me/addresses', body));
    setEditing(null);
  }, 'Dirección guardada.');
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>Mis direcciones</h2><button className="btn btn-primary btn-sm" onClick={() => open({})}><Icon name="plus" /> Agregar</button></div>
      {data.length === 0 && <Empty icon="pin" title="Guarda tus direcciones frecuentes" />}
      {data.map((a) => (
        <div key={a.id} className="card row" style={{ padding: 12, alignItems: 'flex-start' }}>
          <Icon name="pin" />
          <div className="spacer">
            <div className="bold">{a.label || 'Dirección'} {a.is_default && <span className="badge no-dot" style={{ '--c': 'var(--primary)' }}>Predeterminada</span>}</div>
            <div className="small">{a.formatted_address}</div>
            {a.reference && <div className="tiny muted">Ref.: {a.reference}</div>}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => open(a)} aria-label="Editar"><Icon name="edit" /></button>
          <button className="btn btn-sm btn-ghost" onClick={() => window.confirm('¿Eliminar esta dirección?') && run(async () => setData(await api.del(`/api/me/addresses/${a.id}`)), 'Eliminada.')} aria-label="Eliminar"><Icon name="trash" /></button>
        </div>
      ))}
      {editing && (
        <Modal title={editing.id ? 'Editar dirección' : 'Nueva dirección'} size="lg" onClose={() => setEditing(null)} footer={<><button className="btn" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy || !editing.formatted_address} onClick={save}>Guardar</button></>}>
          <div className="stack">
            <Field label="Nombre"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Casa, trabajo…" /></Field>
            <AddressPicker value={editing} onChange={setEditing} allowAdminSelects={false} />
            <label className="check"><input type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} /> Usar como predeterminada</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Profile() {
  const { refreshUser } = useApp();
  const { data, loading, setData } = useAsync(() => api.get('/api/me/profile'), []);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [busy, run] = useAction();
  if (loading || !data) return <Spinner center />;
  return (
    <div className="stack">
      <h2>Mis datos</h2>
      <form className="card card-body form-grid" onSubmit={(e) => { e.preventDefault(); run(async () => { setData(await api.put('/api/me/profile', { name: data.name, phone: data.phone, whatsapp: data.whatsapp || null })); refreshUser(); }, 'Datos actualizados.'); }}>
        <Field label="Nombre"><input className="input" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} required /></Field>
        <Field label="Teléfono"><input className="input" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} required /></Field>
        <Field label="WhatsApp"><input className="input" value={data.whatsapp || ''} onChange={(e) => setData({ ...data, whatsapp: e.target.value })} /></Field>
        <Field label="Correo"><input className="input" value={data.email || ''} disabled /></Field>
        <div className="full"><button className="btn btn-primary" disabled={busy}>Guardar</button></div>
      </form>
      <h2>Cambiar contraseña</h2>
      <form className="card card-body form-grid" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.put('/api/auth/me/password', pw); setPw({ current_password: '', new_password: '' }); }, 'Contraseña actualizada.'); }}>
        <Field label="Contraseña actual"><input className="input" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="Nueva contraseña"><input className="input" type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <div className="full"><button className="btn" disabled={busy}>Cambiar contraseña</button></div>
      </form>
      <div className="card card-body row-wrap"><span className="spacer">Notificaciones de tus pedidos en este dispositivo</span><PushButton /></div>
    </div>
  );
}

export default function CustomerApp() {
  const { user, logout, config } = useApp();
  return (
    <div className="mobile-app" style={{ maxWidth: 820 }}>
      <header className="mobile-header">
        <img src={config?.company?.company_logo_url || '/icons/icon-192.png'} width="32" height="32" alt="" style={{ borderRadius: 8 }} />
        <div className="spacer"><div className="bold">{config?.company?.company_name}</div><div className="tiny" style={{ opacity: 0.8 }}>Hola, {user.name.split(' ')[0]}</div></div>
        <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Cerrar sesión"><Icon name="logout" /></button>
      </header>
      <div style={{ padding: 16 }} className="stack">
        <InstallBanner storageKey="lrd_install_customer" />
        <div className="tabs">
          <NavLink end to="/cliente" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Mis pedidos</NavLink>
          <NavLink to="/cliente/direcciones" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Direcciones</NavLink>
          <NavLink to="/cliente/perfil" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Mi cuenta</NavLink>
        </div>
        <Routes>
          <Route index element={<MyOrders />} />
          <Route path="direcciones" element={<Addresses />} />
          <Route path="perfil" element={<Profile />} />
        </Routes>
      </div>
    </div>
  );
}
