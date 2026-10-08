'use strict';
const express = require('express');
const { z } = require('zod');
const { ah } = require('../../utils/http');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { listForUser, markRead } = require('./service');
const { saveSubscription, removeSubscription } = require('./push');

const router = express.Router();
router.use(requireAuth);

router.get('/', ah(async (req, res) => {
  res.json(await listForUser(req.user.id, { unreadOnly: req.query.unread === 'true' }));
}));

router.post('/read', validate(z.object({ ids: z.array(z.string().uuid()).max(200).optional() })), ah(async (req, res) => {
  await markRead(req.user.id, req.body.ids);
  res.json({ ok: true });
}));

const subscriptionSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

router.post('/push', validate(z.object({ subscription: subscriptionSchema })), ah(async (req, res) => {
  await saveSubscription({ subscription: req.body.subscription, userId: req.user.id, userAgent: req.get('user-agent') });
  res.json({ ok: true });
}));

router.delete('/push', validate(z.object({ endpoint: z.string().url().max(1000) })), ah(async (req, res) => {
  await removeSubscription(req.body.endpoint);
  res.json({ ok: true });
}));

module.exports = router;
