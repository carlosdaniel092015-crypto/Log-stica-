'use strict';
const express = require('express');
const { sendInvoice } = require('../orders/invoice');
const { z } = require('zod');
const { db } = require('../../db');
const { ah, notFound, forbidden } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission, requireRole } = require('../../middleware/auth');
const { getSettings } = require('../settings/service');
const svc = require('./service');
const orders = require('../orders/service');
const { STATUSES } = require('../orders/statuses');
const { buildShare } = require('../tracking/share');
const inventory = require('../inventory/service');

/** Rutas para el personal: listado y detalle de mensajeros. */
const staff = express.Router();

staff.get('/', requirePermission('tracking.view'), ah(async (req, res) => {
  res.json(await svc.listCouriers({ activeOnly: req.query.active === 'true', onShift: req.query.on_shift === 'true' }));
}));

staff.get('/:id', requirePermission('tracking.view'), ah(async (req, res) => {
  const courier = await svc.getCourier(req.params.id);
  if (!courier) throw notFound();
  const assigned = await orders.listOrders({ status: 'assigned,en_route,arriving,arrived' }, { courierId: courier.id });
  res.json({ ...courier, orders: assigned });
}));

staff.get('/:id/trail', requirePermission('tracking.view'), ah(async (req, res) => {
  const since = new Date(Date.now() - (Number(req.query.hours) || 4) * 3600_000).toISOString();
  res.json(await db('courier_locations').where({ courier_id: req.params.id }).where('recorded_at', '>=', since).orderBy('recorded_at').select('lat', 'lng', 'recorded_at').limit(3000));
}));

/** Rutas del propio mensajero (/api/courier). Solo ve pedidos asignados a él. */
const self = express.Router();
self.use(requireRole('courier'));
self.use((req, _res, next) => (req.user.courierId ? next() : next(forbidden('Tu usuario no tiene perfil de mensajero.'))));

self.get('/me', ah(async (req, res) => {
  const settings = await getSettings();
  res.json({
    courier: await svc.getCourier(req.user.courierId),
    settings: {
      location_update_seconds: settings.location_update_seconds,
      courier_tracking_enabled: settings.courier_tracking_enabled,
      proof_required: settings.proof_required,
      proof_photo_enabled: settings.proof_photo_enabled,
      proof_signature_enabled: settings.proof_signature_enabled,
      currency_symbol: settings.currency_symbol,
      company_phone: settings.company_phone,
    },
  });
}));

self.post('/shift/start', validate(z.object({ sharing_location: z.boolean() })), ah(async (req, res) => {
  res.json(await svc.startShift(req.user.courierId, req.body, req));
}));
self.post('/shift/end', ah(async (req, res) => {
  res.json(await svc.endShift(req.user.courierId, req));
}));
self.post('/sharing', validate(z.object({ sharing: z.boolean() })), ah(async (req, res) => {
  res.json(await svc.setSharing(req.user.courierId, req.body.sharing, req));
}));
self.post('/pause', validate(z.object({ paused: z.boolean() })), ah(async (req, res) => {
  res.json(await svc.setPaused(req.user.courierId, req.body.paused, req));
}));

self.post('/location', validate(z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).nullable().optional(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
})), ah(async (req, res) => {
  res.json(await svc.recordLocation(req.user.courierId, req.body));
}));

self.get('/orders', ah(async (req, res) => {
  const scope = req.query.scope === 'history' ? 'delivered,failed,customer_unavailable,rescheduled,cancelled' : 'assigned,en_route,arriving,arrived,failed,customer_unavailable';
  let list = await orders.listOrders({ status: scope, limit: req.query.scope === 'history' ? 50 : 200 }, { courierId: req.user.courierId });
  if (req.query.scope !== 'history') {
    // Los intentos fallidos se pueden reintentar durante 24 h; luego los gestiona la oficina.
    const cutoff = Date.now() - 24 * 3600_000;
    list = list.filter((o) => !['failed', 'customer_unavailable'].includes(o.status) || new Date(o.updated_at).getTime() > cutoff);
  }
  const items = await inventory.itemsForOrders(list.map((o) => o.id));
  res.json(list.map((o) => ({ ...orders.courierView(o), items: items[o.id] || [] })));
}));

self.get('/orders/:id', ah(async (req, res) => {
  const order = await orders.getOrder(req.params.id);
  if (!order || order.courier_id !== req.user.courierId) throw notFound('Pedido no encontrado.');
  res.json(orders.courierView(order));
}));

self.get('/orders/:id/invoice', ah(async (req, res) => {
  const order = await orders.getOrder(req.params.id);
  if (!order || order.courier_id !== req.user.courierId) throw notFound('Pedido no encontrado.');
  await sendInvoice(req, res, order);
}));

/** Inventario del mensajero y sus solicitudes. */
self.get('/inventory', ah(async (req, res) => {
  const [stock, requests, products] = await Promise.all([
    inventory.courierStock(req.user.courierId),
    inventory.listRequests({ courierId: req.user.courierId, limit: 50 }),
    db('products').where({ active: true }).orderBy('name').select('id', 'sku', 'name', 'unit'),
  ]);
  res.json({ stock, requests, products });
}));

/** El mensajero solicita inventario al administrador (cantidades solicitadas). */
self.post('/inventory/requests', validate(z.object({
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(100000) })).min(1).max(50),
  note: z.string().trim().max(500).optional(),
})), ah(async (req, res) => {
  const id = await inventory.createRestockRequest(req.user.courierId, req.body.items, req.body.note);
  const c = await db('couriers as c').join('users as u', 'u.id', 'c.user_id').where('c.id', req.user.courierId).first('u.name');
  require('../notifications/service').notify({ audience: 'admin', title: 'Nueva solicitud de inventario', body: `${c.name} solicita inventario.`, url: '/admin/inventario' }).catch(() => {});
  res.status(201).json({ id });
}));

/** El mensajero comparte el enlace de seguimiento de un pedido asignado a él. */
self.get('/orders/:id/share', ah(async (req, res) => {
  const order = await orders.getOrder(req.params.id);
  if (!order || order.courier_id !== req.user.courierId) throw notFound('Pedido no encontrado.');
  res.json(await buildShare(order, req.user.id));
}));

self.post('/orders/:id/status', validate(z.object({
  status: z.enum(STATUSES),
  note: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
  cash_collected: z.boolean().optional(),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
  proof: z.object({
    receiver_name: z.string().trim().max(160).optional(),
    notes: z.string().max(1000).optional(),
    photo: z.string().max(6_000_000).optional(),
    signature: z.string().max(2_000_000).optional(),
  }).optional(),
  client_ts: z.string().optional(),
})), ah(async (req, res) => {
  const detail = await orders.changeStatus(req.params.id, req.body.status, req, req.body);
  res.json(orders.courierView(detail));
}));

module.exports = { staff, self };
