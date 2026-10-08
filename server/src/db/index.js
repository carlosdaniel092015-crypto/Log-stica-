'use strict';
const knexLib = require('knex');
const knexConfig = require('./knexfile');

const db = knexLib(knexConfig());

const isPg = db.client.config.client === 'pg';

/** Convierte valores booleanos que SQLite devuelve como 0/1. */
function bool(v) {
  return v === true || v === 1 || v === '1' || v === 't';
}

/** Lee columnas JSON almacenadas como texto. */
function json(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { db, isPg, bool, json, now, iso };
