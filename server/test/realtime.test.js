'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { setup, login, db } = require('./helpers');
const { attachRealtime } = require('../src/realtime/socket');

let app;
let server;
let base;
let admin;
let juan;

before(async () => {
  app = await setup();
  server = http.createServer(app);
  attachRealtime(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = await login(app, 'admin@demo.do', 'Admin123!');
  juan = await login(app, 'juan@demo.do', 'Mensajero123!');
});

after(async () => {
  await new Promise((r) => server.close(r));
  await db.destroy();
});

function once(socket, event, predicate = () => true, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), ms);
    const fn = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(t);
      socket.off(event, fn);
      resolve(payload);
    };
    socket.on(event, fn);
  });
}

test('dashboard devuelve indicadores y series', async () => {
  const res = await admin.get('/api/dashboard?days=7');
  assert.equal(res.status, 200);
  assert.equal(res.body.by_day.length, 7);
  assert.ok(Number.isFinite(res.body.kpis.orders_today));
  assert.ok(res.body.by_courier.length > 0);
});

test('el cliente recibe el cambio "En camino" en tiempo real con su token', async () => {
  const couriers = (await admin.get('/api/couriers')).body;
  const juanId = couriers.find((c) => c.email === 'juan@demo.do').id;
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Tiempo Real', phone: '809-000-9999' },
    address: { formatted_address: 'Piantini', lat: 18.4715, lng: -69.94 },
    courier_id: juanId,
  });
  const order = created.body.order;

  const customer = ioClient(base, { transports: ['websocket'] });
  const joined = await new Promise((r) => customer.emit('track:join', { token: order.tracking_link.token }, r));
  assert.equal(joined.ok, true);
  assert.equal(joined.view.status, 'assigned');

  const bad = await new Promise((r) => customer.emit('track:join', { token: 'x'.repeat(43) }, r));
  assert.equal(bad.ok, false, 'un token inválido no se une a ninguna sala');

  const update = once(customer, 'tracking:update', (v) => v.status === 'en_route');
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  const v = await update;
  assert.equal(v.order_number, order.order_number);
  customer.close();
});
