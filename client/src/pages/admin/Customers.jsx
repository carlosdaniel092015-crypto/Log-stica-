import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { pinElement, SD_CENTER } from '../../lib/maps';
import { Empty, Field, Modal, Spinner, useAction, useAsync } from '../../components/ui';
import { MapView, fitTo, syncMarkers } from '../../components/Map';
import AddressPicker from '../../components/AddressPicker';
import Icon from '../../components/Icon';

export function CustomerFormModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ name: initial?.name || '', phone: initial?.phone || '', whatsapp: initial?.whatsapp || '', email: initial?.email || '', notes: initial?.notes || '' });
  const [address, setAddress] = useState({});
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...form, email: form.email || null, whatsapp: form.whatsapp || null, notes: form.notes || null };
      const saved = initial
        ? await api.put(`/api/customers/${initial.id}`, body)
        : await api.post('/api/customers', { ...body, ...(address.formatted_address ? { address: { ...address, label: 'Principal' } } : {}) });
      onSaved(saved);
    }, initial ? 'Cliente actualizado.' : 'Cliente creado.');
  };
  return (
    <Modal title={initial ? 'Editar cliente' : 'Nuevo cliente'} size={initial ? undefined : 'lg'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="customer-form" disabled={busy}>Guardar</button></>}>
      <form id="customer-form" className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nombre"><input className="input" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Teléfono"><input className="input" type="tel" value={form.phone} onChange={set('phone')} required /></Field>
          <Field label="WhatsApp"><input className="input" type="tel" value={form.whatsapp} onChange={set('whatsapp')} /></Field>
          <Field label="Correo"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Notas" className="full"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
        </div>
        {!initial && (<><h3>Dirección principal (opcional)</h3><AddressPicker value={address} onChange={setAddress} /></>)}
      </form>
    </Modal>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [view, setView] = useState('table');
  const [creating, setCreating] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get(`/api/customers${qs({ q, with_addresses: 'true' })}`), [q]);
  const mapRef = useRef(null);
  const markers = useRef(new Map());

  const draw = useCallback(() => {
    const m = mapRef.current;
    if (!m || !data) return;
    const items = [];
    for (const c of data) {
      for (const a of c.addresses || []) {
        if (a.lat == null) continue;
        items.push({
          id: a.id,
          position: { lat: a.lat, lng: a.lng },
          content: pinElement({ color: c.has_account ? '#9333ea' : '#2563eb', label: '', size: 24 }),
          title: `${c.name} — ${a.formatted_address}`,
          onClick: () => navigate(`/admin/clientes/${c.id}`),
        });
      }
    }
    syncMarkers(markers.current, m.map, m.gm, items);
    fitTo(m.map, m.gm, items.map((i) => i.position), { maxZoom: 14 });
  }, [data, navigate]);
  useEffect(draw, [draw]);
  useEffect(() => { if (view !== 'map') { mapRef.current = null; markers.current = new Map(); } }, [view]);

  return (
    <div>
      <div className="page-header">
        <div><h1>Clientes</h1><p>Clientes registrados por el personal o con cuenta propia.</p></div>
        <div className="row-wrap">
          <div className="chips">
            <button className={`chip ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>Lista</button>
            <button className={`chip ${view === 'map' ? 'active' : ''}`} onClick={() => setView('map')}>Mapa</button>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nuevo cliente</button>
        </div>
      </div>
      <div className="filters"><input className="input grow" placeholder="Buscar por nombre, teléfono o correo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {view === 'map' ? (
        <MapView className="map map-tall" center={SD_CENTER} zoom={11} onReady={(m) => { mapRef.current = m; draw(); }}>
          <div className="map-legend"><div className="row" style={{ gap: 6 }}><span className="color-dot" style={{ background: '#2563eb' }} />Cliente</div><div className="row" style={{ gap: 6 }}><span className="color-dot" style={{ background: '#9333ea' }} />Con cuenta</div></div>
        </MapView>
      ) : (
        <div className="card">
          {loading && !data ? <Spinner center /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Dirección principal</th><th>Cuenta</th><th>Registrado</th></tr></thead>
                <tbody>
                  {(data || []).map((c) => {
                    const a = c.addresses?.find((x) => x.is_default) || c.addresses?.[0];
                    return (
                      <tr key={c.id} className="clickable" onClick={() => navigate(`/admin/clientes/${c.id}`)} style={{ opacity: c.active ? 1 : 0.5 }}>
                        <td className="bold">{c.name}</td>
                        <td>{c.phone}</td>
                        <td className="small">{c.email || '—'}</td>
                        <td className="small"><div className="ellipsis" style={{ maxWidth: 280 }}>{a?.formatted_address || '—'}</div></td>
                        <td>{c.has_account ? <span className="badge" style={{ '--c': '#9333ea' }}>Con cuenta</span> : <span className="muted small">Sin cuenta</span>}</td>
                        <td className="small">{dateTime(c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data?.length === 0 && <Empty icon="users" title="Sin clientes" />}
            </div>
          )}
        </div>
      )}
      {creating && <CustomerFormModal onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); reload(); navigate(`/admin/clientes/${c.id}`); }} />}
    </div>
  );
}
