'use strict';
const { Server } = require('socket.io');
const config = require('../config');
const { resolveSession, SOCKET_AUDIENCE } = require('../middleware/auth');
const { resolveToken } = require('../modules/tracking/links');
const { publicView } = require('../modules/tracking/service');
const hub = require('./hub');
const { getRedis } = require('../infra/redis');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Tiempo real con Socket.IO.
 * - Sesiones autenticadas (cookie) se unen a sus salas según rol.
 * - El seguimiento público se une con el token privado; el servidor lo valida
 *   y solo suscribe a la sala de ese pedido.
 */
function attachRealtime(httpServer) {
  // Orígenes permitidos: CORS_ORIGINS y el dominio público (si el frontend está en Vercel).
  const origins = [...new Set([...config.corsOrigins, new URL(config.publicBaseUrl).origin])];
  const io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const authToken = socket.handshake.auth?.token;
      // Frontend en otro dominio: token corto de /api/auth/socket-token. Mismo dominio: cookie.
      socket.data.user = (authToken && (await resolveSession(authToken, { audience: SOCKET_AUDIENCE })))
        || (await resolveSession(authToken || cookies[config.auth.cookieName]));
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) {
      socket.join(`user:${user.id}`);
      if (user.isStaff) socket.join('staff');
      if (user.role === 'courier' && user.courierId) socket.join(`courier:${user.courierId}`);
    }

    socket.on('track:join', async (payload, ack) => {
      try {
        const found = await resolveToken(payload?.token);
        if (!found) return ack?.({ ok: false, error: 'Enlace no válido o vencido.' });
        socket.join(`track:${found.order.id}`);
        ack?.({ ok: true, view: await publicView(found.order) });
      } catch {
        ack?.({ ok: false, error: 'Error de conexión.' });
      }
    });
  });

  // Con Redis, los eventos llegan a los clientes conectados a cualquier instancia.
  const redis = getRedis();
  if (redis) {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    pub.on('error', (err) => console.warn('[redis pub]', err.message));
    sub.on('error', (err) => console.warn('[redis sub]', err.message));
    Promise.all([pub.connect(), sub.connect()])
      .then(() => {
        io.adapter(createAdapter(pub, sub));
        console.log('Socket.IO usando Redis (multi-instancia).');
      })
      .catch((err) => console.warn('[redis] Adaptador de Socket.IO no disponible:', err.message));
  }

  hub.setIO(io);
  return io;
}

module.exports = { attachRealtime };
