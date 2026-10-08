'use strict';
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const env = process.env;

// Los paneles (Dokploy, Easypanel…) a veces guardan espacios al final de un valor pegado:
// se limpian para que no rompan URLs ni contraseñas.
const OWN_VARS = /^(PUBLIC_BASE_URL|CORS_ORIGINS|ADMIN_|JWT_SECRET|DATA_ENCRYPTION_KEY|DB_|DATABASE_URL|REDIS_|GOOGLE_MAPS_|VAPID_|TRUST_PROXY|FORCE_HTTPS|SESSION_HOURS|LOAD_DEMO_DATA|SQLITE_FILE|UPLOADS_DIR|PORT$)/;
for (const [key, value] of Object.entries(env)) {
  if (OWN_VARS.test(key) && typeof value === 'string' && value !== value.trim()) env[key] = value.trim();
}

/** PUBLIC_BASE_URL debe ser una URL http(s) limpia: se usa en enlaces y en el tiempo real. */
function baseUrl(value) {
  if (!value) return `http://localhost:${env.PORT || 3000}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || /\s/.test(value)) {
    throw new Error(`PUBLIC_BASE_URL no es válida: "${value}". Debe ser solo la dirección, por ejemplo https://entregas.tudominio.com (sin espacios ni texto después).`);
  }
  return value.replace(/\/+$/, '');
}
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function secret(name, devFallback) {
  const value = env[name];
  if (value) return value;
  if (isProd) throw new Error(`Falta la variable de entorno obligatoria ${name}`);
  return devFallback;
}

const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: Number(env.PORT || 3000),
  publicBaseUrl: baseUrl(env.PUBLIC_BASE_URL),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : (isProd ? 1 : false),
  forceHttps: env.FORCE_HTTPS ? env.FORCE_HTTPS === 'true' : isProd,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  db: {
    client: env.DB_CLIENT || 'better-sqlite3',
    url: env.DATABASE_URL || '',
    ssl: env.DB_SSL === 'true',
    sqliteFile: env.SQLITE_FILE || path.resolve(__dirname, '../data/logistica.sqlite'),
  },

  auth: {
    jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret-change-me-' + 'x'.repeat(16)),
    sessionHours: Number(env.SESSION_HOURS || 12),
    cookieName: 'lrd_session',
  },

  // Clave para cifrar los tokens de seguimiento en reposo (AES-256-GCM).
  dataKey: crypto.createHash('sha256').update(secret('DATA_ENCRYPTION_KEY', 'dev-only-data-key')).digest(),

  google: {
    browserKey: env.GOOGLE_MAPS_BROWSER_KEY || '',
    serverKey: env.GOOGLE_MAPS_SERVER_KEY || '',
    mapId: env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
  },

  push: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:soporte@example.com',
  },

  redisUrl: env.REDIS_URL || '',
  // Contraseña aparte de la URL: así funciona aunque tenga símbolos (#, @, /…).
  redisPassword: env.REDIS_PASSWORD || '',

  uploadsDir: env.UPLOADS_DIR || path.resolve(__dirname, '../data/uploads'),
  clientDist: path.resolve(__dirname, '../../client/dist'),
};

module.exports = config;
