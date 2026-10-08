import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { money, shortDay } from '../../lib/format';
import { Avatar, Empty, Spinner, useAsync, useSocketEvent } from '../../components/ui';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--axis)', fontSize: 12 }, tickLine: false, axisLine: false };

function ChartTooltip({ active, payload, label, format = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="bold" style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 6 }}>
          <i style={{ width: 9, height: 9, borderRadius: 3, background: p.color, display: 'inline-block' }} />
          <span className="muted">{p.name}:</span> <strong className="mono">{format(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, color, to }) {
  const body = (
    <div className="card kpi">
      <div className="kpi-label">{color && <span className="kpi-dot" style={{ background: color }} />}{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
  return to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : body;
}

/** Barras horizontales con valor al final (entregas por mensajero / zona). */
function HBars({ rows, valueKey, labelKey }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      {rows.map((r) => (
        <div key={r[labelKey]} className="hbar" title={`${r[labelKey]}: ${r[valueKey]}`}>
          <span className="ellipsis">{r[labelKey]}</span>
          <span className="track"><span style={{ width: `${(r[valueKey] / max) * 100}%` }} /></span>
          <strong className="mono" style={{ textAlign: 'right' }}>{r[valueKey]}</strong>
        </div>
      ))}
    </div>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export default function Dashboard() {
  const { user, currency } = useApp();
  const [days, setDays] = useState(14);
  const { data, loading, reload } = useAsync(() => api.get(`/api/dashboard?days=${days}`), [days]);
  useSocketEvent('order:updated', () => reload(true));
  useSocketEvent('inventory:updated', () => reload(true));

  if (loading && !data) return <Spinner center />;
  if (!data) return <Empty title="No se pudo cargar el dashboard" />;
  const { kpis } = data;
  const byDay = data.by_day.map((d) => ({ ...d, label: shortDay(d.day) }));
  const totalDelivered = byDay.reduce((s, d) => s + d.delivered, 0);
  const totalFailed = byDay.reduce((s, d) => s + d.failed, 0);
  const totalRevenue = byDay.reduce((s, d) => s + d.revenue, 0);
  const today = new Date().toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', weekday: 'long', day: 'numeric', month: 'long' });
  const inventory = can(user, 'inventory.manage');

  return (
    <div className="stack" style={{ gap: 18 }}>
      {inventory && data.low_stock?.length > 0 && (
        <div className="banner warning">
          <span className="banner-icon"><Icon name="alert" size={18} /></span>
          <div className="spacer">
            <div className="bold">{data.low_stock.length} producto(s) se están acabando</div>
            <div className="small">{data.low_stock.map((p) => `${p.name} (${p.warehouse_stock})`).join(' · ')}</div>
          </div>
          <Link to="/admin/inventario?tab=products" className="btn btn-sm btn-outline-warning">Ver inventario</Link>
        </div>
      )}
      {inventory && data.pending_requests > 0 && (
        <div className="banner info">
          <span className="banner-icon">{data.pending_requests}</span>
          <div className="spacer"><strong>Solicitudes de inventario pendientes</strong> de tus mensajeros</div>
          <Link to="/admin/inventario" className="btn btn-sm btn-primary">Revisar</Link>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
          <p style={{ textTransform: 'none' }}>{today.charAt(0).toUpperCase() + today.slice(1)} · operación de hoy</p>
        </div>
        <div className="row-wrap">
          <div className="segmented" role="group" aria-label="Rango de fechas">
            {[7, 14, 30].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} días</button>)}
          </div>
          {can(user, 'orders.manage') && <Link to="/admin/pedidos?nuevo=1" className="btn btn-primary"><Icon name="plus" /> Nuevo pedido</Link>}
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Pedidos de hoy" value={kpis.orders_today} color="var(--text)" to="/admin/pedidos" />
        <Kpi label="Pendientes" value={kpis.pending} color="var(--st-preparing)" to="/admin/pedidos?status=new,preparing,ready,rescheduled" />
        <Kpi label="Asignados" value={kpis.assigned} color="var(--st-assigned)" to="/admin/pedidos?status=assigned" />
        <Kpi label="En ruta" value={kpis.en_route} color="var(--st-en_route)" to="/admin/seguimiento" />
        <Kpi label="Entregados hoy" value={kpis.delivered_today} color="var(--st-delivered)" to="/admin/pedidos?status=delivered" />
        <Kpi label="No entregados" value={kpis.failed_today} color="var(--st-failed)" to="/admin/pedidos?status=failed,customer_unavailable" />
        <Kpi label="Mensajeros activos" value={`${kpis.couriers_active} de ${kpis.couriers_total}`} color="#0891b2" to="/admin/mensajeros" />
        <Kpi label="Clientes activos" value={kpis.customers_active} color="var(--st-assigned)" to="/admin/clientes" />
        <Kpi label="Ingresos por delivery" value={money(kpis.revenue_today, currency)} color="var(--success)" />
      </div>

      <div className="grid grid-2">
        <div className="card chart-card">
          <div className="chart-title">
            <div>
              <h3>Entregas por día</h3>
              <div className="small muted">Últimos {days} días · {totalDelivered} entregados · {totalFailed} no entregados</div>
            </div>
            <div className="legend"><span><i style={{ background: 'var(--series-1)' }} />Entregados</span><span><i style={{ background: 'var(--series-2)' }} />No entregados</span></div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byDay} barGap={2} margin={{ left: -18, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
              <Bar dataKey="delivered" name="Entregados" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="failed" name="No entregados" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="chart-title">
            <div>
              <h3>Ingresos por delivery</h3>
              <div className="small muted">Últimos {days} días · total <strong style={{ color: 'var(--text)' }}>{money(totalRevenue, currency)}</strong></div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={byDay} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axisProps} width={52} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip content={<ChartTooltip format={(v) => money(v, currency)} />} cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }} />
              <Area type="linear" dataKey="revenue" name="Ingresos" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card" style={{ paddingBottom: 16 }}>
          <div className="chart-title"><h3>Entregas por mensajero</h3></div>
          {data.by_courier.length === 0 ? <Empty title="Sin entregas en el período" /> : <HBars rows={data.by_courier} valueKey="delivered" labelKey="name" />}
        </div>

        <div className="card chart-card" style={{ paddingBottom: 16 }}>
          <div className="chart-title"><h3>Entregas por zona</h3></div>
          {data.by_zone.length === 0 ? <Empty title="Sin entregas en el período" /> : <HBars rows={data.by_zone.slice(0, 10)} valueKey="delivered" labelKey="name" />}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Rendimiento por mensajero</h3><span className="small muted">Últimos {days} días</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mensajero</th><th className="num">Asignados</th><th className="num">Entregados</th><th className="num">No entregados</th><th>Tasa de éxito</th><th className="num">Tiempo prom.</th><th className="num">Cobrado</th></tr></thead>
            <tbody>
              {data.by_courier.map((c) => (
                <tr key={c.courier_id}>
                  <td><span className="cell-person"><Avatar name={c.name} soft />{c.name}</span></td>
                  <td className="num">{c.assigned}</td>
                  <td className="num">{c.delivered}</td>
                  <td className="num">{c.failed}</td>
                  <td>
                    {c.success_rate == null ? '—' : (
                      <span className="row" style={{ gap: 10 }}>
                        <span className="progress" style={{ width: 130 }}><span style={{ width: `${c.success_rate}%` }} /></span>
                        <strong className="mono">{c.success_rate}%</strong>
                      </span>
                    )}
                  </td>
                  <td className="num">{c.avg_minutes == null ? '—' : `${c.avg_minutes} min`}</td>
                  <td className="num bold">{money(c.collected, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.by_courier.length === 0 && <Empty title="Sin datos en el período" />}
        </div>
      </div>
    </div>
  );
}
