'use strict';
const express = require('express');
const { sendInvoice } = require('./invoice');
const { z } = require('zod');
const { db } = require('../../db');
const { ah, notFound, conflict } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { createLink, revokeLinks, FINAL_STATUSES } = require('../tracking/links');
const { buildShare } = require('../tracking/share');
const { STATUSES } = require('./statuses');
const svc = require('./service');
const events = require('./events');

const router = express.Router();

const money = z.number().min(0).max(10_000_000);
const addressInput = z.object({
  formatted_address: z.string().trim().min(3).max(400),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  place_id: z.string().max(300).nullable().optional(),
  reference: z.string().max(400).nullable().optional(),
  label: z.string().max(80).nullable().optional(),
  province_id: z.string().uuid().nullable().optional(),
  municipality_id: z.string().uuid().nullable().optional(),
  sector_id: z.string().uuid().nullable().optional(),
  components: z.array(z.any()).max(30).optional(),
});

const createSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    customer: z.object({
      name: z.string().trim().min(2).max(160),
      // Opcional: si se escribe, debe tener al menos 7 dígitos.
      phone: z.string().trim().max(40).nullable().optional()
        .transform((v) => v || null)
        .refine((v) => !v || v.replace(/\D/g, '').length >= 7, 'teléfono no válido'),
      whatsapp: z.string().trim().max(40).nullable().optional(),
      email: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal('')),
    }).optional(),
    address_id: z.string().uuid().nullable().optional(),
    address: addressInput,
    save_address: z.boolean().optional(),
    subtotal: money.optional(),
    delivery_fee: money.nullable().optional(),
    payment_method: z.enum(['cash', 'card', 'transfer', 'paid_online']).optional(),
    payment_status: z.enum(['pending', 'paid', 'refunded']).optional(),
    status: z.enum(['new', 'preparing', 'ready']).optional(),
    priority: z.number().int().min(0).max(10).optional(),
    notes: z.string().max(2000).nullable().optional(),
    scheduled_for: z.string().datetime({ offset: true }).nullable().optional(),
    courier_id: z.string().uuid().nullable().optional(),
    location_confirmed: z.boolean().optional(),
    branch_id: z.string().uuid().nullable().optional(),
    items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(100000) })).max(100).optional(),
  })
  .refine((v) => v.customer_id || v.customer, { message: 'selecciona o registra un cliente', path: ['customer'] });

const updateSchema = z.object({
  customer_name: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().min(7).max(40).optional(),
  address: addressInput.optional(),
  reference: z.string().max(400).nullable().optional(),
  subtotal: money.optional(),
  delivery_fee: money.nullable().optional(),
  payment_method: z.enum(['cash', 'card', 'transfer', 'paid_online']).optional(),
  payment_status: z.enum(['pending', 'paid', 'refunded']).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  route_order: z.number().int().min(0).max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  scheduled_for: z.string().datetime({ offset: true }).nullable().optional(),
});

router.get('/', requirePermission('orders.view'), ah(async (req, res) => {
  res.json(await svc.listOrders(req.query));
}));

router.post('/', requirePermission('orders.manage'), validate(createSchema), ah(async (req, res) => {
  res.status(201).json(await svc.createOrder(req.body, req));
}));

router.get('/:id', requirePermission('orders.view'), ah(async (req, res) => {
  res.json(await svc.getOrderDetail(req.params.id));
}));

router.get('/:id/invoice', requirePermission('orders.view'), ah(async (req, res) => {
  const order = await svc.getOrder(req.params.id);
  if (!order) throw notFound();
  await sendInvoice(req, res, order);
}));

router.put('/:id', requirePermission('orders.manage'), validate(updateSchema), ah(async (req, res) => {
  res.json(await svc.updateOrder(req.params.id, req.body, req));
}));

router.post('/:id/assign', requirePermission('orders.assign'), validate(z.object({ courier_id: z.string().uuid().nullable(), reason: z.string().max(300).optional() })), ah(async (req, res) => {
  res.json(await svc.assignCourier(req.params.id, req.body.courier_id, req, req.body.reason));
}));

/** Reordena la ruta de un mensajero (orden definido por el administrador). */
router.post('/route-order', requirePermission('orders.assign'), validate(z.object({ order_ids: z.array(z.string().uuid()).min(1).max(200) })), ah(async (req, res) => {
  await db.transaction(async (trx) => {
    for (const [i, id] of req.body.order_ids.entries()) await trx('orders').where({ id }).update({ route_order: i + 1 });
  });
  await audit(req, { action: 'order.route_order', entity: 'order', newValue: req.body.order_ids });
  for (const id of req.body.order_ids) events.orderChanged(id, { type: 'updated' });
  res.json({ ok: true });
}));

router.post('/:id/status', requirePermission('orders.manage'), validate(z.object({
  status: z.enum(STATUSES),
  note: z.string().max(500).optional(),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
})), ah(async (req, res) => {
  res.json(await svc.changeStatus(req.params.id, req.body.status, req, { note: req.body.note, scheduled_for: req.body.scheduled_for }));
}));

/** Datos para compartir el enlace de seguimiento por WhatsApp, SMS, correo o copiar. */
router.get('/:id/share', requirePermission('orders.view'), ah(async (req, res) => {
  const order = await svc.getOrder(req.params.id);
  if (!order) throw notFound();
  res.json(await buildShare(order, req.user.id));
}));

router.post('/:id/tracking-link', requirePermission('orders.manage'), ah(async (req, res) => {
  const order = await svc.getOrder(req.params.id);
  if (!order) throw notFound();
  if (FINAL_STATUSES.includes(order.status)) throw conflict('El pedido está cerrado: no se puede generar un enlace de seguimiento.');
  const link = await db.transaction(async (trx) => {
    await revokeLinks(trx, order.id);
    const l = await createLink(trx, order.id, req.user.id);
    await audit(req, { action: 'tracking_link.regenerate', entity: 'order', entityId: order.id, orderId: order.id }, trx);
    return l;
  });
  res.status(201).json(link);
}));

router.delete('/:id/tracking-link', requirePermission('orders.manage'), ah(async (req, res) => {
  const order = await svc.getOrder(req.params.id);
  if (!order) throw notFound();
  await db.transaction(async (trx) => {
    await revokeLinks(trx, order.id);
    await audit(req, { action: 'tracking_link.revoke', entity: 'order', entityId: order.id, orderId: order.id }, trx);
  });
  res.json({ ok: true });
}));

router.get('/:id/locations', requirePermission('tracking.view'), ah(async (req, res) => {
  const rows = await db('courier_locations').where({ order_id: req.params.id }).orderBy('recorded_at').select('lat', 'lng', 'recorded_at').limit(2000);
  res.json(rows);
}));

module.exports = router;
