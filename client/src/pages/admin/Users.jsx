import { useState } from 'react';
import { api, qs } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Empty, Field, Modal, Spinner, useAction, useAsync } from '../../components/ui';
import Icon from '../../components/Icon';
import { useApp } from '../../context/AppContext';

const ROLE_LABELS = { admin: 'Administrador', dispatcher: 'Despachador', courier: 'Mensajero' };
const PERMISSIONS = {
  'dashboard.view': 'Ver dashboard', 'orders.view': 'Ver pedidos', 'orders.manage': 'Crear y editar pedidos', 'orders.assign': 'Asignar mensajeros',
  'orders.override_fee': 'Modificar costo de envío', 'customers.manage': 'Administrar clientes', 'tracking.view': 'Ver seguimiento en vivo',
  'zones.manage': 'Administrar zonas y tarifas', 'users.manage': 'Administrar usuarios', 'settings.manage': 'Configuración del sistema', 'audit.view': 'Ver auditoría',
};

function UserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ role: user?.role || 'dispatcher', name: user?.name || '', email: user?.email || '', phone: user?.phone || '', password: '', vehicle: user?.vehicle || '', plate: user?.plate || '' });
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (user) {
        const body = { name: form.name, email: form.email, phone: form.phone || null };
        if (user.role === 'courier') Object.assign(body, { vehicle: form.vehicle || null, plate: form.plate || null });
        await api.put(`/api/users/${user.id}`, body);
      } else await api.post('/api/users', { ...form, phone: form.phone || null, vehicle: form.vehicle || null, plate: form.plate || null });
      onSaved();
    }, user ? 'Usuario actualizado.' : 'Usuario creado.');
  };
  return (
    <Modal title={user ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="user-form" disabled={busy}>Guardar</button></>}>
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <Field label="Rol" className="full">
          <select className="select" value={form.role} onChange={set('role')} disabled={!!user}>{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Nombre"><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Teléfono"><input className="input" type="tel" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Correo" className={user ? 'full' : ''}><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
        {!user && <Field label="Contraseña inicial" hint="Mínimo 8 caracteres"><input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>}
        {form.role === 'courier' && (<><Field label="Vehículo"><input className="input" value={form.vehicle} onChange={set('vehicle')} /></Field><Field label="Placa"><input className="input" value={form.plate} onChange={set('plate')} /></Field></>)}
      </form>
    </Modal>
  );
}

function RolesModal({ onClose }) {
  const roles = useAsync(() => api.get('/api/users/roles'), []);
  const [busy, run] = useAction();
  const [draft, setDraft] = useState({});
  if (!roles.data) return <Modal title="Roles y permisos" onClose={onClose}><Spinner center /></Modal>;
  const staff = roles.data.filter((r) => r.id === 'dispatcher');
  return (
    <Modal title="Roles y permisos" onClose={onClose}>
      <div className="stack">
        <p className="small muted">El administrador tiene todos los permisos. Ajusta qué puede hacer el rol Despachador.</p>
        {staff.map((r) => {
          const perms = draft[r.id] || r.permissions;
          return (
            <div key={r.id} className="stack-sm">
              <h3>{r.name}</h3>
              {Object.entries(PERMISSIONS).map(([k, l]) => (
                <label key={k} className="check small"><input type="checkbox" checked={perms.includes(k)} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.checked ? [...perms, k] : perms.filter((p) => p !== k) })} /> {l}</label>
              ))}
              <button className="btn btn-primary btn-sm" disabled={busy || !draft[r.id]} onClick={() => run(() => api.put(`/api/users/roles/${r.id}`, { permissions: perms }), 'Permisos actualizados.')}>Guardar permisos</button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useApp();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [roles, setRoles] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get(`/api/users${qs({ role, q })}`), [role, q]);
  const [busy, run] = useAction();

  return (
    <div>
      <div className="page-header">
        <div><h1>Usuarios</h1><p>Cuentas de administradores, despachadores y mensajeros. Los clientes no tienen cuenta.</p></div>
        <div className="row-wrap">
          <button className="btn" onClick={() => setRoles(true)}><Icon name="shield" /> Roles y permisos</button>
          <button className="btn btn-primary" onClick={() => setModal({})}><Icon name="plus" /> Nuevo usuario</button>
        </div>
      </div>
      <div className="filters">
        <input className="input grow" placeholder="Buscar por nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol"><option value="">Todos los roles</option>{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div className="card">
        {loading && !data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Teléfono</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {(data || []).map((u) => (
                  <tr key={u.id}>
                    <td className="bold">{u.name}</td>
                    <td className="small">{u.email}</td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td className="small">{u.phone || '—'}</td>
                    <td className="small">{dateTime(u.last_login_at)}</td>
                    <td><span className="badge" style={{ '--c': u.active ? 'var(--success)' : 'var(--muted)' }}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => setModal(u)}><Icon name="edit" /></button>{' '}
                      <button className="btn btn-sm" disabled={busy || u.id === me.id} onClick={() => run(async () => { await api.post(`/api/users/${u.id}/active`, { active: !u.active }); reload(true); }, u.active ? 'Usuario desactivado; sus sesiones se cerraron.' : 'Usuario activado.')}>{u.active ? 'Desactivar' : 'Activar'}</button>{' '}
                      <button className="btn btn-sm btn-ghost" onClick={() => { const p = window.prompt('Nueva contraseña (mínimo 8 caracteres):'); if (p) run(() => api.post(`/api/users/${u.id}/password`, { password: p }), 'Contraseña restablecida.'); }}>Restablecer clave</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.length === 0 && <Empty icon="user" title="Sin usuarios" />}
          </div>
        )}
      </div>
      {modal && <UserModal user={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(true); }} />}
      {roles && <RolesModal onClose={() => setRoles(false)} />}
    </div>
  );
}
