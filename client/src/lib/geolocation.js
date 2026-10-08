/** Utilidades de geolocalización del navegador (siempre con consentimiento explícito). */
export function geoSupported() {
  return 'geolocation' in navigator;
}

export async function geoPermissionState() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state || 'prompt';
  } catch {
    return 'prompt';
  }
}

export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) return reject(new Error('Tu navegador no permite obtener la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, heading: pos.coords.heading }),
      (err) => reject(new Error(geoErrorMessage(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000, ...options }
    );
  });
}

export function geoErrorMessage(err) {
  if (err?.code === 1) return 'No se concedió el permiso de ubicación. Puedes continuar sin compartirla.';
  if (err?.code === 2) return 'No fue posible determinar la ubicación. Verifica el GPS.';
  if (err?.code === 3) return 'La ubicación tardó demasiado. Intenta de nuevo.';
  return err?.message || 'No fue posible obtener la ubicación.';
}
