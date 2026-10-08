'use strict';
const webpush = require('web-push');
const config = require('../../config');
const { db, now } = require('../../db');
const { uuid, sha256 } = require('../../utils/crypto');

let vapid = null;

/** Obtiene las claves VAPID desde el entorno o las genera y guarda una única vez. */
async function getVapid() {
  if (vapid) return vapid;
  if (config.push.publicKey && config.push.privateKey) {
    vapid = { publicKey: config.push.publicKey, privateKey: config.push.privateKey };
  } else {
    const row = await db('settings').where({ key: 'vapid_keys' }).first();
    if (row) vapid = JSON.parse(row.value);
    else {
      vapid = webpush.generateVAPIDKeys();
      await db('settings').insert({ key: 'vapid_keys', value: JSON.stringify(vapid), updated_at: now() });
    }
  }
  webpush.setVapidDetails(config.push.subject, vapid.publicKey, vapid.privateKey);
  return vapid;
}

async function saveSubscription({ subscription, userId = null, trackingLinkId = null, userAgent = null }) {
  const endpointHash = sha256(subscription.endpoint);
  const existing = await db('push_subscriptions').where({ endpoint_hash: endpointHash }).first();
  const row = {
    user_id: userId,
    tracking_link_id: trackingLinkId,
    endpoint: subscription.endpoint,
    endpoint_hash: endpointHash,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
  };
  if (existing) await db('push_subscriptions').where({ id: existing.id }).update(row);
  else await db('push_subscriptions').insert({ id: uuid(), ...row, created_at: now() });
}

async function removeSubscription(endpoint) {
  await db('push_subscriptions').where({ endpoint_hash: sha256(endpoint) }).del();
}

/** Envía un push a un conjunto de suscripciones. Limpia las que ya no son válidas. */
async function sendToSubscriptions(subs, payload) {
  if (!subs.length) return { sent: 0 };
  await getVapid();
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await db('push_subscriptions').where({ id: s.id }).del();
        else if (!config.isTest) console.warn('[push] Error enviando notificación:', err.statusCode || err.message);
      }
    })
  );
  return { sent };
}

module.exports = { getVapid, saveSubscription, removeSubscription, sendToSubscriptions };
