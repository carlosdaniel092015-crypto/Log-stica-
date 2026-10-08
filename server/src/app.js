'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { HttpError } = require('./utils/http');
const { rateLimitStore, redisHealthy } = require('./infra/redis');
const { db } = require('./db');
const { authOptional, requireStaff } = require('./middleware/auth');
const { getSettings, publicSettings } = require('./modules/settings/service');
const { getVapid } = require('./modules/notifications/push');
const { STATUS_LABELS, STAFF_TRANSITIONS } = require('./modules/orders/statuses');
const { COURIER_STATUS_LABELS } = require('./modules/couriers/service');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // HTTPS obligatorio en producción (detrás de proxy usa X-Forwarded-Proto).
  if (config.forceHttps) {
    app.use((req, res, next) => {
      if (req.secure || req.path === '/healthz') return next();
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    });
  }

  const openfreemap = ['https://tiles.openfreemap.org'];
  const google = ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com'];
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-eval'", ...google],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', ...google, ...openfreemap],
          'connect-src': ["'self'", 'ws:', 'wss:', 'data:', 'blob:', ...google, ...openfreemap],
          'worker-src': ["'self'", 'blob:'],
          'frame-src': ['https://*.google.com'],
          'upgrade-insecure-requests': config.forceHttps ? [] : null,
        },
      },
      hsts: config.forceHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '9mb' }));

  // Salud para Dokploy / balanceadores: verifica base de datos y Redis.
  app.get('/healthz', async (_req, res) => {
    let database = false;
    try {
      await db.raw('select 1');
      database = true;
    } catch {
      database = false;
    }
    const redis = await redisHealthy();
    const ok = database && redis !== false;
    res.status(ok ? 200 : 503).json({ ok, database, redis: redis === null ? 'no configurado' : redis });
  });

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.isTest,
      store: rateLimitStore('api'),
      message: { error: 'Demasiadas solicitudes. Intenta en un momento.' },
    })
  );
  // Protección CSRF: las peticiones que modifican datos deben ser JSON (no se pueden
  // enviar desde un formulario de otro sitio) y la cookie de sesión es SameSite=Lax.
  api.use((req, _res, next) => {
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && hasBody && !req.is('application/json')) {
      return next(new HttpError(415, 'El contenido debe enviarse como JSON.'));
    }
    next();
  });
  api.use(authOptional);

  api.get('/public/config', async (_req, res, next) => {
    try {
      const settings = await getSettings();
      const vapid = await getVapid();
      res.json({
        company: publicSettings(settings),
        google: { browserKey: config.google.browserKey, mapId: config.google.mapId },
        vapidPublicKey: vapid.publicKey,
        statuses: STATUS_LABELS,
        transitions: STAFF_TRANSITIONS,
        courierStatuses: COURIER_STATUS_LABELS,
      });
    } catch (err) {
      next(err);
    }
  });

  api.use('/auth', require('./modules/auth/routes'));
  api.use('/users', require('./modules/users/routes'));
  api.use('/geo', require('./modules/geo/routes'));
  api.use('/zones', require('./modules/zones/routes').router);
  api.use('/customers', requireStaff, require('./modules/customers/routes').router);
  api.use('/couriers', requireStaff, require('./modules/couriers/routes').staff);
  api.use('/courier', require('./modules/couriers/routes').self);
  api.use('/orders', requireStaff, require('./modules/orders/routes'));
  api.use('/inventory', requireStaff, require('./modules/inventory/routes'));
  api.use('/proofs', require('./modules/orders/proofs'));
  api.use('/track', require('./modules/tracking/routes'));
  api.use('/notifications', require('./modules/notifications/routes'));
  api.use('/dashboard', requireStaff, require('./modules/dashboard/routes'));
  api.use('/audit', requireStaff, require('./modules/audit/routes'));
  api.use('/settings', require('./modules/settings/routes'));
  api.use('/maps', require('./modules/maps/routes'));
  api.use((_req, _res, next) => next(new HttpError(404, 'Ruta de API no encontrada.')));

  app.use('/api', api);

  // Frontend compilado (SPA). El service worker nunca se cachea para recibir actualizaciones.
  if (fs.existsSync(config.clientDist)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders(res, file) {
          if (file.endsWith('sw.js') || file.endsWith('.webmanifest') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      })
    );
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // Manejador de errores.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido enviado es demasiado grande.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({ error: status >= 500 ? 'Ocurrió un error inesperado. Intenta de nuevo.' : err.message, details: err.details });
  });

  return app;
}

module.exports = { createApp };
