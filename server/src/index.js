'use strict';
const http = require('http');
const config = require('./config');
const { db } = require('./db');
const { createApp } = require('./app');
const { attachRealtime } = require('./realtime/socket');
const { pruneLocations } = require('./modules/couriers/service');
const { ensureFirstAdmin } = require('./db/bootstrap');

async function main() {
  await db.migrate.latest();
  await ensureFirstAdmin();
  const app = createApp();
  const server = http.createServer(app);
  attachRealtime(server);

  // Limpieza periódica del historial de ubicaciones (retención configurable).
  const prune = () => pruneLocations().catch((err) => console.warn('[prune]', err.message));
  prune();
  setInterval(prune, 6 * 3600_000).unref();

  server.listen(config.port, () => {
    console.log(`Logística RD escuchando en ${config.publicBaseUrl} (puerto ${config.port}, BD: ${config.db.client})`);
    if (!config.google.browserKey) console.log('Aviso: GOOGLE_MAPS_BROWSER_KEY no está configurada; los mapas mostrarán un aviso.');
  });

  const shutdown = () => {
    server.close(() => db.destroy().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
