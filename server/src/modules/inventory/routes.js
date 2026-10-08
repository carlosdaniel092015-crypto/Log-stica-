'use strict';
const express = require('express');
const { z } = require('zod');
const { db, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { ah, notFound, conflict } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');
const { audit } = require('../audit/service');
const svc = require('./service');

const router = express.Router();
router.use(requirePermission('inventory.manage'));

const itemsSchema = z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(100000) })).min(1).max(100);
const productSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  price: z.number().min(0).max(10_000_000),
  min_stock: z.number().int().min(0).max(10_000_000).optional(),
  active: z.boolean().optional(),
});

/** Resumen del módulo: productos, inventario por mensajero, solicitudes pendientes. */
router.get('/overview', ah(async (_req, res) => {
  const [products, stock, couriers, pending] = await Promise.all([
    db('products').orderBy('name'),
    db('courier_stock').where('quantity', '>', 0).select('courier_id', 'product_id', 'quantity'),
    db('couriers as c').join('users as u', 'u.id', 'c.user_id').where('u.active', true).orderBy('u.name').select('c.id', 'u.name', 'c.status', 'c.shift_active'),
    db('inventory_requests').where({ status: 'pending' }).count('id as n').first(),
  ]);
  res.json({
    products: products.map(svc.mapProduct),
    couriers: couriers.map((c) => ({
      ...c,
      stock: Object.fromEntries(stock.filter((s) => s.courier_id === c.id).map((s) => [s.product_id, Number(s.quantity)])),
    })),
    pending_requests: Number(pending.n),
    low_stock: (await svc.lowStockProducts()).map((p) => ({ id: p.id, name: p.name, warehouse_stock: p.warehouse_stock, min_stock: p.min_stock })),
  });
}));

router.get('/products', ah(async (_req, res) => {
  res.json((await db('products').orderBy('name')).map(svc.mapProduct));
}));

router.post('/products', validate(productSchema.extend({ warehouse_stock: z.number().int().min(0).max(10_000_000).optional() })), ah(async (req, res) => {
  if (await db('products').where({ sku: req.body.sku }).first()) throw conflict('Ya existe un producto con ese SKU.');
  const ts = now();
  const { warehouse_stock: initial = 0, ...b } = req.body;
  const p = { id: uuid(), ...b, unit: b.unit || 'unidad', description: b.description || null, active: b.active ?? true, warehouse_stock: 0, created_at: ts, updated_at: ts };
  await db.transaction(async (trx) => {
    await trx('products').insert(p);
    if (initial > 0) {
      await svc.changeWarehouseStock(trx, p.id, initial);
      await svc.movement(trx, { type: 'warehouse_adjust', productId: p.id, warehouseDelta: initial, userId: req.user.id, note: 'Existencia inicial' });
    }
    await audit(req, { action: 'product.create', entity: 'product', entityId: p.id, newValue: req.body }, trx);
  });
  svc.broadcast(null, 'product');
  res.status(201).json(svc.mapProduct(await db('products').where({ id: p.id }).first()));
}));

router.put('/products/:id', validate(productSchema.partial()), ah(async (req, res) => {
  const before = await db('products').where({ id: req.params.id }).first();
  if (!before) throw notFound();
  if (req.body.sku && req.body.sku !== before.sku && (await db('products').where({ sku: req.body.sku }).first())) throw conflict('Ya existe un producto con ese SKU.');
  await db('products').where({ id: before.id }).update({ ...req.body, updated_at: now() });
  await audit(req, { action: 'product.update', entity: 'product', entityId: before.id, oldValue: before, newValue: req.body });
  svc.broadcast(null, 'product');
  res.json(svc.mapProduct(await db('products').where({ id: before.id }).first()));
}));

/** Entrada o ajuste del almacén (positivo = entra, negativo = sale). */
router.post('/products/:id/adjust', validate(z.object({ delta: z.number().int().min(-10_000_000).max(10_000_000).refine((v) => v !== 0, 'no puede ser cero'), note: z.string().trim().max(500).optional() })), ah(async (req, res) => {
  await db.transaction(async (trx) => {
    await svc.changeWarehouseStock(trx, req.params.id, req.body.delta);
    await svc.movement(trx, { type: 'warehouse_adjust', productId: req.params.id, warehouseDelta: req.body.delta, userId: req.user.id, note: req.body.note });
    await audit(req, { action: 'product.stock_adjust', entity: 'product', entityId: req.params.id, newValue: req.body }, trx);
  });
  svc.broadcast(null, 'adjust');
  res.json(svc.mapProduct(await db('products').where({ id: req.params.id }).first()));
}));

/** Elimina un producto sin historial; si ya se usó, se debe desactivar para conservar los registros. */
router.delete('/products/:id', ah(async (req, res) => {
  const p = await db('products').where({ id: req.params.id }).first();
  if (!p) throw notFound();
  const used = (await db('order_items').where({ product_id: p.id }).first('id'))
    || (await db('courier_stock').where({ product_id: p.id }).where('quantity', '>', 0).first('id'))
    || (await db('inventory_request_items').where({ product_id: p.id }).first('id'));
  if (used) throw conflict('Este producto ya tiene pedidos, inventario asignado o solicitudes. Desactívalo en lugar de eliminarlo.');
  await db.transaction(async (trx) => {
    await trx('inventory_movements').where({ product_id: p.id }).del();
    await trx('courier_stock').where({ product_id: p.id }).del();
    await trx('products').where({ id: p.id }).del();
    await audit(req, { action: 'product.delete', entity: 'product', entityId: p.id, oldValue: { sku: p.sku, name: p.name } }, trx);
  });
  svc.broadcast(null, 'product');
  res.json({ ok: true });
}));

router.get('/couriers/:id', ah(async (req, res) => {
  res.json({ stock: await svc.courierStock(req.params.id) });
}));

router.post('/couriers/:id/assign', validate(z.object({ items: itemsSchema, note: z.string().trim().max(500).optional() })), ah(async (req, res) => {
  await svc.assignToCourier(req.params.id, req.body.items, req, req.body.note);
  await audit(req, { action: 'inventory.assign', entity: 'courier', entityId: req.params.id, newValue: req.body.items });
  const c = await db('couriers').where({ id: req.params.id }).first('user_id');
  require('../notifications/service').notify({ audience: 'courier', userIds: [c.user_id], title: 'Se te asignó inventario', body: 'Revisa la pestaña "Mi inventario".', url: '/mensajero' }).catch(() => {});
  res.json({ stock: await svc.courierStock(req.params.id) });
}));

router.post('/couriers/:id/return', validate(z.object({ items: itemsSchema, note: z.string().trim().max(500).optional() })), ah(async (req, res) => {
  await svc.returnFromCourier(req.params.id, req.body.items, req, req.body.note);
  await audit(req, { action: 'inventory.return', entity: 'courier', entityId: req.params.id, newValue: req.body.items });
  res.json({ stock: await svc.courierStock(req.params.id) });
}));

router.get('/requests', ah(async (req, res) => {
  res.json(await svc.listRequests({ status: req.query.status || undefined, courierId: req.query.courier_id || undefined, kind: req.query.kind || undefined }));
}));

router.post('/requests/:id/approve', validate(z.object({
  items: z.array(z.object({ product_id: z.string().uuid(), quantity_approved: z.number().int().min(0).max(100000) })).max(100).optional(),
  note: z.string().trim().max(500).optional(),
})), ah(async (req, res) => {
  await svc.approveRequest(req.params.id, req.body, req);
  res.json({ ok: true });
}));

router.post('/requests/:id/reject', validate(z.object({ note: z.string().trim().max(500).optional() })), ah(async (req, res) => {
  await svc.rejectRequest(req.params.id, req.body, req);
  res.json({ ok: true });
}));

/** Entregas recientes (verde) y no entregadas (rojo) para el panel en vivo. */
router.get('/outcomes', ah(async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await db('orders as o')
    .leftJoin('couriers as c', 'c.id', 'o.courier_id')
    .leftJoin('users as u', 'u.id', 'c.user_id')
    .whereIn('o.status', ['delivered', 'failed', 'customer_unavailable'])
    .where('o.updated_at', '>=', since)
    .orderBy('o.updated_at', 'desc')
    .limit(100)
    .select('o.id', 'o.order_number', 'o.status', 'o.customer_name', 'o.address', 'o.updated_at as at', 'u.name as courier_name');
  res.json(rows.map((r) => ({ ...r, outcome: r.status === 'delivered' ? 'success' : 'failure' })));
}));

router.get('/movements', ah(async (req, res) => {
  const q = db('inventory_movements as m')
    .join('products as p', 'p.id', 'm.product_id')
    .leftJoin('couriers as c', 'c.id', 'm.courier_id')
    .leftJoin('users as cu', 'cu.id', 'c.user_id')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .leftJoin('orders as o', 'o.id', 'm.order_id')
    .orderBy('m.created_at', 'desc')
    .limit(300)
    .select('m.*', 'p.name as product_name', 'cu.name as courier_name', 'u.name as user_name', 'o.order_number');
  if (req.query.courier_id) q.where('m.courier_id', String(req.query.courier_id));
  res.json((await q).map((m) => ({ ...m, type_label: svc.MOVEMENT_LABELS[m.type] })));
}));

module.exports = router;
