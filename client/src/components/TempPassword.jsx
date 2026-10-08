import { useState } from 'react';
import { api } from '../lib/api';
import { whatsappUrl } from '../lib/format';
import { Field, Modal, useAction } from './ui';
import Icon from './Icon';
import { useApp } from '../context/AppContext';

/** Clave temporal fácil de dictar: sin letras confusas (0/O, 1/l/I). */
export function generatePassword() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set, n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}`;
}

/** Campo de clave temporal con botón "Generar" (visible, para poder entregarla al usuario). */
export function TempPasswordField({ value, onChange, label = 'Clave temporal' }) {
  return (
    <Field label={label} hint="Mínimo 8 caracteres. La persona la cambia al entrar por primera vez.">
      <div className="input-group">
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} required minLength={8} autoComplete="off" spellCheck={false} />
        <button type="button" className="btn" onClick={() => onChange(generatePassword())}><Icon name="key" /> Generar</button>
      </div>
    </Field>
  );
}

/** Muestra el usuario y la clave temporal para entregarlos (copiar o enviar por WhatsApp). */
export function CredentialsModal({ name, email, password, phone, onClose }) {
  const { config, toast } = useApp();
  const company = config?.company?.company_name || 'la empresa';
  const loginUrl = `${window.location.origin}/login`;
  const text = `Hola ${name.split(' ')[0]}, ya tienes acceso a ${company}.\n\nEntra en: ${loginUrl}\nUsuario: ${email}\nClave temporal: ${password}\n\nAl entrar por primera vez te pedirá cambiar la clave.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Datos copiados.', { type: 'success' });
    } catch {
      toast('No se pudo copiar; selecciona el texto manualmente.', { type: 'warning' });
    }
  };
  return (
    <Modal title="Acceso creado" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Listo</button>}>
      <div className="stack">
        <p className="small muted">Entrega estos datos a <strong>{name}</strong>. La clave es temporal: al iniciar sesión tendrá que elegir una nueva.</p>
        <div className="cred-box">
          <span className="small muted">Usuario</span><span className="mono">{email}</span>
          <span className="small muted">Clave temporal</span><span className="mono">{password}</span>
        </div>
        <div className="row-wrap">
          {phone && <a className="btn btn-success" href={whatsappUrl(phone, text)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> Enviar por WhatsApp</a>}
          <button className="btn" onClick={copy}><Icon name="copy" /> Copiar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Restablecer la clave de un usuario: genera una temporal y la muestra para entregarla. */
export function ResetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState(generatePassword);
  const [done, setDone] = useState(false);
  const [busy, run] = useAction();
  if (done) return <CredentialsModal name={user.name} email={user.email} password={password} phone={user.phone} onClose={onClose} />;
  return (
    <Modal title={`Restablecer clave · ${user.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="reset-pw" disabled={busy}>Restablecer</button></>}>
      <form id="reset-pw" className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post(`/api/users/${user.id}/password`, { password, temporary: true }); setDone(true); }, 'Clave restablecida; sus sesiones abiertas se cerraron.'); }}>
        <TempPasswordField value={password} onChange={setPassword} />
      </form>
    </Modal>
  );
}
