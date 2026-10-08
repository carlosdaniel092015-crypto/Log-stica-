'use strict';
const express = require('express');
const { db } = require('../../db');
const { ah } = require('../../utils/http');
const { requirePermission } = require('../../middleware/auth');
const { getSettings } = require('../settings/service');
const { dayStartIso } = require('../couriers/service');
const { PENDING, ACTIVE_ROUTE } = require('../orders/statuses');

const router = express.Router();
router.use(requirePermission('dashboard.view'));

function localDay(iso, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

router.get('/', ah(async (req, res) => {
  const settings = await getSettings();
  const tz = settings.timezone;
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const today = dayStartIso(tz);
  const since = new Date(new Date(today).getTime() - (days - 1) * 86400_000).toISOString();

  const [todayOrders, open, couriers, activeCustomers, rangeOrders, zones, courierNames] = await Promise.all([
    db('orders').where('created_at', '>=', today).select('status', 'delivery_fee'),
    db('orders').whereIn('status', [...PENDING, 'assigned', ...ACTIVE_ROUTE, 'failed', 'customer_unavailable']).select('status'),
    db('couriers as c').join('users as u', 'u.id', 'c.user_id').where('u.active', true).select('c.status', 'c.shift_active'),
    db('orders').where('created_at', '>=', since).countDistinct('customer_id as n').first(),
    db('orders').where((w) => w.where('created_at', '>=', since).orWhere('delivered_at', '>=', since)).select('id', 'status', 'created_at', 'delivered_at', 'updated_at', 'delivery_fee', 'courier_id', 'zone_id'),
    db('delivery_zones').select('id', 'name'),
    db('couriers as c').join('users as u', 'u.id', 'c.user_id').select('c.id', 'u.name'),
  ]);

  const deliveredToday = await db('orders').where('status', 'delivered').where('delivered_at', '>=', today).select('delivery_fee');
  const failedToday = await db('orders').whereIn('status', ['failed', 'customer_unavailable']).where('updated_at', '>=', today).count('id as n').first();
  const count = (list, statuses) => list.filter((o) => statuses.includes(o.status)).length;

  const kpis = {
    orders_today: todayOrders.length,
    pending: count(open, PENDING),
    assigned: count(open, ['assigned']),
    en_route: count(open, ACTIVE_ROUTE),
    delivered_today: deliveredToday.length,
    failed_today: Number(failedToday.n),
    couriers_active: couriers.filter((c) => [1, true, '1'].includes(c.shift_active)).length,
    couriers_total: couriers.length,
    customers_active: Number(activeCustomers.n),
    revenue_today: deliveredToday.reduce((s, o) => s + Number(o.delivery_fee), 0),
  };

  // Series por día (zona horaria de la empresa).
  const dayKeys = [];
  for (let i = 0; i < days; i++) dayKeys.push(localDay(new Date(new Date(since).getTime() + i * 86400_000 + 12 * 3600_000).toISOString(), tz));
  const byDay = Object.fromEntries(dayKeys.map((d) => [d, { day: d, created: 0, delivered: 0, failed: 0, revenue: 0 }]));
  const byCourier = {};
  const byZone = {};
  for (const o of rangeOrders) {
    const created = localDay(o.created_at, tz);
    if (byDay[created]) byDay[created].created++;
    if (o.status === 'delivered' && o.delivered_at) {
      const d = localDay(o.delivered_at, tz);
      if (byDay[d]) {
        byDay[d].delivered++;
        byDay[d].revenue += Number(o.delivery_fee);
      }
    }
    if (['failed', 'customer_unavailable'].includes(o.status)) {
      const d = localDay(o.updated_at, tz);
      if (byDay[d]) byDay[d].failed++;
    }
    if (o.courier_id && ['delivered', 'failed', 'customer_unavailable'].includes(o.status)) {
      const c = (byCourier[o.courier_id] ||= { courier_id: o.courier_id, name: courierNames.find((x) => x.id === o.courier_id)?.name || '—', delivered: 0, failed: 0, revenue: 0 });
      if (o.status === 'delivered') {
        c.delivered++;
        c.revenue += Number(o.delivery_fee);
      } else c.failed++;
    }
    if (o.status === 'delivered') {
      const key = o.zone_id || 'none';
      const zn = (byZone[key] ||= { zone_id: o.zone_id, name: zones.find((x) => x.id === o.zone_id)?.name || 'Sin zona', delivered: 0, revenue: 0 });
      zn.delivered++;
      zn.revenue += Number(o.delivery_fee);
    }
  }
  const perCourier = Object.values(byCourier).map((c) => ({ ...c, success_rate: c.delivered + c.failed ? Math.round((c.delivered / (c.delivered + c.failed)) * 100) : null }));

  res.json({
    kpis,
    range_days: days,
    by_day: Object.values(byDay),
    by_courier: perCourier.sort((a, b) => b.delivered - a.delivered),
    by_zone: Object.values(byZone).sort((a, b) => b.delivered - a.delivered),
    currency: settings.currency_symbol,
  });
}));

module.exports = router;
