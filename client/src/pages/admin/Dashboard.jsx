import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { money, shortDay } from '../../lib/format';
import { Empty, Spinner, useAsync, useSocketEvent } from '../../components/ui';
import Icon from '../../components/Icon';

const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--axis)', fontSize: 12 }, tickLine: false, axisLine: false };

function ChartTooltip({ active, payload, label, format = (v) => v, labelFormat = (l) => l }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="bold" style={{ marginBottom: 4 }}>{labelFormat(label)}</div>
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

export default function Dashboard() {
  const [days, setDays] = useState(14);
  const { data, loading, reload } = useAsync(() => api.get(`/api/dashboard?days=${days}`), [days]);
  useSocketEvent('order:updated', () => reload(true));

  if (loading && !data) return <Spinner center />;
  if (!data) return <Empty title="No se pudo cargar el dashboard" />;
  const { kpis, currency } = data;
  const byDay = data.by_day.map((d) => ({ ...d, label: shortDay(d.day) }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen de la operación de hoy y de los últimos {days} días.</p>
        </div>
        <div className="row">
          <div className="chips" role="group" aria-label="Rango de fechas">
            {[7, 14, 30].map((d) => (
              <button key={d} className={`chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} días</button>
            ))}
          </div>
          <Link to="/admin/pedidos?nuevo=1" className="btn btn-primary"><Icon name="plus" /> Nuevo pedido</Link>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Pedidos de hoy" value={kpis.orders_today} to="/admin/pedidos" />
        <Kpi label="Pendientes" value={kpis.pending} color="var(--st-preparing)" to="/admin/pedidos?status=new,preparing,ready,rescheduled" />
        <Kpi label="Asignados" value={kpis.assigned} color="var(--st-assigned)" to="/admin/pedidos?status=assigned" />
        <Kpi label="En ruta" value={kpis.en_route} color="var(--st-en_route)" to="/admin/seguimiento" />
        <Kpi label="Entregados hoy" value={kpis.delivered_today} color="var(--st-delivered)" />
        <Kpi label="No entregados hoy" value={kpis.failed_today} color="var(--st-failed)" to="/admin/pedidos?status=failed,customer_unavailable" />
        <Kpi label="Mensajeros activos" value={`${kpis.couriers_active} / ${kpis.couriers_total}`} to="/admin/mensajeros" />
        <Kpi label="Clientes activos" value={kpis.customers_active} to="/admin/clientes" />
        <Kpi label="Ingresos por delivery hoy" value={money(kpis.revenue_today, currency)} />
      </div>

      <div className="grid grid-2">
        <div className="card chart-card">
          <div className="chart-title">
            <h3>Entregas por día</h3>
            <div className="legend"><span><i style={{ background: 'var(--series-1)' }} />Entregados</span><span><i style={{ background: 'var(--series-2)' }} />No entregados</span></div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byDay} barGap={2} margin={{ left: -18, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
              <Bar dataKey="delivered" name="Entregados" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="failed" name="No entregados" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="chart-title"><h3>Ingresos por delivery ({currency})</h3></div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={byDay} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
              <YAxis {...axisProps} width={56} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip content={<ChartTooltip format={(v) => money(v, currency)} />} cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }} />
              <Line type="linear" dataKey="revenue" name="Ingresos" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="chart-title"><h3>Entregas por mensajero</h3></div>
          {data.by_courier.length === 0 ? <Empty title="Sin entregas en el período" /> : (
            <ResponsiveContainer width="100%" height={Math.max(160, data.by_courier.length * 44)}>
              <BarChart data={data.by_courier} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="name" width={110} {...axisProps} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
                <Bar dataKey="delivered" name="Entregados" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card chart-card">
          <div className="chart-title"><h3>Entregas por zona</h3></div>
          {data.by_zone.length === 0 ? <Empty title="Sin entregas en el período" /> : (
            <ResponsiveContainer width="100%" height={Math.max(160, Math.min(data.by_zone.length, 10) * 34)}>
              <BarChart data={data.by_zone.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="name" width={150} {...axisProps} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
                <Bar dataKey="delivered" name="Entregas" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Rendimiento por mensajero ({days} días)</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mensajero</th><th className="num">Entregados</th><th className="num">No entregados</th><th className="num">Efectividad</th><th className="num">Ingresos por delivery</th></tr></thead>
            <tbody>
              {data.by_courier.map((c) => (
                <tr key={c.courier_id}>
                  <td>{c.name}</td>
                  <td className="num">{c.delivered}</td>
                  <td className="num">{c.failed}</td>
                  <td className="num">{c.success_rate == null ? '—' : `${c.success_rate}%`}</td>
                  <td className="num">{money(c.revenue, currency)}</td>
                </tr>
              ))}
              {data.by_courier.length === 0 && <tr><td colSpan={5}><Empty title="Sin datos" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
