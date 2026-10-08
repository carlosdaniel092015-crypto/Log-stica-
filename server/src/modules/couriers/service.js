'use strict';
const { db, bool, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { conflict, notFound } = require('../../utils/http');
const { distanceMeters } = require('../../utils/geo');
const { getSettings } = require('../settings/service');
const { audit } = require('../audit/service');
const { computeEta } = require('../maps/google');
const realtime = require('../../realtime/hub');
const { ACTIVE_ROUTE } = require('../orders/statuses');

const COURIER_STATUS_LABELS = {
  available: 'Disponible',
  en_route: 'En ruta',
  delivering: 'En entrega',
  paused: 'Pausado',
  off_duty: 'Fuera de servicio',
};

function dayStartIso(timezone = 'America/Santo_Domingo') {
  // Inicio del día local (RD es UTC-4 todo el año, pero se calcula de forma genérica).
  const nowDate = new Date();
  const local = new Date(nowDate.toLocaleString('en-US', { timeZone: timezone }));
  const offset = nowDate.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}

function mapCourier(c, stats = {}) {
  return {
    id: c.id,
    user_id: c.user_id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    active: bool(c.user_active),
    vehicle: c.vehicle,
    plate: c.plate,
    branch_id: c.branch_id,
    status: c.status,
    status_label: COURIER_STATUS_LABELS[c.status] || c.status,
    shift_active: bool(c.shift_active),
    shift_started_at: c.shift_started_at,
    sharing_location: bool(c.sharing_location),
    location: c.last_lat != null ? { lat: c.last_lat, lng: c.last_lng, accuracy: c.last_accuracy, updated_at: c.last_location_at } : null,
    current_order: c.current_order_id
      ? { id: c.current_order_id, order_number: c.current_order_number, customer_name: c.current_customer_name, address: c.current_address, status: c.current_order_status, lat: c.current_lat, lng: c.current_lng }
      : null,
    pending_count: Number(stats.pending || 0),
    delivered_today: Number(stats.delivered || 0),
    created_at: c.created_at,
  };
}

function couriersQuery() {
  return db('couriers as c')
    .join('users as u', 'u.id', 'c.user_id')
    .leftJoin('orders as o', 'o.id', 'c.current_order_id')
    .select(
      'c.*',
      'u.name',
      'u.email',
      'u.phone',
      'u.active as user_active',
      'o.order_number as current_order_number',
      'o.customer_name as current_customer_name',
      'o.address as current_address',
      'o.status as current_order_status',
      'o.lat as current_lat',
      'o.lng as current_lng'
    );
}

async function statsFor(courierIds) {
  if (!courierIds.length) return {};
  const settings = await getSettings();
  const since = dayStartIso(settings.timezone);
  const [pending, delivered] = await Promise.all([
    db('orders').whereIn('courier_id', courierIds).whereIn('status', ['assigned', ...ACTIVE_ROUTE]).groupBy('courier_id').select('courier_id').count('id as n'),
    db('orders').whereIn('courier_id', courierIds).where('status', 'delivered').where('delivered_at', '>=', since).groupBy('courier_id').select('courier_id').count('id as n'),
  ]);
  const out = {};
  for (const r of pending) out[r.courier_id] = { ...(out[r.courier_id] || {}), pending: r.n };
  for (const r of delivered) out[r.courier_id] = { ...(out[r.courier_id] || {}), delivered: r.n };
  return out;
}

async function listCouriers({ activeOnly = false, onShift = false } = {}) {
  const q = couriersQuery().orderBy('u.name');
  if (activeOnly) q.where('u.active', true);
  if (onShift) q.where('c.shift_active', true);
  const rows = await q;
  const stats = await statsFor(rows.map((r) => r.id));
  return rows.map((r) => mapCourier(r, stats[r.id]));
}

async function getCourier(id) {
  const row = await couriersQuery().where('c.id', id).first();
  if (!row) return null;
  const stats = await statsFor([id]);
  return mapCourier(row, stats[id]);
}

async function broadcastCourier(id) {
  const courier = await getCourier(id);
  if (courier) {
    realtime.toStaff('courier:updated', courier);
    realtime.toCourier(id, 'courier:self', courier);
  }
  return courier;
}

/** Inicia la jornada. La ubicación solo se comparte si el mensajero la autorizó en su dispositivo. */
async function startShift(courierId, { sharing_location }, req) {
  const ts = now();
  const settings = await getSettings();
  const sharing = !!sharing_location && !!settings.courier_tracking_enabled;
  await db('couriers').where({ id: courierId }).update({ shift_active: true, shift_started_at: ts, sharing_location: sharing, updated_at: ts });
  const { setCourierState } = require('../orders/service');
  await db.transaction((trx) => setCourierState(trx, courierId));
  await audit(req, { action: 'courier.shift_start', entity: 'courier', entityId: courierId, newValue: { sharing_location: sharing } });
  const courier = await broadcastCourier(courierId);
  const { notify } = require('../notifications/service');
  notify({ audience: 'admin', title: `Mensajero ${courier.name.split(' ')[0]} inició jornada`, body: sharing ? 'Ubicación activa.' : 'Sin compartir ubicación.', url: '/admin/seguimiento' }).catch(() => {});
  return courier;
}

async function endShift(courierId, req) {
  const ts = now();
  await db('couriers').where({ id: courierId }).update({ shift_active: false, sharing_location: false, status: 'off_duty', updated_at: ts });
  await audit(req, { action: 'courier.shift_end', entity: 'courier', entityId: courierId });
  return broadcastCourier(courierId);
}

async function setSharing(courierId, sharing, req) {
  const courier = await db('couriers').where({ id: courierId }).first();
  if (!courier) throw notFound();
  const settings = await getSettings();
  if (sharing && !bool(courier.shift_active)) throw conflict('Inicia tu jornada antes de compartir la ubicación.');
  if (sharing && !settings.courier_tracking_enabled) throw conflict('El seguimiento de mensajeros está desactivado por la empresa.');
  await db('couriers').where({ id: courierId }).update({ sharing_location: !!sharing, updated_at: now() });
  await audit(req, { action: sharing ? 'courier.location_on' : 'courier.location_off', entity: 'courier', entityId: courierId });
  return broadcastCourier(courierId);
}

async function setPaused(courierId, paused, req) {
  const courier = await db('couriers').where({ id: courierId }).first();
  if (!courier || !bool(courier.shift_active)) throw conflict('La jornada no está activa.');
  await db('couriers').where({ id: courierId }).update({ status: paused ? 'paused' : 'available', updated_at: now() });
  if (!paused) {
    const { setCourierState } = require('../orders/service');
    await db.transaction((trx) => setCourierState(trx, courierId));
  }
  await audit(req, { action: paused ? 'courier.pause' : 'courier.resume', entity: 'courier', entityId: courierId });
  return broadcastCourier(courierId);
}

const lastEtaAt = new Map();

/**
 * Registra una posición del mensajero durante la jornada.
 * - Solo se acepta con jornada activa y ubicación compartida.
 * - El historial se guarda solo si hubo desplazamiento relevante (≥25 m) o pasaron 2 minutos.
 * - Actualiza el ETA del pedido en curso y marca "Llegando" al entrar en el radio configurado.
 */
async function recordLocation(courierId, { lat, lng, accuracy, speed, heading }) {
  const settings = await getSettings();
  const courier = await db('couriers').where({ id: courierId }).first();
  if (!courier) throw notFound();
  if (!settings.courier_tracking_enabled) throw conflict('El seguimiento de mensajeros está desactivado.');
  if (!bool(courier.shift_active) || !bool(courier.sharing_location)) throw conflict('La ubicación solo se registra con la jornada activa y el permiso concedido.');

  const ts = now();
  const moved = courier.last_lat == null ? Infinity : distanceMeters(courier.last_lat, courier.last_lng, lat, lng);
  const elapsed = courier.last_location_at ? Date.now() - new Date(courier.last_location_at).getTime() : Infinity;
  if (moved >= 25 || elapsed >= 120_000) {
    await db('courier_locations').insert({
      id: uuid(), courier_id: courierId, order_id: courier.current_order_id || null, lat, lng,
      accuracy: accuracy ?? null, speed: speed ?? null, heading: heading ?? null, recorded_at: ts,
    });
  }
  await db('couriers').where({ id: courierId }).update({ last_lat: lat, last_lng: lng, last_accuracy: accuracy ?? null, last_location_at: ts, updated_at: ts });

  const payload = { courier_id: courierId, lat, lng, accuracy: accuracy ?? null, heading: heading ?? null, updated_at: ts, current_order_id: courier.current_order_id };
  realtime.toStaff('courier:location', payload);

  if (courier.current_order_id) {
    const order = await db('orders').where({ id: courier.current_order_id }).first();
    if (order && ACTIVE_ROUTE.includes(order.status) && order.lat != null) {
      const dist = distanceMeters(lat, lng, order.lat, order.lng);
      let eta = order.eta_seconds != null ? { duration_s: order.eta_seconds, distance_m: order.eta_distance_m } : null;
      const last = lastEtaAt.get(order.id) || 0;
      if (Date.now() - last > 45_000 || !eta) {
        lastEtaAt.set(order.id, Date.now());
        eta = await computeEta({ lat, lng }, { lat: order.lat, lng: order.lng }, { avgSpeedKmh: Number(settings.average_speed_kmh) || 25 });
        await db('orders').where({ id: order.id }).update({ eta_seconds: eta.duration_s, eta_distance_m: eta.distance_m, eta_updated_at: ts });
      }
      if (settings.customer_can_see_courier && settings.customer_can_see_courier_location) {
        realtime.toTracking(order.id, 'tracking:courier', { lat, lng, updated_at: ts, eta: { seconds: eta.duration_s, distance_m: eta.distance_m } });
      } else {
        realtime.toTracking(order.id, 'tracking:courier', { lat: null, lng: null, updated_at: ts, eta: { seconds: eta.duration_s, distance_m: eta.distance_m } });
      }
      if (order.status === 'en_route' && dist <= (Number(settings.arriving_radius_m) || 500)) {
        const { changeStatus } = require('../orders/service');
        await changeStatus(order.id, 'arriving', { system: true, user: null }, { note: `Mensajero a ${Math.round(dist)} m del destino`, lat, lng }).catch(() => {});
      }
    }
  }
  return payload;
}

async function pruneLocations() {
  const settings = await getSettings();
  const days = Number(settings.location_retention_days) || 30;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  return db('courier_locations').where('recorded_at', '<', cutoff).del();
}

module.exports = {
  COURIER_STATUS_LABELS,
  dayStartIso,
  listCouriers,
  getCourier,
  broadcastCourier,
  startShift,
  endShift,
  setSharing,
  setPaused,
  recordLocation,
  pruneLocations,
};
