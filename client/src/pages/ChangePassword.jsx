import { useState } from 'react';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';
import { Field, useAction } from '../components/ui';
import Icon from '../components/Icon';
import { useApp } from '../context/AppContext';

/** Primer inicio de sesión con clave temporal: hay que elegir una propia para continuar. */
export default function ChangePassword() {
  const { config, user, refreshUser, logout } = useApp();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, run] = useAction();
  const company = config?.company;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    if (form.next.length < 8) return setError('La nueva clave debe tener al menos 8 caracteres.');
    if (form.next !== form.confirm) return setError('Las claves nuevas no coinciden.');
    if (form.next === form.current) return setError('La nueva clave debe ser diferente a la temporal.');
    run(async () => {
      await api.put('/api/auth/me/password', { current_password: form.current, new_password: form.next });
      resetSocket(); // el tiempo real se reconecta ya con la sesión completa
      await refreshUser();
    }, 'Listo, tu clave quedó guardada.');
  };

  return (
    <div className="pw-page">
      <div className="card card-body pw-card stack">
        <div className="row" style={{ gap: 12 }}>
          {company?.company_logo_url ? <img src={company.company_logo_url} alt="" width="44" height="44" style={{ borderRadius: 10, objectFit: 'contain' }} /> : <span className="banner-icon"><Icon name="key" size={20} /></span>}
          <div>
            <h1 style={{ fontSize: '1.25rem' }}>Crea tu propia clave</h1>
            <div className="small muted">Hola {user.name.split(' ')[0]}, entraste con una clave temporal.</div>
          </div>
        </div>
        <p className="small muted">Por seguridad, elige una clave nueva que solo tú conozcas. La usarás desde ahora para entrar{company?.company_name ? ` a ${company.company_name}` : ''}.</p>
        <form className="stack" onSubmit={submit}>
          {error && <div className="alert alert-danger">{error}</div>}
          <Field label="Clave temporal"><input className="input input-lg" type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required autoFocus /></Field>
          <Field label="Nueva clave" hint="Mínimo 8 caracteres"><input className="input input-lg" type="password" value={form.next} onChange={set('next')} autoComplete="new-password" required minLength={8} /></Field>
          <Field label="Repite la nueva clave"><input className="input input-lg" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Guardando…' : 'Guardar y continuar'}</button>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Salir</button>
        </form>
      </div>
    </div>
  );
}
