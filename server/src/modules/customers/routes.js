'use strict';
const express = require('express');
const { z } = require('zod');
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound, conflict } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { resolveAdministrative } = require('../geo/resolver');
const { listOrders } = require('../orders/service');
const { toCsv } = require('../../utils/csv');

const router = express.Router();

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  // Opcional: si se escribe, debe tener al menos 7 dígitos.
  phone: z.string().trim().max(40).nullable().optional()
    .transform((v) => v || null)
    .refine((v) => !v || v.replace(/\D/g, '').length >= 7, 'teléfono no válido'),
  whatsapp: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal('')),
  notes: z.string().max(2000).nullable().optional(),
});

const addressSchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  formatted_address: z.string().trim().min(3).max(400),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  place_id: z.string().max(300).nullable().optional(),
  reference: z.string().max(400).nullable().optional(),
  province_id: z.string().uuid().nullable().optional(),
  municipality_id: z.string().uuid().nullable().optional(),
  sector_id: z.string().uuid().nullable().optional(),
  components: z.array(z.any()).optional(),
  is_default: z.boolean().optional(),
});

function mapCustomer(c) {
  return { ...c, active: bool(c.active), has_account: !!c.user_id };
}

function mapAddress(a) {
  return { ...a, is_default: bool(a.is_default) };
}

async function addressesOf(customerId) {
  return (
    await db('customer_addresses as a')
      .leftJoin('provinces as p', 'p.id', 'a.province_id')
      .leftJoin('municipalities as m', 'm.id', 'a.municipality_id')
      .leftJoin('sectors as s', 's.id', 'a.sector_id')
      .where('a.customer_id', customerId)
      .orderBy([{ column: 'a.is_default', order: 'desc' }, { column: 'a.created_at', order: 'asc' }])
      .select('a.*', 'p.name as province_name', 'm.name as municipality_name', 's.name as sector_name')
  ).map(mapAddress);
}

/** Inserta o actualiza una dirección resolviendo provincia/municipio/sector en el servidor. */
async function saveAddress(customerId, body, addressId = null) {
  const geo = await resolveAdministrative({ lat: body.lat, lng: body.lng, components: body.components || [] });
  const ts = now();
  const row = {
    label: body.label || null,
    formatted_address: body.formatted_address,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    place_id: body.place_id || null,
    reference: body.reference || null,
    province_id: body.province_id || geo.province_id,
    municipality_id: body.municipality_id || geo.municipality_id,
    sector_id: body.sector_id || geo.sector_id,
    updated_at: ts,
  };
  await db.transaction(async (trx) => {
    const hasAny = await trx('customer_addresses').where({ customer_id: customerId }).first();
    const makeDefault = body.is_default || !hasAny;
    if (makeDefault) await trx('customer_addresses').where({ customer_id: customerId }).update({ is_default: false });
    if (addressId) await trx('customer_addresses').where({ id: addressId, customer_id: customerId }).update({ ...row, ...(makeDefault ? { is_default: true } : {}) });
    else {
      addressId = uuid();
      await trx('customer_addresses').insert({ id: addressId, customer_id: customerId, ...row, is_default: !!makeDefault, created_at: ts });
    }
  });
  return addressId;
}

router.get('/', requirePermission('customers.manage'), ah(async (req, res) => {
  const q = db('customers').orderBy('name').limit(Math.min(Number(req.query.limit) || 300, 1000));
  if (req.query.q) {
    const like = `%${String(req.query.q).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(name) like ?', [like]).orWhere('phone', 'like', like).orWhereRaw('lower(email) like ?', [like]));
  }
  const customers = (await q).map(mapCustomer);
  // Resumen de compras: cantidad de pedidos, último pedido y total entregado.
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    const stats = await db('orders').whereIn('customer_id', ids).groupBy('customer_id')
      .select('customer_id')
      .count('id as orders_count')
      .max('created_at as last_order_at')
      .select(db.raw("sum(case when status = 'delivered' then total else 0 end) as total_spent"));
    const byId = Object.fromEntries(stats.map((r) => [r.customer_id, r]));
    const defaults = await db('customer_addresses as a')
      .leftJoin('sectors as s', 's.id', 'a.sector_id')
      .leftJoin('municipalities as m', 'm.id', 'a.municipality_id')
      .whereIn('a.customer_id', ids)
      .orderBy('a.is_default', 'desc')
      .select('a.customer_id', 's.name as sector_name', 'm.name as municipality_name');
    for (const c of customers) {
      const st = byId[c.id];
      const addr = defaults.find((d) => d.customer_id === c.id);
      c.orders_count = Number(st?.orders_count || 0);
      c.last_order_at = st?.last_order_at || null;
      c.total_spent = Number(st?.total_spent || 0);
      c.sector_name = addr?.sector_name || null;
      c.municipality_name = addr?.municipality_name || null;
    }
  }
  if (req.query.with_addresses === 'true' && customers.length) {
    const addrs = await db('customer_addresses').whereIn('customer_id', customers.map((c) => c.id));
    for (const c of customers) c.addresses = addrs.filter((a) => a.customer_id === c.id).map(mapAddress);
  }
  res.json(customers);
}));

/** Descargar la base de clientes (CSV para Excel o JSON), con su dirección principal y resumen de compras. */
router.get('/export', requirePermission('customers.manage'), ah(async (req, res) => {
  const customers = await db('customers').orderBy('name');
  const stats = await db('orders').whereNotNull('customer_id').groupBy('customer_id')
    .select('customer_id')
    .count('id as orders_count')
    .max('created_at as last_order_at')
    .select(db.raw("sum(case when status = 'delivered' then total else 0 end) as total_spent"));
  const byId = Object.fromEntries(stats.map((r) => [r.customer_id, r]));
  const addresses = await db('customer_addresses as a')
    .leftJoin('sectors as s', 's.id', 'a.sector_id')
    .leftJoin('municipalities as m', 'm.id', 'a.municipality_id')
    .leftJoin('provinces as p', 'p.id', 'a.province_id')
    .orderBy('a.is_default', 'desc')
    .orderBy('a.created_at')
    .select('a.customer_id', 'a.formatted_address', 'a.reference', 'a.lat', 'a.lng', 's.name as sector', 'm.name as municipio', 'p.name as provincia');
  const firstAddress = {};
  const addressCount = {};
  for (const a of addresses) {
    firstAddress[a.customer_id] ||= a;
    addressCount[a.customer_id] = (addressCount[a.customer_id] || 0) + 1;
  }
  const date = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const rows = customers.map((c) => {
    const a = firstAddress[c.id] || {};
    const st = byId[c.id] || {};
    return {
      nombre: c.name,
      telefono: c.phone || '',
      whatsapp: c.whatsapp || '',
      correo: c.email || '',
      direccion: a.formatted_address || '',
      referencia: a.reference || '',
      sector: a.sector || '',
      municipio: a.municipio || '',
      provincia: a.provincia || '',
      latitud: a.lat ?? '',
      longitud: a.lng ?? '',
      direcciones_guardadas: addressCount[c.id] || 0,
      pedidos: Number(st.orders_count || 0),
      total_comprado: Number(st.total_spent || 0),
      ultimo_pedido: date(st.last_order_at),
      estado: bool(c.active) ? 'Activo' : 'Inactivo',
      notas: c.notes || '',
      registrado: date(c.created_at),
    };
  });
  await audit(req, { action: 'customer.export', entity: 'customer', newValue: { format: req.query.format === 'json' ? 'json' : 'csv', count: rows.length } });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="clientes-${stamp}.json"`);
    return res.json(rows);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="clientes-${stamp}.csv"`);
  res.send(toCsv(Object.keys(rows[0] || { nombre: '' }), rows));
}));

router.get('/:id', requirePermission('customers.manage'), ah(async (req, res) => {
  const c = await db('customers').where({ id: req.params.id }).first();
  if (!c) throw notFound();
  res.json({ ...mapCustomer(c), addresses: await addressesOf(c.id), orders: await listOrders({ limit: 50 }, { customerId: c.id }) });
}));

router.post('/', requirePermission('customers.manage'), validate(customerSchema.extend({ address: addressSchema.optional() })), ah(async (req, res) => {
  const { address, ...b } = req.body;
  if (b.phone && (await db('customers').where({ phone: b.phone }).first())) throw conflict('Ya existe un cliente con ese teléfono.');
  const ts = now();
  const c = { id: uuid(), ...b, email: b.email || null, whatsapp: b.whatsapp || b.phone || null, active: true, created_at: ts, updated_at: ts };
  await db('customers').insert(c);
  if (address) await saveAddress(c.id, address);
  await audit(req, { action: 'customer.create', entity: 'customer', entityId: c.id, newValue: b });
  res.status(201).json({ ...mapCustomer(c), addresses: await addressesOf(c.id) });
}));

router.put('/:id', requirePermission('customers.manage'), validate(customerSchema.partial()), ah(async (req, res) => {
  const before = await db('customers').where({ id: req.params.id }).first();
  if (!before) throw notFound();
  await db('customers').where({ id: before.id }).update({ ...req.body, updated_at: now() });
  await audit(req, { action: 'customer.update', entity: 'customer', entityId: before.id, oldValue: before, newValue: req.body });
  res.json(mapCustomer(await db('customers').where({ id: before.id }).first()));
}));

router.patch('/:id/active', requirePermission('customers.manage'), validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  const before = await db('customers').where({ id: req.params.id }).first();
  if (!before) throw notFound();
  await db('customers').where({ id: before.id }).update({ active: req.body.active, updated_at: now() });
  await audit(req, { action: req.body.active ? 'customer.activate' : 'customer.deactivate', entity: 'customer', entityId: before.id });
  res.json({ ok: true });
}));

router.post('/:id/addresses', requirePermission('customers.manage'), validate(addressSchema), ah(async (req, res) => {
  const c = await db('customers').where({ id: req.params.id }).first();
  if (!c) throw notFound();
  const id = await saveAddress(c.id, req.body);
  await audit(req, { action: 'address.create', entity: 'customer_address', entityId: id, newValue: req.body.formatted_address });
  res.status(201).json(await addressesOf(c.id));
}));

router.put('/:id/addresses/:addressId', requirePermission('customers.manage'), validate(addressSchema), ah(async (req, res) => {
  const a = await db('customer_addresses').where({ id: req.params.addressId, customer_id: req.params.id }).first();
  if (!a) throw notFound();
  await saveAddress(req.params.id, req.body, a.id);
  await audit(req, { action: 'address.update', entity: 'customer_address', entityId: a.id, oldValue: a.formatted_address, newValue: req.body.formatted_address });
  res.json(await addressesOf(req.params.id));
}));

router.delete('/:id/addresses/:addressId', requirePermission('customers.manage'), ah(async (req, res) => {
  const a = await db('customer_addresses').where({ id: req.params.addressId, customer_id: req.params.id }).first();
  if (!a) throw notFound();
  await db('customer_addresses').where({ id: a.id }).del();
  await audit(req, { action: 'address.delete', entity: 'customer_address', entityId: a.id, oldValue: a.formatted_address });
  res.json(await addressesOf(req.params.id));
}));

module.exports = { router, addressSchema, saveAddress, addressesOf, mapCustomer, customerSchema };
