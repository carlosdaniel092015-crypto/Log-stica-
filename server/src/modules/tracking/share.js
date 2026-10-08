'use strict';
const { db } = require('../../db');
const { conflict } = require('../../utils/http');
const { getSettings } = require('../settings/service');
const { availableChannels } = require('../notifications/channels');
const { createLink, activeLink, FINAL_STATUSES } = require('./links');

const digits = (p) => String(p || '').replace(/\D/g, '');
// Números dominicanos de 10 dígitos: se antepone el código de país 1.
const waNumber = (p) => (digits(p).length === 10 ? `1${digits(p)}` : digits(p));

/**
 * Datos para compartir el enlace privado de seguimiento (WhatsApp, SMS, correo o copiar).
 * Lo usan el personal y el mensajero asignado. Un pedido cerrado no tiene enlace.
 */
async function buildShare(order, userId) {
  if (FINAL_STATUSES.includes(order.status)) {
    throw conflict('El pedido está cerrado: por seguridad el enlace de seguimiento ya no está disponible.');
  }
  let link = await activeLink(order.id);
  if (!link) link = await db.transaction((trx) => createLink(trx, order.id, userId));
  const settings = await getSettings();
  const message = String(settings.tracking_share_message)
    .replaceAll('{cliente}', order.customer_name.split(' ')[0])
    .replaceAll('{pedido}', order.order_number)
    .replaceAll('{empresa}', settings.company_name)
    .replaceAll('{enlace}', link.url);
  return {
    url: link.url,
    expires_at: link.expires_at,
    access_count: link.access_count || 0,
    message,
    whatsapp_url: `https://wa.me/${waNumber(order.customer_whatsapp || order.phone)}?text=${encodeURIComponent(message)}`,
    sms_url: `sms:${digits(order.phone)}?body=${encodeURIComponent(message)}`,
    email_url: order.customer_email
      ? `mailto:${order.customer_email}?subject=${encodeURIComponent(`Seguimiento de tu pedido #${order.order_number}`)}&body=${encodeURIComponent(message)}`
      : null,
    channels: availableChannels(),
  };
}

module.exports = { buildShare };
