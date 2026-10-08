'use strict';

/** Roles base del sistema y sus permisos (editables luego desde la API de roles). */
const ROLES = [
  { id: 'admin', name: 'Administrador', permissions: ['*'] },
  {
    id: 'dispatcher',
    name: 'Despachador',
    permissions: ['dashboard.view', 'orders.view', 'orders.manage', 'orders.assign', 'customers.manage', 'tracking.view'],
  },
  { id: 'courier', name: 'Mensajero', permissions: [] },
];

exports.ROLES = ROLES;

exports.up = async function up(knex) {
  const ts = new Date().toISOString();
  for (const r of ROLES) {
    const exists = await knex('roles').where({ id: r.id }).first();
    if (!exists) await knex('roles').insert({ id: r.id, name: r.name, permissions: JSON.stringify(r.permissions), created_at: ts, updated_at: ts });
  }
};

exports.down = async function down() {
  // Los roles se eliminan junto con su tabla en la migración inicial.
};
