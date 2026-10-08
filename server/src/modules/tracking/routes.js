'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, now } = require('../../db');
const { ah, notFound, conflict } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { audit } = require('../audit/service');
const { resolveToken } = require('./links');
const { publicView } = require('./service');
const { saveSubscription } = require('../notifications/push');
const { notify } = require('../notifications/service');
const { priceAddress, insertHistory } = require('../orders/service');
const maps = require('../maps/google');
const events = require('../orders/events');
const { rateLimitStore } = require('../../infra/redis');

const router = express.Router();
const isTest = () => process.env.NODE_ENV === 'test';

const readLimiter = rateLimit({ store: rateLimitStore('track-read'), windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, skip: isTest, message: { error: 'Demasiadas solicitudes. Intenta en un momento.' } });
const writeLimiter = rateLimit({ store: rateLimitStore('track-write'), windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, skip: isTest, message: { error: 'Demasiadas solicitudes. Intenta en un momento.' } });

async function load(req) {
  const found = await resolveToken(req.params.token, { touch: req.method === 'GET' });
  // Mismo mensaje para token inexistente, revocado o vencido.
  if (!found) throw notFound('Este enlace de seguimiento no es válido o ha vencido.');
  return found;
}

const customerCtx = (req, order) => ({ actorName: `Cliente ${order.customer_name} (enlace)`, ip: req.ip, userAgent: req.get('user-agent') });

router.get('/:token', readLimiter, ah(async (req, res) => {
  const { order } = await load(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await publicView(order));
}));

/** El cliente comparte su ubicación (GPS) o corrige el pin en el mapa. */
router.post('/:token/location', writeLimiter, validate(z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).nullable().optional(),
  source: z.enum(['gps', 'pin', 'search']).default('pin'),
  reference: z.string().trim().max(400).optional(),
})), ah(async (req, res) => {
  const { order } = await load(req);
  if (!['new', 'preparing', 'ready', 'assigned', 'rescheduled', 'en_route'].includes(order.status)) {
    throw conflict('La ubicación ya no se puede modificar para este pedido.');
  }
  const b = req.body;
  let components = [];
  let formatted = null;
  try {
    const rev = await maps.reverseGeocode(b.lat, b.lng);
    if (rev) {
      components = rev.components;
      formatted = rev.formatted_address;
    }
  } catch {
    /* la geocodificación inversa es opcional */
  }
  const { geo, quote } = await priceAddress({ lat: b.lat, lng: b.lng, components });
  const patch = {
    lat: b.lat,
    lng: b.lng,
    province_id: geo.province_id,
    municipality_id: geo.municipality_id,
    sector_id: geo.sector_id,
    location_confirmed: true,
    updated_at: now(),
  };
  if (b.reference) patch.reference = b.reference;
  const zoneChanged = (quote.zone?.id || null) !== (order.zone_id || null);
  await db.transaction(async (trx) => {
    await trx('orders').where({ id: order.id }).update(patch);
    await insertHistory(trx, { orderId: order.id, from: order.status, to: order.status, role: 'customer', note: `Cliente ${b.source === 'gps' ? 'compartió su ubicación' : 'corrigió la ubicación en el mapa'}${formatted ? `: ${formatted}` : ''}`, lat: b.lat, lng: b.lng });
    await audit(customerCtx(req, order), {
      action: 'order.customer_location', entity: 'order', entityId: order.id, orderId: order.id,
      oldValue: { lat: order.lat, lng: order.lng, zone_id: order.zone_id }, newValue: { lat: b.lat, lng: b.lng, source: b.source, detected_zone: quote.zone?.name || null },
    }, trx);
  });
  if (zoneChanged) {
    // El precio no se cambia automáticamente: se avisa al personal para que lo revise.
    notify({
      audience: 'admin', orderId: order.id,
      title: `Pedido #${order.order_number}: ubicación en otra zona`,
      body: `El cliente ajustó su ubicación. Zona detectada: ${quote.zone?.name || 'fuera de cobertura'} (${quote.fee != null ? `RD$${quote.fee}` : 'sin tarifa'}). Revisa el costo de envío.`,
      url: `/admin/pedidos/${order.id}`,
    }).catch(() => {});
  }
  events.orderChanged(order.id, { type: 'updated' });
  const fresh = await db('orders').where({ id: order.id }).first();
  res.json(await publicView(fresh));
}));

router.post('/:token/confirm', writeLimiter, ah(async (req, res) => {
  const { order } = await load(req);
  await db('orders').where({ id: order.id }).update({ location_confirmed: true, updated_at: now() });
  await audit(customerCtx(req, order), { action: 'order.customer_confirm_location', entity: 'order', entityId: order.id, orderId: order.id });
  events.orderChanged(order.id, { type: 'updated' });
  res.json(await publicView(await db('orders').where({ id: order.id }).first()));
}));

router.post('/:token/reference', writeLimiter, validate(z.object({ reference: z.string().trim().min(2).max(400) })), ah(async (req, res) => {
  const { order } = await load(req);
  if (['delivered', 'cancelled'].includes(order.status)) throw conflict('El pedido ya fue cerrado.');
  await db('orders').where({ id: order.id }).update({ reference: req.body.reference, updated_at: now() });
  await audit(customerCtx(req, order), { action: 'order.customer_reference', entity: 'order', entityId: order.id, orderId: order.id, oldValue: { reference: order.reference }, newValue: { reference: req.body.reference } });
  events.orderChanged(order.id, { type: 'updated' });
  res.json(await publicView(await db('orders').where({ id: order.id }).first()));
}));

router.post('/:token/push', writeLimiter, validate(z.object({
  subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
})), ah(async (req, res) => {
  const { link } = await load(req);
  await saveSubscription({ subscription: req.body.subscription, trackingLinkId: link.id, userAgent: req.get('user-agent') });
  res.json({ ok: true });
}));

module.exports = router;
