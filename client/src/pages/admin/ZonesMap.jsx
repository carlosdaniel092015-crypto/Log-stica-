import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { money, ZONE_KINDS } from '../../lib/format';
import { SD_CENTER } from '../../lib/maps';
import { useAsync } from '../../components/ui';
import { MapView } from '../../components/Map';
import { fitZone, zoneShapes, ZoneFormModal } from '../../components/ZoneEditor';
import Icon from '../../components/Icon';
import { can, useApp } from '../../context/AppContext';

const AREA = { polygon: 'Polígono', circle: 'Círculo', none: 'Sin área' };

export default function ZonesMap() {
  const { user, currency } = useApp();
  const zones = useAsync(() => api.get('/api/zones'), []);
  const [editing, setEditing] = useState(null);
  const [test, setTest] = useState(null);
  const hRef = useRef(null);

  const runQuote = useCallback(async (lat, lng) => {
    hRef.current?.setMarkers([{ id: 'probe', lat, lng, kind: 'dest', color: '#0f172a', label: '?', size: 30 }]);
    setTest({ loading: true });
    try {
      setTest(await api.post('/api/zones/quote', { lat, lng }));
    } catch (err) {
      setTest({ error: err.message });
    }
  }, []);

  const draw = useCallback(() => {
    if (hRef.current && zones.data) hRef.current.setShapes(zoneShapes(zones.data, { onClick: (_z, lat, lng) => runQuote(lat, lng) }));
  }, [zones.data, runQuote]);
  useEffect(draw, [draw]);

  const editable = can(user, 'zones.manage');

  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }} data-responsive="zones">
        <MapView className="map map-tall card" center={SD_CENTER} zoom={11} onReady={(h) => { hRef.current = h; h.onClick((lat, lng) => runQuote(lat, lng)); draw(); }}>
          <div className="map-toolbar" style={{ left: 60 }}>
            <span className="map-chip"><Icon name="crosshair" size={14} /> Probador: toca el mapa para ver la zona y el precio</span>
          </div>
          {test && (
            <div className="map-legend" style={{ minWidth: 230 }}>
              {test.loading ? 'Calculando…' : test.error ? test.error : (
                <>
                  <div className="small muted">Zona detectada</div>
                  <div className="bold">{test.zone ? test.zone.name : 'Fuera de cobertura'}</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{test.fee != null ? money(test.fee, currency) : '—'}</div>
                  <div className="tiny muted">{test.geo?.sector_name || test.geo?.municipality_name || ''}{test.geo?.province_name ? `, ${test.geo.province_name}` : ''}</div>
                  {test.candidates?.length > 1 && <div className="tiny muted">También: {test.candidates.slice(1).map((c) => c.name).join(', ')}</div>}
                </>
              )}
            </div>
          )}
        </MapView>
        <div className="card" style={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>
          <div className="card-title">
            <h3>Zonas</h3>
            {editable && <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> Nueva zona</button>}
          </div>
          {(zones.data || []).map((z) => (
            <div key={z.id} className="list-item clickable" style={{ opacity: z.active ? 1 : 0.5 }} onClick={() => fitZone(hRef.current, z)}>
              <span className="color-dot" style={{ background: z.active ? z.color : 'var(--border-strong)', width: 14, height: 14 }} />
              <span className="spacer" style={{ minWidth: 0 }}>
                <span className="bold" style={{ display: 'block' }}>{z.name}</span>
                <span className="tiny muted">{ZONE_KINDS[z.kind]} · {AREA[z.geometry_type]} · {z.active ? 'Activa' : 'Inactiva'}</span>
              </span>
              <strong className="mono">{money(z.price, currency)}</strong>
              {editable && <button className="btn btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); setEditing(z); }} aria-label={`Editar ${z.name}`}><Icon name="edit" /></button>}
            </div>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 1000px) { [data-responsive="zones"] { grid-template-columns: 1fr !important; } }`}</style>
      {editing && <ZoneFormModal zone={editing.id ? editing : null} allZones={zones.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); zones.reload(true); }} />}
    </div>
  );
}
