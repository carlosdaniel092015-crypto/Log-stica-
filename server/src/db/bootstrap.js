'use strict';
const bcrypt = require('bcryptjs');
const { db, now } = require('./index');
const { uuid } = require('../utils/crypto');

/**
 * Crea el primer administrador en una instalación vacía a partir de
 * ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (útil en producción sin datos de ejemplo).
 */
async function ensureFirstAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const any = await db('users').where({ role_id: 'admin' }).first();
  if (any) return;
  const ts = now();
  await db('users').insert({
    id: uuid(), role_id: 'admin', name: ADMIN_NAME || 'Administrador', email: ADMIN_EMAIL.toLowerCase(),
    password_hash: await bcrypt.hash(ADMIN_PASSWORD, 12), active: true, token_version: 0, created_at: ts, updated_at: ts,
  });
  console.log(`Administrador inicial creado: ${ADMIN_EMAIL}`);
}

/**
 * LOAD_DEMO_DATA=true: carga los datos de ejemplo de RD solo si la base está vacía
 * (nunca borra datos existentes). Útil para probar un despliegue nuevo.
 */
async function loadDemoDataIfEmpty() {
  if (process.env.LOAD_DEMO_DATA !== 'true') return;
  const any = await db('users').first('id');
  if (any) return;
  console.log('Base de datos vacía: cargando datos de ejemplo (LOAD_DEMO_DATA=true)…');
  const previous = process.env.SEED_FORCE;
  process.env.SEED_FORCE = 'true';
  try {
    await db.seed.run();
  } finally {
    process.env.SEED_FORCE = previous;
  }
}

module.exports = { ensureFirstAdmin, loadDemoDataIfEmpty };
