'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const { db } = require('../../db');
const { ah, notFound, forbidden } = require('../../utils/http');
const { requireAuth, hasPermission } = require('../../middleware/auth');

const router = express.Router();

/** Sirve evidencias de entrega solo al personal autorizado o al mensajero que la registró. */
router.get('/:id/:kind', requireAuth, ah(async (req, res) => {
  if (!['photo', 'signature'].includes(req.params.kind)) throw notFound();
  const proof = await db('delivery_proofs').where({ id: req.params.id }).first();
  if (!proof) throw notFound();
  const allowed = hasPermission(req.user, 'orders.view') || (req.user.role === 'courier' && req.user.courierId === proof.courier_id);
  if (!allowed) throw forbidden();
  const rel = req.params.kind === 'photo' ? proof.photo_path : proof.signature_path;
  if (!rel) throw notFound();
  const abs = path.resolve(config.uploadsDir, rel);
  if (!abs.startsWith(path.resolve(config.uploadsDir)) || !fs.existsSync(abs)) throw notFound();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(abs);
}));

module.exports = router;
