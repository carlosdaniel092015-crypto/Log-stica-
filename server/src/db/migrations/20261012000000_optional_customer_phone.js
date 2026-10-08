'use strict';

/** El teléfono del cliente pasa a ser opcional (clientes y pedidos). */
async function setNullable(knex, nullable) {
  // SQLite reconstruye las tablas al cambiar una columna: se pausan las llaves foráneas.
  const sqlite = knex.client.config.client === 'better-sqlite3';
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    for (const table of ['customers', 'orders']) {
      if (!nullable) await knex(table).whereNull('phone').update({ phone: '' });
      await knex.schema.alterTable(table, (t) => {
        const col = t.string('phone', 40);
        (nullable ? col.nullable() : col.notNullable()).alter();
      });
    }
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
}

exports.up = (knex) => setNullable(knex, true);
exports.down = (knex) => setNullable(knex, false);
exports.config = { transaction: false };
