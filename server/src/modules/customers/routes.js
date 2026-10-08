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

const router = express.Router();

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(40),
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
  if (req.query.with_addresses === 'true' && customers.length) {
    const addrs = await db('customer_addresses').whereIn('customer_id', customers.map((c) => c.id));
    for (const c of customers) c.addresses = addrs.filter((a) => a.customer_id === c.id).map(mapAddress);
  }
  res.json(customers);
}));

router.get('/:id', requirePermission('customers.manage'), ah(async (req, res) => {
  const c = await db('customers').where({ id: req.params.id }).first();
  if (!c) throw notFound();
  res.json({ ...mapCustomer(c), addresses: await addressesOf(c.id), orders: await listOrders({ limit: 50 }, { customerId: c.id }) });
}));

router.post('/', requirePermission('customers.manage'), validate(customerSchema.extend({ address: addressSchema.optional() })), ah(async (req, res) => {
  const { address, ...b } = req.body;
  if (await db('customers').where({ phone: b.phone }).first()) throw conflict('Ya existe un cliente con ese teléfono.');
  const ts = now();
  const c = { id: uuid(), ...b, email: b.email || null, whatsapp: b.whatsapp || b.phone, active: true, created_at: ts, updated_at: ts };
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

/**
 * Vincula el historial de un cliente (pedidos y direcciones) a la cuenta de un cliente registrado.
 * Lo hace el personal después de verificar la identidad del cliente.
 */
router.post('/:id/link-account', requirePermission('customers.manage'), validate(z.object({ email: z.string().trim().toLowerCase().email() })), ah(async (req, res) => {
  const source = await db('customers').where({ id: req.params.id }).first();
  if (!source) throw notFound();
  const user = await db('users').where({ email: req.body.email, role_id: 'customer' }).first();
  if (!user) throw notFound('No existe una cuenta de cliente con ese correo.');
  const target = await db('customers').where({ user_id: user.id }).first();
  if (!target) throw notFound('La cuenta no tiene perfil de cliente.');
  if (target.id === source.id) return res.json(mapCustomer(target));
  await db.transaction(async (trx) => {
    const ts = now();
    await trx('orders').where({ customer_id: source.id }).update({ customer_id: target.id, updated_at: ts });
    await trx('customer_addresses').where({ customer_id: source.id }).update({ customer_id: target.id, is_default: false, updated_at: ts });
    await trx('customers').where({ id: source.id }).update({ active: false, notes: `Vinculado a la cuenta ${user.email}`, updated_at: ts });
    await audit(req, { action: 'customer.link_account', entity: 'customer', entityId: target.id, oldValue: { customer_id: source.id }, newValue: { customer_id: target.id, email: user.email } }, trx);
  });
  res.json(mapCustomer(await db('customers').where({ id: target.id }).first()));
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
