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
  // Un valor con texto de más (p. ej. un comentario pegado) no debe crear un administrador inservible.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) {
    console.error(`ADMIN_EMAIL no es un correo válido: "${ADMIN_EMAIL}". No se creó el administrador; corrige la variable y vuelve a desplegar.`);
    return;
  }
  if (ADMIN_PASSWORD.length < 8) {
    console.error('ADMIN_PASSWORD debe tener al menos 8 caracteres. No se creó el administrador.');
    return;
  }
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
 * Instalación nueva sin geografía: carga las provincias, municipios y sectores de RD
 * para que el administrador no tenga que escribirlos a mano.
 */
async function ensureBaseGeography() {
  const any = await db('provinces').first('id');
  if (any) return;
  const { loadBaseGeography } = require('../modules/geo/base');
  const added = await db.transaction((trx) => loadBaseGeography(trx));
  console.log(`División territorial de RD cargada: ${added.provinces} provincias, ${added.municipalities} municipios y ${added.sectors} sectores.`);
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

module.exports = { ensureBaseGeography, ensureFirstAdmin, loadDemoDataIfEmpty };
