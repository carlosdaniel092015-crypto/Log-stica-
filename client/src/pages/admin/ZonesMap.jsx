import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { money, ZONE_KINDS } from '../../lib/format';
import { pinElement, SD_CENTER } from '../../lib/maps';
import { useAsync } from '../../components/ui';
import { MapView } from '../../components/Map';
import { drawZones, ZoneFormModal } from '../../components/ZoneEditor';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

export default function ZonesMap() {
  const { user, currency } = useApp();
  const zones = useAsync(() => api.get('/api/zones'), []);
  const [editing, setEditing] = useState(null);
  const [test, setTest] = useState(null);
  const mapRef = useRef(null);
  const overlays = useRef([]);
  const testMarker = useRef(null);

  const runQuote = useCallback(async (lat, lng) => {
    const m = mapRef.current;
    if (!testMarker.current) testMarker.current = new m.gm.marker.AdvancedMarkerElement({ map: m.map, content: pinElement({ color: '#0f172a', label: '?' }) });
    testMarker.current.position = { lat, lng };
    setTest({ loading: true });
    try {
      setTest(await api.post('/api/zones/quote', { lat, lng }));
    } catch (err) {
      setTest({ error: err.message });
    }
  }, []);

  const draw = useCallback(() => {
    const m = mapRef.current;
    if (!m || !zones.data) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = drawZones(m.gm, m.map, zones.data, {
      onClick: (z, e) => {
        if (e?.latLng) runQuote(e.latLng.lat(), e.latLng.lng());
      },
    });
  }, [zones.data, runQuote]);
  useEffect(draw, [draw]);

  const withArea = (zones.data || []).filter((z) => z.geometry_type !== 'none');
  const byDivision = (zones.data || []).filter((z) => z.geometry_type === 'none');

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Zonas en el mapa</h1><p>Toca cualquier punto del mapa para probar qué zona y precio se aplicarían.</p></div>
        {can(user, 'zones.manage') && <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Dibujar nueva zona</button>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }} data-responsive="zones">
        <MapView className="map map-tall" center={SD_CENTER} zoom={11} onReady={(m) => { mapRef.current = m; m.map.addListener('click', (e) => runQuote(e.latLng.lat(), e.latLng.lng())); draw(); }}>
          {test && (
            <div className="map-legend" style={{ minWidth: 220 }}>
              {test.loading ? 'Calculando…' : test.error ? test.error : (
                <>
                  <div className="bold">{test.zone ? test.zone.name : 'Fuera de cobertura'}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{test.fee != null ? money(test.fee, currency) : '—'}</div>
                  <div className="tiny muted">{test.geo?.sector_name || test.geo?.municipality_name || ''}{test.geo?.province_name ? `, ${test.geo.province_name}` : ''}</div>
                  {test.candidates?.length > 1 && <div className="tiny muted">Otras: {test.candidates.slice(1).map((c) => c.name).join(', ')}</div>}
                </>
              )}
            </div>
          )}
        </MapView>
        <div className="card" style={{ maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
          <div className="card-header"><strong>Zonas con área ({withArea.length})</strong></div>
          {withArea.map((z) => (
            <button key={z.id} className="notif-item row" style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border)', background: 'none', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
              onClick={() => {
                const m = mapRef.current;
                if (m) {
                  if (z.geometry_type === 'circle') { m.map.setCenter({ lat: z.center_lat, lng: z.center_lng }); m.map.setZoom(13); }
                  else { const b = new m.gm.core.LatLngBounds(); z.polygon.forEach(([lat, lng]) => b.extend({ lat, lng })); m.map.fitBounds(b, 40); }
                }
              }}>
              <span className="color-dot" style={{ background: z.color }} />
              <span className="spacer"><span className="bold">{z.name}</span><span className="tiny muted" style={{ display: 'block' }}>{ZONE_KINDS[z.kind]} · {z.active ? 'Activa' : 'Inactiva'}</span></span>
              <span className="mono bold">{money(z.price, currency)}</span>
              {can(user, 'zones.manage') && <span className="btn btn-sm btn-ghost" role="button" onClick={(e) => { e.stopPropagation(); setEditing(z); }}><Icon name="edit" /></span>}
            </button>
          ))}
          <div className="card-header"><strong>Por división territorial ({byDivision.length})</strong></div>
          {byDivision.map((z) => (
            <div key={z.id} className="notif-item row">
              <span className="color-dot" style={{ background: z.color }} />
              <span className="spacer"><span className="bold">{z.name}</span><span className="tiny muted" style={{ display: 'block' }}>{ZONE_KINDS[z.kind]}</span></span>
              <span className="mono bold">{money(z.price, currency)}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { [data-responsive="zones"] { grid-template-columns: 1fr !important; } }`}</style>
      {editing && <ZoneFormModal zone={editing.id ? editing : null} allZones={zones.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); zones.reload(true); }} />}
    </div>
  );
}
