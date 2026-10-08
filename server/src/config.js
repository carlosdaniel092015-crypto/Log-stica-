'use strict';
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const env = process.env;
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
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : (isProd ? 1 : false),
  forceHttps: env.FORCE_HTTPS ? env.FORCE_HTTPS === 'true' : isProd,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  db: {
    client: env.DB_CLIENT || 'better-sqlite3',
    url: env.DATABASE_URL || '',
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

  uploadsDir: env.UPLOADS_DIR || path.resolve(__dirname, '../data/uploads'),
  clientDist: path.resolve(__dirname, '../../client/dist'),
};

module.exports = config;
