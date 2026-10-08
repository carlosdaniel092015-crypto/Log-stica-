'use strict';
const express = require('express');
const { z } = require('zod');
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound, conflict } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requireStaff, requirePermission } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { resolveAdministrative } = require('./resolver');
const { loadBaseGeography } = require('./base');

const router = express.Router();
router.use(requireStaff);

const TABLES = {
  provinces: { parent: null, entity: 'province' },
  municipalities: { parent: 'province_id', entity: 'municipality' },
  sectors: { parent: 'municipality_id', entity: 'sector' },
};

const coord = z.number().finite().nullable().optional();
const baseSchema = { name: z.string().trim().min(2).max(120), lat: coord, lng: coord, active: z.boolean().optional() };
const schemas = {
  provinces: z.object({ ...baseSchema, code: z.string().trim().max(10).optional().nullable() }),
  municipalities: z.object({ ...baseSchema, province_id: z.string().uuid(), kind: z.enum(['municipio', 'distrito_municipal']).optional() }),
  sectors: z.object({ ...baseSchema, municipality_id: z.string().uuid() }),
};

const mapRow = (r) => ({ ...r, active: bool(r.active) });

/** Árbol completo: provincias → municipios → sectores. */
/** Carga (o completa) la división territorial de RD: solo agrega lo que falta. */
router.post('/load-base', requirePermission('zones.manage'), ah(async (req, res) => {
  const added = await db.transaction(async (trx) => {
    const result = await loadBaseGeography(trx);
    await audit(req, { action: 'geo.load_base', entity: 'province', newValue: result }, trx);
    return result;
  });
  res.json(added);
}));

router.get('/tree', ah(async (_req, res) => {
  const [provinces, municipalities, sectors] = await Promise.all([
    db('provinces').orderBy('name'),
    db('municipalities').orderBy('name'),
    db('sectors').orderBy('name'),
  ]);
  res.json({ provinces: provinces.map(mapRow), municipalities: municipalities.map(mapRow), sectors: sectors.map(mapRow) });
}));

/** Tarifa que aplica a cada sector de un municipio (según su punto central). */
router.get('/sector-prices', ah(async (req, res) => {
  const { quote } = require('../zones/service');
  const muni = await db('municipalities').where({ id: String(req.query.municipality_id || '') }).first();
  if (!muni) throw notFound();
  const sectors = await db('sectors').where({ municipality_id: muni.id }).orderBy('name');
  const out = [];
  for (const s of sectors) {
    const q = await quote({ lat: s.lat, lng: s.lng, sector_id: s.id, municipality_id: muni.id, province_id: muni.province_id });
    out.push({ sector_id: s.id, fee: q.fee, zone_name: q.zone?.name || null, zone_kind: q.zone?.kind || null });
  }
  res.json(out);
}));

router.post('/resolve', validate(z.object({ lat: z.number(), lng: z.number(), components: z.array(z.any()).optional() })), ah(async (req, res) => {
  res.json(await resolveAdministrative(req.body));
}));

for (const [table, meta] of Object.entries(TABLES)) {
  router.get(`/${table}`, ah(async (req, res) => {
    const q = db(table).orderBy('name');
    if (meta.parent && req.query[meta.parent]) q.where(meta.parent, String(req.query[meta.parent]));
    res.json((await q).map(mapRow));
  }));

  router.post(`/${table}`, requirePermission('zones.manage'), validate(schemas[table]), ah(async (req, res) => {
    const ts = now();
    const row = { id: uuid(), ...req.body, active: req.body.active ?? true, created_at: ts, updated_at: ts };
    try {
      await db(table).insert(row);
    } catch (err) {
      if (/unique|duplicate/i.test(err.message)) throw conflict('Ya existe un registro con ese nombre.');
      throw err;
    }
    await audit(req, { action: `${meta.entity}.create`, entity: meta.entity, entityId: row.id, newValue: req.body });
    res.status(201).json(mapRow(row));
  }));

  router.put(`/${table}/:id`, requirePermission('zones.manage'), validate(schemas[table].partial()), ah(async (req, res) => {
    const before = await db(table).where({ id: req.params.id }).first();
    if (!before) throw notFound();
    await db(table).where({ id: before.id }).update({ ...req.body, updated_at: now() });
    await audit(req, { action: `${meta.entity}.update`, entity: meta.entity, entityId: before.id, oldValue: before, newValue: req.body });
    res.json(mapRow(await db(table).where({ id: before.id }).first()));
  }));

  router.delete(`/${table}/:id`, requirePermission('zones.manage'), ah(async (req, res) => {
    const before = await db(table).where({ id: req.params.id }).first();
    if (!before) throw notFound();
    const child = { provinces: ['municipalities', 'province_id'], municipalities: ['sectors', 'municipality_id'] }[table];
    if (child && (await db(child[0]).where(child[1], before.id).first())) {
      throw conflict('No se puede eliminar porque tiene registros dependientes. Elimínalos o desactívalo.');
    }
    const fk = { provinces: 'province_id', municipalities: 'municipality_id', sectors: 'sector_id' }[table];
    if (await db('orders').where(fk, before.id).first()) throw conflict('No se puede eliminar porque hay pedidos asociados. Puedes desactivarlo.');
    try {
      await db(table).where({ id: before.id }).del();
    } catch (err) {
      throw conflict('No se puede eliminar porque está en uso. Puedes desactivarlo en su lugar.');
    }
    await audit(req, { action: `${meta.entity}.delete`, entity: meta.entity, entityId: before.id, oldValue: before });
    res.json({ ok: true });
  }));
}

module.exports = router;
