'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, db } = require('./helpers');

let app;
let admin;
let juan;
let juanId;
let product;

const stockOf = async (agent, productId) => ((await agent.get('/api/courier/inventory')).body.stock.find((s) => s.product_id === productId)?.quantity) ?? 0;

async function newOrder(qty, name) {
  const res = await admin.post('/api/orders').send({
    customer: { name, phone: `809-${String(Math.random()).slice(2, 5)}-${String(Math.random()).slice(2, 6)}` },
    address: { formatted_address: 'Piantini', lat: 18.4715, lng: -69.94 },
    items: [{ product_id: product.id, quantity: qty }],
    courier_id: juanId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order;
}

before(async () => {
  app = await setup();
  admin = await login(app, 'admin@demo.do', 'Admin123!');
  juan = await login(app, 'juan@demo.do', 'Mensajero123!');
  juanId = (await admin.get('/api/couriers')).body.find((c) => c.email === 'juan@demo.do').id;
  const created = await admin.post('/api/inventory/products').send({ sku: 'TEST-1', name: 'Producto prueba', price: 150, warehouse_stock: 10 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  product = created.body;
});

after(async () => {
  await db.destroy();
});

test('asignar inventario al mensajero descuenta del almacén', async () => {
  const res = await admin.post(`/api/inventory/couriers/${juanId}/assign`).send({ items: [{ product_id: product.id, quantity: 6 }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await stockOf(juan, product.id), 6);
  const p = (await admin.get('/api/inventory/products')).body.find((x) => x.id === product.id);
  assert.equal(p.warehouse_stock, 4);
  const tooMuch = await admin.post(`/api/inventory/couriers/${juanId}/assign`).send({ items: [{ product_id: product.id, quantity: 50 }] });
  assert.equal(tooMuch.status, 409, 'no se asigna más de lo que hay en almacén');
});

test('al entregar se reduce el inventario y se crea una solicitud que el administrador aprueba', async () => {
  const order = await newOrder(2, 'Cliente Inventario');
  assert.equal(order.subtotal, 300, 'el subtotal se calcula con los productos');
  assert.equal(order.items[0].quantity, 2);
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  const done = await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'delivered', proof: { receiver_name: 'Ana' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await stockOf(juan, product.id), 4);

  const pending = (await admin.get('/api/inventory/requests?status=pending')).body.find((r) => r.order_id === order.id);
  assert.ok(pending, 'existe la solicitud de entrega');
  assert.equal(pending.kind, 'delivery');
  assert.equal(pending.items[0].quantity_requested, 2);
  assert.equal((await admin.post(`/api/inventory/requests/${pending.id}/approve`).send({})).status, 200);
  const r = (await admin.get('/api/inventory/requests')).body.find((x) => x.id === pending.id);
  assert.equal(r.status, 'approved');
  assert.equal(r.items[0].quantity_approved, 2);
  assert.equal((await admin.post(`/api/inventory/requests/${pending.id}/approve`).send({})).status, 409, 'no se aprueba dos veces');

  const outcomes = (await admin.get('/api/inventory/outcomes')).body;
  assert.equal(outcomes.find((o) => o.id === order.id).outcome, 'success');
});

test('sin inventario suficiente la entrega no se bloquea: lo que falta sale del almacén', async () => {
  // Juan tiene 4 y el almacén 4; el pedido lleva 9 → 4 del mensajero, 4 del almacén y 1 faltante.
  const order = await newOrder(9, 'Cliente Sin Stock');
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  const res = await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'delivered', proof: { receiver_name: 'X' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await admin.get(`/api/orders/${order.id}`)).body.status, 'delivered');
  assert.equal(await stockOf(juan, product.id), 0);
  const p = (await admin.get('/api/inventory/products')).body.find((x) => x.id === product.id);
  assert.equal(p.warehouse_stock, 0);

  const req = (await admin.get('/api/inventory/requests?status=pending')).body.find((r) => r.order_id === order.id);
  assert.match(req.note, /no tenía asignado: 5 Producto prueba \(4 del almacén\) \(1 sin existencia\)/);
  const moves = (await admin.get(`/api/inventory/movements?courier_id=${juanId}`)).body.filter((m) => m.request_id === req.id);
  assert.ok(moves.some((m) => m.type === 'deliver' && m.courier_delta === -4));
  assert.ok(moves.some((m) => m.type === 'deliver_warehouse' && m.warehouse_delta === -4));
  await new Promise((r) => setTimeout(r, 50));
  const notes = await db('notifications').where('title', 'like', `%#${order.order_number}%sin inventario%`);
  assert.ok(notes.length >= 1, 'se avisa a los administradores');

  // Al rechazar, cada unidad vuelve a donde salió.
  assert.equal((await admin.post(`/api/inventory/requests/${req.id}/reject`).send({ note: 'Revisar' })).status, 200);
  assert.equal(await stockOf(juan, product.id), 4);
  assert.equal((await admin.get('/api/inventory/products')).body.find((x) => x.id === product.id).warehouse_stock, 4);
});

test('el no entregado se reporta en rojo', async () => {
  const order = await newOrder(1, 'Cliente No Estaba');
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  const failed = await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'failed', note: 'No estaba' });
  assert.equal(failed.status, 200);
  const outcomes = (await admin.get('/api/inventory/outcomes')).body;
  assert.equal(outcomes.find((o) => o.id === order.id).outcome, 'failure');
  assert.equal(await stockOf(juan, product.id), 4, 'no entregado no descuenta inventario');
});

test('rechazar una entrega devuelve el inventario al mensajero', async () => {
  const order = await newOrder(1, 'Cliente Rechazo');
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'delivered', proof: { receiver_name: 'Y' } });
  assert.equal(await stockOf(juan, product.id), 3);
  const reqId = (await admin.get('/api/inventory/requests?status=pending')).body.find((r) => r.order_id === order.id).id;
  assert.equal((await admin.post(`/api/inventory/requests/${reqId}/reject`).send({ note: 'No coincide' })).status, 200);
  assert.equal(await stockOf(juan, product.id), 4);
});

test('el mensajero solicita inventario y el administrador aprueba las cantidades', async () => {
  const created = await juan.post('/api/courier/inventory/requests').send({ items: [{ product_id: product.id, quantity: 3 }], note: 'Para la tarde' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const r = (await admin.get('/api/inventory/requests?status=pending')).body.find((x) => x.id === created.body.id);
  assert.equal(r.kind, 'restock');
  assert.equal(r.items[0].quantity_requested, 3);
  const ok = await admin.post(`/api/inventory/requests/${r.id}/approve`).send({ items: [{ product_id: product.id, quantity_approved: 2 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await stockOf(juan, product.id), 6);
  const p = (await admin.get('/api/inventory/products')).body.find((x) => x.id === product.id);
  assert.equal(p.warehouse_stock, 2);
  const moves = (await admin.get(`/api/inventory/movements?courier_id=${juanId}`)).body;
  assert.ok(moves.some((m) => m.type === 'restock' && m.courier_delta === 2));
});

test('el mensajero no puede usar la administración de inventario', async () => {
  assert.equal((await juan.get('/api/inventory/overview')).status, 403);
  assert.equal((await juan.post(`/api/inventory/couriers/${juanId}/assign`).send({ items: [{ product_id: product.id, quantity: 1 }] })).status, 403);
});

test('un producto con historial no se borra: se puede ocultar y deja de avisar', async () => {
  const del = await admin.delete(`/api/inventory/products/${product.id}`);
  assert.equal(del.status, 409);
  assert.equal(del.body.details.code, 'in_use');
  const hidden = await admin.put(`/api/inventory/products/${product.id}`).send({ active: false });
  assert.equal(hidden.status, 200);
  assert.equal((await admin.get('/api/inventory/products')).body.find((p) => p.id === product.id).active, false);
  // Un producto nuevo sin historial sí se elimina.
  const fresh = (await admin.post('/api/inventory/products').send({ sku: 'TMP-DEL', name: 'Temporal', price: 10, warehouse_stock: 0 })).body;
  assert.equal((await admin.delete(`/api/inventory/products/${fresh.id}`)).status, 200);
});
