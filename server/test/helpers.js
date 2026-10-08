'use strict';
process.env.NODE_ENV = 'test';
// Por defecto SQLite en memoria; con TEST_DATABASE_URL se prueba contra PostgreSQL.
if (process.env.TEST_DATABASE_URL) {
  process.env.DB_CLIENT = 'pg';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  process.env.SQLITE_FILE = ':memory:';
}
process.env.UPLOADS_DIR = require('path').join(require('os').tmpdir(), `lrd-test-${process.pid}`);

const request = require('supertest');
const { db } = require('../src/db');
const { createApp } = require('../src/app');

async function setup() {
  if (process.env.TEST_DATABASE_URL) await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await db.seed.run();
  return createApp();
}

async function login(app, email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

module.exports = { setup, login, db, request };
