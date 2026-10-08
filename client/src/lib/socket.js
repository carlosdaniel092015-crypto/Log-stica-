import { io } from 'socket.io-client';

let socket = null;

/** Conexión Socket.IO compartida (la cookie de sesión autentica automáticamente). */
export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
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
