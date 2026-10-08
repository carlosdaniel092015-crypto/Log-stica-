import { api } from './api';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission() {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/**
 * Activa notificaciones push. El permiso se pide SOLO cuando el usuario lo solicita
 * con un botón (nunca automáticamente). `endpoint` define a dónde se registra.
 */
export async function enablePush(vapidPublicKey, endpoint = '/api/notifications/push') {
  if (!pushSupported()) throw new Error('Tu navegador no admite notificaciones push.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió el permiso de notificaciones. Puedes seguir usando la plataforma normalmente.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  await api.post(endpoint, { subscription: sub.toJSON() });
  return true;
}
