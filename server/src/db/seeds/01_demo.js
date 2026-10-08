'use strict';
/**
 * Datos de ejemplo de República Dominicana para demostrar la plataforma.
 * Todo (provincias, sectores, zonas, tarifas, usuarios) se puede editar luego desde el panel.
 * ¡Este seed BORRA los datos existentes! No se ejecuta en producción salvo SEED_FORCE=true.
 */
const bcrypt = require('bcryptjs');
const geoData = require('./data/dominican-republic.json');
const { loadBaseGeography } = require('../../modules/geo/base');
const { uuid, randomToken, sha256, encrypt } = require('../../utils/crypto');

const TABLES_IN_DELETE_ORDER = [
  'inventory_movements', 'inventory_request_items', 'inventory_requests', 'order_items', 'courier_stock', 'products',
  'audit_logs', 'notifications', 'push_subscriptions', 'tracking_links', 'delivery_proofs', 'delivery_assignments',
  'order_status_history', 'courier_locations', 'orders', 'customer_addresses', 'customers', 'couriers',
  'delivery_rates', 'delivery_zones', 'sectors', 'municipalities', 'provinces', 'branches', 'users',
];

// Generador pseudoaleatorio determinista para que la demo sea reproducible.
let rngState = 20261008;
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    throw new Error('El seed de demostración borra datos. Usa SEED_FORCE=true si realmente deseas ejecutarlo en producción.');
  }
  for (const t of TABLES_IN_DELETE_ORDER) await knex(t).del();
  await knex('settings').whereNot({ key: 'vapid_keys' }).del();

  const ts = new Date().toISOString();
  const stamp = { created_at: ts, updated_at: ts };

  // --- Geografía (la misma división territorial que se carga en producción) ---
  await loadBaseGeography(knex);
  const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r.id]));
  const provinceIds = byName(await knex('provinces').select('id', 'name'));
  const municipalityIds = byName(await knex('municipalities').select('id', 'name'));
  const sectorIds = byName(await knex('sectors').select('id', 'name'));

  // --- Sucursal ---
  const branchId = uuid();
  await knex('branches').insert({ id: branchId, name: 'Sucursal Principal', address: 'Av. 27 de Febrero, Santo Domingo', lat: 18.4730, lng: -69.9390, phone: '809-555-0100', active: true, ...stamp });

  // --- Usuarios ---
  const hash = (p) => bcrypt.hash(p, 10);
  const adminId = uuid();
  await knex('users').insert([
    { id: adminId, role_id: 'admin', name: 'Administrador Demo', email: 'admin@demo.do', phone: '809-555-0100', password_hash: await hash('Admin123!'), active: true, token_version: 0, ...stamp },
    { id: uuid(), role_id: 'dispatcher', name: 'Laura Despacho', email: 'despacho@demo.do', phone: '809-555-0102', password_hash: await hash('Despacho123!'), active: true, token_version: 0, ...stamp },
  ]);

  const courierDefs = [
    { name: 'Juan Pérez', email: 'juan@demo.do', phone: '809-555-0201', vehicle: 'Motor Honda CG 150', plate: 'K123456', lat: 18.4920, lng: -69.9650 },
    { name: 'Pedro Martínez', email: 'pedro@demo.do', phone: '829-555-0202', vehicle: 'Motor Yamaha YBR', plate: 'K654321', lat: 18.4880, lng: -69.8600 },
    { name: 'Ana Castillo', email: 'ana@demo.do', phone: '849-555-0203', vehicle: 'Carro Toyota Yaris', plate: 'A778899', lat: null, lng: null },
  ];
  const couriers = [];
  const courierPassword = await hash('Mensajero123!');
  for (const c of courierDefs) {
    const userId = uuid();
    const id = uuid();
    await knex('users').insert({ id: userId, role_id: 'courier', name: c.name, email: c.email, phone: c.phone, password_hash: courierPassword, active: true, token_version: 0, ...stamp });
    await knex('couriers').insert({ id, user_id: userId, branch_id: branchId, vehicle: c.vehicle, plate: c.plate, status: 'off_duty', shift_active: false, sharing_location: false, last_lat: c.lat, last_lng: c.lng, last_location_at: c.lat ? ts : null, ...stamp });
    couriers.push({ ...c, id, userId });
  }

  // --- Zonas y tarifas ---
  const zoneIds = {};
  for (const z of geoData.zones) {
    const id = uuid();
    zoneIds[z.name] = id;
    await knex('delivery_zones').insert({
      id,
      name: z.name,
      kind: z.kind,
      province_id: z.province ? provinceIds[z.province] : null,
      municipality_id: z.municipality ? municipalityIds[z.municipality] : null,
      sector_id: z.sector ? sectorIds[z.sector] : null,
      geometry_type: z.geometry,
      polygon: z.geometry === 'polygon' ? JSON.stringify(z.data.polygon) : null,
      center_lat: z.geometry === 'circle' ? z.data.center[0] : null,
      center_lng: z.geometry === 'circle' ? z.data.center[1] : null,
      radius_m: z.geometry === 'circle' ? z.data.radius : null,
      priority: 0,
      color: z.color,
      active: true,
      ...stamp,
    });
    await knex('delivery_rates').insert({ id: uuid(), zone_id: id, price: z.price, currency: 'DOP', created_by: adminId, effective_from: ts, created_at: ts });
  }

  // --- Clientes ---
  const customerDefs = [
    { name: 'María Rodríguez', phone: '809-555-0101', email: 'maria@demo.do', address: 'Calle Respaldo Los Mina #12, Los Mina', sector: 'Los Mina', lat: 18.4952, lng: -69.8735, ref: 'Frente al colmado La Esquina, portón verde' },
    { name: 'Carlos Gómez', phone: '829-555-0110', address: 'Plaza Fermín, Km 9 Autopista Duarte', sector: 'Km 9 Autopista Duarte', lat: 18.4935, lng: -69.9690, ref: 'Local 14, segundo nivel' },
    { name: 'Luisa Fernández', phone: '809-555-0111', address: 'Av. Gustavo Mejía Ricart #54, Piantini', sector: 'Piantini', lat: 18.4718, lng: -69.9395, ref: 'Torre Ámbar, apto 5B' },
    { name: 'José Santana', phone: '849-555-0112', address: 'Calle Duarte #8, Los Alcarrizos', sector: 'Los Alcarrizos Centro', lat: 18.5172, lng: -70.0160, ref: 'Al lado de la farmacia' },
    { name: 'Rosa Jiménez', phone: '809-555-0113', address: 'Calle Duarte #30, Boca Chica', sector: 'Boca Chica Centro', lat: 18.4545, lng: -69.6070, ref: 'Casa amarilla' },
    { name: 'Miguel Batista', phone: '829-555-0114', address: 'Av. Hermanas Mirabal #120, Villa Mella', sector: 'Villa Mella', lat: 18.5545, lng: -69.9025, ref: 'Edificio 3, primer piso' },
    { name: 'Carmen Díaz', phone: '809-555-0115', address: 'Carretera Sánchez Km 13, Haina', sector: 'Haina Centro', lat: 18.4175, lng: -70.0330, ref: 'Detrás de la iglesia' },
    { name: 'Rafael Peña', phone: '849-555-0116', address: 'Calle Activo 20-30 #5, Herrera', sector: 'Herrera', lat: 18.4770, lng: -69.9660, ref: 'Zona industrial, nave 4' },
    { name: 'Yolanda Reyes', phone: '809-555-0117', address: 'Av. San Vicente de Paúl #77, Alma Rosa', sector: 'Alma Rosa', lat: 18.4885, lng: -69.8565, ref: 'Plaza comercial, local 2' },
    { name: 'Esteban Mejía', phone: '829-555-0118', address: 'Calle del Sol #45, Santiago', sector: 'Centro de Santiago', lat: 19.4520, lng: -70.6965, ref: 'Frente al parque Duarte' },
  ];
  const customers = [];
  for (const c of customerDefs) {
    const id = uuid();
    await knex('customers').insert({ id, user_id: null, name: c.name, phone: c.phone, whatsapp: c.phone, email: c.email || null, active: true, ...stamp });
    const sectorRow = geoData.sectors.find((s) => s.name === c.sector);
    const municipality = geoData.municipalities.find((m) => m.name === sectorRow.municipality);
    const addressId = uuid();
    await knex('customer_addresses').insert({
      id: addressId, customer_id: id, label: 'Principal', formatted_address: c.address, lat: c.lat, lng: c.lng, place_id: null,
      province_id: provinceIds[municipality.province], municipality_id: municipalityIds[municipality.name], sector_id: sectorIds[c.sector],
      reference: c.ref, is_default: true, ...stamp,
    });
    customers.push({ ...c, id, addressId, province_id: provinceIds[municipality.province], municipality_id: municipalityIds[municipality.name], sector_id: sectorIds[c.sector] });
  }

  // --- Pedidos ---
  const { quote } = require('../../modules/zones/service');
  let orderNumber = 1250;
  const now = Date.now();
  const createOrder = async ({ customer, status, courier, createdAgoMin, durationMin = 45, subtotal }) => {
    const id = uuid();
    const created = new Date(now - createdAgoMin * 60_000);
    const q = await quote({ lat: customer.lat, lng: customer.lng, province_id: customer.province_id, municipality_id: customer.municipality_id, sector_id: customer.sector_id });
    const fee = q.fee ?? 300;
    const steps = { new: ['new'], preparing: ['new', 'preparing'], ready: ['new', 'preparing', 'ready'], assigned: ['new', 'preparing', 'assigned'],
      en_route: ['new', 'preparing', 'assigned', 'en_route'], delivered: ['new', 'preparing', 'assigned', 'en_route', 'arrived', 'delivered'],
      failed: ['new', 'preparing', 'assigned', 'en_route', 'arrived', 'failed'], customer_unavailable: ['new', 'assigned', 'en_route', 'arrived', 'customer_unavailable'],
      cancelled: ['new', 'cancelled'] }[status];
    const stepTime = (i) => new Date(created.getTime() + (i * durationMin * 60_000) / Math.max(steps.length - 1, 1)).toISOString();
    const at = (s) => (steps.includes(s) ? stepTime(steps.indexOf(s)) : null);
    const order = {
      id, order_number: ++orderNumber, branch_id: branchId, customer_id: customer.id, address_id: customer.addressId,
      customer_name: customer.name, phone: customer.phone, address: customer.address, lat: customer.lat, lng: customer.lng, place_id: null,
      reference: customer.ref, province_id: customer.province_id, municipality_id: customer.municipality_id, sector_id: customer.sector_id,
      zone_id: q.zone?.id || null, delivery_fee: fee, fee_overridden: false, subtotal, total: subtotal + fee,
      payment_method: pick(['cash', 'cash', 'card', 'transfer']), payment_status: status === 'delivered' ? 'paid' : 'pending',
      status, priority: 0, courier_id: courier && steps.includes('assigned') ? courier.id : null, notes: null,
      assigned_at: at('assigned'), departed_at: at('en_route'), arrived_at: at('arrived'), delivered_at: at('delivered'),
      location_confirmed: rand() > 0.4, created_by: adminId, created_at: created.toISOString(), updated_at: stepTime(steps.length - 1),
    };
    await knex('orders').insert(order);
    let prev = null;
    for (const [i, s] of steps.entries()) {
      await knex('order_status_history').insert({ id: uuid(), order_id: id, from_status: prev, to_status: s, user_id: s === 'new' || s === 'assigned' || s === 'cancelled' ? adminId : courier?.userId || adminId, actor_role: ['en_route', 'arrived', 'delivered', 'failed', 'customer_unavailable'].includes(s) ? 'courier' : 'admin', note: i === 0 ? 'Pedido creado' : null, created_at: stepTime(i) });
      prev = s;
    }
    if (order.courier_id) await knex('delivery_assignments').insert({ id: uuid(), order_id: id, courier_id: order.courier_id, assigned_by: adminId, assigned_at: order.assigned_at });
    if (['delivered', 'failed', 'customer_unavailable'].includes(status)) {
      await knex('delivery_proofs').insert({ id: uuid(), order_id: id, courier_id: order.courier_id, outcome: status, receiver_name: status === 'delivered' ? customer.name.split(' ')[0] : null, notes: status === 'delivered' ? 'Entregado sin novedad' : 'No respondió al timbre ni al teléfono', lat: customer.lat + 0.0002, lng: customer.lng - 0.0002, accuracy: 15, created_at: order.updated_at });
    }
    const token = randomToken(32);
    await knex('tracking_links').insert({ id: uuid(), order_id: id, token_hash: sha256(token), token_encrypted: encrypt(token), expires_at: new Date(now + 7 * 86400_000).toISOString(), created_by: adminId, created_at: order.created_at });
    return { ...order, token };
  };

  // Historial de los últimos 10 días.
  for (let day = 10; day >= 1; day--) {
    const count = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const status = rand() < 0.85 ? 'delivered' : pick(['failed', 'customer_unavailable', 'cancelled']);
      await createOrder({ customer: pick(customers), status, courier: pick(couriers), createdAgoMin: day * 1440 - 480 + Math.floor(rand() * 500), subtotal: 500 + Math.floor(rand() * 40) * 50 });
    }
  }
  // Pedidos de hoy en distintos estados.
  const [juan, pedro] = couriers;
  const today = [
    { customer: customers[1], status: 'delivered', courier: juan, createdAgoMin: 240 },
    { customer: customers[7], status: 'delivered', courier: juan, createdAgoMin: 200 },
    { customer: customers[0], status: 'en_route', courier: pedro, createdAgoMin: 50, durationMin: 30 },
    { customer: customers[8], status: 'assigned', courier: pedro, createdAgoMin: 40 },
    { customer: customers[3], status: 'assigned', courier: juan, createdAgoMin: 35 },
    { customer: customers[2], status: 'assigned', courier: juan, createdAgoMin: 30 },
    { customer: customers[5], status: 'preparing', courier: null, createdAgoMin: 20 },
    { customer: customers[6], status: 'new', courier: null, createdAgoMin: 10 },
    { customer: customers[4], status: 'ready', courier: null, createdAgoMin: 15 },
  ];
  const todayOrders = [];
  for (const o of today) todayOrders.push(await createOrder({ ...o, subtotal: 800 + Math.floor(rand() * 20) * 100 }));

  // --- Inventario de ejemplo ---
  const productDefs = [
    { sku: 'AGUA-5G', name: 'Botellón de agua 5 galones', unit: 'botellón', price: 100, warehouse: 300, min: 50 },
    { sku: 'REF-24', name: 'Caja de refrescos (24 uds.)', unit: 'caja', price: 900, warehouse: 80, min: 20 },
    { sku: 'ARROZ-25', name: 'Saco de arroz 25 lb', unit: 'saco', price: 1150, warehouse: 30, min: 25 },
    { sku: 'ACEITE-1G', name: 'Aceite vegetal 1 galón', unit: 'galón', price: 650, warehouse: 90, min: 20 },
  ];
  const products = [];
  for (const p of productDefs) {
    const id = uuid();
    await knex('products').insert({ id, sku: p.sku, name: p.name, unit: p.unit, price: p.price, warehouse_stock: p.warehouse, min_stock: p.min, active: true, ...stamp });
    await knex('inventory_movements').insert({ id: uuid(), type: 'warehouse_adjust', product_id: id, warehouse_delta: p.warehouse, user_id: adminId, note: 'Existencia inicial', created_at: ts });
    products.push({ ...p, id });
  }
  // Inventario asignado a Juan y Pedro.
  for (const [courier, qty] of [[couriers[0], [20, 6, 4, 6]], [couriers[1], [15, 4, 3, 5]]]) {
    for (const [i, p] of products.entries()) {
      await knex('courier_stock').insert({ id: uuid(), courier_id: courier.id, product_id: p.id, quantity: qty[i], updated_at: ts });
      await knex('products').where({ id: p.id }).decrement('warehouse_stock', qty[i]);
      await knex('inventory_movements').insert({ id: uuid(), type: 'assign', product_id: p.id, courier_id: courier.id, courier_delta: qty[i], warehouse_delta: -qty[i], user_id: adminId, note: 'Carga del día', created_at: ts });
    }
  }
  // Productos en los pedidos abiertos de hoy.
  for (const [i, o] of todayOrders.filter((x) => !['delivered', 'cancelled'].includes(x.status)).entries()) {
    const p1 = products[i % products.length];
    const p2 = products[(i + 1) % products.length];
    const lines = [{ p: p1, q: 2 }, ...(i % 2 ? [{ p: p2, q: 1 }] : [])];
    let subtotal = 0;
    for (const l of lines) {
      subtotal += l.p.price * l.q;
      await knex('order_items').insert({ id: uuid(), order_id: o.id, product_id: l.p.id, product_name: l.p.name, quantity: l.q, unit_price: l.p.price, created_at: ts });
    }
    await knex('orders').where({ id: o.id }).update({ subtotal, total: subtotal + Number(o.delivery_fee) });
  }

  // Pedro está en ruta hacia María con la jornada activa y ubicación compartida.
  const enRoute = todayOrders.find((o) => o.status === 'en_route');
  await knex('couriers').where({ id: pedro.id }).update({ shift_active: true, shift_started_at: new Date(now - 3 * 3600_000).toISOString(), sharing_location: true, status: 'en_route', current_order_id: enRoute.id, last_lat: 18.4905, last_lng: -69.8640, last_accuracy: 12, last_location_at: ts });
  await knex('orders').where({ id: enRoute.id }).update({ eta_seconds: 540, eta_distance_m: 1900, eta_updated_at: ts });
  await knex('couriers').where({ id: juan.id }).update({ shift_active: true, shift_started_at: new Date(now - 5 * 3600_000).toISOString(), sharing_location: true, status: 'available', last_lat: 18.4932, last_lng: -69.9672, last_accuracy: 10, last_location_at: ts });

  // Rutas ordenadas por el administrador.
  let routeOrder = 1;
  for (const o of todayOrders.filter((x) => x.courier_id === juan.id && x.status === 'assigned')) await knex('orders').where({ id: o.id }).update({ route_order: routeOrder++ });

  if (process.env.NODE_ENV !== 'test') {
    console.log('\nUsuarios de demostración:');
    console.log('  Administrador: admin@demo.do / Admin123!');
    console.log('  Despachador:   despacho@demo.do / Despacho123!');
    console.log('  Mensajeros:    juan@demo.do, pedro@demo.do, ana@demo.do / Mensajero123!');
    console.log(`\nSeguimiento de ejemplo (pedido #${enRoute.order_number} en camino):`);
    console.log(`  ${(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/seguimiento/${enRoute.token}\n`);
  }
};
