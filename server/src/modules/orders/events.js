'use strict';
/**
 * Difusión de cambios de pedidos en tiempo real y notificaciones asociadas.
 * Se cargan los módulos de forma diferida para evitar dependencias circulares.
 */
const realtime = require('../../realtime/hub');
const config = require('../../config');

const CUSTOMER_MESSAGES = {
  preparing: ['Tu pedido está en preparación', 'Estamos preparando tu pedido #{n}.'],
  ready: ['Tu pedido fue preparado', 'Tu pedido #{n} está listo para despacho.'],
  assigned: ['Mensajero asignado', 'Tu pedido #{n} fue asignado a un mensajero.'],
  en_route: ['Tu mensajero está en camino 🚚', 'Tu pedido #{n} va en camino.'],
  arriving: ['Tu mensajero está llegando', 'Tu mensajero está cerca de tu ubicación.'],
  arrived: ['Tu mensajero llegó', 'Tu mensajero llegó al punto de entrega.'],
  delivered: ['Pedido entregado ✅', 'Tu pedido #{n} fue entregado. ¡Gracias!'],
  failed: ['No pudimos entregar tu pedido', 'Tu pedido #{n} no pudo ser entregado. Te contactaremos.'],
  customer_unavailable: ['No te encontramos', 'El mensajero no pudo localizarte para entregar el pedido #{n}.'],
  rescheduled: ['Entrega reprogramada', 'Tu pedido #{n} fue reprogramado.'],
  cancelled: ['Pedido cancelado', 'Tu pedido #{n} fue cancelado.'],
};

async function orderChanged(orderId, info = {}) {
  try {
    const orders = require('./service');
    const tracking = require('../tracking/service');
    const { notify } = require('../notifications/service');
    const { getSettings } = require('../settings/service');
    const { db } = require('../../db');

    const order = await orders.getOrder(orderId);
    if (!order) return;
    realtime.toStaff('order:updated', order);
    if (order.courier_id) realtime.toCourier(order.courier_id, 'order:updated', orders.courierView(order));
    if (info.previousCourierId && info.previousCourierId !== order.courier_id) {
      realtime.toCourier(info.previousCourierId, 'order:removed', { id: order.id });
    }
    const closed = ['delivered', 'cancelled'].includes(order.status);
    if (closed) {
      // Seguimiento cerrado: se avisa a quien tenga la página abierta y se le saca del canal,
      // sin enviar más datos del mensajero.
      realtime.closeTracking(order.id, {
        order_number: order.order_number,
        status: order.status,
        status_label: order.status_label,
        message: tracking.statusMessage(order.status),
      });
    } else {
      realtime.toTracking(order.id, 'tracking:update', await tracking.publicView(order));
    }
    if (order.courier_id || info.previousCourierId) {
      for (const cid of [order.courier_id, info.previousCourierId].filter(Boolean)) {
        realtime.toStaff('courier:updated', await require('../couriers/service').getCourier(cid));
      }
    }

    const settings = await getSettings();
    const n = order.order_number;

    // Cliente
    if (info.type === 'status' || info.type === 'assigned') {
      const status = order.status;
      const msg = CUSTOMER_MESSAGES[status];
      if (msg && (settings.notify_customer_statuses || []).includes(status) && (info.type === 'status' || status === 'assigned')) {
        // Al cerrar el pedido se envía un último aviso a los enlaces recién revocados.
        const linksQuery = db('tracking_links').where({ order_id: order.id });
        if (!closed) linksQuery.whereNull('revoked_at');
        const linkIds = (await linksQuery.select('id')).map((l) => l.id);
        await notify({
          audience: 'customer',
          trackingLinkIds: linkIds,
          orderId: order.id,
          title: msg[0],
          body: msg[1].replace('{n}', n),
          url: closed ? '/' : (await tracking.trackingPathFor(order.id)) || '/',
        });
        // Ya no habrá más avisos de este pedido: se eliminan sus suscripciones push.
        if (closed && linkIds.length) await db('push_subscriptions').whereIn('tracking_link_id', linkIds).del();
      }
    }

    // Mensajero
    if (info.type === 'assigned' && info.courierId) {
      const courier = await db('couriers').where({ id: info.courierId }).first('user_id');
      const pending = await db('orders').where({ courier_id: info.courierId }).whereIn('status', ['assigned', 'en_route', 'arriving', 'arrived']).count('id as n').first();
      await notify({
        audience: 'courier',
        userIds: [courier.user_id],
        orderId: order.id,
        title: 'Tienes una nueva entrega',
        body: `Pedido #${n} — ${order.customer_name}, ${order.sector_name || order.address}. Pendientes: ${Number(pending.n)}.`,
        url: '/mensajero',
      });
    }
    if (info.type === 'assigned' && info.previousCourierId && info.previousCourierId !== info.courierId) {
      const courier = await db('couriers').where({ id: info.previousCourierId }).first('user_id');
      if (courier) await notify({ audience: 'courier', userIds: [courier.user_id], orderId: order.id, title: 'Tu ruta fue actualizada', body: `El pedido #${n} fue reasignado a otro mensajero.`, url: '/mensajero' });
    }

    // Administración
    if (info.type === 'status' && ['delivered', 'failed', 'customer_unavailable'].includes(order.status)) {
      const titles = {
        delivered: `Pedido #${n} entregado`,
        failed: `Pedido #${n} no pudo ser entregado`,
        customer_unavailable: `Pedido #${n}: cliente no disponible`,
      };
      await notify({
        audience: 'admin',
        orderId: order.id,
        title: titles[order.status],
        body: `${order.courier_name || 'Mensajero'} → ${order.customer_name} (${order.sector_name || order.address})`,
        url: `/admin/pedidos/${order.id}`,
      });
    }
  } catch (err) {
    if (!config.isTest) console.error('[events] Error difundiendo cambio de pedido:', err);
  }
}

module.exports = { orderChanged };
