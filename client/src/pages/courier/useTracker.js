import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { geoErrorMessage } from '../../lib/geolocation';

/**
 * Comparte la ubicación del mensajero mientras la jornada está activa y él lo autorizó.
 * Limitación real de la web: los navegadores (Android/iOS) suspenden el GPS cuando
 * la app pasa a segundo plano o se cierra; por eso se pide mantener la pantalla abierta
 * y se ofrece Wake Lock para evitar que se apague.
 */
export function useTracker({ enabled, intervalSeconds = 15, onDenied }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const lastSent = useRef(0);
  const latest = useRef(null);
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;

  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) return undefined;
    setError(null);
    const send = async (force = false) => {
      const p = latest.current;
      if (!p || !navigator.onLine) return;
      if (!force && Date.now() - lastSent.current < intervalSeconds * 1000) return;
      lastSent.current = Date.now();
      try {
        await api.post('/api/courier/location', p);
      } catch (err) {
        if (err.status === 409) setError(err.message);
      }
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, heading: pos.coords.heading };
        latest.current = p;
        setPosition(p);
        send();
      },
      (err) => {
        setError(geoErrorMessage(err));
        if (err.code === 1) onDeniedRef.current?.();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    // Envío periódico aunque el mensajero esté detenido (mantiene "última actualización").
    const timer = setInterval(() => send(true), Math.max(intervalSeconds, 10) * 1000);
    const onVisible = () => document.visibilityState === 'visible' && send(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalSeconds]);

  return { position, error, latest };
}

/** Mantiene la pantalla encendida (Screen Wake Lock API) cuando el navegador lo permite. */
export function useWakeLock(active) {
  const [supported] = useState(() => 'wakeLock' in navigator);
  const [on, setOn] = useState(false);
  const lock = useRef(null);
  useEffect(() => {
    if (!active || !supported) return undefined;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock.current = await navigator.wakeLock.request('screen');
        if (!cancelled) setOn(true);
        lock.current.addEventListener('release', () => setOn(false));
      } catch {
        setOn(false);
      }
    };
    acquire();
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock.current?.release().catch(() => {});
      lock.current = null;
      setOn(false);
    };
  }, [active, supported]);
  return { supported, on };
}
