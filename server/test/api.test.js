'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, db, request } = require('./helpers');

let app;
let admin;
let juan;
let pedro;
let juanId;
let pedroId;

before(async () => {
  app = await setup();
  admin = await login(app, 'admin@demo.do', 'Admin123!');
  juan = await login(app, 'juan@demo.do', 'Mensajero123!');
  pedro = await login(app, 'pedro@demo.do', 'Mensajero123!');
  const couriers = (await admin.get('/api/couriers')).body;
  juanId = couriers.find((c) => c.email === 'juan@demo.do').id;
  pedroId = couriers.find((c) => c.email === 'pedro@demo.do').id;
});

after(async () => {
  await db.destroy();
});

test('rechaza credenciales inválidas y protege la API', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'admin@demo.do', password: 'incorrecta' });
  assert.equal(bad.status, 401);
  assert.equal((await request(app).get('/api/orders')).status, 401);
  assert.equal((await juan.get('/api/orders')).status, 403, 'un mensajero no ve todos los pedidos');
  assert.equal((await juan.get('/api/settings')).status, 403);
});

test('cotiza por polígono, círculo y división administrativa con prioridad', async () => {
  const alcarrizos = await admin.post('/api/zones/quote').send({ lat: 18.5172, lng: -70.016 });
  assert.equal(alcarrizos.body.zone.name, 'Los Alcarrizos');
  assert.equal(alcarrizos.body.fee, 200);
  const fermin = await admin.post('/api/zones/quote').send({ lat: 18.4935, lng: -69.969 });
  assert.equal(fermin.body.zone.name, 'Autopista Duarte Km 9 – Km 14', 'la zona personalizada tiene prioridad');
  const herrera = await admin.post('/api/zones/quote').send({ lat: 18.4766, lng: -69.9653 });
  assert.equal(herrera.body.zone.name, 'Herrera', 'sector antes que municipio');
  const santiago = await admin.post('/api/zones/quote').send({ lat: 19.452, lng: -70.6965 });
  assert.equal(santiago.body.fee, 700);
  const mar = await admin.post('/api/zones/quote').send({ lat: 17.5, lng: -68.0 });
  assert.equal(mar.body.covered, false);
});

test('flujo completo: crear, asignar, en camino, seguimiento público y entrega', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Cliente Prueba', phone: '809-000-1111' },
    address: { formatted_address: 'Calle Duarte #1, Los Alcarrizos', lat: 18.5172, lng: -70.016, reference: 'Casa azul' },
    subtotal: 1000,
    payment_method: 'cash',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const order = created.body.order;
  assert.equal(order.delivery_fee, 200);
  assert.equal(order.total, 1200);
  assert.equal(order.zone_name, 'Los Alcarrizos');
  assert.ok(order.tracking_link.url.includes('/seguimiento/'));
  const token = order.tracking_link.token;

  // Seguimiento sin cuenta.
  const pub = await request(app).get(`/api/track/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.order_number, order.order_number);
  assert.equal(pub.body.status, 'new');
  assert.equal(pub.body.phone, undefined, 'no expone datos internos');

  // Token alterado → 404.
  const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await request(app).get(`/api/track/${tampered}`)).status, 404);

  // Mensajero no asignado no puede verlo.
  assert.equal((await pedro.get(`/api/courier/orders/${order.id}`)).status, 404);

  const assigned = await admin.post(`/api/orders/${order.id}/assign`).send({ courier_id: juanId });
  assert.equal(assigned.body.status, 'assigned');
  assert.equal((await pedro.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' })).status, 404);

  const mine = await juan.get('/api/courier/orders');
  assert.ok(mine.body.some((o) => o.id === order.id));

  // "VOY HACIA ESTE CLIENTE"
  const going = await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route', lat: 18.49, lng: -69.96 });
  assert.equal(going.status, 200, JSON.stringify(going.body));
  assert.equal(going.body.status, 'en_route');
  const courier = (await admin.get(`/api/couriers/${juanId}`)).body;
  assert.equal(courier.current_order.id, order.id, 'el admin ve a qué cliente se dirige');

  // Ubicación: requiere jornada activa.
  await juan.post('/api/courier/shift/end');
  assert.equal((await juan.post('/api/courier/location').send({ lat: 18.5, lng: -70 })).status, 409);
  await juan.post('/api/courier/shift/start').send({ sharing_location: true });
  const loc = await juan.post('/api/courier/location').send({ lat: 18.5165, lng: -70.0158, accuracy: 10 });
  assert.equal(loc.status, 200);
  const afterLoc = (await request(app).get(`/api/track/${token}`)).body;
  assert.equal(afterLoc.status, 'arriving', 'cerca del destino pasa a "Llegando"');
  assert.ok(afterLoc.courier.location, 'el cliente ve la ubicación del mensajero');
  assert.ok(afterLoc.eta.seconds >= 0);

  // Entregado sin nombre de quien recibe → error.
  assert.equal((await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'delivered' })).status, 400);
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const delivered = await juan.post(`/api/courier/orders/${order.id}/status`).send({
    status: 'delivered', lat: 18.5171, lng: -70.0161, accuracy: 8, cash_collected: true,
    proof: { receiver_name: 'Juana', notes: 'Recibido en la puerta', signature: tinyPng },
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  const detail = (await admin.get(`/api/orders/${order.id}`)).body;
  assert.equal(detail.status, 'delivered');
  assert.equal(detail.payment_status, 'paid');
  assert.equal(detail.proofs[0].receiver_name, 'Juana');
  assert.ok(detail.proofs[0].has_signature);
  assert.ok(detail.delivered_at);
  assert.deepEqual(detail.history.map((h) => h.to_status), ['new', 'assigned', 'en_route', 'arriving', 'delivered']);
  assert.equal((await admin.get(detail.proofs[0].signature_url)).status, 200);
  assert.equal((await pedro.get(detail.proofs[0].signature_url)).status, 403);

  assert.equal((await request(app).get(`/api/track/${token}`)).status, 404, 'el seguimiento se cierra al entregar');

  const audit = (await admin.get(`/api/audit?order_id=${order.id}`)).body;
  assert.ok(audit.some((a) => a.action === 'order.assign'));
  assert.ok(audit.some((a) => a.action === 'order.status' && a.new_value.status === 'delivered'));
});

test('transiciones inválidas son rechazadas', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Otro Cliente', phone: '809-000-2222' },
    address: { formatted_address: 'Piantini', lat: 18.4715, lng: -69.94 },
  });
  const id = created.body.order.id;
  const res = await admin.post(`/api/orders/${id}/status`).send({ status: 'delivered' });
  assert.equal(res.status, 409);
  const res2 = await admin.post(`/api/orders/${id}/status`).send({ status: 'en_route' });
  assert.equal(res2.status, 409);
});

test('el cliente corrige su ubicación con el enlace y agrega referencia', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Ubicación Prueba', phone: '809-000-3333' },
    address: { formatted_address: 'Herrera', lat: 18.4766, lng: -69.9653 },
  });
  const token = created.body.order.tracking_link.token;
  const moved = await request(app).post(`/api/track/${token}/location`).send({ lat: 18.477, lng: -69.966, source: 'pin', reference: 'Portón negro' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.location_confirmed, true);
  assert.equal(moved.body.reference, 'Portón negro');
  const revoke = await admin.delete(`/api/orders/${created.body.order.id}/tracking-link`);
  assert.equal(revoke.status, 200);
  assert.equal((await request(app).get(`/api/track/${token}`)).status, 404, 'enlace revocado');
});

test('los clientes no tienen cuenta: no hay registro ni acceso con rol cliente', async () => {
  assert.equal((await request(app).post('/api/auth/register').send({ name: 'X', email: 'x@x.do', phone: '8090000000', password: 'Clave12345' })).status, 404);
  const res = await admin.post('/api/users').send({ role: 'customer', name: 'Cliente', email: 'cli@demo.do', password: 'Clave12345' });
  assert.equal(res.status, 400, 'no se pueden crear usuarios con rol cliente');
});

test('el mensajero comparte el enlace de sus pedidos y el enlace vence al entregar', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Enlace Mensajero', phone: '809-000-4444' },
    address: { formatted_address: 'Naco', lat: 18.476, lng: -69.93 },
    courier_id: juanId,
  });
  const order = created.body.order;
  const share = await juan.get(`/api/courier/orders/${order.id}/share`);
  assert.equal(share.status, 200, JSON.stringify(share.body));
  assert.match(share.body.whatsapp_url, /^https:\/\/wa\.me\/18090004444\?text=/);
  assert.equal(share.body.url, order.tracking_link.url, 'reutiliza el mismo enlace vigente');
  assert.equal((await pedro.get(`/api/courier/orders/${order.id}/share`)).status, 404, 'otro mensajero no puede compartirlo');

  const token = order.tracking_link.token;
  assert.equal((await request(app).get(`/api/track/${token}`)).status, 200);
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'en_route' });
  await juan.post(`/api/courier/orders/${order.id}/status`).send({ status: 'delivered', proof: { receiver_name: 'Ana' } });

  assert.equal((await request(app).get(`/api/track/${token}`)).status, 404, 'el enlace vence al marcar Entregado');
  assert.equal((await request(app).post(`/api/track/${token}/location`).send({ lat: 18.47, lng: -69.93 })).status, 404);
  assert.equal((await juan.get(`/api/courier/orders/${order.id}/share`)).status, 409, 'no se puede volver a compartir');
  assert.equal((await admin.get(`/api/orders/${order.id}/share`)).status, 409);
  assert.equal((await admin.post(`/api/orders/${order.id}/tracking-link`)).status, 409, 'no se puede regenerar');
  const links = await db('tracking_links').where({ order_id: order.id });
  assert.ok(links.every((l) => l.revoked_at), 'todos los enlaces quedan revocados');
});

test('el enlace vence al cancelar el pedido', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Cancelado', phone: '809-000-5555' },
    address: { formatted_address: 'Gazcue', lat: 18.466, lng: -69.901 },
  });
  const token = created.body.order.tracking_link.token;
  assert.equal((await request(app).get(`/api/track/${token}`)).status, 200);
  await admin.post(`/api/orders/${created.body.order.id}/status`).send({ status: 'cancelled', note: 'Cliente desistió' });
  assert.equal((await request(app).get(`/api/track/${token}`)).status, 404);
});

test('administración de tarifas: crear, cambiar precio, exportar e importar', async () => {
  const created = await admin.post('/api/zones').send({
    name: 'Zona Prueba', kind: 'custom', geometry_type: 'circle', center_lat: 18.6, center_lng: -69.6, radius_m: 1000, price: 999,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const q = await admin.post('/api/zones/quote').send({ lat: 18.6, lng: -69.6 });
  assert.equal(q.body.fee, 999);
  await admin.patch(`/api/zones/${created.body.id}/price`).send({ price: 437 });
  assert.equal((await admin.post('/api/zones/quote').send({ lat: 18.6, lng: -69.6 })).body.fee, 437);
  const rates = (await admin.get(`/api/zones/${created.body.id}/rates`)).body;
  assert.equal(rates.length, 2, 'se conserva el historial de precios');
  const off = await admin.patch(`/api/zones/${created.body.id}/active`).send({ active: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.notEqual((await admin.post('/api/zones/quote').send({ lat: 18.6, lng: -69.6 })).body.fee, 437);

  const csv = await admin.get('/api/zones/export');
  assert.match(csv.text, /Los Alcarrizos/);
  const imported = await admin.post('/api/zones/import').send({ content: 'nombre,tipo,provincia,municipio,sector,precio,estado\nZona Importada,Provincia,La Romana,,,650,Activa\n' });
  assert.equal(imported.body.created, 1, JSON.stringify(imported.body));
  assert.equal((await admin.post('/api/zones/quote').send({ lat: 18.427, lng: -68.972 })).body.fee, 650);
});

test('un despachador no puede cambiar configuración ni tarifas', async () => {
  const disp = await login(app, 'despacho@demo.do', 'Despacho123!');
  assert.equal((await disp.get('/api/orders')).status, 200);
  assert.equal((await disp.put('/api/settings').send({ company_name: 'X' })).status, 403);
  assert.equal((await disp.post('/api/zones').send({ name: 'X', kind: 'custom', geometry_type: 'circle', center_lat: 1, center_lng: 1, radius_m: 1, price: 1 })).status, 403);
});

test('desactivar un usuario invalida su sesión', async () => {
  const ana = await login(app, 'ana@demo.do', 'Mensajero123!');
  assert.equal((await ana.get('/api/courier/me')).status, 200);
  const users = (await admin.get('/api/users?role=courier')).body;
  const anaUser = users.find((u) => u.email === 'ana@demo.do');
  await admin.post(`/api/users/${anaUser.id}/active`).send({ active: false });
  assert.equal((await ana.get('/api/courier/me')).status, 401);
});

test('rechaza formularios no JSON (protección CSRF)', async () => {
  const res = await admin.post('/api/orders').type('form').send('a=1');
  assert.equal(res.status, 415);
});

test('pedido para cliente nuevo sin teléfono (opcional)', async () => {
  const created = await admin.post('/api/orders').send({
    customer: { name: 'Cliente Sin Teléfono', phone: '' },
    address: { formatted_address: 'Calle 1, Naco', lat: 18.476, lng: -69.93 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.order.phone, null);
  // Dos clientes sin teléfono no se confunden entre sí.
  const other = await admin.post('/api/orders').send({ customer: { name: 'Otra Persona' }, address: { formatted_address: 'Calle 2, Naco', lat: 18.476, lng: -69.93 } });
  assert.equal(other.status, 201);
  assert.notEqual(other.body.order.customer_id, created.body.order.customer_id);
  // Un teléfono escrito sigue validándose.
  const bad = await admin.post('/api/orders').send({ customer: { name: 'Teléfono Malo', phone: '12' }, address: { formatted_address: 'Calle 3', lat: 18.476, lng: -69.93 } });
  assert.equal(bad.status, 400);
  // El enlace para compartir funciona sin teléfono.
  const share = await admin.get(`/api/orders/${created.body.order.id}/share`);
  assert.equal(share.status, 200);
  assert.match(share.body.whatsapp_url, /^https:\/\/wa\.me\/\?text=/, 'sin número: WhatsApp deja elegir el contacto');
});
