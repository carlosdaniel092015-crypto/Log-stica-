import { useEffect, useState, useCallback, useRef } from 'react';
import Icon from './Icon';
import { useApp } from '../context/AppContext';
import { getSocket } from '../lib/socket';

const COURIER_COLORS = { available: '#16a34a', en_route: '#2563eb', delivering: '#0891b2', paused: '#d97706', off_duty: '#64748b' };

export function StatusBadge({ status, label }) {
  const { config } = useApp();
  return (
    <span className="badge" style={{ '--c': `var(--st-${status})` }}>
      {label || config?.statuses?.[status] || status}
    </span>
  );
}

export function CourierBadge({ status }) {
  const { config } = useApp();
  return (
    <span className="badge" style={{ '--c': COURIER_COLORS[status] || '#64748b' }}>
      {config?.courierStatuses?.[status] || status}
    </span>
  );
}

export function Spinner({ center }) {
  const s = <div className="spinner" role="progressbar" aria-label="Cargando" />;
  return center ? <div className="center">{s}</div> : s;
}

export function Empty({ icon = 'box', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="bold">{title}</div>
      {children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size ? `modal-${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', gap: 16, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span>
        <span className="bold" style={{ display: 'block' }}>{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={`field ${className || ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Carga datos asíncronos con estados de carga/error y recarga manual. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
      return null;
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload, setData: (updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })) };
}

/** Suscripción a un evento de Socket.IO durante la vida del componente. */
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const socket = getSocket();
    const fn = (payload) => ref.current(payload);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [event]);
}

export function useSocketStatus() {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, []);
  return connected;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OnlineIndicator() {
  const online = useOnline();
  const live = useSocketStatus();
  if (!online) return <span className="live-pill offline"><Icon name="wifiOff" size={14} /> Sin conexión</span>;
  return (
    <span className={`live-pill ${live ? '' : 'off'}`} title={live ? 'Actualizaciones en tiempo real activas' : 'Conectando…'}>
      <i /> {live ? 'En vivo' : 'Conectando…'}
    </span>
  );
}

const AVATAR_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#7c3aed', '#d97706', '#db2777', '#0d9488', '#4f46e5'];
export function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/** Círculo con iniciales. `color` fija el color; si no, se deriva del nombre. */
export function Avatar({ name, color, soft = false, size }) {
  const c = color || AVATAR_COLORS[[...String(name || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className={`avatar ${soft ? 'soft' : ''} ${size === 'lg' ? 'lg' : ''}`} style={{ '--av': c }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function ConfirmButton({ message, onConfirm, children, className = 'btn', ...rest }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ErrorAlert({ error }) {
  if (!error) return null;
  return <div className="alert alert-danger">{error.message || String(error)}</div>;
}

/** Hook para ejecutar acciones con estado "ocupado" y toasts de error. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn, successMsg) => {
      setBusy(true);
      try {
        const r = await fn();
        if (successMsg) toast(successMsg, { type: 'success' });
        return r;
      } catch (err) {
        toast(err.message, { type: 'error', title: 'No se pudo completar' });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return [busy, run];
}
