'use strict';
const express = require('express');
const { z } = require('zod');
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission, requireStaff } = require('../../middleware/auth');
const { audit, diff } = require('../audit/service');
const { getSettings, updateSettings, DEFAULTS } = require('./service');
const { availableChannels } = require('../notifications/channels');
const maps = require('../maps/google');
const { STATUSES } = require('../orders/statuses');

const router = express.Router();

const schema = z.object({
  company_name: z.string().trim().min(2).max(120),
  company_logo_url: z.string().trim().max(500).refine((v) => v === '' || /^https:\/\/|^\//.test(v), 'debe ser una URL https'),
  company_phone: z.string().trim().max(40),
  company_whatsapp: z.string().trim().max(40),
  company_email: z.string().trim().max(190),
  currency_symbol: z.string().trim().min(1).max(6),
  business_hours: z.string().trim().max(200),
  min_delivery_fee: z.number().min(0).max(1_000_000),
  default_fee_enabled: z.boolean(),
  default_fee: z.number().min(0).max(1_000_000),
  max_distance_km: z.number().min(0).max(1000),
  zone_priority: z.array(z.enum(['custom', 'sector', 'municipality', 'province'])).length(4),
  location_update_seconds: z.number().int().min(5).max(600),
  location_retention_days: z.number().int().min(1).max(365),
  courier_tracking_enabled: z.boolean(),
  customer_can_see_courier: z.boolean(),
  customer_can_see_courier_location: z.boolean(),
  customer_can_contact_courier: z.boolean(),
  arriving_radius_m: z.number().int().min(50).max(5000),
  average_speed_kmh: z.number().min(5).max(120),
  proof_required: z.boolean(),
  proof_signature_enabled: z.boolean(),
  proof_photo_enabled: z.boolean(),
  push_notifications_enabled: z.boolean(),
  notify_customer_statuses: z.array(z.enum(STATUSES)),
  tracking_link_expiry_hours: z.number().int().min(0).max(24 * 365),
  tracking_link_expire_after_delivery_hours: z.number().int().min(0).max(24 * 365),
  tracking_share_message: z.string().max(1000).refine((v) => v.includes('{enlace}'), 'debe incluir {enlace}'),
  allow_customer_signup: z.boolean(),
}).partial();

router.get('/', requireStaff, ah(async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULTS, channels: availableChannels(), google_server_enabled: maps.enabled() });
}));

router.put('/', requirePermission('settings.manage'), validate(schema), ah(async (req, res) => {
  const before = await getSettings();
  const updated = await updateSettings(req.body);
  const { oldValue, newValue, changed } = diff(before, req.body);
  if (changed) await audit(req, { action: 'settings.update', entity: 'settings', oldValue, newValue });
  res.json({ settings: updated });
}));

/** Sucursales (preparado para múltiples sucursales/almacenes). */
const branchSchema = z.object({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(300).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

router.get('/branches', requireStaff, ah(async (_req, res) => {
  res.json((await db('branches').orderBy('name')).map((b) => ({ ...b, active: bool(b.active) })));
}));

router.post('/branches', requirePermission('settings.manage'), validate(branchSchema), ah(async (req, res) => {
  const ts = now();
  const row = { id: uuid(), ...req.body, active: req.body.active ?? true, created_at: ts, updated_at: ts };
  await db('branches').insert(row);
  await audit(req, { action: 'branch.create', entity: 'branch', entityId: row.id, newValue: req.body });
  res.status(201).json(row);
}));

router.put('/branches/:id', requirePermission('settings.manage'), validate(branchSchema.partial()), ah(async (req, res) => {
  const before = await db('branches').where({ id: req.params.id }).first();
  if (!before) throw notFound();
  await db('branches').where({ id: before.id }).update({ ...req.body, updated_at: now() });
  await audit(req, { action: 'branch.update', entity: 'branch', entityId: before.id, oldValue: before, newValue: req.body });
  res.json(await db('branches').where({ id: before.id }).first());
}));

module.exports = router;
