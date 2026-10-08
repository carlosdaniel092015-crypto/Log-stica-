'use strict';
const { db, bool, now } = require('../../db');
const { getSettings, publicSettings } = require('../settings/service');
const { STATUS_LABELS, customerSteps, ACTIVE_ROUTE } = require('../orders/statuses');
const { activeLink } = require('./links');

const IMPORTANT = ['new', 'preparing', 'ready', 'assigned', 'en_route', 'arriving', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'];

function statusMessage(status) {
  return {
    new: 'Recibimos tu pedido.',
    preparing: 'Estamos preparando tu pedido.',
    ready: 'Tu pedido está listo para salir.',
    assigned: 'Un mensajero fue asignado a tu pedido.',
    en_route: 'Tu mensajero está en camino.',
    arriving: 'Tu mensajero está cerca.',
    arrived: 'Tu mensajero llegó al punto de entrega.',
    delivered: 'Tu pedido fue entregado.',
    failed: 'No pudimos entregar tu pedido. Te contactaremos.',
    customer_unavailable: 'El mensajero no pudo localizarte. Contáctanos para coordinar.',
    rescheduled: 'Tu entrega fue reprogramada.',
    cancelled: 'Tu pedido fue cancelado.',
  }[status];
}

/**
 * Vista pública del pedido para el enlace de seguimiento.
 * Solo incluye datos del propio pedido y respeta la configuración de privacidad.
 */
async function publicView(order) {
  const settings = await getSettings();
  const history = await db('order_status_history').where({ order_id: order.id }).orderBy('created_at', 'asc').select('from_status', 'to_status', 'created_at');
  let courier = null;
  if (order.courier_id && settings.customer_can_see_courier) {
    const c = await db('couriers as c').join('users as u', 'u.id', 'c.user_id').where('c.id', order.courier_id).first('c.*', 'u.name', 'u.phone');
    if (c) {
      const showLocation =
        settings.courier_tracking_enabled &&
        settings.customer_can_see_courier_location &&
        ACTIVE_ROUTE.includes(order.status) &&
        c.current_order_id === order.id &&
        bool(c.sharing_location) &&
        c.last_lat != null;
      courier = {
        name: c.name.split(' ')[0] + (c.name.split(' ')[1] ? ` ${c.name.split(' ')[1][0]}.` : ''),
        vehicle: c.vehicle,
        phone: settings.customer_can_contact_courier && ACTIVE_ROUTE.includes(order.status) ? c.phone : null,
        location: showLocation ? { lat: c.last_lat, lng: c.last_lng, updated_at: c.last_location_at } : null,
      };
    }
  }
  const proof = order.status === 'delivered' ? await db('delivery_proofs').where({ order_id: order.id, outcome: 'delivered' }).orderBy('created_at', 'desc').first('receiver_name', 'created_at') : null;
  const sector = order.sector_id ? await db('sectors').where({ id: order.sector_id }).first('name') : null;
  const canEditLocation = ['new', 'preparing', 'ready', 'assigned', 'rescheduled', 'en_route'].includes(order.status);

  return {
    order_number: order.order_number,
    status: order.status,
    status_label: STATUS_LABELS[order.status],
    message: statusMessage(order.status),
    steps: customerSteps(order.status, history),
    events: history.filter((h) => h.from_status !== h.to_status && IMPORTANT.includes(h.to_status)).map((h) => ({ status: h.to_status, label: STATUS_LABELS[h.to_status], at: h.created_at })),
    customer_name: order.customer_name,
    address: order.address,
    reference: order.reference,
    sector_name: sector?.name || null,
    destination: order.lat != null ? { lat: order.lat, lng: order.lng } : null,
    location_confirmed: bool(order.location_confirmed),
    can_edit_location: canEditLocation,
    delivery_fee: Number(order.delivery_fee),
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    courier,
    eta: ACTIVE_ROUTE.includes(order.status) && order.eta_seconds != null ? { seconds: order.eta_seconds, distance_m: order.eta_distance_m, updated_at: order.eta_updated_at } : null,
    delivered: proof ? { receiver_name: proof.receiver_name, at: proof.created_at } : null,
    scheduled_for: order.scheduled_for,
    company: publicSettings(settings),
    updated_at: order.updated_at || now(),
  };
}

async function trackingPathFor(orderId) {
  const link = await activeLink(orderId);
  return link ? `/seguimiento/${link.token}` : null;
}

module.exports = { publicView, trackingPathFor, statusMessage };
