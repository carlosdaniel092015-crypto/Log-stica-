'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

function knexConfig() {
  const common = {
    migrations: { directory: path.join(__dirname, 'migrations'), tableName: 'knex_migrations' },
    seeds: { directory: path.join(__dirname, 'seeds') },
  };
  if (config.db.client === 'pg') {
    return {
      ...common,
      client: 'pg',
      connection: config.db.url,
      pool: { min: 1, max: 10 },
    };
  }
  const file = config.db.sqliteFile;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    ...common,
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn, done) {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('busy_timeout = 5000');
        done();
      },
    },
  };
}

module.exports = knexConfig;
