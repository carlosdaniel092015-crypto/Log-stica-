'use strict';
const express = require('express');
const { z } = require('zod');
const { db, now } = require('../../db');
const { ah, notFound, forbidden } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const { listOrders, getOrderDetail } = require('../orders/service');
const { trackingPathFor } = require('../tracking/service');
const { addressSchema, saveAddress, addressesOf, mapCustomer } = require('./routes');

/** Área privada opcional del cliente con cuenta (/api/me). */
const router = express.Router();
router.use(requireRole('customer'));
router.use((req, _res, next) => (req.user.customerId ? next() : next(forbidden('Tu cuenta no tiene perfil de cliente.'))));

router.get('/profile', ah(async (req, res) => {
  res.json(mapCustomer(await db('customers').where({ id: req.user.customerId }).first()));
}));

router.put('/profile', validate(z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(40),
  whatsapp: z.string().trim().max(40).nullable().optional(),
})), ah(async (req, res) => {
  const ts = now();
  await db.transaction(async (trx) => {
    await trx('customers').where({ id: req.user.customerId }).update({ ...req.body, updated_at: ts });
    await trx('users').where({ id: req.user.id }).update({ name: req.body.name, phone: req.body.phone, updated_at: ts });
    await audit(req, { action: 'customer.self_update', entity: 'customer', entityId: req.user.customerId, newValue: req.body }, trx);
  });
  res.json(mapCustomer(await db('customers').where({ id: req.user.customerId }).first()));
}));

router.get('/orders', ah(async (req, res) => {
  const orders = await listOrders({ limit: 100 }, { customerId: req.user.customerId });
  const out = [];
  for (const o of orders) {
    out.push({
      id: o.id, order_number: o.order_number, status: o.status, status_label: o.status_label, address: o.address,
      delivery_fee: o.delivery_fee, subtotal: o.subtotal, total: o.total, payment_method: o.payment_method, payment_status: o.payment_status,
      created_at: o.created_at, delivered_at: o.delivered_at, courier_name: o.courier_name,
      tracking_path: ['delivered', 'cancelled'].includes(o.status) ? null : await trackingPathFor(o.id),
    });
  }
  res.json(out);
}));

/** Comprobante simple de un pedido propio. */
router.get('/orders/:id/receipt', ah(async (req, res) => {
  const order = await getOrderDetail(req.params.id);
  if (order.customer_id !== req.user.customerId) throw notFound();
  const proof = order.proofs.find((p) => p.outcome === 'delivered');
  res.json({
    order_number: order.order_number, created_at: order.created_at, delivered_at: order.delivered_at, address: order.address,
    subtotal: order.subtotal, delivery_fee: order.delivery_fee, total: order.total, payment_method: order.payment_method,
    payment_status: order.payment_status, status_label: order.status_label, receiver_name: proof?.receiver_name || null,
    history: order.history.filter((h) => h.from_status !== h.to_status).map((h) => ({ label: h.to_label, at: h.created_at })),
  });
}));

router.get('/addresses', ah(async (req, res) => res.json(await addressesOf(req.user.customerId))));

router.post('/addresses', validate(addressSchema), ah(async (req, res) => {
  await saveAddress(req.user.customerId, req.body);
  res.status(201).json(await addressesOf(req.user.customerId));
}));

router.put('/addresses/:id', validate(addressSchema), ah(async (req, res) => {
  const a = await db('customer_addresses').where({ id: req.params.id, customer_id: req.user.customerId }).first();
  if (!a) throw notFound();
  await saveAddress(req.user.customerId, req.body, a.id);
  res.json(await addressesOf(req.user.customerId));
}));

router.delete('/addresses/:id', ah(async (req, res) => {
  const deleted = await db('customer_addresses').where({ id: req.params.id, customer_id: req.user.customerId }).del();
  if (!deleted) throw notFound();
  res.json(await addressesOf(req.user.customerId));
}));

module.exports = router;
