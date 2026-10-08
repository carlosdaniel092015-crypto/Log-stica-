'use strict';

/** Clave temporal: el usuario debe cambiarla al iniciar sesión por primera vez. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  // SQLite reconstruye la tabla al quitar una columna: se pausan las llaves foráneas.
  const sqlite = knex.client.config.client === 'better-sqlite3';
  if (sqlite) await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('must_change_password');
    });
  } finally {
    if (sqlite) await knex.raw('PRAGMA foreign_keys = ON');
  }
};

exports.config = { transaction: false };
