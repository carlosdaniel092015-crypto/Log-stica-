import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Spinner, Switch, useAction, useAsync } from '../../components/ui';
import { useApp } from '../../context/AppContext';

const PRIORITY_LABELS = { custom: 'Zona personalizada', sector: 'Sector', municipality: 'Municipio', province: 'Provincia' };
const NOTIFY_STATUSES = ['preparing', 'ready', 'assigned', 'en_route', 'arriving', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'];

function Section({ title, description, children }) {
  return (
    <div className="card">
      <div className="card-header" style={{ display: 'block' }}>
        <h3>{title}</h3>
        {description && <p className="small muted" style={{ marginTop: 2 }}>{description}</p>}
      </div>
      <div className="card-body stack">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { reloadConfig, config } = useApp();
  const { data, loading } = useAsync(() => api.get('/api/settings'), []);
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('empresa');
  const [busy, run] = useAction();
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (loading || !s) return <Spinner center />;

  const set = (k) => (v) => setS({ ...s, [k]: v });
  const num = (k) => (e) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) });
  const txt = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const move = (i, dir) => {
    const list = [...s.zone_priority];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setS({ ...s, zone_priority: list });
  };
  const save = () => run(async () => {
    const { vapid_keys, timezone, currency_code, ...body } = s; // eslint-disable-line no-unused-vars
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    const res = await api.put('/api/settings', body);
    setS(res.settings);
    reloadConfig();
  }, 'Configuración guardada.');

  const tabs = { empresa: 'Empresa', logistica: 'Logística y tarifas', seguimiento: 'Seguimiento', entregas: 'Prueba de entrega', notificaciones: 'Notificaciones', enlaces: 'Enlaces públicos' };

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Configuración › Logística</h1><p>Parámetros de la operación. Los cambios aplican de inmediato.</p></div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      <div className="tabs" role="tablist">
        {Object.entries(tabs).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'empresa' && (
        <Section title="Datos de la empresa" description="Se muestran en el panel, en el seguimiento del cliente y en los mensajes.">
          <div className="form-grid">
            <Field label="Nombre de la empresa"><input className="input" value={s.company_name} onChange={txt('company_name')} /></Field>
            <Field label="Logo (URL https)" hint="Imagen cuadrada recomendada"><input className="input" value={s.company_logo_url} onChange={txt('company_logo_url')} placeholder="https://…" /></Field>
            <Field label="Teléfono"><input className="input" value={s.company_phone} onChange={txt('company_phone')} placeholder="809-555-0100" /></Field>
            <Field label="WhatsApp"><input className="input" value={s.company_whatsapp} onChange={txt('company_whatsapp')} placeholder="809-555-0100" /></Field>
            <Field label="Correo"><input className="input" value={s.company_email} onChange={txt('company_email')} /></Field>
            <Field label="Horario"><input className="input" value={s.business_hours} onChange={txt('business_hours')} /></Field>
            <Field label="Moneda (símbolo)" hint="Peso dominicano"><input className="input" value={s.currency_symbol} onChange={txt('currency_symbol')} /></Field>
          </div>
        </Section>
      )}

      {tab === 'logistica' && (
        <Section title="Tarifas y cobertura">
          <div className="form-grid">
            <Field label={`Precio mínimo de delivery (${s.currency_symbol})`}><input className="input" type="number" min="0" value={s.min_delivery_fee} onChange={num('min_delivery_fee')} /></Field>
            <Field label="Distancia máxima (km)" hint="0 = sin límite; se mide desde la sucursal más cercana"><input className="input" type="number" min="0" value={s.max_distance_km} onChange={num('max_distance_km')} /></Field>
            <Field label={`Tarifa predeterminada (${s.currency_symbol})`} hint="Para direcciones fuera de todas las zonas"><input className="input" type="number" min="0" value={s.default_fee} onChange={num('default_fee')} disabled={!s.default_fee_enabled} /></Field>
            <div style={{ alignSelf: 'end' }}><Switch label="Usar tarifa predeterminada" checked={s.default_fee_enabled} onChange={set('default_fee_enabled')} /></div>
          </div>
          <div>
            <div className="label">Prioridad cuando una dirección pertenece a varias zonas</div>
            <div className="stack-sm" style={{ marginTop: 6, maxWidth: 380 }}>
              {s.zone_priority.map((k, i) => (
                <div key={k} className="card row" style={{ padding: '6px 10px' }}>
                  <strong className="mono">{i + 1}.</strong><span className="spacer">{PRIORITY_LABELS[k]}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} disabled={i === s.zone_priority.length - 1} aria-label="Bajar">▼</button>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {tab === 'seguimiento' && (
        <Section title="Seguimiento de mensajeros" description="La ubicación solo se comparte con permiso del mensajero y mientras su jornada está activa.">
          <Switch label="Seguimiento de mensajeros activo" checked={s.courier_tracking_enabled} onChange={set('courier_tracking_enabled')} />
          <Switch label="Permitir que el cliente vea el mensajero asignado" checked={s.customer_can_see_courier} onChange={set('customer_can_see_courier')} />
          <Switch label="Permitir que el cliente vea la ubicación del mensajero" hint="Solo mientras el mensajero va hacia ese cliente" checked={s.customer_can_see_courier_location} onChange={set('customer_can_see_courier_location')} disabled={!s.customer_can_see_courier} />
          <Switch label="Permitir que el cliente contacte al mensajero" hint="Muestra el teléfono del mensajero mientras está en camino" checked={s.customer_can_contact_courier} onChange={set('customer_can_contact_courier')} />
          <div className="form-grid">
            <Field label="Frecuencia de actualización de ubicación (segundos)"><input className="input" type="number" min="5" max="600" value={s.location_update_seconds} onChange={num('location_update_seconds')} /></Field>
            <Field label="Conservar historial de ubicaciones (días)"><input className="input" type="number" min="1" max="365" value={s.location_retention_days} onChange={num('location_retention_days')} /></Field>
            <Field label="Radio para marcar “Llegando” (metros)"><input className="input" type="number" min="50" max="5000" value={s.arriving_radius_m} onChange={num('arriving_radius_m')} /></Field>
            <Field label="Velocidad promedio para estimaciones (km/h)" hint="Se usa si Routes API no está disponible"><input className="input" type="number" min="5" max="120" value={s.average_speed_kmh} onChange={num('average_speed_kmh')} /></Field>
          </div>
        </Section>
      )}

      {tab === 'entregas' && (
        <Section title="Prueba de entrega">
          <Switch label="Exigir nombre de quien recibe al marcar Entregado" checked={s.proof_required} onChange={set('proof_required')} />
          <Switch label="Permitir firma" checked={s.proof_signature_enabled} onChange={set('proof_signature_enabled')} />
          <Switch label="Permitir fotografía" checked={s.proof_photo_enabled} onChange={set('proof_photo_enabled')} />
        </Section>
      )}

      {tab === 'notificaciones' && (
        <Section title="Notificaciones" description="Las notificaciones push son opcionales: cada persona decide si las activa en su dispositivo.">
          <Switch label="Notificaciones push activas" checked={s.push_notifications_enabled} onChange={set('push_notifications_enabled')} />
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Avisar al cliente cuando el pedido cambie a:</div>
            <div className="row-wrap">
              {NOTIFY_STATUSES.map((k) => (
                <label key={k} className="check small" style={{ minWidth: 190 }}>
                  <input type="checkbox" checked={s.notify_customer_statuses.includes(k)} onChange={(e) => setS({ ...s, notify_customer_statuses: e.target.checked ? [...s.notify_customer_statuses, k] : s.notify_customer_statuses.filter((x) => x !== k) })} />
                  {config?.statuses?.[k]}
                </label>
              ))}
            </div>
          </div>
          <div className="alert alert-info small">
            Canales externos: WhatsApp {data.channels.whatsapp ? '✓ configurado' : '— sin configurar'} · SMS {data.channels.sms ? '✓' : '—'} · Correo {data.channels.email ? '✓' : '—'}. Se habilitan con variables de entorno del servidor (ver README).
          </div>
        </Section>
      )}

      {tab === 'enlaces' && (
        <Section title="Enlaces públicos de seguimiento" description="Los clientes no tienen cuenta: solo reciben este enlace, que comparte el administrador o el mensajero. Cada enlace usa un token aleatorio de 256 bits y solo da acceso a su pedido.">
          <div className="form-grid">
            <Field label="Vencimiento del enlace (horas)" hint="0 = no vence"><input className="input" type="number" min="0" value={s.tracking_link_expiry_hours} onChange={num('tracking_link_expiry_hours')} /></Field>
            <Field label="Mensaje para compartir" className="full" hint="Variables: {cliente} {pedido} {empresa} {enlace}"><textarea className="textarea" rows={5} value={s.tracking_share_message} onChange={txt('tracking_share_message')} /></Field>
          </div>
          <div className="alert alert-info small">Por seguridad del mensajero, el enlace vence automáticamente en cuanto el pedido se marca como <strong>Entregado</strong> o <strong>Cancelado</strong>, y no se puede volver a generar mientras siga cerrado.</div>
          <div className="small muted">Google Maps del servidor (Geocoding/Routes): {data.google_server_enabled ? 'configurado' : 'sin clave; se usan estimaciones locales'}.</div>
        </Section>
      )}
    </div>
  );
}
