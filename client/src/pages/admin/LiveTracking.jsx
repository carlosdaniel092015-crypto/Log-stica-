import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { courierColor, initials, pinElement, SD_CENTER } from '../../lib/maps';
import { CourierBadge, Empty, StatusBadge, useAsync, useSocketEvent } from '../../components/ui';
import { MapView, fitTo, syncMarkers } from '../../components/Map';
import Icon from '../../components/Icon';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function infoHtml(c) {
  const current = c.current_order;
  return `<div class="gm-info">
    <strong>${escapeHtml(c.name)}</strong><br/>
    Estado: ${escapeHtml(c.status_label)}<br/>
    ${current ? `Pedido actual: <a href="/admin/pedidos/${current.id}">#${current.order_number}</a><br/>Cliente: ${escapeHtml(current.customer_name)}<br/><span style="color:#64748b">${escapeHtml(current.address)}</span><br/>` : 'Sin pedido en curso<br/>'}
    Pendientes: ${c.pending_count} · Entregados hoy: ${c.delivered_today}<br/>
    <span style="color:#64748b">Última actualización: ${c.location ? escapeHtml(relative(c.location.updated_at)) : '—'}</span>
  </div>`;
}

export default function LiveTracking() {
  const { data: couriers, setData } = useAsync(() => api.get('/api/couriers?active=true'), []);
  const active = useAsync(() => api.get('/api/orders?status=assigned,en_route,arriving,arrived&limit=300'), []);
  const [showOrders, setShowOrders] = useState(true);
  const [onlyOnShift, setOnlyOnShift] = useState(true);
  const [selected, setSelected] = useState(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const lines = useRef(new Map());
  const info = useRef(null);
  const fitted = useRef(false);

  useSocketEvent('courier:location', (p) => {
    setData((list) => list?.map((c) => (c.id === p.courier_id ? { ...c, location: { lat: p.lat, lng: p.lng, accuracy: p.accuracy, updated_at: p.updated_at } } : c)));
  });
  useSocketEvent('courier:updated', (c) => c && setData((list) => (list ? (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]) : list)));
  useSocketEvent('order:updated', () => active.reload(true));

  const visible = (couriers || []).filter((c) => !onlyOnShift || c.shift_active);

  const draw = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const { map, gm } = m;
    const items = visible
      .filter((c) => c.location)
      .map((c) => ({
        id: `c-${c.id}`,
        position: { lat: c.location.lat, lng: c.location.lng },
        content: pinElement({ color: courierColor(c.status), label: initials(c.name), pulse: c.status === 'en_route', size: 38 }),
        title: c.name,
        zIndex: 20,
        onClick: (marker) => {
          setSelected(c.id);
          info.current ||= new gm.maps.InfoWindow();
          info.current.setContent(infoHtml(c));
          info.current.open({ map, anchor: marker });
        },
      }));
    if (showOrders) {
      for (const o of active.data || []) {
        if (o.lat == null) continue;
        items.push({
          id: `o-${o.id}`,
          position: { lat: o.lat, lng: o.lng },
          content: pinElement({ color: `var(--st-${o.status})`, label: '', size: 22 }),
          title: `#${o.order_number} · ${o.customer_name} · ${o.status_label}`,
          zIndex: 5,
        });
      }
    }
    syncMarkers(markers.current, map, gm, items);

    // Línea desde el mensajero hasta el cliente al que se dirige.
    const seen = new Set();
    for (const c of visible) {
      const dest = c.current_order;
      if (!c.location || !dest || dest.lat == null) continue;
      seen.add(c.id);
      const path = [{ lat: c.location.lat, lng: c.location.lng }, { lat: dest.lat, lng: dest.lng }];
      let line = lines.current.get(c.id);
      if (!line) {
        line = new gm.maps.Polyline({ map, path, strokeColor: courierColor(c.status), strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '14px' }] });
        lines.current.set(c.id, line);
      } else line.setPath(path);
    }
    for (const [id, line] of lines.current) if (!seen.has(id)) { line.setMap(null); lines.current.delete(id); }

    if (!fitted.current && items.length) {
      fitted.current = true;
      fitTo(map, gm, items.map((i) => i.position), { maxZoom: 14 });
    }
  }, [visible, active.data, showOrders]);

  useEffect(draw, [draw]);

  const focus = (c) => {
    setSelected(c.id);
    const m = mapRef.current;
    if (m && c.location) {
      m.map.panTo({ lat: c.location.lat, lng: c.location.lng });
      m.map.setZoom(15);
      const marker = markers.current.get(`c-${c.id}`);
      if (marker) {
        info.current ||= new m.gm.maps.InfoWindow();
        info.current.setContent(infoHtml(c));
        info.current.open({ map: m.map, anchor: marker });
      }
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Seguimiento en vivo</h1>
          <p>Ubicación de mensajeros que autorizaron compartirla durante su jornada.</p>
        </div>
        <div className="row-wrap">
          <label className="check small"><input type="checkbox" checked={onlyOnShift} onChange={(e) => setOnlyOnShift(e.target.checked)} /> Solo en jornada</label>
          <label className="check small"><input type="checkbox" checked={showOrders} onChange={(e) => setShowOrders(e.target.checked)} /> Mostrar destinos</label>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }} data-responsive="tracking">
        <MapView className="map map-tall" center={SD_CENTER} zoom={11} onReady={(m) => { mapRef.current = m; draw(); }}>
          <div className="map-legend">
            {[['available', 'Disponible'], ['en_route', 'En ruta'], ['delivering', 'En entrega'], ['paused', 'Pausado'], ['off_duty', 'Fuera de servicio']].map(([k, l]) => (
              <div key={k} className="row" style={{ gap: 6 }}><span className="color-dot" style={{ background: courierColor(k), borderRadius: '50%' }} />{l}</div>
            ))}
          </div>
        </MapView>
        <div className="card" style={{ maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
          <div className="card-header"><strong>Mensajeros ({visible.length})</strong></div>
          {visible.length === 0 && <Empty icon="truck" title="No hay mensajeros en jornada" />}
          {visible.map((c) => (
            <button key={c.id} onClick={() => focus(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border)', background: selected === c.id ? 'var(--primary-50)' : 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{c.name}</strong>
                <CourierBadge status={c.status} />
              </div>
              {c.current_order ? (
                <div className="small" style={{ marginTop: 4 }}>
                  <Icon name="navigation" size={13} /> Hacia <strong>{c.current_order.customer_name}</strong> · <Link to={`/admin/pedidos/${c.current_order.id}`} onClick={(e) => e.stopPropagation()}>#{c.current_order.order_number}</Link>
                  <div style={{ marginTop: 3 }}><StatusBadge status={c.current_order.status} /></div>
                </div>
              ) : <div className="small muted" style={{ marginTop: 4 }}>Sin pedido en curso</div>}
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {c.sharing_location ? (c.location ? `📍 ${relative(c.location.updated_at)}` : 'Esperando ubicación…') : 'No comparte ubicación'} · {c.pending_count} pendientes · {c.delivered_today} entregados hoy
              </div>
            </button>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { [data-responsive="tracking"] { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
