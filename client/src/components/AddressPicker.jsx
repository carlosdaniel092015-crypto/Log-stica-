import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { MapView } from './Map';
import { api } from '../lib/api';
import { pinElement, SD_CENTER } from '../lib/maps';
import { getCurrentPosition, geoSupported } from '../lib/geolocation';
import { Field, Modal } from './ui';

let geoTreeCache = null;
export async function getGeoTree(force = false) {
  if (!geoTreeCache || force) geoTreeCache = api.get('/api/geo/tree');
  try {
    return await geoTreeCache;
  } catch (err) {
    geoTreeCache = null;
    throw err;
  }
}

export const LOCATION_PRIVACY_TEXT = 'Usaremos tu ubicación únicamente para identificar con mayor precisión dónde deseas recibir tu pedido.';

/** Botón "USAR MI UBICACIÓN ACTUAL" con explicación previa antes de pedir permiso. */
export function UseMyLocationButton({ onLocated, className = 'btn', label = 'Usar mi ubicación actual' }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!geoSupported()) return null;
  const locate = async () => {
    setBusy(true);
    setError(null);
    try {
      const pos = await getCurrentPosition();
      setAsking(false);
      onLocated(pos);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)}>
        <Icon name="crosshair" /> {label.toUpperCase()}
      </button>
      {asking && (
        <Modal
          title="Usar mi ubicación"
          onClose={() => setAsking(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAsking(false)}>Ahora no</button>
              <button className="btn btn-primary" onClick={locate} disabled={busy}>{busy ? 'Obteniendo…' : 'Continuar'}</button>
            </>
          }
        >
          <div className="stack">
            <p>{LOCATION_PRIVACY_TEXT}</p>
            <p className="small muted">Tu navegador te pedirá permiso. Si prefieres no compartirla, puedes buscar la dirección, escribirla o marcar el punto en el mapa.</p>
            {error && <div className="alert alert-warning">{error}</div>}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Selector de dirección completo:
 *  - Google Places Autocomplete (restringido a República Dominicana).
 *  - Pin movible y clic en el mapa para corregir la ubicación.
 *  - Ubicación actual del dispositivo con consentimiento.
 *  - Dirección escrita manualmente y selección de provincia/municipio/sector.
 */
export default function AddressPicker({ value, onChange, showReference = true, mapClass = 'map map-sm', allowAdminSelects = true }) {
  const v = value || {};
  const [tree, setTree] = useState(null);
  const [mapState, setMapState] = useState(null);
  const markerRef = useRef(null);
  const autoRef = useRef(null);
  const valueRef = useRef(v);
  valueRef.current = v;

  useEffect(() => {
    if (allowAdminSelects) getGeoTree().then(setTree).catch(() => {});
  }, [allowAdminSelects]);

  const update = useCallback((patch) => onChange({ ...valueRef.current, ...patch }), [onChange]);

  /** Resuelve provincia/municipio/sector y dirección (geocodificación inversa en el servidor). */
  const resolvePoint = useCallback(
    async (lat, lng, { components, formatted, placeId } = {}) => {
      update({ lat, lng, ...(placeId !== undefined ? { place_id: placeId } : {}), ...(formatted ? { formatted_address: formatted } : {}) });
      try {
        let admin;
        let address = formatted;
        if (components?.length) {
          admin = await api.post('/api/geo/resolve', { lat, lng, components });
        } else {
          const r = await api.post('/api/maps/reverse', { lat, lng });
          admin = r.admin;
          address = address || r.formatted_address;
        }
        const current = valueRef.current;
        onChange({
          ...current,
          lat,
          lng,
          components: components || current.components,
          formatted_address: address || current.formatted_address || '',
          province_id: admin.province_id,
          municipality_id: admin.municipality_id,
          sector_id: admin.sector_id,
          admin_approximate: admin.approximate,
        });
      } catch {
        /* la resolución administrativa es opcional */
      }
    },
    [onChange, update]
  );

  // Marcador movible.
  useEffect(() => {
    if (!mapState) return;
    const { map, gm } = mapState;
    if (v.lat == null || v.lng == null) {
      if (markerRef.current) markerRef.current.map = null;
      markerRef.current = null;
      return;
    }
    const pos = { lat: Number(v.lat), lng: Number(v.lng) };
    if (!markerRef.current) {
      const m = new gm.marker.AdvancedMarkerElement({ map, position: pos, gmpDraggable: true, content: pinElement({ color: '#dc2626', label: '' }), title: 'Arrastra para ajustar' });
      m.addListener('dragend', () => {
        const p = m.position;
        const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
        const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
        resolvePoint(lat, lng);
      });
      markerRef.current = m;
      map.setCenter(pos);
      map.setZoom(16);
    } else {
      markerRef.current.position = pos;
      const c = map.getCenter();
      if (c && Math.abs(c.lat() - pos.lat) + Math.abs(c.lng() - pos.lng) > 0.01) map.panTo(pos);
    }
  }, [mapState, v.lat, v.lng, resolvePoint]);

  const onReady = useCallback(
    ({ map, gm }) => {
      setMapState({ map, gm });
      map.addListener('click', (e) => resolvePoint(e.latLng.lat(), e.latLng.lng()));
      // Autocompletado de Google Places (API nueva).
      if (autoRef.current && gm.places.PlaceAutocompleteElement) {
        const el = new gm.places.PlaceAutocompleteElement({ includedRegionCodes: ['do'], locationBias: SD_CENTER });
        el.setAttribute('placeholder', 'Buscar dirección o lugar (ej. Plaza Fermín km 9 Autopista Duarte)');
        autoRef.current.innerHTML = '';
        autoRef.current.appendChild(el);
        const handle = async (prediction) => {
          if (!prediction) return;
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'id'] });
          const lat = place.location.lat();
          const lng = place.location.lng();
          const name = place.displayName && !place.formattedAddress?.startsWith(place.displayName) ? `${place.displayName}, ` : '';
          resolvePoint(lat, lng, {
            components: (place.addressComponents || []).map((c) => ({ long_name: c.longText, short_name: c.shortText, types: c.types })),
            formatted: `${name}${place.formattedAddress || ''}`,
            placeId: place.id,
          });
        };
        el.addEventListener('gmp-select', (e) => handle(e.placePrediction));
        el.addEventListener('gmp-placeselect', async (e) => {
          // Compatibilidad con versiones anteriores del componente.
          if (!e.place) return;
          await e.place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'id'] });
          resolvePoint(e.place.location.lat(), e.place.location.lng(), {
            components: (e.place.addressComponents || []).map((c) => ({ long_name: c.longText, short_name: c.shortText, types: c.types })),
            formatted: e.place.formattedAddress,
            placeId: e.place.id,
          });
        });
      }
    },
    [resolvePoint]
  );

  const municipalities = useMemo(() => (tree?.municipalities || []).filter((m) => !v.province_id || m.province_id === v.province_id), [tree, v.province_id]);
  const sectors = useMemo(() => (tree?.sectors || []).filter((s) => !v.municipality_id || s.municipality_id === v.municipality_id), [tree, v.municipality_id]);

  return (
    <div className="stack">
      <div ref={autoRef} />
      <MapView className={mapClass} center={v.lat != null ? { lat: Number(v.lat), lng: Number(v.lng) } : SD_CENTER} zoom={v.lat != null ? 16 : 11} onReady={onReady}>
        {mapState && (
          <div className="map-toolbar" style={{ justifyContent: 'flex-end', top: 'auto', bottom: 12 }}>
            <span className="badge no-dot" style={{ background: 'var(--surface)', color: 'var(--text-2)', '--c': 'var(--border-strong)' }}>
              Toca el mapa o arrastra el pin para ajustar
            </span>
          </div>
        )}
      </MapView>
      <div className="row-wrap">
        <UseMyLocationButton className="btn btn-sm" onLocated={(p) => resolvePoint(p.lat, p.lng)} />
        {v.lat != null && (
          <span className="small muted mono">
            {Number(v.lat).toFixed(5)}, {Number(v.lng).toFixed(5)}
          </span>
        )}
      </div>
      <Field label="Dirección completa">
        <input className="input" value={v.formatted_address || ''} onChange={(e) => update({ formatted_address: e.target.value })} placeholder="Calle, número, sector" required />
      </Field>
      {showReference && (
        <Field label="Referencia" hint="Ej.: frente al colmado, portón verde, segundo piso">
          <input className="input" value={v.reference || ''} onChange={(e) => update({ reference: e.target.value })} maxLength={400} />
        </Field>
      )}
      {allowAdminSelects && tree && (
        <div className="form-grid three">
          <Field label="Provincia">
            <select className="select" value={v.province_id || ''} onChange={(e) => update({ province_id: e.target.value || null, municipality_id: null, sector_id: null })}>
              <option value="">—</option>
              {tree.provinces.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Municipio / DM">
            <select className="select" value={v.municipality_id || ''} onChange={(e) => update({ municipality_id: e.target.value || null, sector_id: null })}>
              <option value="">—</option>
              {municipalities.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Sector">
            <select className="select" value={v.sector_id || ''} onChange={(e) => update({ sector_id: e.target.value || null })}>
              <option value="">—</option>
              {sectors.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {v.admin_approximate && <div className="small muted">Provincia/municipio/sector detectados de forma aproximada; verifica y corrige si es necesario.</div>}
    </div>
  );
}
