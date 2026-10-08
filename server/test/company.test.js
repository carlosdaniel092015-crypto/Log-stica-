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
