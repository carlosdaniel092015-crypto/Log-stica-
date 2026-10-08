import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { courierColor, initials, SD_CENTER } from '../../lib/maps';
import { Avatar, CourierBadge, Empty, useAsync, useSocketEvent } from '../../components/ui';
import { MapView } from '../../components/Map';
import Icon from '../../components/Icon';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function infoHtml(c) {
  const cur = c.current_order;
  return `<strong>${esc(c.name)}</strong><br/>${esc(c.status_label)}<br/>
    ${cur ? `Hacia: <a href="/admin/pedidos/${cur.id}">${esc(cur.customer_name)} #${cur.order_number}</a><br/><span style="color:#64748b">${esc(cur.address)}</span><br/>` : 'Sin destino asignado<br/>'}
    ${c.pending_count} pendientes · ${c.delivered_today} entregados hoy<br/>
    <span style="color:#64748b">Actualizado ${c.location ? esc(relative(c.location.updated_at)) : '—'}</span>`;
}

const LEGEND = [['available', 'Disponible'], ['en_route', 'En ruta'], ['delivering', 'En entrega'], ['paused', 'Pausado'], ['off_duty', 'Fuera de servicio']];

export default function LiveTracking() {
  const { data: couriers, setData } = useAsync(() => api.get('/api/couriers?active=true'), []);
  const active = useAsync(() => api.get('/api/orders?status=assigned,en_route,arriving,arrived&limit=300'), []);
  const [showOrders, setShowOrders] = useState(true);
  const [onlyOnShift, setOnlyOnShift] = useState(true);
  const [selected, setSelected] = useState(null);
  const [, tick] = useState(0);
  const hRef = useRef(null);
  const fitted = useRef(false);

  // Refresca los "hace X s" cada pocos segundos.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useSocketEvent('courier:location', (p) => {
    setData((list) => list?.map((c) => (c.id === p.courier_id ? { ...c, location: { lat: p.lat, lng: p.lng, accuracy: p.accuracy, updated_at: p.updated_at } } : c)));
  });
  useSocketEvent('courier:updated', (c) => c && setData((list) => (list ? (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]) : list)));
  useSocketEvent('order:updated', () => active.reload(true));

  const visible = (couriers || []).filter((c) => !onlyOnShift || c.shift_active);

  const draw = useCallback(() => {
    const h = hRef.current;
    if (!h) return;
    const markers = visible.filter((c) => c.location).map((c) => ({
      id: `c-${c.id}`, lat: c.location.lat, lng: c.location.lng, kind: 'courier', color: courierColor(c.status), label: initials(c.name),
      pulse: c.status === 'en_route', title: c.name, zIndex: 500, onClick: () => { setSelected(c.id); h.popup(`c-${c.id}`, infoHtml(c)); },
    }));
    if (showOrders) {
      for (const o of active.data || []) {
        if (o.lat == null) continue;
        markers.push({ id: `o-${o.id}`, lat: o.lat, lng: o.lng, kind: 'dest', color: '#dc2626', size: 26, title: `#${o.order_number} · ${o.customer_name} · ${o.status_label}` });
      }
    }
    h.setMarkers(markers);
    // Línea punteada desde cada mensajero hasta el cliente al que se dirige.
    h.setLines(visible.filter((c) => c.location && c.current_order?.lat != null).map((c) => ({ id: c.id, from: [c.location.lat, c.location.lng], to: [c.current_order.lat, c.current_order.lng], color: courierColor(c.status) })));
    if (!fitted.current && markers.length) {
      fitted.current = true;
      h.fit(markers.map((m) => ({ lat: m.lat, lng: m.lng })), { maxZoom: 14 });
    }
  }, [visible, active.data, showOrders]);

  useEffect(draw, [draw]);

  const focus = (c) => {
    setSelected(c.id);
    const h = hRef.current;
    if (h && c.location) {
      h.setView({ lat: c.location.lat, lng: c.location.lng }, 15);
      h.popup(`c-${c.id}`, infoHtml(c));
    }
  };

  return (
    <div className="stack">
      <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
        <label className="check small"><input type="checkbox" checked={onlyOnShift} onChange={(e) => setOnlyOnShift(e.target.checked)} /> Solo en jornada</label>
        <label className="check small"><input type="checkbox" checked={showOrders} onChange={(e) => setShowOrders(e.target.checked)} /> Mostrar destinos</label>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }} data-responsive="tracking">
        <MapView className="map map-tall card" center={SD_CENTER} zoom={11} onReady={(h) => { hRef.current = h; draw(); }}>
          <div className="map-legend">
            <div className="bold" style={{ marginBottom: 4 }}>Leyenda</div>
            {LEGEND.map(([k, l]) => (
              <div key={k} className="row" style={{ gap: 6 }}><span className="color-dot" style={{ background: courierColor(k), borderRadius: '50%', boxShadow: '0 0 0 2px var(--surface), 0 0 0 3px ' + courierColor(k) }} />{l}</div>
            ))}
            <div className="row" style={{ gap: 6 }}><Icon name="pin" size={13} /> Cliente de destino</div>
          </div>
        </MapView>
        <div className="card" style={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>
          <div className="card-title"><h3>Mensajeros</h3><span className="small muted">En tiempo real</span></div>
          {visible.length === 0 && <Empty icon="truck" title="No hay mensajeros en jornada" />}
          {visible.map((c) => (
            <button key={c.id} onClick={() => focus(c)} className={`list-item clickable ${selected === c.id ? 'selected' : ''}`} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: selected === c.id ? 'var(--primary-50)' : 'transparent', color: 'inherit', font: 'inherit', alignItems: 'flex-start' }}>
              <Avatar name={c.name} color={courierColor(c.status)} size="lg" />
              <span className="spacer" style={{ minWidth: 0 }}>
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{c.name}</strong>
                  <CourierBadge status={c.status} />
                </span>
                <span className="small" style={{ display: 'block', marginTop: 2 }}>
                  {c.current_order ? <>Hacia: {c.current_order.customer_name} <Link to={`/admin/pedidos/${c.current_order.id}`} onClick={(e) => e.stopPropagation()}>#{c.current_order.order_number}</Link></> : c.shift_active ? 'Sin destino asignado' : 'Sin jornada activa'}
                </span>
                <span className="tiny muted" style={{ display: 'block', marginTop: 3 }}>
                  {c.sharing_location ? (c.location ? `Actualizado ${relative(c.location.updated_at)}` : 'Esperando ubicación…') : 'Sin ubicación'} · {c.pending_count} pendientes · {c.delivered_today} entregados hoy
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 1000px) { [data-responsive="tracking"] { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
