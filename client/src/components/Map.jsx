import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { loadGoogleMaps, DR_CENTER } from '../lib/maps';

/**
 * Inicializa un mapa de Google en un contenedor y devuelve { map, gm, error }.
 * gm contiene las librerías cargadas (maps, marker, places, geometry).
 */
export function useGoogleMap(containerRef, { center = DR_CENTER, zoom = 8, options = {} } = {}) {
  const { config } = useApp();
  const [state, setState] = useState({ map: null, gm: null, error: null });
  const key = config?.google?.browserKey;
  const mapId = config?.google?.mapId || 'DEMO_MAP_ID';

  useEffect(() => {
    if (!config) return undefined;
    let cancelled = false;
    if (!key) {
      setState({ map: null, gm: null, error: 'NO_KEY' });
      return undefined;
    }
    (async () => {
      try {
        const google = await loadGoogleMaps(key);
        const [maps, marker, places, geometry] = await Promise.all([
          google.importLibrary('maps'),
          google.importLibrary('marker'),
          google.importLibrary('places'),
          google.importLibrary('geometry'),
        ]);
        if (cancelled || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, {
          center,
          zoom,
          mapId,
          gestureHandling: 'greedy',
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          ...options,
        });
        setState({ map, gm: { maps, marker, places, geometry, core: google }, error: null });
      } catch (err) {
        if (!cancelled) setState({ map: null, gm: null, error: err.message || 'LOAD_ERROR' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, key]);

  return state;
}

export function MapPlaceholder({ error }) {
  const messages = {
    NO_KEY: 'Configura GOOGLE_MAPS_BROWSER_KEY en el servidor para mostrar Google Maps. El resto de la plataforma funciona normalmente.',
    AUTH_FAILURE: 'La clave de Google Maps fue rechazada. Verifica que esté habilitada y restringida a este dominio.',
    LOAD_ERROR: 'No se pudo cargar Google Maps. Revisa tu conexión a internet.',
  };
  return (
    <div className="map-placeholder">
      <div className="card">
        <div className="bold" style={{ marginBottom: 6 }}>Mapa no disponible</div>
        <div className="small">{messages[error] || messages.LOAD_ERROR}</div>
      </div>
    </div>
  );
}

/** Contenedor de mapa con manejo de estado. `onReady({ map, gm })` se llama una vez. */
export function MapView({ className = 'map', center, zoom, options, onReady, children }) {
  const ref = useRef(null);
  const { map, gm, error } = useGoogleMap(ref, { center, zoom, options });
  const readyRef = useRef(false);
  useEffect(() => {
    if (map && gm && !readyRef.current) {
      readyRef.current = true;
      onReady?.({ map, gm });
    }
  }, [map, gm, onReady]);
  return (
    <div className={className}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {error && <MapPlaceholder error={error} />}
      {children}
    </div>
  );
}

/**
 * Sincroniza un conjunto de marcadores avanzados con una lista de elementos.
 * items: [{ id, position: {lat,lng}, content: HTMLElement, title, zIndex, onClick }]
 */
export function syncMarkers(store, map, gm, items) {
  if (!map || !gm) return;
  const seen = new Set();
  for (const it of items) {
    if (!it.position || it.position.lat == null) continue;
    seen.add(it.id);
    let m = store.get(it.id);
    if (!m) {
      m = new gm.marker.AdvancedMarkerElement({ map, position: it.position, content: it.content, title: it.title || '', zIndex: it.zIndex, gmpClickable: !!it.onClick });
      if (it.onClick) m.addListener('click', () => it.onClick(m));
      store.set(it.id, m);
    } else {
      m.position = it.position;
      if (it.content && m.content !== it.content) m.content = it.content;
      if (it.zIndex != null) m.zIndex = it.zIndex;
      m.title = it.title || '';
    }
  }
  for (const [id, m] of store) {
    if (!seen.has(id)) {
      m.map = null;
      store.delete(id);
    }
  }
}

export function fitTo(map, gm, points, { maxZoom = 15, padding = 60 } = {}) {
  const valid = points.filter((p) => p && p.lat != null && p.lng != null);
  if (!map || !gm || !valid.length) return;
  if (valid.length === 1) {
    map.setCenter(valid[0]);
    map.setZoom(Math.min(maxZoom, 15));
    return;
  }
  const bounds = new gm.core.LatLngBounds();
  valid.forEach((p) => bounds.extend(p));
  map.fitBounds(bounds, padding);
  const once = map.addListener('idle', () => {
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
    gm.core.event.removeListener(once);
  });
}
