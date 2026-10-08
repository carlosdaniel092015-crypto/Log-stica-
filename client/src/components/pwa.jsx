import { useEffect, useState } from 'react';
import Icon from './Icon';
import { useApp } from '../context/AppContext';
import { enablePush, pushPermission, pushSupported } from '../lib/push';

let deferredPrompt = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((l) => l(true));
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((l) => l(false));
});

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Banner opcional para instalar la PWA. Nunca bloquea el uso de la web
 * y se puede descartar. `recommended` lo muestra con más énfasis (mensajeros).
 */
export function InstallBanner({ recommended = false, storageKey = 'lrd_install_dismissed' }) {
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    listeners.add(setCanInstall);
    return () => listeners.delete(setCanInstall);
  }, []);
  if (isStandalone() || dismissed) return null;
  const ios = isIos();
  if (!canInstall && !(ios && recommended)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* sin almacenamiento */
    }
  };

  return (
    <div className="card install-banner">
      <img src="/icons/icon-192.png" width="40" height="40" alt="" style={{ borderRadius: 10 }} />
      <div style={{ flex: 1 }}>
        <div className="bold">{recommended ? 'Instala la app (recomendado)' : 'Instalar en tu pantalla de inicio'}</div>
        <div className="small muted">
          {ios && !canInstall ? 'En Safari toca Compartir → "Agregar a pantalla de inicio".' : 'Acceso rápido y pantalla completa. Es opcional: todo funciona desde el navegador.'}
        </div>
      </div>
      {canInstall && (
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice.catch(() => {});
            deferredPrompt = null;
            setCanInstall(false);
          }}
        >
          Instalar
        </button>
      )}
      <button className="btn btn-ghost btn-icon btn-sm" onClick={dismiss} aria-label="Descartar">
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Botón para activar notificaciones push (el permiso se pide solo al pulsarlo). */
export function PushButton({ endpoint, className = 'btn btn-sm', label = 'Activar notificaciones' }) {
  const { config, toast } = useApp();
  const [state, setState] = useState(pushPermission());
  if (!pushSupported() || !config?.vapidPublicKey) return null;
  if (state === 'granted' && localStorage.getItem(`lrd_push_${endpoint || 'user'}`) === '1') {
    return <span className="small muted row"><Icon name="bell" size={16} /> Notificaciones activas</span>;
  }
  if (state === 'denied') return <span className="small muted">Notificaciones bloqueadas en el navegador</span>;
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await enablePush(config.vapidPublicKey, endpoint);
          try {
            localStorage.setItem(`lrd_push_${endpoint || 'user'}`, '1');
          } catch {
            /* sin almacenamiento */
          }
          setState('granted');
          toast('Recibirás notificaciones en este dispositivo.', { type: 'success' });
        } catch (err) {
          setState(pushPermission());
          toast(err.message, { type: 'warning' });
        }
      }}
    >
      <Icon name="bell" /> {label}
    </button>
  );
}
