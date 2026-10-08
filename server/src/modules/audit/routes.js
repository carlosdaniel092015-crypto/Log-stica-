'use strict';
const express = require('express');
const { db, json } = require('../../db');
const { ah } = require('../../utils/http');
const { requirePermission } = require('../../middleware/auth');

const router = express.Router();
router.use(requirePermission('audit.view'));

router.get('/', ah(async (req, res) => {
  const q = db('audit_logs').orderBy('created_at', 'desc').limit(Math.min(Number(req.query.limit) || 200, 1000));
  if (req.query.entity) q.where('entity', String(req.query.entity));
  if (req.query.action) q.where('action', 'like', `${String(req.query.action)}%`);
  if (req.query.user_id) q.where('user_id', String(req.query.user_id));
  if (req.query.order_id) q.where('order_id', String(req.query.order_id));
  if (req.query.from) q.where('created_at', '>=', new Date(String(req.query.from)).toISOString());
  if (req.query.to) q.where('created_at', '<=', new Date(String(req.query.to)).toISOString());
  const rows = await q;
  res.json(rows.map((r) => ({ ...r, old_value: json(r.old_value, r.old_value), new_value: json(r.new_value, r.new_value) })));
}));

module.exports = router;
