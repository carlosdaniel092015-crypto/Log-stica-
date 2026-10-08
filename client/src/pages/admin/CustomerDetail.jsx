import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, money, whatsappUrl } from '../../lib/format';
import { Empty, ErrorAlert, Field, Modal, Spinner, StatusBadge, useAction, useAsync } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import Icon from '../../components/Icon';
import { CustomerFormModal } from './Customers';
import { useApp } from '../../context/AppContext';

export function AddressModal({ initial, onClose, onSave }) {
  const [address, setAddress] = useState(initial || {});
  const [label, setLabel] = useState(initial?.label || '');
  const [isDefault, setIsDefault] = useState(!!initial?.is_default);
  const [busy, run] = useAction();
  return (
    <Modal title={initial?.id ? 'Editar dirección' : 'Nueva dirección'} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !address.formatted_address} onClick={() => run(() => onSave({ ...address, label: label || null, is_default: isDefault }), 'Dirección guardada.')}>Guardar</button></>}>
      <div className="stack">
        <Field label="Nombre de la dirección"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Casa, Oficina…" /></Field>
        <AddressPicker value={address} onChange={setAddress} />
        <label className="check"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Dirección predeterminada</label>
      </div>
    </Modal>
  );
}

function clean(a) {
  return {
    label: a.label || null, formatted_address: a.formatted_address, lat: a.lat ?? null, lng: a.lng ?? null, place_id: a.place_id || null,
    reference: a.reference || null, province_id: a.province_id || null, municipality_id: a.municipality_id || null, sector_id: a.sector_id || null,
    components: a.components, is_default: !!a.is_default,
  };
}

export default function CustomerDetail() {
  const { id } = useParams();
  const { currency } = useApp();
  const { data, loading, error, reload, setData } = useAsync(() => api.get(`/api/customers/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState(null);
  const [linking, setLinking] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, run] = useAction();
  if (loading && !data) return <Spinner center />;
  if (error) return <ErrorAlert error={error} />;
  const c = data;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-header">
        <div>
          <Link to="/admin/clientes" className="small"><Icon name="back" size={14} /> Clientes</Link>
          <h1 style={{ marginTop: 6 }}>{c.name}</h1>
          <p>{c.has_account ? 'Cliente con cuenta' : 'Cliente sin cuenta'} · registrado {dateTime(c.created_at)}</p>
        </div>
        <div className="row-wrap">
          <a className="btn" href={`tel:${c.phone}`}><Icon name="phone" /> Llamar</a>
          <a className="btn" href={whatsappUrl(c.whatsapp || c.phone)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> WhatsApp</a>
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Editar</button>
          <button className="btn" disabled={busy} onClick={() => run(async () => { await api.patch(`/api/customers/${c.id}/active`, { active: !c.active }); reload(true); }, c.active ? 'Cliente desactivado.' : 'Cliente activado.')}>{c.active ? 'Desactivar' : 'Activar'}</button>
        </div>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card card-body stack">
          <h3>Datos</h3>
          <dl className="kv">
            <dt>Teléfono</dt><dd>{c.phone}</dd>
            <dt>WhatsApp</dt><dd>{c.whatsapp || '—'}</dd>
            <dt>Correo</dt><dd>{c.email || '—'}</dd>
            <dt>Notas</dt><dd>{c.notes || '—'}</dd>
          </dl>
          {!c.has_account && (
            linking ? (
              <div className="stack-sm">
                <div className="small muted">Mueve los pedidos y direcciones de este cliente a la cuenta registrada (verifica antes la identidad del cliente).</div>
                <div className="input-group">
                  <input className="input" type="email" placeholder="Correo de la cuenta" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button className="btn btn-primary" disabled={busy || !email} onClick={() => run(async () => { const t = await api.post(`/api/customers/${c.id}/link-account`, { email }); window.location.assign(`/admin/clientes/${t.id}`); }, 'Historial vinculado a la cuenta.')}>Vincular</button>
                </div>
              </div>
            ) : <button className="btn btn-sm" onClick={() => setLinking(true)}><Icon name="link" /> Vincular a una cuenta de cliente</button>
          )}
        </div>
        <div className="card card-body stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>Direcciones</h3><button className="btn btn-sm" onClick={() => setAddr({})}><Icon name="plus" /> Agregar</button></div>
          {c.addresses.length === 0 && <Empty icon="pin" title="Sin direcciones guardadas" />}
          {c.addresses.map((a) => (
            <div key={a.id} className="row" style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <Icon name="pin" />
              <div className="spacer">
                <div className="bold">{a.label || 'Dirección'} {a.is_default && <span className="badge no-dot" style={{ '--c': 'var(--primary)' }}>Predeterminada</span>}</div>
                <div className="small">{a.formatted_address}</div>
                <div className="tiny muted">{[a.sector_name, a.municipality_name, a.province_name].filter(Boolean).join(', ')}{a.reference ? ` · Ref.: ${a.reference}` : ''}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setAddr(a)} aria-label="Editar"><Icon name="edit" /></button>
              <button className="btn btn-sm btn-ghost" onClick={() => window.confirm('¿Eliminar esta dirección?') && run(async () => setData({ ...c, addresses: await api.del(`/api/customers/${c.id}/addresses/${a.id}`) }), 'Dirección eliminada.')} aria-label="Eliminar"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Historial de pedidos</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Pedido</th><th>Fecha</th><th>Dirección</th><th>Estado</th><th className="num">Total</th></tr></thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/admin/pedidos/${o.id}`}>#{o.order_number}</Link></td>
                  <td className="small">{dateTime(o.created_at)}</td>
                  <td className="small"><div className="ellipsis" style={{ maxWidth: 300 }}>{o.address}</div></td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="num">{money(o.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.orders.length === 0 && <Empty title="Sin pedidos" />}
        </div>
      </div>
      {editing && <CustomerFormModal initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(true); }} />}
      {addr && (
        <AddressModal
          initial={addr}
          onClose={() => setAddr(null)}
          onSave={async (a) => {
            const list = addr.id ? await api.put(`/api/customers/${c.id}/addresses/${addr.id}`, clean(a)) : await api.post(`/api/customers/${c.id}/addresses`, clean(a));
            setData({ ...c, addresses: list });
            setAddr(null);
          }}
        />
      )}
    </div>
  );
}
