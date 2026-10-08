'use strict';
const express = require('express');
const { z } = require('zod');
const { db, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound, badRequest } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requireStaff, requirePermission } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { normalizeName } = require('../../utils/geo');
const { toCsv, parseCsv } = require('../../utils/csv');
const { ZONE_KINDS, listZones, getZone, quote, setRate } = require('./service');
const { priceAddress } = require('../orders/service');

const router = express.Router();
router.use(requireStaff);

const KIND_LABELS = { province: 'Provincia', municipality: 'Municipio', sector: 'Sector', custom: 'Personalizada' };

const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const zoneSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    kind: z.enum(ZONE_KINDS),
    province_id: z.string().uuid().nullable().optional(),
    municipality_id: z.string().uuid().nullable().optional(),
    sector_id: z.string().uuid().nullable().optional(),
    geometry_type: z.enum(['none', 'polygon', 'circle']).default('none'),
    polygon: z.array(latLng).min(3).max(500).nullable().optional(),
    center_lat: z.number().min(-90).max(90).nullable().optional(),
    center_lng: z.number().min(-180).max(180).nullable().optional(),
    radius_m: z.number().positive().max(200000).nullable().optional(),
    priority: z.number().int().min(-100).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    active: z.boolean().optional(),
    price: z.number().min(0).max(1_000_000),
  })
  .superRefine((v, ctx) => {
    if (v.geometry_type === 'polygon' && !v.polygon) ctx.addIssue({ code: 'custom', path: ['polygon'], message: 'dibuja el polígono en el mapa' });
    if (v.geometry_type === 'circle' && (v.center_lat == null || v.center_lng == null || !v.radius_m)) ctx.addIssue({ code: 'custom', path: ['radius_m'], message: 'dibuja el círculo en el mapa' });
    if (v.geometry_type === 'none' && v.kind === 'custom') ctx.addIssue({ code: 'custom', path: ['geometry_type'], message: 'una zona personalizada necesita un área en el mapa' });
    if (v.geometry_type === 'none' && v.kind === 'province' && !v.province_id) ctx.addIssue({ code: 'custom', path: ['province_id'], message: 'selecciona la provincia' });
    if (v.geometry_type === 'none' && v.kind === 'municipality' && !v.municipality_id) ctx.addIssue({ code: 'custom', path: ['municipality_id'], message: 'selecciona el municipio' });
    if (v.geometry_type === 'none' && v.kind === 'sector' && !v.sector_id) ctx.addIssue({ code: 'custom', path: ['sector_id'], message: 'selecciona el sector' });
  });

function toRow(b) {
  return {
    name: b.name,
    kind: b.kind,
    province_id: b.province_id || null,
    municipality_id: b.municipality_id || null,
    sector_id: b.sector_id || null,
    geometry_type: b.geometry_type,
    polygon: b.geometry_type === 'polygon' ? JSON.stringify(b.polygon) : null,
    center_lat: b.geometry_type === 'circle' ? b.center_lat : null,
    center_lng: b.geometry_type === 'circle' ? b.center_lng : null,
    radius_m: b.geometry_type === 'circle' ? b.radius_m : null,
    priority: b.priority ?? 0,
    color: b.color || '#2563eb',
    active: b.active ?? true,
  };
}

router.get('/', ah(async (req, res) => {
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
  res.json(await listZones({ q: req.query.q, kind: req.query.kind, active, provinceId: req.query.province_id }));
}));

/** Cotiza una dirección: detecta zona y precio en el servidor. */
router.post('/quote', validate(z.object({
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  components: z.array(z.any()).optional(),
  province_id: z.string().uuid().nullable().optional(),
  municipality_id: z.string().uuid().nullable().optional(),
  sector_id: z.string().uuid().nullable().optional(),
})), ah(async (req, res) => {
  const { geo, quote: q } = await priceAddress(req.body);
  res.json({ ...q, geo });
}));

router.get('/export', ah(async (req, res) => {
  const zones = await listZones();
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="tarifas.json"');
    return res.json(zones);
  }
  const headers = ['nombre', 'tipo', 'provincia', 'municipio', 'sector', 'precio', 'estado', 'geometria', 'centro_lat', 'centro_lng', 'radio_m', 'poligono', 'prioridad', 'color'];
  const rows = zones.map((zn) => ({
    nombre: zn.name, tipo: KIND_LABELS[zn.kind], provincia: zn.province_name, municipio: zn.municipality_name, sector: zn.sector_name,
    precio: zn.price, estado: zn.active ? 'Activa' : 'Inactiva', geometria: zn.geometry_type, centro_lat: zn.center_lat, centro_lng: zn.center_lng,
    radio_m: zn.radius_m, poligono: zn.polygon ? JSON.stringify(zn.polygon) : '', prioridad: zn.priority, color: zn.color,
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tarifas.csv"');
  res.send(toCsv(headers, rows));
}));

router.post('/import', requirePermission('zones.manage'), validate(z.object({ content: z.string().max(2_000_000) })), ah(async (req, res) => {
  const rows = parseCsv(req.body.content);
  if (!rows.length) throw badRequest('El archivo no contiene filas.');
  const [provinces, municipalities, sectors] = await Promise.all([db('provinces'), db('municipalities'), db('sectors')]);
  const plain = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const kindFromLabel = Object.fromEntries(Object.entries(KIND_LABELS).flatMap(([k, l]) => [[plain(l), k], [k, k]]));
  const findBy = (list, name, extra = () => true) => list.find((x) => normalizeName(x.name) === normalizeName(name) && extra(x));
  const result = { created: 0, updated: 0, errors: [] };

  await db.transaction(async (trx) => {
    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      try {
        const kind = kindFromLabel[plain(r.tipo || r.kind)];
        if (!kind) throw new Error('tipo inválido');
        const province = r.provincia ? findBy(provinces, r.provincia) : null;
        const municipality = r.municipio ? findBy(municipalities, r.municipio, (m) => !province || m.province_id === province.id) : null;
        const sector = r.sector ? findBy(sectors, r.sector, (s) => !municipality || s.municipality_id === municipality.id) : null;
        const price = Number(String(r.precio ?? r.price ?? '').replace(/[^0-9.]/g, ''));
        const geometry = ['polygon', 'circle'].includes(r.geometria) ? r.geometria : 'none';
        const candidate = {
          name: r.nombre || r.name,
          kind,
          province_id: province?.id || null,
          municipality_id: municipality?.id || null,
          sector_id: sector?.id || null,
          geometry_type: geometry,
          polygon: geometry === 'polygon' && r.poligono ? JSON.parse(r.poligono) : null,
          center_lat: r.centro_lat ? Number(r.centro_lat) : null,
          center_lng: r.centro_lng ? Number(r.centro_lng) : null,
          radius_m: r.radio_m ? Number(r.radio_m) : null,
          priority: r.prioridad ? parseInt(r.prioridad, 10) : 0,
          color: /^#[0-9a-fA-F]{6}$/.test(r.color || '') ? r.color : undefined,
          active: !/inactiv|no|false|0/i.test(r.estado || 'activa'),
          price,
        };
        const parsed = zoneSchema.safeParse(candidate);
        if (!parsed.success) throw new Error(parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
        const ts = now();
        const existing = await trx('delivery_zones').where({ kind, name: candidate.name }).first();
        if (existing) {
          await trx('delivery_zones').where({ id: existing.id }).update({ ...toRow(parsed.data), updated_at: ts });
          const current = await trx('delivery_rates').where({ zone_id: existing.id }).orderBy('effective_from', 'desc').first();
          if (!current || Number(current.price) !== price) await setRate(trx, existing.id, price, req.user.id);
          result.updated++;
        } else {
          const id = uuid();
          await trx('delivery_zones').insert({ id, ...toRow(parsed.data), created_at: ts, updated_at: ts });
          await setRate(trx, id, price, req.user.id);
          result.created++;
        }
      } catch (err) {
        result.errors.push({ line, error: err.message });
      }
    }
    await audit(req, { action: 'zone.import', entity: 'zone', newValue: { created: result.created, updated: result.updated, errors: result.errors.length } }, trx);
  });
  res.json(result);
}));

router.get('/:id', ah(async (req, res) => {
  const zone = await getZone(req.params.id);
  if (!zone) throw notFound();
  res.json(zone);
}));

router.get('/:id/rates', ah(async (req, res) => {
  const rates = await db('delivery_rates as r').leftJoin('users as u', 'u.id', 'r.created_by').where('r.zone_id', req.params.id).orderBy('r.effective_from', 'desc').select('r.*', 'u.name as created_by_name');
  res.json(rates.map((r) => ({ ...r, price: Number(r.price) })));
}));

router.post('/', requirePermission('zones.manage'), validate(zoneSchema), ah(async (req, res) => {
  const ts = now();
  const id = uuid();
  await db.transaction(async (trx) => {
    await trx('delivery_zones').insert({ id, ...toRow(req.body), created_at: ts, updated_at: ts });
    await setRate(trx, id, req.body.price, req.user.id);
    await audit(req, { action: 'zone.create', entity: 'zone', entityId: id, newValue: { name: req.body.name, kind: req.body.kind, price: req.body.price } }, trx);
  });
  res.status(201).json(await getZone(id));
}));

router.put('/:id', requirePermission('zones.manage'), validate(zoneSchema), ah(async (req, res) => {
  const before = await getZone(req.params.id);
  if (!before) throw notFound();
  await db.transaction(async (trx) => {
    await trx('delivery_zones').where({ id: before.id }).update({ ...toRow(req.body), updated_at: now() });
    if (before.price !== req.body.price) await setRate(trx, before.id, req.body.price, req.user.id);
    await audit(req, {
      action: before.price !== req.body.price ? 'zone.update_price' : 'zone.update',
      entity: 'zone', entityId: before.id,
      oldValue: { name: before.name, price: before.price, active: before.active, geometry_type: before.geometry_type },
      newValue: { name: req.body.name, price: req.body.price, active: req.body.active ?? true, geometry_type: req.body.geometry_type },
    }, trx);
  });
  res.json(await getZone(before.id));
}));

router.patch('/:id/price', requirePermission('zones.manage'), validate(z.object({ price: z.number().min(0).max(1_000_000) })), ah(async (req, res) => {
  const before = await getZone(req.params.id);
  if (!before) throw notFound();
  await db.transaction(async (trx) => {
    await setRate(trx, before.id, req.body.price, req.user.id);
    await trx('delivery_zones').where({ id: before.id }).update({ updated_at: now() });
    await audit(req, { action: 'zone.update_price', entity: 'zone', entityId: before.id, oldValue: { price: before.price }, newValue: { price: req.body.price } }, trx);
  });
  res.json(await getZone(before.id));
}));

router.patch('/:id/active', requirePermission('zones.manage'), validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  const before = await getZone(req.params.id);
  if (!before) throw notFound();
  await db('delivery_zones').where({ id: before.id }).update({ active: req.body.active, updated_at: now() });
  await audit(req, { action: req.body.active ? 'zone.activate' : 'zone.deactivate', entity: 'zone', entityId: before.id, oldValue: { active: before.active }, newValue: { active: req.body.active } });
  res.json(await getZone(before.id));
}));

router.delete('/:id', requirePermission('zones.manage'), ah(async (req, res) => {
  const before = await getZone(req.params.id);
  if (!before) throw notFound();
  await db('delivery_zones').where({ id: before.id }).del();
  await audit(req, { action: 'zone.delete', entity: 'zone', entityId: before.id, oldValue: before });
  res.json({ ok: true });
}));

module.exports = { router, quote };
