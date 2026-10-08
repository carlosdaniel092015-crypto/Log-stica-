'use strict';
const { db, now } = require('../../db');
const { uuid } = require('../../utils/crypto');
const { getSettings } = require('../settings/service');
const { sendToSubscriptions } = require('./push');
const realtime = require('../../realtime/hub');

/**
 * Crea notificaciones internas y, si está permitido, Web Push.
 * audience: 'admin' (todo el personal), 'courier' (userIds) o 'customer' (trackingLinkIds y/o userIds).
 */
async function notify({ audience, userIds = [], trackingLinkIds = [], orderId = null, title, body, url = '/', kind = null }) {
  const settings = await getSettings();
  const ts = now();
  let recipients = userIds;
  if (audience === 'admin' && !userIds.length) {
    recipients = (await db('users').whereIn('role_id', ['admin', 'dispatcher']).where({ active: true }).select('id')).map((u) => u.id);
  }

  const rows = recipients.map((userId) => ({
    id: uuid(), audience, user_id: userId, order_id: orderId, channel: 'in_app', title, body, status: 'sent', created_at: ts,
  }));
  if (audience === 'customer' && !recipients.length) {
    rows.push({ id: uuid(), audience, user_id: null, order_id: orderId, channel: 'in_app', title, body, status: 'sent', created_at: ts });
  }
  if (rows.length) await db('notifications').insert(rows);

  for (const r of rows) {
    if (r.user_id) realtime.toUser(r.user_id, 'notification', { id: r.id, title, body, url, order_id: orderId, kind, created_at: ts });
  }

  if (!settings.push_notifications_enabled) return;
  const subsQuery = db('push_subscriptions').where((w) => {
    if (recipients.length) w.whereIn('user_id', recipients);
    if (trackingLinkIds.length) w.orWhereIn('tracking_link_id', trackingLinkIds);
  });
  if (!recipients.length && !trackingLinkIds.length) return;
  const subs = await subsQuery;
  sendToSubscriptions(subs, { title, body, url, tag: orderId || undefined }).catch(() => {});
}

async function listForUser(userId, { unreadOnly = false, limit = 30 } = {}) {
  const q = db('notifications').where({ user_id: userId }).orderBy('created_at', 'desc').limit(limit);
  if (unreadOnly) q.whereNull('read_at');
  return q;
}

async function markRead(userId, ids) {
  const q = db('notifications').where({ user_id: userId }).whereNull('read_at');
  if (ids?.length) q.whereIn('id', ids);
  await q.update({ read_at: now() });
}

module.exports = { notify, listForUser, markRead };
