'use strict';
/**
 * Redis (opcional, recomendado en producción):
 *  - Adaptador de Socket.IO para que el tiempo real funcione con varias instancias.
 *  - Almacén compartido del límite de peticiones (rate limiting).
 * Si REDIS_URL no está definida, todo funciona en memoria con una sola instancia.
 */
const { createClient } = require('redis');
const { RedisStore } = require('rate-limit-redis');
const config = require('../config');

let client = null;

function getRedis() {
  if (!config.redisUrl) return null;
  if (!client) {
    client = createClient({ url: config.redisUrl, socket: { reconnectStrategy: (n) => Math.min(n * 200, 5000) } });
    client.on('error', (err) => console.warn('[redis]', err.message));
    // Los comandos se encolan hasta que la conexión esté lista.
    client.connect().catch((err) => console.warn('[redis] No se pudo conectar:', err.message));
  }
  return client;
}

/** Almacén de rate limiting en Redis (o memoria si no hay Redis). */
function rateLimitStore(prefix) {
  const c = getRedis();
  if (!c) return undefined;
  return new RedisStore({ sendCommand: (...args) => c.sendCommand(args), prefix: `rl:${prefix}:` });
}

async function redisHealthy() {
  const c = getRedis();
  if (!c) return null;
  try {
    return (await c.ping()) === 'PONG';
  } catch {
    return false;
  }
}

async function closeRedis() {
  if (client) await client.quit().catch(() => {});
  client = null;
}

module.exports = { getRedis, rateLimitStore, redisHealthy, closeRedis };
