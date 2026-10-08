import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Spinner, useAction, useAsync } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import Icon from '../../components/Icon';

/** Reduce la imagen en el navegador (máx. 512 px) y la convierte a PNG para el panel y las facturas. */
function imageToPng(file, max = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || max) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || max) * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

function LogoUploader({ value, onChange }) {
  const [busy, run] = useAction();
  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(async () => {
      if (!file.type.startsWith('image/')) throw new Error('Elige un archivo de imagen.');
      const res = await api.put('/api/settings/logo', { data_url: await imageToPng(file) });
      onChange(res.settings);
    }, 'Logo actualizado.');
  };
  return (
    <div className="logo-uploader">
      <div className="logo-preview">{value ? <img src={value} alt="Logo de la empresa" /> : <Icon name="image" size={26} />}</div>
      <div className="stack-sm" style={{ gap: 6 }}>
        <strong>Logo de la empresa</strong>
        <small className="muted">PNG, JPG, SVG o WebP. Se muestra en el panel, el inicio de sesión, el seguimiento y las facturas.</small>
        <div className="row-wrap">
          <label className={`btn btn-sm ${busy ? 'disabled' : ''}`}>
            <Icon name="upload" /> {value ? 'Cambiar logo' : 'Subir logo'}
            <input type="file" accept="image/*" hidden onChange={upload} disabled={busy} />
          </label>
          {value && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(async () => onChange((await api.del('/api/settings/logo')).settings), 'Logo eliminado.')}>Quitar</button>}
        </div>
      </div>
    </div>
  );
}

const PRIORITY_LABELS = { custom: 'Zona personalizada', sector: 'Sector', municipality: 'Municipio', province: 'Provincia' };
const NOTIFY_STATUSES = ['preparing', 'ready', 'assigned', 'en_route', 'arriving', 'arrived', 'delivered', 'failed', 'customer_unavailable', 'rescheduled', 'cancelled'];

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
    // Un número vacío no se envía; un texto vacío sí (p. ej. quitar el RNC).
    for (const k of Object.keys(body)) if (body[k] === '' && typeof data.defaults?.[k] === 'number') delete body[k];
    const res = await api.put('/api/settings', body);
    setS(res.settings);
    reloadConfig();
  }, 'Configuración guardada.');

  const tabs = { empresa: 'Empresa', logistica: 'Logística y tarifas', seguimiento: 'Seguimiento', entregas: 'Prueba de entrega', notificaciones: 'Notificaciones', enlaces: 'Enlaces públicos' };
  // Funciones (no componentes) para no perder el foco al escribir.
  const numInput = (k, unit, min = 0, max) => (
    <><input className="input num" type="number" min={min} max={max} value={s[k]} onChange={num(k)} />{unit && <span className="small muted" style={{ minWidth: 54 }}>{unit}</span>}</>
  );
  const toggle = (k, disabled = false) => (
    <span className="switch"><input type="checkbox" checked={!!s[k]} disabled={disabled} onChange={(e) => set(k)(e.target.checked)} /><span /></span>
  );

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div><h1>Configuración</h1><p>Empresa, logística, seguimiento y enlaces públicos</p></div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      <div className="tabs" role="tablist">
        {Object.entries(tabs).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'empresa' && (
        <div className="setting-list">
          <div className="setting-row"><LogoUploader value={s.company_logo_url} onChange={(st) => { setS({ ...s, company_logo_url: st.company_logo_url }); reloadConfig(); }} /></div>
          <div className="setting-row"><div className="form-grid" style={{ flex: 1 }}>
            <Field label="Nombre de la empresa"><input className="input" value={s.company_name} onChange={txt('company_name')} /></Field>
            <Field label="RNC (opcional)" hint="Si lo dejas vacío no aparece en la factura"><input className="input" value={s.company_rnc} onChange={txt('company_rnc')} placeholder="1-31-12345-6" inputMode="numeric" /></Field>
            <Field label="Dirección (opcional)" className="full"><input className="input" value={s.company_address} onChange={txt('company_address')} placeholder="Av. Winston Churchill #95, Piantini, Santo Domingo" /></Field>
            <Field label="Teléfono"><input className="input" value={s.company_phone} onChange={txt('company_phone')} placeholder="809-555-0100" /></Field>
            <Field label="WhatsApp"><input className="input" value={s.company_whatsapp} onChange={txt('company_whatsapp')} placeholder="809-555-0100" /></Field>
            <Field label="Correo"><input className="input" value={s.company_email} onChange={txt('company_email')} /></Field>
            <Field label="Horario"><input className="input" value={s.business_hours} onChange={txt('business_hours')} /></Field>
            <Field label="Moneda (símbolo)" hint="Peso dominicano"><input className="input" value={s.currency_symbol} onChange={txt('currency_symbol')} /></Field>
            <Field label="Nota al pie de la factura" className="full"><input className="input" value={s.invoice_note} onChange={txt('invoice_note')} placeholder="Gracias por su compra." /></Field>
          </div></div>
        </div>
      )}

      {tab === 'logistica' && (
        <>
          <div className="setting-list">
            <SettingRow title="Precio de delivery por defecto" hint="Se usa si la dirección no cae en ninguna zona.">{numInput('default_fee', s.currency_symbol)}</SettingRow>
            <SettingRow title="Usar el precio por defecto fuera de las zonas" hint="Si está apagado, el despachador confirma el precio manualmente.">{toggle('default_fee_enabled')}</SettingRow>
            <SettingRow title="Precio mínimo de delivery" hint="Ninguna tarifa queda por debajo de este valor.">{numInput('min_delivery_fee', s.currency_symbol)}</SettingRow>
            <SettingRow title="Distancia máxima" hint="Desde la sucursal más cercana. 0 = sin límite.">{numInput('max_distance_km', "km")}</SettingRow>
          </div>
          <div className="setting-list">
            <div className="setting-row" style={{ display: 'block' }}>
              <div className="setting-text" style={{ marginBottom: 10 }}><strong>Prioridad cuando una dirección cae en varias zonas</strong><small>Gana la primera de la lista.</small></div>
              <div className="stack-sm" style={{ maxWidth: 380 }}>
                {s.zone_priority.map((k, i) => (
                  <div key={k} className="card row" style={{ padding: '6px 10px' }}>
                    <strong className="mono">{i + 1}.</strong><span className="spacer">{PRIORITY_LABELS[k]}</span>
                    <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} disabled={i === s.zone_priority.length - 1} aria-label="Bajar">▼</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'seguimiento' && (
        <div className="setting-list">
          <SettingRow title="Seguimiento de mensajeros" hint="La ubicación solo se comparte con permiso del mensajero y durante su jornada.">{toggle('courier_tracking_enabled')}</SettingRow>
          <SettingRow title="El cliente ve al mensajero asignado">{toggle('customer_can_see_courier')}</SettingRow>
          <SettingRow title="El cliente ve la ubicación del mensajero" hint="Solo mientras va hacia ese cliente.">{toggle('customer_can_see_courier_location', !s.customer_can_see_courier)}</SettingRow>
          <SettingRow title="El cliente puede contactar al mensajero" hint="Muestra su teléfono mientras está en camino.">{toggle('customer_can_contact_courier')}</SettingRow>
          <SettingRow title="Frecuencia de actualización de ubicación">{numInput('location_update_seconds', "segundos", 5, 600)}</SettingRow>
          <SettingRow title="Conservar historial de ubicaciones">{numInput('location_retention_days', "días", 1, 365)}</SettingRow>
          <SettingRow title="Radio para marcar “Llegando”">{numInput('arriving_radius_m', "metros", 50, 5000)}</SettingRow>
          <SettingRow title="Velocidad promedio para estimaciones" hint="Se usa si Routes API de Google no está configurada.">{numInput('average_speed_kmh', "km/h", 5, 120)}</SettingRow>
        </div>
      )}

      {tab === 'entregas' && (
        <div className="setting-list">
          <SettingRow title="Exigir nombre de quien recibe" hint="Al marcar Entregado.">{toggle('proof_required')}</SettingRow>
          <SettingRow title="Permitir firma con el dedo">{toggle('proof_signature_enabled')}</SettingRow>
          <SettingRow title="Permitir fotografía">{toggle('proof_photo_enabled')}</SettingRow>
        </div>
      )}

      {tab === 'notificaciones' && (
        <>
          <div className="setting-list">
            <SettingRow title="Notificaciones push" hint="Opcionales: cada persona decide si las activa en su dispositivo.">{toggle('push_notifications_enabled')}</SettingRow>
            <div className="setting-row" style={{ display: 'block' }}>
              <div className="setting-text" style={{ marginBottom: 8 }}><strong>Avisar al cliente cuando el pedido cambie a</strong></div>
              <div className="row-wrap">
                {NOTIFY_STATUSES.map((k) => (
                  <label key={k} className="check small" style={{ minWidth: 190 }}>
                    <input type="checkbox" checked={s.notify_customer_statuses.includes(k)} onChange={(e) => setS({ ...s, notify_customer_statuses: e.target.checked ? [...s.notify_customer_statuses, k] : s.notify_customer_statuses.filter((x) => x !== k) })} />
                    {config?.statuses?.[k]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="alert alert-info small">
            Canales externos: WhatsApp {data.channels.whatsapp ? '✓ configurado' : '— sin configurar'} · SMS {data.channels.sms ? '✓' : '—'} · Correo {data.channels.email ? '✓' : '—'}. Se habilitan con variables de entorno del servidor (ver README).
          </div>
        </>
      )}

      {tab === 'enlaces' && (
        <>
          <div className="setting-list">
            <SettingRow title="Vencimiento del enlace" hint="0 = no vence por tiempo.">{numInput('tracking_link_expiry_hours', "horas")}</SettingRow>
            <div className="setting-row" style={{ display: 'block' }}>
              <Field label="Mensaje para compartir" hint="Variables: {cliente} {pedido} {empresa} {enlace}"><textarea className="textarea" rows={5} value={s.tracking_share_message} onChange={txt('tracking_share_message')} /></Field>
            </div>
          </div>
          <div className="alert alert-info small">Los clientes no tienen cuenta: solo reciben este enlace, que comparte el administrador o el mensajero. Por seguridad del mensajero, el enlace vence en cuanto el pedido se marca como <strong>Entregado</strong> o <strong>Cancelado</strong>.</div>
          <div className="small muted">Mapas: {config?.google?.browserKey ? 'Google Maps' : 'OpenFreeMap (gratis, sin clave)'} · Geocodificación y rutas en el servidor: {data.google_server_enabled ? 'Google configurado' : 'estimaciones locales'}.</div>
        </>
      )}
    </div>
  );
}

function SettingRow({ title, hint, children }) {
  return (
    <div className="setting-row">
      <div className="setting-text"><strong>{title}</strong>{hint && <small>{hint}</small>}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
