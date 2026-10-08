import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { dateTime, money, PAYMENT_METHODS } from '../../lib/format';
import { Empty, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import Icon from '../../components/Icon';
import OrderForm from '../../components/OrderForm';
import ShareDialog from '../../components/ShareDialog';
import { can, useApp } from '../../context/AppContext';

const GROUPS = [
  { key: '', label: 'Todos' },
  { key: 'new,preparing,ready,rescheduled', label: 'Pendientes' },
  { key: 'assigned', label: 'Asignados' },
  { key: 'en_route,arriving,arrived', label: 'En camino' },
  { key: 'delivered', label: 'Entregados' },
  { key: 'failed,customer_unavailable', label: 'No entregados' },
  { key: 'cancelled', label: 'Cancelados' },
];

export default function Orders() {
  const { user, currency } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const [courierId, setCourierId] = useState('');
  const [date, setDate] = useState('');
  const [creating, setCreating] = useState(params.get('nuevo') === '1');
  const [sharing, setSharing] = useState(null);
  const [busy, run] = useAction();

  const range = useMemo(() => {
    if (!date) return {};
    const from = new Date(`${date}T00:00:00-04:00`);
    return { from: from.toISOString(), to: new Date(from.getTime() + 86400_000 - 1).toISOString() };
  }, [date]);

  const orders = useAsync(() => api.get(`/api/orders${qs({ status, q, courier_id: courierId, ...range, limit: 300 })}`), [status, q, courierId, range]);
  const couriers = useAsync(() => api.get('/api/couriers?active=true'), []);

  useSocketEvent('order:updated', (o) => {
    orders.setData((list) => {
      if (!list) return list;
      const i = list.findIndex((x) => x.id === o.id);
      const matches = !status || status.split(',').includes(o.status);
      if (i >= 0) return matches ? list.map((x) => (x.id === o.id ? o : x)) : list.filter((x) => x.id !== o.id);
      return matches && !q && !courierId && !date ? [o, ...list] : list;
    });
  });

  const assign = (orderId, cid) =>
    run(() => api.post(`/api/orders/${orderId}/assign`, { courier_id: cid || null }), cid ? 'Mensajero asignado.' : 'Mensajero retirado.');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Pedidos</h1>
          <p>Crea, asigna y da seguimiento a todas las entregas.</p>
        </div>
        {can(user, 'orders.manage') && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nuevo pedido</button>
        )}
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        {GROUPS.map((g) => (
          <button key={g.key} className={`chip ${status === g.key ? 'active' : ''}`} onClick={() => setParams(g.key ? { status: g.key } : {})}>{g.label}</button>
        ))}
      </div>
      <div className="filters">
        <input className="input grow" placeholder="Buscar por #pedido, cliente, teléfono o dirección" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={courierId} onChange={(e) => setCourierId(e.target.value)} aria-label="Mensajero">
          <option value="">Todos los mensajeros</option>
          {(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" />
      </div>

      <div className="card">
        {orders.loading && !orders.data ? <Spinner center /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pedido</th><th>Cliente</th><th>Sector / zona</th><th className="num">Envío</th><th className="num">Total</th><th>Pago</th><th>Estado</th><th>Mensajero</th><th>Creado</th><th />
                </tr>
              </thead>
              <tbody>
                {(orders.data || []).map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/admin/pedidos/${o.id}`)}>
                    <td className="bold nowrap">#{o.order_number}{o.priority >= 5 && <span className="badge no-dot" style={{ '--c': 'var(--danger)', marginLeft: 6 }}>{o.priority >= 10 ? 'Urgente' : 'Alta'}</span>}</td>
                    <td><div>{o.customer_name}</div><div className="tiny muted">{o.phone}</div></td>
                    <td><div className="ellipsis" style={{ maxWidth: 200 }}>{o.sector_name || o.municipality_name || '—'}</div><div className="tiny muted">{o.zone_name || 'Sin zona'}</div></td>
                    <td className="num">{money(o.delivery_fee, currency)}{o.fee_overridden && <span title="Costo modificado manualmente"> ✎</span>}</td>
                    <td className="num">{money(o.total, currency)}</td>
                    <td className="small">{PAYMENT_METHODS[o.payment_method]}<div className="tiny muted">{o.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}</div></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {can(user, 'orders.assign') && !['delivered', 'cancelled'].includes(o.status) ? (
                        <select className="select" style={{ minWidth: 150, minHeight: 34, padding: '4px 8px' }} value={o.courier_id || ''} disabled={busy} onChange={(e) => assign(o.id, e.target.value)} aria-label="Asignar mensajero">
                          <option value="">Sin asignar</option>
                          {(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.shift_active ? '' : ' (fuera de turno)'}</option>)}
                        </select>
                      ) : (o.courier_name || '—')}
                    </td>
                    <td className="small nowrap">{dateTime(o.created_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {!['delivered', 'cancelled'].includes(o.status) && <button className="btn btn-sm btn-ghost" title="Compartir seguimiento" onClick={() => setSharing(o)}><Icon name="share" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.data?.length === 0 && <Empty title="No hay pedidos con estos filtros" />}
          </div>
        )}
      </div>

      {creating && (
        <OrderForm
          onClose={() => { setCreating(false); if (params.get('nuevo')) setParams({}); }}
          onCreated={(o) => { setCreating(false); orders.reload(true); setSharing(o); }}
        />
      )}
      {sharing && <ShareDialog orderId={sharing.id} orderNumber={sharing.order_number} onClose={() => setSharing(null)} />}
    </div>
  );
}
