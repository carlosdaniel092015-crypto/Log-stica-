'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { badRequest, notFound, forbidden, conflict } = require('../../utils/http');
const { audit } = require('../audit/service');
const { quote } = require('../zones/service');
const { resolveAdministrative } = require('../geo/resolver');
const { getSettings } = require('../settings/service');
const { createLink, activeLink, revokeLinks, FINAL_STATUSES } = require('../tracking/links');
const { STATUS_LABELS, canTransition, ACTIVE_ROUTE, OUTCOMES } = require('./statuses');
const events = require('./events');
const inventory = require('../inventory/service');

const money = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

function mapOrder(o) {
  if (!o) return null;
  return {
    id: o.id,
    order_number: o.order_number,
    branch_id: o.branch_id,
    customer_id: o.customer_id,
    address_id: o.address_id,
    customer_name: o.customer_name,
    phone: o.phone,
    address: o.address,
    lat: o.lat,
    lng: o.lng,
    place_id: o.place_id,
    reference: o.reference,
    province_id: o.province_id,
    province_name: o.province_name ?? null,
    municipality_id: o.municipality_id,
    municipality_name: o.municipality_name ?? null,
    sector_id: o.sector_id,
    sector_name: o.sector_name ?? null,
    zone_id: o.zone_id,
    zone_name: o.zone_name ?? null,
    delivery_fee: money(o.delivery_fee),
    fee_overridden: bool(o.fee_overridden),
    subtotal: money(o.subtotal),
    total: money(o.total),
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    status: o.status,
    status_label: STATUS_LABELS[o.status] || o.status,
    priority: o.priority,
    route_order: o.route_order,
    courier_id: o.courier_id,
    courier_name: o.courier_name ?? null,
    courier_phone: o.courier_phone ?? null,
    notes: o.notes,
    scheduled_for: o.scheduled_for,
    assigned_at: o.assigned_at,
    departed_at: o.departed_at,
    arrived_at: o.arrived_at,
    delivered_at: o.delivered_at,
    eta_seconds: o.eta_seconds,
    eta_distance_m: o.eta_distance_m,
    eta_updated_at: o.eta_updated_at,
    location_confirmed: bool(o.location_confirmed),
    customer_whatsapp: o.customer_whatsapp ?? null,
    customer_email: o.customer_email ?? null,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

function ordersQuery() {
  return db('orders as o')
    .leftJoin('provinces as p', 'p.id', 'o.province_id')
    .leftJoin('municipalities as m', 'm.id', 'o.municipality_id')
    .leftJoin('sectors as s', 's.id', 'o.sector_id')
    .leftJoin('delivery_zones as z', 'z.id', 'o.zone_id')
    .leftJoin('couriers as c', 'c.id', 'o.courier_id')
    .leftJoin('users as cu', 'cu.id', 'c.user_id')
    .leftJoin('customers as cus', 'cus.id', 'o.customer_id')
    .select(
      'o.*',
      'p.name as province_name',
      'm.name as municipality_name',
      's.name as sector_name',
      'z.name as zone_name',
      'cu.name as courier_name',
      'cu.phone as courier_phone',
      'cus.whatsapp as customer_whatsapp',
      'cus.email as customer_email'
    );
}

async function getOrder(id) {
  return mapOrder(await ordersQuery().where('o.id', id).first());
}

async function getOrderDetail(id) {
  const order = await getOrder(id);
  if (!order) throw notFound('Pedido no encontrado.');
  const [history, assignments, proofs, link, itemsByOrder, invRequests] = await Promise.all([
    db('order_status_history as h').leftJoin('users as u', 'u.id', 'h.user_id').where('h.order_id', id).orderBy('h.created_at', 'asc').select('h.*', 'u.name as user_name'),
    db('delivery_assignments as a')
      .leftJoin('couriers as c', 'c.id', 'a.courier_id')
      .leftJoin('users as cu', 'cu.id', 'c.user_id')
      .leftJoin('users as by', 'by.id', 'a.assigned_by')
      .where('a.order_id', id)
      .orderBy('a.assigned_at', 'asc')
      .select('a.*', 'cu.name as courier_name', 'by.name as assigned_by_name'),
    db('delivery_proofs').where({ order_id: id }).orderBy('created_at', 'desc'),
    activeLink(id),
    inventory.itemsForOrders([id]),
    inventory.listRequests({ orderId: id }),
  ]);
  return {
    ...order,
    history: history.map((h) => ({ ...h, to_label: STATUS_LABELS[h.to_status], from_label: STATUS_LABELS[h.from_status] || null })),
    assignments,
    proofs: proofs.map(mapProof),
    tracking_link: link,
    items: itemsByOrder[id] || [],
    inventory_requests: invRequests,
  };
}

function mapProof(p) {
  return {
    id: p.id,
    outcome: p.outcome,
    outcome_label: STATUS_LABELS[p.outcome],
    receiver_name: p.receiver_name,
    notes: p.notes,
    has_photo: !!p.photo_path,
    has_signature: !!p.signature_path,
    photo_url: p.photo_path ? `/api/proofs/${p.id}/photo` : null,
    signature_url: p.signature_path ? `/api/proofs/${p.id}/signature` : null,
    lat: p.lat,
    lng: p.lng,
    accuracy: p.accuracy,
    created_at: p.created_at,
  };
}

async function listOrders(filters = {}, { courierId, customerId } = {}) {
  const q = ordersQuery();
  if (courierId) q.where('o.courier_id', courierId);
  if (customerId) q.where('o.customer_id', customerId);
  if (filters.status) q.whereIn('o.status', String(filters.status).split(','));
  if (filters.courier_id) q.where('o.courier_id', filters.courier_id);
  if (filters.zone_id) q.where('o.zone_id', filters.zone_id);
  if (filters.from) q.where('o.created_at', '>=', new Date(filters.from).toISOString());
  if (filters.to) q.where('o.created_at', '<=', new Date(filters.to).toISOString());
  if (filters.q) {
    const term = `%${String(filters.q).toLowerCase()}%`;
    const asNumber = Number(String(filters.q).replace('#', ''));
    q.where((w) => {
      w.whereRaw('lower(o.customer_name) like ?', [term]).orWhereRaw('lower(o.address) like ?', [term]).orWhere('o.phone', 'like', term);
      if (Number.isInteger(asNumber) && asNumber > 0) w.orWhere('o.order_number', asNumber);
    });
  }
  q.orderBy('o.created_at', 'desc').limit(Math.min(Number(filters.limit) || 200, 500));
  return (await q).map(mapOrder);
}

/** Resuelve la ubicación administrativa y la tarifa de una dirección. */
async function priceAddress(address) {
  const geo = await resolveAdministrative({ lat: address.lat, lng: address.lng, components: address.components || [] });
  const point = {
    lat: address.lat,
    lng: address.lng,
    province_id: address.province_id || geo.province_id,
    municipality_id: address.municipality_id || geo.municipality_id,
    sector_id: address.sector_id || geo.sector_id,
  };
  const q = await quote(point);
  return { geo: { ...geo, province_id: point.province_id, municipality_id: point.municipality_id, sector_id: point.sector_id }, quote: q };
}

async function nextOrderNumber(trx) {
  const row = await trx('orders').max('order_number as max').first();
  return Math.max(Number(row?.max) || 0, 1000) + 1;
}

async function insertHistory(trx, { orderId, from, to, user, role, note, lat, lng }) {
  await trx('order_status_history').insert({
    id: uuid(),
    order_id: orderId,
    from_status: from || null,
    to_status: to,
    user_id: user?.id || null,
    actor_role: role || user?.role || 'system',
    note: note ? String(note).slice(0, 500) : null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    created_at: now(),
  });
}

async function findOrCreateCustomer(trx, input, req) {
  if (input.customer_id) {
    const c = await trx('customers').where({ id: input.customer_id }).first();
    if (!c) throw badRequest('El cliente seleccionado no existe.');
    return c;
  }
  const data = input.customer;
  if (!data?.name) throw badRequest('Indica el nombre del cliente.');
  // Sin teléfono no se puede reconocer a un cliente existente: se registra uno nuevo.
  if (data.phone) {
    const existing = await trx('customers').where({ phone: data.phone }).first();
    if (existing) return existing;
  }
  const ts = now();
  const c = {
    id: uuid(),
    name: data.name,
    phone: data.phone || null,
    whatsapp: data.whatsapp || data.phone || null,
    email: data.email || null,
    notes: null,
    active: true,
    created_at: ts,
    updated_at: ts,
  };
  await trx('customers').insert(c);
  await audit(req, { action: 'customer.create', entity: 'customer', entityId: c.id, newValue: { name: c.name, phone: c.phone } }, trx);
  return c;
}

/**
 * Crea un pedido: resuelve cliente, dirección, zona y tarifa en el servidor,
 * genera el enlace privado de seguimiento y opcionalmente asigna mensajero.
 */
async function createOrder(input, req) {
  const user = req.user;
  const address = input.address;
  const { geo, quote: q } = await priceAddress(address);
  const canOverride = req.user.permissions.includes('*') || req.user.permissions.includes('orders.override_fee');

  let fee = q.fee;
  let overridden = false;
  if (input.delivery_fee != null && input.delivery_fee !== q.fee) {
    if (!canOverride) throw forbidden('No tienes permiso para modificar manualmente el costo de envío.');
    fee = input.delivery_fee;
    overridden = true;
  }
  if (fee == null) throw badRequest('La dirección está fuera de cobertura. Indica el costo de envío manualmente o crea una zona.');

  const result = await db.transaction(async (trx) => {
    const customer = await findOrCreateCustomer(trx, input, req);
    const ts = now();
    let addressId = input.address_id || null;
    if (!addressId && input.save_address) {
      addressId = uuid();
      await trx('customer_addresses').insert({
        id: addressId,
        customer_id: customer.id,
        label: address.label || 'Principal',
        formatted_address: address.formatted_address,
        lat: address.lat ?? null,
        lng: address.lng ?? null,
        place_id: address.place_id || null,
        province_id: geo.province_id,
        municipality_id: geo.municipality_id,
        sector_id: geo.sector_id,
        reference: address.reference || null,
        is_default: !(await trx('customer_addresses').where({ customer_id: customer.id }).first()),
        created_at: ts,
        updated_at: ts,
      });
    }
    const subtotal = money(input.subtotal || 0);
    const order = {
      id: uuid(),
      order_number: await nextOrderNumber(trx),
      branch_id: input.branch_id || (await trx('branches').where({ active: true }).orderBy('created_at').first('id'))?.id || null,
      customer_id: customer.id,
      address_id: addressId,
      customer_name: customer.name,
      phone: customer.phone,
      address: address.formatted_address,
      lat: address.lat ?? null,
      lng: address.lng ?? null,
      place_id: address.place_id || null,
      reference: address.reference || null,
      province_id: geo.province_id,
      municipality_id: geo.municipality_id,
      sector_id: geo.sector_id,
      zone_id: q.zone?.id || null,
      delivery_fee: money(fee),
      fee_overridden: overridden,
      subtotal,
      total: money(subtotal + fee),
      payment_method: input.payment_method || 'cash',
      payment_status: input.payment_status || 'pending',
      status: input.status || 'new',
      priority: input.priority || 0,
      notes: input.notes || null,
      scheduled_for: input.scheduled_for || null,
      location_confirmed: !!input.location_confirmed,
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
    };
    await trx('orders').insert(order);
    if (input.items?.length) {
      // Productos del pedido: si no se indicó subtotal, se calcula con los precios del catálogo.
      const r = await inventory.setOrderItems(trx, order.id, input.items);
      if (input.subtotal == null) {
        order.subtotal = r.subtotal;
        order.total = money(r.subtotal + fee);
        await trx('orders').where({ id: order.id }).update({ subtotal: order.subtotal, total: order.total });
      }
    }
    await insertHistory(trx, { orderId: order.id, from: null, to: order.status, user, note: 'Pedido creado' });
    const link = await createLink(trx, order.id, user.id);
    await audit(req, {
      action: 'order.create',
      entity: 'order',
      entityId: order.id,
      orderId: order.id,
      newValue: { order_number: order.order_number, customer: order.customer_name, delivery_fee: order.delivery_fee, zone: q.zone?.name || null, fee_overridden: overridden },
    }, trx);
    return { order, link };
  });

  if (input.courier_id) await assignCourier(result.order.id, input.courier_id, req);
  else events.orderChanged(result.order.id, { type: 'created' });

  return { order: await getOrderDetail(result.order.id), quote: q };
}

const EDITABLE = ['customer_name', 'phone', 'reference', 'subtotal', 'payment_method', 'payment_status', 'priority', 'route_order', 'notes', 'scheduled_for'];

async function updateOrder(id, input, req) {
  const before = await db('orders').where({ id }).first();
  if (!before) throw notFound('Pedido no encontrado.');
  const patch = {};
  for (const key of EDITABLE) if (key in input) patch[key] = input[key];

  if (input.address) {
    const { geo, quote: q } = await priceAddress(input.address);
    Object.assign(patch, {
      address: input.address.formatted_address,
      lat: input.address.lat ?? null,
      lng: input.address.lng ?? null,
      place_id: input.address.place_id || null,
      reference: input.address.reference ?? patch.reference ?? before.reference,
      province_id: geo.province_id,
      municipality_id: geo.municipality_id,
      sector_id: geo.sector_id,
      zone_id: q.zone?.id || null,
    });
    if (!bool(before.fee_overridden) && input.delivery_fee == null) {
      if (q.fee == null) throw badRequest('La nueva dirección está fuera de cobertura. Indica el costo de envío manualmente.');
      patch.delivery_fee = q.fee;
    }
  }
  if (input.delivery_fee != null && money(input.delivery_fee) !== money(before.delivery_fee)) {
    const canOverride = req.user.permissions.includes('*') || req.user.permissions.includes('orders.override_fee');
    if (!canOverride) throw forbidden('No tienes permiso para modificar manualmente el costo de envío.');
    patch.delivery_fee = money(input.delivery_fee);
    patch.fee_overridden = true;
  }
  const subtotal = patch.subtotal != null ? Number(patch.subtotal) : Number(before.subtotal);
  const fee = patch.delivery_fee != null ? Number(patch.delivery_fee) : Number(before.delivery_fee);
  patch.total = money(subtotal + fee);
  patch.updated_at = now();

  await db.transaction(async (trx) => {
    await trx('orders').where({ id }).update(patch);
    const changed = {};
    const previous = {};
    for (const k of Object.keys(patch)) {
      if (k === 'updated_at') continue;
      if (String(before[k] ?? '') !== String(patch[k] ?? '')) {
        changed[k] = patch[k];
        previous[k] = before[k];
      }
    }
    if (Object.keys(changed).length) {
      await audit(req, { action: 'order.update', entity: 'order', entityId: id, orderId: id, oldValue: previous, newValue: changed }, trx);
    }
  });
  events.orderChanged(id, { type: 'updated' });
  return getOrderDetail(id);
}

async function setCourierState(trx, courierId) {
  if (!courierId) return;
  const courier = await trx('couriers').where({ id: courierId }).first();
  if (!courier) return;
  const active = await trx('orders').where({ courier_id: courierId }).whereIn('status', ACTIVE_ROUTE).orderBy('departed_at', 'desc').first();
  let status = courier.status;
  if (!bool(courier.shift_active)) status = 'off_duty';
  else if (status === 'paused') status = 'paused';
  else if (active?.status === 'arrived') status = 'delivering';
  else if (active) status = 'en_route';
  else status = 'available';
  await trx('couriers').where({ id: courierId }).update({ status, current_order_id: active?.id || null, updated_at: now() });
}

/** Asigna o cambia el mensajero de un pedido. */
async function assignCourier(orderId, courierId, req, reason) {
  const order = await db('orders').where({ id: orderId }).first();
  if (!order) throw notFound('Pedido no encontrado.');
  if (['delivered', 'cancelled'].includes(order.status)) throw conflict('No se puede asignar un pedido entregado o cancelado.');
  const previousCourier = order.courier_id;

  await db.transaction(async (trx) => {
    const ts = now();
    if (courierId) {
      const courier = await trx('couriers as c').join('users as u', 'u.id', 'c.user_id').where('c.id', courierId).first('c.id', 'u.active', 'u.name');
      if (!courier || !bool(courier.active)) throw badRequest('El mensajero no existe o está inactivo.');
    }
    if (previousCourier && previousCourier !== courierId) {
      await trx('delivery_assignments').where({ order_id: orderId, courier_id: previousCourier }).whereNull('unassigned_at').update({ unassigned_at: ts, reason: reason || 'Reasignado' });
    }
    const patch = { courier_id: courierId || null, updated_at: ts };
    let newStatus = order.status;
    if (courierId) {
      patch.assigned_at = ts;
      if (['new', 'preparing', 'ready', 'rescheduled', 'failed', 'customer_unavailable'].includes(order.status) || (previousCourier && previousCourier !== courierId && ACTIVE_ROUTE.includes(order.status))) {
        newStatus = 'assigned';
      }
      if (previousCourier !== courierId) {
        await trx('delivery_assignments').insert({ id: uuid(), order_id: orderId, courier_id: courierId, assigned_by: req.user?.id || null, assigned_at: ts });
      }
    } else if (['assigned', ...ACTIVE_ROUTE].includes(order.status)) {
      newStatus = 'ready';
    }
    patch.status = newStatus;
    await trx('orders').where({ id: orderId }).update(patch);
    if (newStatus !== order.status) {
      await insertHistory(trx, { orderId, from: order.status, to: newStatus, user: req.user, note: courierId ? 'Mensajero asignado' : 'Mensajero retirado' });
    }
    await audit(req, {
      action: courierId ? (previousCourier ? 'order.reassign' : 'order.assign') : 'order.unassign',
      entity: 'order',
      entityId: orderId,
      orderId,
      oldValue: { courier_id: previousCourier, status: order.status },
      newValue: { courier_id: courierId || null, status: newStatus },
    }, trx);
    await setCourierState(trx, previousCourier);
    await setCourierState(trx, courierId);
  });

  events.orderChanged(orderId, { type: 'assigned', previousCourierId: previousCourier, courierId });
  return getOrderDetail(orderId);
}

function saveDataUrl(dataUrl, orderId, kind) {
  if (!dataUrl) return null;
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest(`El archivo de ${kind === 'photo' ? 'fotografía' : 'firma'} no es una imagen válida.`);
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw badRequest('La imagen supera el tamaño máximo de 4 MB.');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const rel = path.join('proofs', orderId, `${kind}-${uuid()}.${ext}`);
  const abs = path.join(config.uploadsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

/**
 * Cambia el estado de un pedido validando la máquina de estados y el rol.
 * Registra historial, fechas clave, evidencia de entrega y auditoría.
 */
async function changeStatus(orderId, to, req, extra = {}) {
  const order = await db('orders').where({ id: orderId }).first();
  if (!order) throw notFound('Pedido no encontrado.');
  const role = req.user?.role === 'courier' ? 'courier' : req.system ? 'system' : 'staff';
  if (role === 'courier' && order.courier_id !== req.user.courierId) throw notFound('Pedido no encontrado.');
  if (order.status === to) return getOrderDetail(orderId);
  if (!canTransition(order.status, to, role)) {
    throw conflict(`No se puede cambiar de "${STATUS_LABELS[order.status]}" a "${STATUS_LABELS[to]}".`);
  }
  if (['assigned', 'en_route', 'arriving', 'arrived', 'delivered'].includes(to) && !order.courier_id) {
    throw badRequest('Asigna un mensajero antes de cambiar a este estado.');
  }
  const settings = await getSettings();
  if (to === 'delivered' && role === 'courier' && settings.proof_required && !extra.proof?.receiver_name) {
    throw badRequest('Indica el nombre de quien recibió el pedido.');
  }

  const ts = now();
  let photoPath = null;
  let signaturePath = null;
  if (OUTCOMES.includes(to) && extra.proof) {
    if (extra.proof.photo && settings.proof_photo_enabled) photoPath = saveDataUrl(extra.proof.photo, orderId, 'photo');
    if (extra.proof.signature && settings.proof_signature_enabled) signaturePath = saveDataUrl(extra.proof.signature, orderId, 'signature');
  }

  let consumed = null;
  await db.transaction(async (trx) => {
    const patch = { status: to, updated_at: ts };
    if (to === 'en_route') {
      patch.departed_at = ts;
      patch.eta_seconds = null;
      patch.eta_updated_at = null;
      // Un mensajero atiende un cliente a la vez: los demás pedidos en ruta vuelven a "Asignado".
      const others = await trx('orders').where({ courier_id: order.courier_id }).whereIn('status', ACTIVE_ROUTE).whereNot({ id: orderId });
      for (const other of others) {
        await trx('orders').where({ id: other.id }).update({ status: 'assigned', updated_at: ts });
        await insertHistory(trx, { orderId: other.id, from: other.status, to: 'assigned', user: req.user, note: `El mensajero se dirige al pedido #${order.order_number}` });
        setImmediate(() => events.orderChanged(other.id, { type: 'status', from: other.status, to: 'assigned' }));
      }
    }
    if (to === 'arrived') patch.arrived_at = ts;
    if (to === 'delivered') {
      patch.delivered_at = ts;
      if (order.payment_method === 'cash' && extra.cash_collected) patch.payment_status = 'paid';
    }
    if (to === 'rescheduled' && extra.scheduled_for) patch.scheduled_for = extra.scheduled_for;
    if (to === 'ready' && order.courier_id && role === 'staff') patch.courier_id = null;
    await trx('orders').where({ id: orderId }).update(patch);
    await insertHistory(trx, { orderId, from: order.status, to, user: req.user, role: req.system ? 'system' : undefined, note: extra.note, lat: extra.lat, lng: extra.lng });

    if (OUTCOMES.includes(to)) {
      const proof = extra.proof || {};
      await trx('delivery_proofs').insert({
        id: uuid(),
        order_id: orderId,
        courier_id: order.courier_id,
        outcome: to,
        receiver_name: proof.receiver_name || null,
        notes: proof.notes || extra.note || null,
        photo_path: photoPath,
        signature_path: signaturePath,
        lat: Number.isFinite(extra.lat) ? extra.lat : null,
        lng: Number.isFinite(extra.lng) ? extra.lng : null,
        accuracy: Number.isFinite(extra.accuracy) ? extra.accuracy : null,
        created_at: ts,
      });
    }
    // Entregado o cancelado: el enlace del cliente vence de inmediato (seguridad del mensajero).
    if (FINAL_STATUSES.includes(to)) await revokeLinks(trx, orderId);
    // Entregado: se descuenta el inventario del mensajero y se crea la solicitud para aprobación.
    if (to === 'delivered') consumed = await inventory.consumeForDelivery(trx, order, req.user?.id);
    if (patch.courier_id === null && order.courier_id) {
      await trx('delivery_assignments').where({ order_id: orderId, courier_id: order.courier_id }).whereNull('unassigned_at').update({ unassigned_at: ts, reason: 'Devuelto a despacho' });
    }
    await audit(req.system ? { actorName: 'Sistema' } : req, {
      action: 'order.status',
      entity: 'order',
      entityId: orderId,
      orderId,
      oldValue: { status: order.status },
      newValue: { status: to, note: extra.note || undefined },
    }, trx);
    await setCourierState(trx, order.courier_id);
  });

  events.orderChanged(orderId, { type: 'status', from: order.status, to });
  // Avisos de inventario (faltantes, mínimo de almacén) después de confirmar la transacción.
  if (consumed) inventory.broadcast(order.courier_id, 'delivered');
  return getOrderDetail(orderId);
}

/** Vista reducida para el mensajero (solo lo necesario para la entrega). */
function courierView(o) {
  return {
    id: o.id,
    order_number: o.order_number,
    customer_name: o.customer_name,
    phone: o.phone,
    customer_whatsapp: o.customer_whatsapp,
    address: o.address,
    reference: o.reference,
    lat: o.lat,
    lng: o.lng,
    sector_name: o.sector_name,
    municipality_name: o.municipality_name,
    zone_name: o.zone_name,
    delivery_fee: o.delivery_fee,
    total: o.total,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    status: o.status,
    status_label: o.status_label,
    priority: o.priority,
    route_order: o.route_order,
    notes: o.notes,
    location_confirmed: o.location_confirmed,
    scheduled_for: o.scheduled_for,
    assigned_at: o.assigned_at,
    departed_at: o.departed_at,
    delivered_at: o.delivered_at,
    eta_seconds: o.eta_seconds,
    created_at: o.created_at,
  };
}

module.exports = {
  mapOrder,
  mapProof,
  ordersQuery,
  getOrder,
  getOrderDetail,
  listOrders,
  priceAddress,
  createOrder,
  updateOrder,
  assignCourier,
  changeStatus,
  courierView,
  insertHistory,
  setCourierState,
};
