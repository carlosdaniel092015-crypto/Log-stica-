import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Field } from '../components/ui';
import { resetSocket } from '../lib/socket';

export default function Register() {
  const { user, refreshUser, config } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  if (config && !config.company.allow_customer_signup) return <Navigate to="/login" replace />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/register', form);
      resetSocket();
      await refreshUser();
      navigate('/cliente', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fullscreen-center">
      <form className="card card-body stack" style={{ width: '100%', maxWidth: 440 }} onSubmit={submit}>
        <div>
          <h1>Crear cuenta</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            La cuenta es opcional: te permite ver tu historial y guardar direcciones. Para seguir un pedido no la necesitas.
          </p>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <Field label="Nombre completo"><input className="input" value={form.name} onChange={set('name')} required minLength={2} /></Field>
        <Field label="Teléfono"><input className="input" type="tel" value={form.phone} onChange={set('phone')} required placeholder="809-555-0000" /></Field>
        <Field label="Correo electrónico"><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres."><input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
      </form>
    </div>
  );
}
