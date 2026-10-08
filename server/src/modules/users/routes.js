'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db, bool, json, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound, conflict, badRequest } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission, clearRoleCache } = require('../../middleware/auth');
const { audit } = require('../audit/service');

const router = express.Router();
router.use(requirePermission('users.manage'));

const ROLE_IDS = ['admin', 'dispatcher', 'courier', 'customer'];

function mapUser(u) {
  return {
    id: u.id, role: u.role_id, role_name: u.role_name, name: u.name, email: u.email, phone: u.phone,
    active: bool(u.active), last_login_at: u.last_login_at, created_at: u.created_at, updated_at: u.updated_at,
    courier_id: u.courier_id || null, vehicle: u.vehicle || null, plate: u.plate || null, customer_id: u.customer_id || null,
  };
}

function usersQuery() {
  return db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .leftJoin('couriers as c', 'c.user_id', 'u.id')
    .leftJoin('customers as cu', 'cu.user_id', 'u.id')
    .select('u.*', 'r.name as role_name', 'c.id as courier_id', 'c.vehicle', 'c.plate', 'cu.id as customer_id');
}

router.get('/roles', ah(async (_req, res) => {
  const roles = await db('roles').orderBy('id');
  res.json(roles.map((r) => ({ id: r.id, name: r.name, permissions: json(r.permissions, []) })));
}));

router.put('/roles/:id', validate(z.object({ permissions: z.array(z.string().max(60)).max(50) })), ah(async (req, res) => {
  const role = await db('roles').where({ id: req.params.id }).first();
  if (!role) throw notFound();
  if (role.id === 'admin') throw badRequest('Los permisos del administrador no se pueden reducir.');
  await db('roles').where({ id: role.id }).update({ permissions: JSON.stringify(req.body.permissions), updated_at: now() });
  clearRoleCache();
  await audit(req, { action: 'role.update', entity: 'role', entityId: role.id, oldValue: json(role.permissions), newValue: req.body.permissions });
  res.json({ ok: true });
}));

router.get('/', ah(async (req, res) => {
  const q = usersQuery().orderBy('u.name');
  if (req.query.role) q.where('u.role_id', String(req.query.role));
  if (req.query.q) {
    const like = `%${String(req.query.q).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(u.name) like ?', [like]).orWhereRaw('lower(u.email) like ?', [like]));
  }
  res.json((await q).map(mapUser));
}));

const userSchema = z.object({
  role: z.enum(ROLE_IDS),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z.string().min(8).max(100),
  vehicle: z.string().trim().max(80).optional().nullable(),
  plate: z.string().trim().max(20).optional().nullable(),
});

router.post('/', validate(userSchema), ah(async (req, res) => {
  const b = req.body;
  if (await db('users').where({ email: b.email }).first()) throw conflict('Ya existe un usuario con ese correo.');
  const ts = now();
  const user = { id: uuid(), role_id: b.role, name: b.name, email: b.email, phone: b.phone || null, password_hash: await bcrypt.hash(b.password, 12), active: true, token_version: 0, created_at: ts, updated_at: ts };
  await db.transaction(async (trx) => {
    await trx('users').insert(user);
    if (b.role === 'courier') {
      const branch = await trx('branches').where({ active: true }).orderBy('created_at').first('id');
      await trx('couriers').insert({ id: uuid(), user_id: user.id, branch_id: branch?.id || null, vehicle: b.vehicle || null, plate: b.plate || null, status: 'off_duty', shift_active: false, sharing_location: false, created_at: ts, updated_at: ts });
    }
    if (b.role === 'customer') {
      await trx('customers').insert({ id: uuid(), user_id: user.id, name: b.name, phone: b.phone || '', whatsapp: b.phone || null, email: b.email, active: true, created_at: ts, updated_at: ts });
    }
    await audit(req, { action: 'user.create', entity: 'user', entityId: user.id, newValue: { name: b.name, email: b.email, role: b.role } }, trx);
  });
  res.status(201).json(mapUser(await usersQuery().where('u.id', user.id).first()));
}));

router.put('/:id', validate(userSchema.partial().omit({ password: true })), ah(async (req, res) => {
  const before = await db('users').where({ id: req.params.id }).first();
  if (!before) throw notFound();
  const b = req.body;
  if (b.role && b.role !== before.role_id) throw badRequest('El rol no se puede cambiar; crea un usuario nuevo con el rol deseado.');
  if (b.email && b.email !== before.email && (await db('users').where({ email: b.email }).first())) throw conflict('Ya existe un usuario con ese correo.');
  const patch = { updated_at: now() };
  for (const k of ['name', 'email', 'phone']) if (k in b) patch[k] = b[k];
  await db.transaction(async (trx) => {
    await trx('users').where({ id: before.id }).update(patch);
    if (before.role_id === 'courier' && ('vehicle' in b || 'plate' in b)) {
      const cp = { updated_at: patch.updated_at };
      if ('vehicle' in b) cp.vehicle = b.vehicle;
      if ('plate' in b) cp.plate = b.plate;
      await trx('couriers').where({ user_id: before.id }).update(cp);
    }
    await audit(req, { action: 'user.update', entity: 'user', entityId: before.id, oldValue: { name: before.name, email: before.email, phone: before.phone }, newValue: b }, trx);
  });
  res.json(mapUser(await usersQuery().where('u.id', before.id).first()));
}));

router.post('/:id/active', validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) throw notFound();
  if (user.id === req.user.id && !req.body.active) throw badRequest('No puedes desactivar tu propia cuenta.');
  // Al desactivar se invalidan todas las sesiones abiertas (token_version).
  await db('users').where({ id: user.id }).update({ active: req.body.active, token_version: user.token_version + (req.body.active ? 0 : 1), updated_at: now() });
  if (!req.body.active && user.role_id === 'courier') {
    await db('couriers').where({ user_id: user.id }).update({ shift_active: false, sharing_location: false, status: 'off_duty', updated_at: now() });
  }
  await audit(req, { action: req.body.active ? 'user.activate' : 'user.deactivate', entity: 'user', entityId: user.id, oldValue: { active: bool(user.active) }, newValue: { active: req.body.active } });
  res.json({ ok: true });
}));

router.post('/:id/password', validate(z.object({ password: z.string().min(8).max(100) })), ah(async (req, res) => {
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) throw notFound();
  await db('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(req.body.password, 12), token_version: user.token_version + 1, updated_at: now() });
  await audit(req, { action: 'user.password_reset', entity: 'user', entityId: user.id });
  res.json({ ok: true });
}));

module.exports = router;
