import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { homeFor } from '../App';
import { Field } from '../components/ui';
import Icon from '../components/Icon';

const BENEFITS = [
  'Pedidos y mensajeros en tiempo real, con su ubicación en el mapa.',
  'Tarifas automáticas por zona: el precio del delivery se calcula al ubicar la dirección.',
  'Seguimiento sin app para tus clientes, por WhatsApp, SMS o correo.',
];

export default function Login() {
  const { login, user, config } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const company = config?.company;

  if (user) return <Navigate to={params.get('next') || homeFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password, remember);
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(u), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <section className="auth-side">
        <div className="row" style={{ gap: 12 }}>
          <img src={company?.company_logo_url || '/icons/icon.svg'} width="40" height="40" alt="" style={{ borderRadius: 10, border: '1px solid rgb(255 255 255 / 0.2)' }} />
          <div>
            <strong style={{ fontSize: '1.05rem' }}>{company?.company_name || 'Entregas RD'}</strong>
            <div className="small" style={{ color: '#cbd5e1' }}>Logística y entregas en República Dominicana</div>
          </div>
        </div>
        <div style={{ maxWidth: 460 }}>
          <h1>Cada pedido, cada mensajero, en un solo lugar.</h1>
          <ul className="auth-benefits">
            {BENEFITS.map((b) => (
              <li key={b}><span><Icon name="check" size={16} /></span>{b}</li>
            ))}
          </ul>
        </div>
        <small style={{ color: '#94a3b8' }}>© {new Date().getFullYear()} {company?.company_name || 'Entregas RD'} · República Dominicana</small>
      </section>
      <section className="auth-form">
        <form className="stack" style={{ width: '100%', maxWidth: 400 }} onSubmit={submit}>
          <div>
            <h1>Iniciar sesión</h1>
            <p className="muted" style={{ marginTop: 6 }}>Acceso para administradores, despachadores y mensajeros.</p>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <Field label="Correo electrónico">
            <input className="input input-lg" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contraseña">
            <div className="input-group">
              <input className="input input-lg" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="btn" style={{ minHeight: 46 }} onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button>
            </div>
          </Field>
          <label className="check small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión</label>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <div className="alert alert-info small row" style={{ alignItems: 'flex-start' }}>
            <Icon name="link" size={18} />
            <span><strong>¿Eres cliente?</strong> No necesitas cuenta: abre el enlace de seguimiento que te enviamos por WhatsApp, SMS o correo.</span>
          </div>
        </form>
      </section>
    </div>
  );
}
