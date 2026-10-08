'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, login, db, request } = require('./helpers');

let app;
let admin;
let juan;

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

before(async () => {
  app = await setup();
  admin = await login(app, 'admin@demo.do', 'Admin123!');
  juan = await login(app, 'juan@demo.do', 'Mensajero123!');
});

after(async () => {
  await db.destroy();
});

test('logo de la empresa: se sube, se sirve y valida el formato', async () => {
  const png = fs.readFileSync(path.join(__dirname, '../../client/public/icons/icon-192.png'));
  const bad = await admin.put('/api/settings/logo').send({ data_url: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64') });
  assert.equal(bad.status, 400, 'rechaza contenido que no es PNG/JPEG');
  assert.equal((await juan.put('/api/settings/logo').send({ data_url: 'x' })).status, 403);

  const ok = await admin.put('/api/settings/logo').send({ data_url: 'data:image/png;base64,' + png.toString('base64') });
  assert.equal(ok.status, 200);
  const url = ok.body.settings.company_logo_url;
  assert.match(url, /^\/api\/public\/logo\?v=/);
  const cfg = await request(app).get('/api/public/config');
  assert.equal(cfg.body.company.company_logo_url, url);
  const img = await request(app).get(url).buffer(true).parse(binary);
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.body.length, png.length);

  await admin.delete('/api/settings/logo');
  assert.equal((await request(app).get('/api/public/logo')).status, 404);
});

test('mensajero nuevo con clave temporal: debe cambiarla antes de usar la app', async () => {
  const created = await admin.post('/api/users').send({ role: 'courier', name: 'Luis Temporal', email: 'luis@demo.do', phone: '809-555-7777', password: 'Temporal123' });
  assert.equal(created.status, 201);
  assert.equal(created.body.must_change_password, true);

  const luis = request.agent(app);
  const res = await luis.post('/api/auth/login').send({ email: 'luis@demo.do', password: 'Temporal123' });
  assert.equal(res.body.user.must_change_password, true);
  assert.equal((await luis.get('/api/auth/me')).body.user.must_change_password, true);
  assert.equal((await luis.get('/api/courier/orders')).status, 403, 'bloqueado hasta cambiar la clave');
  assert.equal((await luis.get('/api/auth/socket-token')).status, 403);

  const same = await luis.put('/api/auth/me/password').send({ current_password: 'Temporal123', new_password: 'Temporal123' });
  assert.equal(same.status, 400, 'la nueva clave debe ser distinta');
  const changed = await luis.put('/api/auth/me/password').send({ current_password: 'Temporal123', new_password: 'MiClave2026' });
  assert.equal(changed.status, 200);
  assert.equal((await luis.get('/api/auth/me')).body.user.must_change_password, false);
  assert.equal((await luis.get('/api/courier/orders')).status, 200);

  // Si el administrador le restablece la clave, vuelve a ser temporal.
  await admin.post(`/api/users/${created.body.id}/password`).send({ password: 'OtraTemporal1' });
  const again = request.agent(app);
  await again.post('/api/auth/login').send({ email: 'luis@demo.do', password: 'OtraTemporal1' });
  assert.equal((await again.get('/api/courier/orders')).status, 403);
});

test('factura PDF: admin y el mensajero del pedido; nadie más', async () => {
  await admin.put('/api/settings').send({ company_name: 'Entregas Quisqueya', company_rnc: '131123456' });
  const juanOrder = (await juan.get('/api/courier/orders')).body[0];
  const pdf = await admin.get(`/api/orders/${juanOrder.id}/invoice`).buffer(true).parse(binary);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  const mine = await juan.get(`/api/courier/orders/${juanOrder.id}/invoice`).buffer(true).parse(binary);
  assert.equal(mine.status, 200);
  const pedro = await login(app, 'pedro@demo.do', 'Mensajero123!');
  assert.equal((await pedro.get(`/api/courier/orders/${juanOrder.id}/invoice`)).status, 404, 'otro mensajero no la ve');
  assert.equal((await request(app).get(`/api/orders/${juanOrder.id}/invoice`)).status, 401);

  const bad = await admin.put('/api/settings').send({ company_rnc: 'abc' });
  assert.equal(bad.status, 400, 'RNC inválido');
  assert.equal((await admin.put('/api/settings').send({ company_rnc: '' })).status, 200, 'RNC es opcional');
});

test('división territorial completa de RD y tarifas sugeridas', async () => {
  const tree = (await admin.get('/api/geo/tree')).body;
  assert.equal(tree.provinces.length, 32, '32 provincias (incluye el Distrito Nacional)');
  assert.ok(tree.municipalities.filter((m) => m.kind === 'municipio').length >= 158, '158 municipios (ONE 2021)');
  assert.ok(tree.municipalities.every((m) => m.lat != null && m.lng != null), 'todos con coordenadas');
  const santiago = tree.provinces.find((p) => p.name === 'Santiago');
  assert.equal(tree.municipalities.filter((m) => m.province_id === santiago.id).length, 10);

  // Cargar de nuevo no duplica nada.
  const again = (await admin.post('/api/geo/load-base')).body;
  assert.deepEqual(again, { provinces: 0, municipalities: 0, sectors: 0 });
  assert.equal((await juan.post('/api/geo/load-base')).status, 403);

  const first = (await admin.post('/api/zones/load-suggested')).body;
  assert.ok(first.created >= 1);
  assert.equal((await admin.post('/api/zones/load-suggested')).body.created, 0, 'no duplica zonas');
  const zones = (await admin.get('/api/zones')).body;
  assert.ok(zones.some((z) => z.name === 'Santo Domingo Oeste' && z.price === 250));
});

test('las zonas sin provincia/municipio/sector se marcan y "tarifas sugeridas" las repara', async () => {
  const haina = (await admin.get('/api/zones')).body.find((z) => z.name === 'Haina');
  await db('delivery_zones').where({ id: haina.id }).update({ province_id: null, municipality_id: null, sector_id: null, geometry_type: 'none', polygon: null, center_lat: null, center_lng: null, radius_m: null });
  const broken = (await admin.get('/api/zones')).body.find((z) => z.name === 'Haina');
  assert.equal(broken.covers, false);
  const before = (await admin.post('/api/zones/quote').send({ lat: 18.4167, lng: -70.0333 })).body;
  assert.notEqual(before.zone?.name, 'Haina');

  const r = (await admin.post('/api/zones/load-suggested')).body;
  assert.ok(r.repaired >= 1);
  const fixed = (await admin.get('/api/zones')).body.find((z) => z.name === 'Haina');
  assert.equal(fixed.covers, true);
  assert.equal(fixed.municipality_name, 'Bajos de Haina');
  assert.equal(fixed.price, haina.price, 'conserva su precio');
});
