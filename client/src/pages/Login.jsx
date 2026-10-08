import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { homeFor } from '../App';
import { Field } from '../components/ui';
import Icon from '../components/Icon';

export default function Login() {
  const { login, user, config } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const company = config?.company;

  if (user) return <Navigate to={params.get('next') || homeFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
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
        <div className="row">
          <img src={company?.company_logo_url || '/icons/icon-192.png'} width="44" height="44" alt="" style={{ borderRadius: 12 }} />
          <strong>{company?.company_name || 'Entregas RD'}</strong>
        </div>
        <div>
          <h1>Logística y entregas en toda República Dominicana</h1>
          <ul>
            <li>Pedidos, mensajeros y rutas en tiempo real</li>
            <li>Tarifas automáticas por provincia, municipio, sector o zona</li>
            <li>Seguimiento para clientes sin descargar ninguna app</li>
          </ul>
        </div>
        <small style={{ color: '#94a3b8' }}>{company?.business_hours}</small>
      </section>
      <section className="auth-form">
        <form className="card card-body stack" onSubmit={submit}>
          <div>
            <h1>Iniciar sesión</h1>
            <p className="muted small" style={{ marginTop: 4 }}>Administradores, despachadores, mensajeros y clientes con cuenta.</p>
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <Field label="Correo electrónico">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contraseña">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          {company?.allow_customer_signup && (
            <p className="small muted" style={{ textAlign: 'center' }}>
              ¿Cliente frecuente? <Link to="/registro">Crea una cuenta opcional</Link>
            </p>
          )}
          <div className="alert alert-info small row" style={{ alignItems: 'flex-start' }}>
            <Icon name="link" size={18} />
            <span>¿Quieres seguir un pedido? No necesitas cuenta: abre el enlace de seguimiento que recibiste por WhatsApp, SMS o correo.</span>
          </div>
        </form>
      </section>
    </div>
  );
}
