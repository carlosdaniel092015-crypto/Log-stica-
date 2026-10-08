const TZ = 'America/Santo_Domingo';

export function money(value, symbol = 'RD$') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${symbol}${Number(value).toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-DO', { timeZone: TZ, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fullDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-DO', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
}

export function time(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-DO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

export function shortDay(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-DO', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

export function relative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return dateTime(iso);
}

export function duration(seconds) {
  if (seconds == null) return '—';
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function distance(meters) {
  if (meters == null) return '—';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const PAYMENT_METHODS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', paid_online: 'Pagado en línea' };
export const PAYMENT_STATUS = { pending: 'Pendiente', paid: 'Pagado', refunded: 'Reembolsado' };
export const ZONE_KINDS = { province: 'Provincia', municipality: 'Municipio', sector: 'Sector', custom: 'Personalizada' };

export function phoneDigits(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `1${d}` : d;
}

export function whatsappUrl(phone, text = '') {
  return `https://wa.me/${phoneDigits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function navigationUrl(lat, lng, address) {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || '')}`;
}
