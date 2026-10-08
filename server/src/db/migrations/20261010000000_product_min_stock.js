'use strict';

/** Existencia mínima por producto: por debajo se avisa que se está acabando. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.integer('min_stock').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  // SQLite reconstruye la tabla al quitar una columna; hay que pausar las llaves foráneas
  // (fuera de transacción, porque el PRAGMA no tiene efecto dentro de una).
  const sqlite = knex.client.config.client === 'better-sqlite3';
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('products', (t) => {
      t.dropColumn('min_stock');
    });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};

exports.config = { transaction: false };
