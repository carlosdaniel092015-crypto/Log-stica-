import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { createMap } from '../lib/mapEngine';
import { DR_CENTER } from '../lib/maps';

export function MapPlaceholder({ error }) {
  const messages = {
    AUTH_FAILURE: 'La clave de Google Maps fue rechazada. Verifica que esté habilitada y restringida a este dominio.',
    LOAD_ERROR: 'No se pudo cargar el mapa. Revisa tu conexión a internet.',
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

/**
 * Mapa con el motor configurado: OpenFreeMap (sin clave) o Google Maps (con clave).
 * `onReady(handle)` se llama una vez; el handle expone la API común de lib/mapEngine.
 */
export function MapView({ className = 'map', center = DR_CENTER, zoom = 8, onReady, children }) {
  const { config, isDark } = useApp();
  const ref = useRef(null);
  const handleRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [error, setError] = useState(null);
  const key = config?.google?.browserKey || '';

  useEffect(() => {
    if (!config || !ref.current) return undefined;
    let cancelled = false;
    createMap(ref.current, { googleKey: key, mapId: config.google?.mapId, center, zoom, dark: isDark })
      .then((h) => {
        if (cancelled) {
          h.destroy();
          return;
        }
        handleRef.current = h;
        onReadyRef.current?.(h);
      })
      .catch((err) => !cancelled && setError(err.message || 'LOAD_ERROR'));
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, key]);

  useEffect(() => {
    handleRef.current?.setTheme(isDark);
  }, [isDark]);

  return (
    <div className={className}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {error && <MapPlaceholder error={error} />}
      {children}
    </div>
  );
}
