import { io } from 'socket.io-client';

// En Vercel el frontend y el backend viven en dominios distintos y Vercel no reenvía
// WebSockets: el socket se conecta directo al backend con un token corto.
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL || '';

let socket = null;

async function socketAuth(cb) {
  try {
    const res = await fetch('/api/auth/socket-token', { credentials: 'same-origin' });
    cb(res.ok ? { token: (await res.json()).token } : {});
  } catch {
    cb({});
  }
}

/** Conexión Socket.IO compartida (en el mismo dominio la cookie de sesión autentica sola). */
export function getSocket() {
  if (!socket) {
    const opts = { path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] };
    socket = REALTIME_URL ? io(REALTIME_URL, { ...opts, auth: socketAuth }) : io(opts);
  }
  return socket;
}

/** Reconecta para que el servidor tome la sesión nueva (después de login/logout). */
export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
