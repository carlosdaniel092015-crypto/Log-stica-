'use strict';
const config = require('../../config');
const { db, now } = require('../../db');
const { uuid, randomToken, sha256, encrypt, decrypt } = require('../../utils/crypto');
const { getSettings } = require('../settings/service');

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

function urlFor(token) {
  return `${config.publicBaseUrl}/seguimiento/${token}`;
}

/** Crea un enlace privado de seguimiento (token de 256 bits; se guarda hasheado y cifrado). */
async function createLink(trx, orderId, userId = null) {
  const settings = await getSettings();
  const token = randomToken(32);
  const hours = Number(settings.tracking_link_expiry_hours) || 0;
  const created = new Date();
  const row = {
    id: uuid(),
    order_id: orderId,
    token_hash: sha256(token),
    token_encrypted: encrypt(token),
    expires_at: hours > 0 ? new Date(created.getTime() + hours * 3600_000).toISOString() : null,
    created_by: userId,
    created_at: created.toISOString(),
  };
  await trx('tracking_links').insert(row);
  return { id: row.id, token, url: urlFor(token), expires_at: row.expires_at };
}

/** Enlace vigente más reciente de un pedido (para volver a compartirlo). */
async function activeLink(orderId) {
  const link = await db('tracking_links')
    .where({ order_id: orderId })
    .whereNull('revoked_at')
    .orderBy('created_at', 'desc')
    .first();
  if (!link) return null;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return null;
  const token = decrypt(link.token_encrypted);
  return { id: link.id, token, url: urlFor(token), expires_at: link.expires_at, created_at: link.created_at, access_count: link.access_count, last_accessed_at: link.last_accessed_at };
}

async function revokeLinks(trx, orderId) {
  await trx('tracking_links').where({ order_id: orderId }).whereNull('revoked_at').update({ revoked_at: now() });
}

/**
 * Valida un token público. Solo devuelve el pedido asociado a ese token exacto:
 * no existe forma de llegar a otro pedido alterando la URL.
 */
async function resolveToken(token, { touch = false } = {}) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const link = await db('tracking_links').where({ token_hash: sha256(token) }).first();
  if (!link || link.revoked_at) return null;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return null;
  const order = await db('orders').where({ id: link.order_id }).first();
  if (!order) return null;
  const settings = await getSettings();
  const graceHours = Number(settings.tracking_link_expire_after_delivery_hours) || 0;
  if (graceHours > 0 && ['delivered', 'cancelled'].includes(order.status)) {
    const closedAt = new Date(order.delivered_at || order.updated_at);
    if (Date.now() - closedAt.getTime() > graceHours * 3600_000) return null;
  }
  if (touch) {
    await db('tracking_links').where({ id: link.id }).update({ last_accessed_at: now(), access_count: (link.access_count || 0) + 1 });
  }
  return { link, order };
}

module.exports = { createLink, activeLink, revokeLinks, resolveToken, urlFor };
