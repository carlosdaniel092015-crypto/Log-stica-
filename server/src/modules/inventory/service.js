'use strict';
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { badRequest, conflict, notFound } = require('../../utils/http');
const realtime = require('../../realtime/hub');

const REQUEST_STATUS_LABELS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const REQUEST_KIND_LABELS = { delivery: 'Entrega por aprobar', restock: 'Solicitud de inventario' };
const MOVEMENT_LABELS = {
  assign: 'Asignado al mensajero',
  return: 'Devuelto al almacén',
  deliver: 'Entregado al cliente',
  restock: 'Reposición aprobada',
  reject_restore: 'Entrega rechazada (se devuelve al mensajero)',
  warehouse_adjust: 'Ajuste de almacén',
};

const mapProduct = (p) => ({
  ...p,
  price: Number(p.price),
  warehouse_stock: Number(p.warehouse_stock),
  min_stock: Number(p.min_stock || 0),
  low_stock: bool(p.active) && Number(p.min_stock || 0) > 0 && Number(p.warehouse_stock) <= Number(p.min_stock),
  active: bool(p.active),
});

/** Productos activos cuya existencia en almacén llegó al mínimo. */
async function lowStockProducts() {
  return (await db('products').where({ active: true }).where('min_stock', '>', 0).whereRaw('warehouse_stock <= min_stock').orderBy('name')).map(mapProduct);
}

// Productos que cruzaron el mínimo dentro de una transacción; se avisa después de confirmarla.
const lowStockQueue = new Set();

/** Avisa en tiempo real al personal y al mensajero afectado. */
function broadcast(courierId, reason) {
  if (lowStockQueue.size) {
    const ids = [...lowStockQueue];
    lowStockQueue.clear();
    notifyLowStock(ids).catch(() => {});
  }
  const payload = { courier_id: courierId || null, reason, at: now() };
  realtime.toStaff('inventory:updated', payload);
  if (courierId) realtime.toCourier(courierId, 'inventory:updated', payload);
}

async function notifyLowStock(ids) {
  const { notify } = require('../notifications/service');
  const rows = await db('products').whereIn('id', ids);
  // Se vuelve a comprobar (por si la operación se revirtió).
  for (const p of rows.filter((x) => Number(x.warehouse_stock) <= Number(x.min_stock))) {
    await notify({ audience: 'admin', title: 'Producto por acabarse', body: `${p.name}: quedan ${p.warehouse_stock} en almacén (mínimo ${p.min_stock}).`, url: '/admin/inventario' });
  }
}

async function movement(trx, m) {
  await trx('inventory_movements').insert({
    id: uuid(),
    type: m.type,
    product_id: m.productId,
    courier_id: m.courierId || null,
    order_id: m.orderId || null,
    request_id: m.requestId || null,
    courier_delta: m.courierDelta || 0,
    warehouse_delta: m.warehouseDelta || 0,
    user_id: m.userId || null,
    note: m.note ? String(m.note).slice(0, 500) : null,
    created_at: now(),
  });
}

async function productName(trx, productId) {
  return (await trx('products').where({ id: productId }).first('name'))?.name || 'producto';
}

/** Suma o resta existencia del mensajero. Nunca permite quedar en negativo. */
async function changeCourierStock(trx, courierId, productId, delta) {
  const ts = now();
  const row = await trx('courier_stock').where({ courier_id: courierId, product_id: productId }).first();
  if (delta < 0) {
    const updated = await trx('courier_stock')
      .where({ courier_id: courierId, product_id: productId })
      .where('quantity', '>=', -delta)
      .update({ quantity: trx.raw('quantity + ?', [delta]), updated_at: ts });
    if (!updated) {
      throw conflict(`Inventario insuficiente de "${await productName(trx, productId)}": disponible ${row?.quantity || 0}, se necesitan ${-delta}.`);
    }
    return;
  }
  if (row) await trx('courier_stock').where({ id: row.id }).update({ quantity: trx.raw('quantity + ?', [delta]), updated_at: ts });
  else await trx('courier_stock').insert({ id: uuid(), courier_id: courierId, product_id: productId, quantity: delta, updated_at: ts });
}

/** Suma o resta existencia del almacén. Nunca permite quedar en negativo. */
async function changeWarehouseStock(trx, productId, delta) {
  const q = trx('products').where({ id: productId });
  if (delta < 0) q.where('warehouse_stock', '>=', -delta);
  const before = delta < 0 ? await trx('products').where({ id: productId }).first('warehouse_stock', 'min_stock') : null;
  const updated = await q.update({ warehouse_stock: trx.raw('warehouse_stock + ?', [delta]), updated_at: now() });
  if (updated && before && Number(before.min_stock) > 0) {
    const after = Number(before.warehouse_stock) + delta;
    if (after <= Number(before.min_stock) && Number(before.warehouse_stock) > Number(before.min_stock)) lowStockQueue.add(productId);
  }
  if (!updated) {
    const p = await trx('products').where({ id: productId }).first();
    if (!p) throw notFound('Producto no encontrado.');
    throw conflict(`El almacén no tiene suficiente "${p.name}": disponible ${p.warehouse_stock}, se necesitan ${-delta}.`);
  }
}

function normalizeItems(items) {
  const merged = new Map();
  for (const it of items || []) {
    const q = Math.trunc(Number(it.quantity));
    if (!it.product_id || !Number.isFinite(q) || q <= 0) throw badRequest('Cada producto necesita una cantidad mayor que cero.');
    merged.set(it.product_id, (merged.get(it.product_id) || 0) + q);
  }
  return [...merged].map(([product_id, quantity]) => ({ product_id, quantity }));
}

async function nextRequestNumber(trx) {
  const row = await trx('inventory_requests').max('request_number as max').first();
  return (Number(row?.max) || 100) + 1;
}

/** Asigna inventario del almacén a un mensajero. */
async function assignToCourier(courierId, items, req, note) {
  const list = normalizeItems(items);
  if (!list.length) throw badRequest('Agrega al menos un producto.');
  await db.transaction(async (trx) => {
    if (!(await trx('couriers').where({ id: courierId }).first())) throw notFound('Mensajero no encontrado.');
    for (const it of list) {
      await changeWarehouseStock(trx, it.product_id, -it.quantity);
      await changeCourierStock(trx, courierId, it.product_id, it.quantity);
      await movement(trx, { type: 'assign', productId: it.product_id, courierId, courierDelta: it.quantity, warehouseDelta: -it.quantity, userId: req.user.id, note });
    }
  });
  broadcast(courierId, 'assign');
}

/** El mensajero devuelve inventario al almacén. */
async function returnFromCourier(courierId, items, req, note) {
  const list = normalizeItems(items);
  if (!list.length) throw badRequest('Agrega al menos un producto.');
  await db.transaction(async (trx) => {
    for (const it of list) {
      await changeCourierStock(trx, courierId, it.product_id, -it.quantity);
      await changeWarehouseStock(trx, it.product_id, it.quantity);
      await movement(trx, { type: 'return', productId: it.product_id, courierId, courierDelta: -it.quantity, warehouseDelta: it.quantity, userId: req.user.id, note });
    }
  });
  broadcast(courierId, 'return');
}

/**
 * Al marcar un pedido como Entregado (dentro de la misma transacción):
 * descuenta del inventario del mensajero los productos del pedido y crea
 * una solicitud de entrega pendiente de aprobación del administrador.
 */
async function consumeForDelivery(trx, order, userId) {
  const items = await trx('order_items').where({ order_id: order.id });
  if (!items.length || !order.courier_id) return null;
  const ts = now();
  const requestId = uuid();
  await trx('inventory_requests').insert({
    id: requestId,
    request_number: await nextRequestNumber(trx),
    courier_id: order.courier_id,
    order_id: order.id,
    kind: 'delivery',
    status: 'pending',
    note: `Entrega del pedido #${order.order_number} a ${order.customer_name}`,
    created_at: ts,
    updated_at: ts,
  });
  for (const it of items) {
    await changeCourierStock(trx, order.courier_id, it.product_id, -it.quantity);
    await trx('inventory_request_items').insert({ id: uuid(), request_id: requestId, product_id: it.product_id, quantity_requested: it.quantity, quantity_approved: null });
    await movement(trx, { type: 'deliver', productId: it.product_id, courierId: order.courier_id, orderId: order.id, requestId, courierDelta: -it.quantity, userId, note: `Pedido #${order.order_number}` });
  }
  return requestId;
}

/** El mensajero solicita más inventario (cantidades solicitadas). */
async function createRestockRequest(courierId, items, note) {
  const list = normalizeItems(items);
  if (!list.length) throw badRequest('Agrega al menos un producto.');
  const ts = now();
  const id = uuid();
  await db.transaction(async (trx) => {
    for (const it of list) {
      const p = await trx('products').where({ id: it.product_id }).first();
      if (!p || !bool(p.active)) throw badRequest('Uno de los productos no existe o está inactivo.');
    }
    await trx('inventory_requests').insert({ id, request_number: await nextRequestNumber(trx), courier_id: courierId, kind: 'restock', status: 'pending', note: note || null, created_at: ts, updated_at: ts });
    for (const it of list) {
      await trx('inventory_request_items').insert({ id: uuid(), request_id: id, product_id: it.product_id, quantity_requested: it.quantity, quantity_approved: null });
    }
  });
  broadcast(courierId, 'request');
  return id;
}

/**
 * El administrador aprueba una solicitud.
 *  - Entrega: confirma lo entregado (el inventario ya se descontó).
 *  - Reposición: entrega las cantidades aprobadas desde el almacén al mensajero.
 */
async function approveRequest(requestId, { items = [], note } = {}, req) {
  let courierId;
  await db.transaction(async (trx) => {
    const r = await trx('inventory_requests').where({ id: requestId }).first();
    if (!r) throw notFound('Solicitud no encontrada.');
    if (r.status !== 'pending') throw conflict('La solicitud ya fue revisada.');
    courierId = r.courier_id;
    const lines = await trx('inventory_request_items').where({ request_id: r.id });
    const overrides = new Map(items.map((i) => [i.product_id, Math.trunc(Number(i.quantity_approved))]));
    for (const line of lines) {
      let approved = line.quantity_requested;
      if (r.kind === 'restock' && overrides.has(line.product_id)) {
        approved = overrides.get(line.product_id);
        if (!Number.isFinite(approved) || approved < 0) throw badRequest('Cantidad aprobada inválida.');
      }
      if (r.kind === 'restock' && approved > 0) {
        await changeWarehouseStock(trx, line.product_id, -approved);
        await changeCourierStock(trx, r.courier_id, line.product_id, approved);
        await movement(trx, { type: 'restock', productId: line.product_id, courierId: r.courier_id, requestId: r.id, courierDelta: approved, warehouseDelta: -approved, userId: req.user.id, note });
      }
      await trx('inventory_request_items').where({ id: line.id }).update({ quantity_approved: approved });
    }
    await trx('inventory_requests').where({ id: r.id }).update({ status: 'approved', reviewed_by: req.user.id, reviewed_at: now(), review_note: note || null, updated_at: now() });
    const { audit } = require('../audit/service');
    await audit(req, { action: 'inventory.request_approve', entity: 'inventory_request', entityId: r.id, orderId: r.order_id, oldValue: { status: 'pending' }, newValue: { status: 'approved', kind: r.kind } }, trx);
  });
  broadcast(courierId, 'approved');
  await notifyCourier(courierId, requestId, 'approved');
}

/** Rechazo: en una entrega, el inventario descontado vuelve al mensajero. */
async function rejectRequest(requestId, { note } = {}, req) {
  let courierId;
  await db.transaction(async (trx) => {
    const r = await trx('inventory_requests').where({ id: requestId }).first();
    if (!r) throw notFound('Solicitud no encontrada.');
    if (r.status !== 'pending') throw conflict('La solicitud ya fue revisada.');
    courierId = r.courier_id;
    if (r.kind === 'delivery') {
      const lines = await trx('inventory_request_items').where({ request_id: r.id });
      for (const line of lines) {
        await changeCourierStock(trx, r.courier_id, line.product_id, line.quantity_requested);
        await movement(trx, { type: 'reject_restore', productId: line.product_id, courierId: r.courier_id, orderId: r.order_id, requestId: r.id, courierDelta: line.quantity_requested, userId: req.user.id, note });
      }
    }
    await trx('inventory_request_items').where({ request_id: r.id }).update({ quantity_approved: 0 });
    await trx('inventory_requests').where({ id: r.id }).update({ status: 'rejected', reviewed_by: req.user.id, reviewed_at: now(), review_note: note || null, updated_at: now() });
    const { audit } = require('../audit/service');
    await audit(req, { action: 'inventory.request_reject', entity: 'inventory_request', entityId: r.id, orderId: r.order_id, oldValue: { status: 'pending' }, newValue: { status: 'rejected', note } }, trx);
  });
  broadcast(courierId, 'rejected');
  await notifyCourier(courierId, requestId, 'rejected');
}

async function notifyCourier(courierId, requestId, status) {
  try {
    const { notify } = require('../notifications/service');
    const c = await db('couriers').where({ id: courierId }).first('user_id');
    const r = await db('inventory_requests').where({ id: requestId }).first();
    await notify({
      audience: 'courier',
      userIds: [c.user_id],
      title: status === 'approved' ? `Solicitud #${r.request_number} aprobada` : `Solicitud #${r.request_number} rechazada`,
      body: `${REQUEST_KIND_LABELS[r.kind]}${r.review_note ? `: ${r.review_note}` : ''}`,
      url: '/mensajero',
    });
  } catch {
    /* la notificación es opcional */
  }
}

async function courierStock(courierId) {
  return (
    await db('courier_stock as s')
      .join('products as p', 'p.id', 's.product_id')
      .where('s.courier_id', courierId)
      .orderBy('p.name')
      .select('s.product_id', 's.quantity', 's.updated_at', 'p.name', 'p.sku', 'p.unit', 'p.price')
  ).map((r) => ({ ...r, quantity: Number(r.quantity), price: Number(r.price) }));
}

async function listRequests({ status, courierId, kind, orderId, limit = 200 } = {}) {
  const q = db('inventory_requests as r')
    .join('couriers as c', 'c.id', 'r.courier_id')
    .join('users as u', 'u.id', 'c.user_id')
    .leftJoin('orders as o', 'o.id', 'r.order_id')
    .leftJoin('users as rv', 'rv.id', 'r.reviewed_by')
    .select('r.*', 'u.name as courier_name', 'o.order_number', 'o.customer_name', 'rv.name as reviewed_by_name')
    .orderBy('r.created_at', 'desc')
    .limit(limit);
  if (status) q.where('r.status', status);
  if (courierId) q.where('r.courier_id', courierId);
  if (kind) q.where('r.kind', kind);
  if (orderId) q.where('r.order_id', orderId);
  const rows = await q;
  if (!rows.length) return [];
  const lines = await db('inventory_request_items as i')
    .join('products as p', 'p.id', 'i.product_id')
    .whereIn('i.request_id', rows.map((r) => r.id))
    .select('i.*', 'p.name as product_name', 'p.sku', 'p.unit');
  return rows.map((r) => ({
    ...r,
    status_label: REQUEST_STATUS_LABELS[r.status],
    kind_label: REQUEST_KIND_LABELS[r.kind],
    items: lines.filter((l) => l.request_id === r.id),
  }));
}

/** Productos de un pedido (para crear o editar). Valida y guarda precio y nombre del momento. */
async function setOrderItems(trx, orderId, items) {
  const list = normalizeItems(items);
  await trx('order_items').where({ order_id: orderId }).del();
  let subtotal = 0;
  for (const it of list) {
    const p = await trx('products').where({ id: it.product_id }).first();
    if (!p || !bool(p.active)) throw badRequest('Uno de los productos no existe o está inactivo.');
    subtotal += Number(p.price) * it.quantity;
    await trx('order_items').insert({ id: uuid(), order_id: orderId, product_id: p.id, product_name: p.name, quantity: it.quantity, unit_price: p.price, created_at: now() });
  }
  return { count: list.length, subtotal: Math.round(subtotal * 100) / 100 };
}

async function itemsForOrders(orderIds) {
  if (!orderIds.length) return {};
  const rows = await db('order_items as i').leftJoin('products as p', 'p.id', 'i.product_id').whereIn('i.order_id', orderIds).orderBy('i.created_at').select('i.*', 'p.sku');
  const out = {};
  for (const r of rows) (out[r.order_id] ||= []).push({ product_id: r.product_id, sku: r.sku, name: r.product_name, quantity: Number(r.quantity), unit_price: Number(r.unit_price) });
  return out;
}

module.exports = {
  lowStockProducts,
  REQUEST_STATUS_LABELS,
  REQUEST_KIND_LABELS,
  MOVEMENT_LABELS,
  mapProduct,
  broadcast,
  movement,
  changeWarehouseStock,
  assignToCourier,
  returnFromCourier,
  consumeForDelivery,
  createRestockRequest,
  approveRequest,
  rejectRequest,
  courierStock,
  listRequests,
  setOrderItems,
  itemsForOrders,
};
