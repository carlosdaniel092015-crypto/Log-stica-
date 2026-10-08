import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, flushOutbox, outboxSize, postOrQueue } from '../../lib/api';
import { dateTime, distance as fmtDistance, duration, money, PAYMENT_METHODS, time, whatsappUrl } from '../../lib/format';
import { courierColor, initials } from '../../lib/maps';
import { getCurrentPosition, geoPermissionState } from '../../lib/geolocation';
import { CourierBadge, Empty, Field, Modal, OnlineIndicator, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import { MapView } from '../../components/Map';
import SignaturePad, { compressImage } from '../../components/SignaturePad';
import { InstallBanner, PushButton } from '../../components/pwa';
import Icon from '../../components/Icon';
import ShareDialog from '../../components/ShareDialog';
import { ItemsEditor } from '../admin/Inventory';
import { useApp } from '../../context/AppContext';
import { useTracker, useWakeLock } from './useTracker';

const LOCATION_TEXT = 'Para asignar rutas y permitir el seguimiento de tus entregas necesitamos acceso a tu ubicación mientras estás trabajando.';

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Coordenadas para la evidencia: solo si el permiso ya fue concedido (no se pide de sorpresa). */
async function proofCoords(latest) {
  if (latest) return latest;
  if ((await geoPermissionState()) !== 'granted') return null;
  try {
    return await getCurrentPosition({ timeout: 8000 });
  } catch {
    return null;
  }
}

function ShiftStart({ onStart, busy }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const start = async (share) => {
    setError(null);
    if (share) {
      try {
        await getCurrentPosition(); // dispara el permiso estándar del navegador
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    setAsking(false);
    onStart(share);
  };
  return (
    <>
      <button className="btn btn-success btn-lg btn-block" onClick={() => setAsking(true)} disabled={busy}><Icon name="power" /> INICIAR JORNADA</button>
      {asking && (
        <Modal title="Iniciar jornada" onClose={() => setAsking(false)}>
          <div className="stack">
            <p>{LOCATION_TEXT}</p>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Solo se comparte mientras tu jornada está activa.</li>
              <li>Puedes dejar de compartirla en cualquier momento.</li>
              <li>Si tu navegador ofrece “Esta vez” o “Mientras la app está en uso”, cualquiera de las dos funciona.</li>
            </ul>
            {error && <div className="alert alert-warning">{error}</div>}
            <button className="btn btn-primary btn-lg" onClick={() => start(true)}><Icon name="crosshair" /> Compartir ubicación e iniciar</button>
            <button className="btn" onClick={() => start(false)}>Iniciar sin compartir ubicación</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function OutcomeModal({ order, initial, settings, latest, onClose, onDone }) {
  const { currency } = useApp();
  const [outcome, setOutcome] = useState(initial);
  const [receiver, setReceiver] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState(null);
  const [signature, setSignature] = useState(null);
  const [cash, setCash] = useState(order.payment_method === 'cash' && order.payment_status !== 'paid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const onSignature = useCallback((v) => setSignature(v), []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (outcome === 'delivered' && settings.proof_required && !receiver.trim()) return setError('Indica el nombre de quien recibió.');
    if (outcome !== 'delivered' && !notes.trim()) return setError('Describe brevemente el motivo.');
    setBusy(true);
    try {
      const coords = await proofCoords(latest);
      const body = {
        status: outcome,
        note: notes || undefined,
        ...(coords ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy ?? undefined } : {}),
        cash_collected: outcome === 'delivered' ? cash : undefined,
        proof: { receiver_name: receiver || undefined, notes: notes || undefined, photo: photo || undefined, signature: signature || undefined },
      };
      const r = await postOrQueue(`/api/courier/orders/${order.id}/status`, body, `#${order.order_number}: ${outcome}`);
      onDone(r, outcome);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Pedido #${order.order_number} — ${order.customer_name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className={`btn ${outcome === 'delivered' ? 'btn-success' : 'btn-danger'}`} form="outcome-form" disabled={busy}>{busy ? 'Enviando…' : 'Confirmar'}</button></>}>
      <form id="outcome-form" className="stack" onSubmit={submit}>
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="chips">
          {[['delivered', 'Entregado'], ['failed', 'No entregado'], ['customer_unavailable', 'Cliente no disponible'], ['rescheduled', 'Reprogramado']].map(([k, l]) => (
            <button type="button" key={k} className={`chip ${outcome === k ? 'active' : ''}`} onClick={() => setOutcome(k)}>{l}</button>
          ))}
        </div>
        {outcome === 'delivered' ? (
          <>
            <Field label={`Nombre de quien recibió${settings.proof_required ? ' *' : ''}`}><input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} autoFocus /></Field>
            {order.payment_method === 'cash' && order.payment_status !== 'paid' && (
              <label className="check"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> Cobré {money(order.total, currency)} en efectivo</label>
            )}
            {settings.proof_photo_enabled && (
              <Field label="Fotografía (opcional)">
                <input className="input" type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await compressImage(f)); }} />
                {photo && <img className="photo-preview" src={photo} alt="Vista previa" />}
              </Field>
            )}
            {settings.proof_signature_enabled && (
              <div className="field"><span>Firma (opcional)</span><SignaturePad onChange={onSignature} /></div>
            )}
            <Field label="Notas (opcional)"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field label="Motivo *"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: nadie respondió, dirección incorrecta…" autoFocus /></Field>
            {settings.proof_photo_enabled && (
              <Field label="Fotografía del lugar (opcional)">
                <input className="input" type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await compressImage(f)); }} />
                {photo && <img className="photo-preview" src={photo} alt="Vista previa" />}
              </Field>
            )}
          </>
        )}
        <p className="tiny muted">Se registrará la fecha, la hora y, si diste permiso de ubicación, las coordenadas aproximadas.</p>
      </form>
    </Modal>
  );
}

/** Enlaces universales: abren la app instalada (Google Maps o Waze) o la web si no está. */
export function navLinks(order) {
  const has = order.lat != null && order.lng != null;
  return {
    google: has ? `https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lng}&travelmode=driving` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address || '')}`,
    waze: has ? `https://waze.com/ul?ll=${order.lat},${order.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(order.address || '')}&navigate=yes`,
  };
}

/** Elegir con qué app navegar hasta el cliente. */
function NavChooser({ order, onClose }) {
  const links = navLinks(order);
  const remember = (app) => {
    try {
      localStorage.setItem('lrd_nav_app', app);
    } catch {
      /* sin almacenamiento */
    }
    onClose();
  };
  let last = null;
  try {
    last = localStorage.getItem('lrd_nav_app');
  } catch {
    last = null;
  }
  return (
    <Modal title="Iniciar ruta" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Abre la navegación hacia <strong>{order.customer_name}</strong> con la app que prefieras. Si no la tienes instalada, se abre en el navegador.</p>
        <a className={`nav-option ${last === 'google' ? 'last' : ''}`} href={links.google} target="_blank" rel="noreferrer" onClick={() => remember('google')}>
          <span className="nav-logo" style={{ background: '#fff' }}><img src="/icons/google-maps.svg" alt="" width="28" height="28" /></span>
          <span className="spacer"><strong>Google Maps</strong><small>Rutas con tráfico en tiempo real</small></span>
          <Icon name="chevron" size={20} />
        </a>
        <a className={`nav-option ${last === 'waze' ? 'last' : ''}`} href={links.waze} target="_blank" rel="noreferrer" onClick={() => remember('waze')}>
          <span className="nav-logo" style={{ background: '#33ccff' }}><img src="/icons/waze.svg" alt="" width="28" height="28" /></span>
          <span className="spacer"><strong>Waze</strong><small>Alertas de tránsito y policía</small></span>
          <Icon name="chevron" size={20} />
        </a>
        {order.lat == null && <div className="small" style={{ color: 'var(--warning)' }}>Este pedido no tiene coordenadas: se buscará por la dirección escrita.</div>}
      </div>
    </Modal>
  );
}

function OrderMap({ order, me, onClose, onNavigate }) {
  const hRef = useRef(null);
  const draw = useCallback(() => {
    const h = hRef.current;
    if (!h) return;
    const dest = order.lat != null ? { lat: order.lat, lng: order.lng } : null;
    h.setMarkers([
      ...(dest ? [{ id: 'dest', ...dest, kind: 'dest', color: '#dc2626', size: 32, title: order.address }] : []),
      ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, kind: 'courier', color: '#2563eb', label: 'Yo', pulse: true, title: 'Mi ubicación' }] : []),
    ]);
    h.setLines(dest && me ? [{ id: 'r', from: [me.lat, me.lng], to: [dest.lat, dest.lng] }] : []);
  }, [order, me]);
  useEffect(draw, [draw]);
  return (
    <Modal title={`${order.customer_name} · #${order.order_number}`} onClose={onClose} size="lg" footer={<button className="btn btn-primary btn-block" onClick={onNavigate}><Icon name="navigation" /> Iniciar ruta (Google Maps o Waze)</button>}>
      <div className="stack-sm">
        <MapView className="map" zoom={15} center={order.lat != null ? { lat: order.lat, lng: order.lng } : undefined} onReady={(h) => { hRef.current = h; draw(); h.fit([order.lat != null ? { lat: order.lat, lng: order.lng } : null, me], { maxZoom: 16 }); }} />
        <div className="small"><strong>{order.address}</strong></div>
        {order.reference && <div className="small muted">Referencia: {order.reference}</div>}
        {!order.location_confirmed && <div className="small" style={{ color: 'var(--warning)' }}>El cliente aún no ha confirmado su ubicación en el mapa.</div>}
      </div>
    </Modal>
  );
}

function DeliveryCard({ order, active, distanceM, onAction, onMap, onNavigate, onShare, busy }) {
  const { currency } = useApp();
  const st = order.status;
  const toCollect = order.payment_status !== 'paid';
  const primary = (() => {
    if (st === 'assigned' || st === 'failed' || st === 'customer_unavailable')
      return <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAction(order, 'en_route')}>VOY HACIA ESTE CLIENTE</button>;
    if (st === 'en_route' || st === 'arriving')
      return <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAction(order, 'arrived')}>LLEGUÉ</button>;
    if (st === 'arrived')
      return (
        <div className="grid grid-2" style={{ gap: 8 }}>
          <button className="btn btn-success btn-lg" disabled={busy} onClick={() => onAction(order, 'delivered')}><Icon name="check" /> ENTREGADO</button>
          <button className="btn btn-danger btn-lg" disabled={busy} onClick={() => onAction(order, 'failed')}><Icon name="x" /> NO ENTREGADO</button>
        </div>
      );
    return null;
  })();

  return (
    <div className={`card delivery-card ${active ? 'active' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <strong style={{ fontSize: '1.12rem' }}>{order.customer_name}</strong>
          <div className="small muted">#{order.order_number}{order.sector_name ? ` · ${order.sector_name}` : ''}{order.priority >= 5 ? ' · ⚡ Prioridad' : ''}</div>
        </div>
        <StatusBadge status={st} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: 'var(--danger)', marginTop: 1 }}><Icon name="pin" size={18} /></span>
        <div>
          <div className="bold">{order.address}</div>
          {order.reference && <div className="small">Ref.: {order.reference}</div>}
        </div>
      </div>
      <div className="delivery-meta">
        <div><span className="meta-label">Teléfono</span><span className="mono">{order.phone}</span></div>
        <div><span className="meta-label">Distancia</span>{distanceM != null ? fmtDistance(distanceM) : '—'}</div>
        <div><span className="meta-label">Envío</span>{money(order.delivery_fee, currency)}</div>
        <div><span className="meta-label">Pago</span>{PAYMENT_METHODS[order.payment_method]}</div>
      </div>
      <div className="collect-box">
        <span>{toCollect ? 'Monto a cobrar' : 'Pagado'}</span>
        <strong>{money(order.total, currency)}</strong>
      </div>
      {order.items?.length > 0 && (
        <div className="stack-sm" style={{ gap: 4 }}>
          {order.items.map((i) => <div key={i.product_id} className="row small"><span className="spacer">{i.quantity}× {i.name}</span><span className="muted mono">{money(i.quantity * i.unit_price, currency)}</span></div>)}
        </div>
      )}
      {order.notes && <div className="alert alert-info small">{order.notes}</div>}
      {active && order.eta_seconds != null && <div className="small" style={{ color: 'var(--primary)' }}>Llegada estimada: {duration(order.eta_seconds)}</div>}
      <div className="delivery-actions">
        <button className="btn" onClick={() => onMap(order)}><Icon name="map" />VER MAPA</button>
        <button className="btn" onClick={() => onNavigate(order)}><Icon name="navigation" />INICIAR RUTA</button>
        <a className="btn" href={`tel:${order.phone}`}><Icon name="phone" />LLAMAR</a>
        <a className="btn btn-wa" href={whatsappUrl(order.customer_whatsapp || order.phone, `Hola ${order.customer_name.split(' ')[0]}, soy el mensajero de tu pedido #${order.order_number}.`)} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WHATSAPP</a>
      </div>
      <button className="btn btn-share" onClick={() => onShare(order)}><Icon name="share" /> COMPARTIR SEGUIMIENTO CON EL CLIENTE</button>
      {primary}
      {(st === 'en_route' || st === 'arriving') && (
        <div className="grid grid-2" style={{ gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => onAction(order, 'delivered')}><Icon name="check" /> ENTREGADO</button>
          <button className="btn" disabled={busy} onClick={() => onAction(order, 'failed')}><Icon name="x" /> NO ENTREGADO</button>
        </div>
      )}
    </div>
  );
}

/** Inventario del mensajero: existencias, solicitudes y pedir más inventario. */
function CourierInventory() {
  const { data, loading, reload } = useAsync(() => api.get('/api/courier/inventory'), []);
  const [asking, setAsking] = useState(false);
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  useSocketEvent('inventory:updated', () => reload(true));
  if (loading && !data) return <Spinner center />;
  if (!data) return <Empty title="No se pudo cargar tu inventario" />;
  const colors = { pending: 'var(--warning)', approved: 'var(--success)', rejected: 'var(--danger)' };
  return (
    <div className="stack">
      <div className="card">
        <div className="card-header"><strong>Lo que tengo</strong><button className="btn btn-sm btn-primary" onClick={() => { setItems([{ product_id: data.products[0]?.id || '', quantity: 1 }]); setAsking(true); }} disabled={!data.products.length}><Icon name="plus" /> Solicitar inventario</button></div>
        {data.stock.length === 0 ? <Empty icon="box" title="No tienes inventario asignado" /> : data.stock.map((s) => (
          <div key={s.product_id} className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="spacer">{s.name} <span className="tiny muted">{s.sku}</span></span>
            <strong className="mono" style={{ fontSize: '1.15rem', color: s.quantity === 0 ? 'var(--danger)' : undefined }}>{s.quantity}</strong>
            <span className="tiny muted">{s.unit}</span>
          </div>
        ))}
      </div>
      <h3>Mis solicitudes</h3>
      {data.requests.length === 0 && <Empty title="Sin solicitudes" />}
      {data.requests.map((r) => (
        <div key={r.id} className="card" style={{ padding: 12, borderLeft: `4px solid ${colors[r.status]}` }}>
          <div className="row"><strong className="spacer">#{r.request_number} · {r.kind_label}</strong><span className="badge" style={{ '--c': colors[r.status] }}>{r.status_label}</span></div>
          {r.order_number && <div className="small muted">Pedido #{r.order_number} · {r.customer_name}</div>}
          <div className="small">{r.items.map((i) => `${i.quantity_requested} × ${i.product_name}${i.quantity_approved != null && i.quantity_approved !== i.quantity_requested ? ` (aprobado ${i.quantity_approved})` : ''}`).join(' · ')}</div>
          <div className="tiny muted">{dateTime(r.created_at)}{r.review_note ? ` · ${r.review_note}` : ''}</div>
        </div>
      ))}
      {asking && (
        <Modal title="Solicitar inventario" onClose={() => setAsking(false)} footer={<><button className="btn" onClick={() => setAsking(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
          const clean = items.filter((i) => i.product_id && Number(i.quantity) > 0).map((i) => ({ product_id: i.product_id, quantity: Math.trunc(Number(i.quantity)) }));
          if (!clean.length) throw new Error('Indica al menos un producto y cantidad.');
          await api.post('/api/courier/inventory/requests', { items: clean, note: note || undefined });
          setAsking(false);
          setNote('');
          reload(true);
        }, 'Solicitud enviada al administrador.')}>Enviar solicitud</button></>}>
          <div className="stack">
            <p className="small muted">Indica las cantidades que necesitas. El administrador las aprobará y se sumarán a tu inventario.</p>
            <ItemsEditor products={data.products} items={items} onChange={setItems} stock={Object.fromEntries(data.stock.map((s) => [s.product_id, s.quantity]))} />
            <Field label="Nota (opcional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function History() {
  const { currency } = useApp();
  const { data, loading } = useAsync(() => api.get('/api/courier/orders?scope=history'), []);
  if (loading) return <Spinner center />;
  if (!data?.length) return <Empty title="Aún no tienes entregas cerradas" />;
  return (
    <div className="stack-sm">
      {data.map((o) => (
        <div key={o.id} className="card" style={{ padding: 12 }}>
          <div className="row"><strong className="spacer">#{o.order_number} · {o.customer_name}</strong><StatusBadge status={o.status} /></div>
          <div className="small muted">{o.address}</div>
          <div className="small">{dateTime(o.delivered_at || o.created_at)} · {money(o.delivery_fee, currency)}</div>
        </div>
      ))}
    </div>
  );
}

export default function CourierApp() {
  const { user, logout, toast, isDark, toggleTheme } = useApp();
  const me = useAsync(() => api.get('/api/courier/me'), []);
  const orders = useAsync(() => api.get('/api/courier/orders'), []);
  const [tab, setTab] = useState('active');
  const [sort, setSort] = useState('route');
  const [outcome, setOutcome] = useState(null);
  const [mapOrder, setMapOrder] = useState(null);
  const [shareOrder, setShareOrder] = useState(null);
  const [navOrder, setNavOrder] = useState(null);
  const [pending, setPending] = useState(outboxSize());
  const [busy, run] = useAction();
  const courier = me.data?.courier;
  const settings = me.data?.settings || {};
  const tracking = !!courier?.shift_active && !!courier?.sharing_location;
  const setCourier = (c) => me.setData((d) => ({ ...d, courier: c }));

  const { position, error: trackError, latest } = useTracker({
    enabled: tracking,
    intervalSeconds: settings.location_update_seconds || 15,
    onDenied: () => api.post('/api/courier/sharing', { sharing: false }).then(setCourier).catch(() => {}),
  });
  const wake = useWakeLock(tracking);

  useSocketEvent('order:updated', (o) => orders.setData((list) => {
    if (!list) return list;
    const open = ['assigned', 'en_route', 'arriving', 'arrived', 'failed', 'customer_unavailable'].includes(o.status);
    const exists = list.some((x) => x.id === o.id);
    if (!open) return list.filter((x) => x.id !== o.id);
    if (!exists) {
      orders.reload(true); // pedido nuevo: se recarga para traer sus productos
      return [{ ...o, items: [] }, ...list];
    }
    return list.map((x) => (x.id === o.id ? { ...x, ...o, items: o.items || x.items } : x));
  }));
  useSocketEvent('order:removed', ({ id }) => orders.setData((list) => list?.filter((x) => x.id !== id)));
  useSocketEvent('courier:self', (c) => setCourier(c));
  useSocketEvent('notification', (n) => toast(n.body, { title: n.title }));

  useEffect(() => {
    const onChange = (e) => setPending(e.detail);
    window.addEventListener('outbox:changed', onChange);
    const onOnline = async () => {
      const r = await flushOutbox();
      if (r.sent) { toast(`${r.sent} acción(es) sincronizada(s).`, { type: 'success' }); orders.reload(true); }
      r.failed.forEach((f) => toast(`${f.label}: ${f.error}`, { type: 'error' }));
    };
    window.addEventListener('online', onOnline);
    onOnline();
    return () => {
      window.removeEventListener('outbox:changed', onChange);
      window.removeEventListener('online', onOnline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const list = [...(orders.data || [])];
    const here = position || courier?.location;
    const dist = (o) => (here && o.lat != null ? haversine(here, { lat: o.lat, lng: o.lng }) : Infinity);
    const activeFirst = (o) => (['en_route', 'arriving', 'arrived'].includes(o.status) ? 0 : 1);
    list.sort((a, b) => {
      const af = activeFirst(a) - activeFirst(b);
      if (af) return af;
      if (sort === 'priority') return b.priority - a.priority || (a.route_order ?? 999) - (b.route_order ?? 999);
      if (sort === 'distance') return dist(a) - dist(b);
      return (a.route_order ?? 999) - (b.route_order ?? 999) || b.priority - a.priority || new Date(a.assigned_at) - new Date(b.assigned_at);
    });
    return list.map((o) => ({ o, d: dist(o) === Infinity ? null : dist(o) }));
  }, [orders.data, sort, position, courier?.location]);

  const act = async (order, status) => {
    if (['delivered', 'failed'].includes(status)) return setOutcome({ order, status });
    const coords = latest.current || null;
    const r = await run(() => postOrQueue(`/api/courier/orders/${order.id}/status`, { status, ...(coords ? { lat: coords.lat, lng: coords.lng } : {}) }, `#${order.order_number}`));
    if (r?.queued) {
      toast('Sin conexión: la acción se enviará cuando vuelva internet.', { type: 'warning' });
      orders.setData((list) => list.map((x) => (x.id === order.id ? { ...x, status, status_label: '(pendiente de sincronizar)' } : x)));
    } else if (r) {
      orders.setData((list) => list.map((x) => (x.id === r.id ? { ...x, ...r, items: x.items } : x)));
      if (status === 'en_route') toast(`Vas hacia ${order.customer_name}. El cliente y la oficina ya lo saben.`, { type: 'success' });
    }
  };

  if (me.loading && !me.data) return <div className="fullscreen-center"><Spinner /></div>;
  if (!courier) return <div className="fullscreen-center"><Empty title="No se pudo cargar tu perfil de mensajero" /></div>;
  const activeOrder = sorted.find(({ o }) => ['en_route', 'arriving', 'arrived'].includes(o.status))?.o;

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <span className="avatar lg" style={{ '--av': '#2563eb', border: '2px solid rgb(255 255 255 / 0.85)' }}>{initials(user.name)}</span>
        <div className="spacer">
          <div className="bold" style={{ fontSize: '1.05rem' }}>{user.name}</div>
          <div className="tiny row" style={{ gap: 6, opacity: 0.9 }}><span className="kpi-dot" style={{ background: courierColor(courier.status) }} />{courier.status_label}</div>
        </div>
        <OnlineIndicator />
        <button className="btn btn-ghost btn-icon" onClick={toggleTheme} aria-label={isDark ? 'Modo claro' : 'Modo oscuro'}><Icon name={isDark ? 'sun' : 'moon'} /></button>
        <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Cerrar sesión"><Icon name="logout" /></button>
      </header>

      <main className="stack" style={{ padding: 14 }}>
        {pending > 0 && <div className="alert alert-warning small">{pending} acción(es) pendiente(s) de sincronizar. Se enviarán al recuperar la conexión.</div>}

        <div className="card card-body stack-sm">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Jornada</strong>
            <span className="small muted">{courier.shift_active ? `Iniciada ${time(courier.shift_started_at)}` : 'Sin iniciar'}</span>
          </div>
          {!courier.shift_active ? (
            <>
              <p className="small muted">Inicia tu jornada para recibir rutas y que el despacho vea tu ubicación.</p>
              <ShiftStart busy={busy} onStart={(share) => run(async () => setCourier(await api.post('/api/courier/shift/start', { sharing_location: share })), share ? 'Jornada iniciada con ubicación activa.' : 'Jornada iniciada.')} />
            </>
          ) : (
            <>
              {courier.sharing_location ? (
                <div className="status-bar on"><span className="live-dot" /> UBICACIÓN ACTIVA <span className="spacer" /><span className="tiny" style={{ fontWeight: 500 }}>cada {settings.location_update_seconds || 15} s</span></div>
              ) : (
                <div className="status-bar off"><Icon name="crosshair" size={18} /> Ubicación no compartida</div>
              )}
              {trackError && <div className="alert alert-warning small">{trackError}</div>}
              {courier.sharing_location ? (
                <button className="btn btn-danger btn-lg" disabled={busy} onClick={() => run(async () => setCourier(await api.post('/api/courier/sharing', { sharing: false })), 'Dejaste de compartir tu ubicación.')}><Icon name="crosshair" /> DEJAR DE COMPARTIR UBICACIÓN</button>
              ) : (
                <button className="btn btn-primary btn-lg" disabled={busy || !settings.courier_tracking_enabled} onClick={() => run(async () => { await getCurrentPosition(); setCourier(await api.post('/api/courier/sharing', { sharing: true })); }, 'Ubicación activa.')}><Icon name="crosshair" /> COMPARTIR UBICACIÓN</button>
              )}
              <div className="grid grid-2" style={{ gap: 8 }}>
                <button className="btn" disabled={busy} onClick={() => run(async () => setCourier(await api.post('/api/courier/pause', { paused: courier.status !== 'paused' })))}>
                  <Icon name={courier.status === 'paused' ? 'play' : 'pause'} /> {courier.status === 'paused' ? 'Reanudar' : 'Pausar'}
                </button>
                <button className="btn btn-outline-danger" disabled={busy} onClick={() => window.confirm('¿Terminar tu jornada? Se detendrá el seguimiento de ubicación.') && run(async () => setCourier(await api.post('/api/courier/shift/end')), 'Jornada terminada.')}><Icon name="power" /> Terminar jornada</button>
              </div>
              {courier.sharing_location && (
                <div className="tiny muted">Mantén esta pantalla abierta: los navegadores pausan el GPS cuando la app se cierra o queda en segundo plano.{wake.supported && wake.on ? ' La pantalla se mantendrá encendida.' : ''}</div>
              )}
            </>
          )}
        </div>

        <div className="card seg-tabs" role="tablist">
          {[['active', 'MIS ENTREGAS'], ['inventory', 'Mi inventario'], ['history', 'Historial']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <InstallBanner recommended storageKey="lrd_install_courier" />

        {tab === 'inventory' ? <CourierInventory /> : tab === 'history' ? <History /> : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Mis entregas</h2>
              <span className="small muted">{orders.data?.length || 0} pendientes · {courier.delivered_today} entregadas hoy</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{activeOrder ? `Atendiendo: ${activeOrder.customer_name}` : 'Elige el cliente que vas a atender'}</span>
              <select className="select" style={{ width: 'auto', minHeight: 34 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
                <option value="route">Orden asignado</option>
                <option value="priority">Prioridad</option>
                <option value="distance">Cercanía</option>
              </select>
            </div>
            {orders.loading && !orders.data ? <Spinner center /> : sorted.length === 0 ? <Empty icon="box" title="No tienes entregas asignadas">Cuando te asignen un pedido aparecerá aquí al instante.</Empty> : (
              sorted.map(({ o, d }) => <DeliveryCard key={o.id} order={o} distanceM={d} active={o.id === activeOrder?.id} busy={busy} onAction={act} onMap={setMapOrder} onNavigate={setNavOrder} onShare={setShareOrder} />)
            )}
            <div className="row-wrap" style={{ justifyContent: 'center' }}><PushButton className="btn btn-sm btn-ghost" label="Activar notificaciones" /></div>
          </>
        )}
      </main>

      {outcome && (
        <OutcomeModal
          order={outcome.order}
          initial={outcome.status}
          settings={settings}
          latest={latest.current}
          onClose={() => setOutcome(null)}
          onDone={(r, status) => {
            setOutcome(null);
            if (r?.queued) toast('Sin conexión: se enviará al volver internet.', { type: 'warning' });
            else toast(status === 'delivered' ? '¡Entrega registrada!' : 'Registro guardado.', { type: 'success' });
            orders.reload(true);
          }}
        />
      )}
      {shareOrder && <ShareDialog orderId={shareOrder.id} orderNumber={shareOrder.order_number} endpoint={`/api/courier/orders/${shareOrder.id}/share`} manage={false} onClose={() => setShareOrder(null)} />}
      {mapOrder && <OrderMap order={mapOrder} me={position || courier.location} onClose={() => setMapOrder(null)} onNavigate={() => { setNavOrder(mapOrder); setMapOrder(null); }} />}
      {navOrder && <NavChooser order={navOrder} onClose={() => setNavOrder(null)} />}
    </div>
  );
}
