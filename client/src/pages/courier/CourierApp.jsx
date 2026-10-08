import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, flushOutbox, outboxSize, postOrQueue } from '../../lib/api';
import { dateTime, distance as fmtDistance, duration, money, navigationUrl, PAYMENT_METHODS, whatsappUrl } from '../../lib/format';
import { courierColor, initials, pinElement } from '../../lib/maps';
import { getCurrentPosition, geoPermissionState } from '../../lib/geolocation';
import { CourierBadge, Empty, Field, Modal, OnlineIndicator, Spinner, StatusBadge, useAction, useAsync, useSocketEvent } from '../../components/ui';
import { MapView, fitTo, syncMarkers } from '../../components/Map';
import SignaturePad, { compressImage } from '../../components/SignaturePad';
import { InstallBanner, PushButton } from '../../components/pwa';
import Icon from '../../components/Icon';
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

function OrderMap({ order, me, onClose }) {
  const ref = useRef(new Map());
  const mapRef = useRef(null);
  const draw = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const items = [];
    if (order.lat != null) items.push({ id: 'dest', position: { lat: order.lat, lng: order.lng }, content: pinElement({ color: '#dc2626' }), title: order.address });
    if (me) items.push({ id: 'me', position: { lat: me.lat, lng: me.lng }, content: pinElement({ color: '#2563eb', label: 'Yo', pulse: true }), title: 'Mi ubicación' });
    syncMarkers(ref.current, m.map, m.gm, items);
  }, [order, me]);
  useEffect(draw, [draw]);
  return (
    <Modal title={`${order.customer_name} · #${order.order_number}`} onClose={onClose} size="lg" footer={<a className="btn btn-primary" href={navigationUrl(order.lat, order.lng, order.address)} target="_blank" rel="noreferrer"><Icon name="navigation" /> Iniciar navegación</a>}>
      <div className="stack-sm">
        <MapView className="map" zoom={15} center={order.lat != null ? { lat: order.lat, lng: order.lng } : undefined} onReady={(m) => { mapRef.current = m; draw(); fitTo(m.map, m.gm, [order.lat != null ? { lat: order.lat, lng: order.lng } : null, me], { maxZoom: 16 }); }} />
        <div className="small"><strong>{order.address}</strong></div>
        {order.reference && <div className="small muted">Referencia: {order.reference}</div>}
        {!order.location_confirmed && <div className="small" style={{ color: 'var(--warning)' }}>El cliente aún no ha confirmado su ubicación en el mapa.</div>}
      </div>
    </Modal>
  );
}

function DeliveryCard({ order, active, distanceM, settings, onAction, onMap, busy }) {
  const { currency } = useApp();
  const st = order.status;
  const primary = (() => {
    if (st === 'assigned' || st === 'failed' || st === 'customer_unavailable')
      return <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAction(order, 'en_route')}><Icon name="navigation" /> VOY HACIA ESTE CLIENTE</button>;
    if (st === 'en_route' || st === 'arriving')
      return <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAction(order, 'arrived')}><Icon name="pin" /> LLEGUÉ</button>;
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
          <div className="row" style={{ gap: 8 }}>
            {order.route_order != null && <span className="badge no-dot" style={{ '--c': 'var(--primary)' }}>{order.route_order}</span>}
            <strong style={{ fontSize: '1.05rem' }}>{order.customer_name}</strong>
          </div>
          <div className="small muted">Pedido #{order.order_number}{order.priority >= 5 ? ' · ⚡ Prioridad alta' : ''}</div>
        </div>
        <StatusBadge status={st} />
      </div>
      <div className="small"><Icon name="pin" size={14} /> {order.address}</div>
      {order.reference && <div className="small muted">Ref.: {order.reference}</div>}
      <div className="delivery-meta">
        <div><span className="muted">Sector:</span> {order.sector_name || order.municipality_name || '—'}</div>
        <div><span className="muted">Teléfono:</span> {order.phone}</div>
        <div><span className="muted">Envío:</span> {money(order.delivery_fee, currency)}</div>
        <div><span className="muted">Cobrar:</span> <strong>{order.payment_status === 'paid' ? 'Pagado' : money(order.total, currency)}</strong></div>
        <div><span className="muted">Pago:</span> {PAYMENT_METHODS[order.payment_method]}</div>
        {distanceM != null && <div><span className="muted">Distancia:</span> {fmtDistance(distanceM)}</div>}
      </div>
      {order.notes && <div className="alert alert-info small">{order.notes}</div>}
      {active && order.eta_seconds != null && <div className="small" style={{ color: 'var(--primary)' }}>Llegada estimada: {duration(order.eta_seconds)}</div>}
      <div className="delivery-actions">
        <button className="btn" onClick={() => onMap(order)}><Icon name="map" />VER MAPA</button>
        <a className="btn" href={navigationUrl(order.lat, order.lng, order.address)} target="_blank" rel="noreferrer"><Icon name="navigation" />INICIAR RUTA</a>
        <a className="btn" href={`tel:${order.phone}`}><Icon name="phone" />LLAMAR</a>
        <a className="btn" href={whatsappUrl(order.customer_whatsapp || order.phone, `Hola ${order.customer_name.split(' ')[0]}, soy el mensajero de tu pedido #${order.order_number}.`)} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WHATSAPP</a>
      </div>
      {primary}
      {(st === 'en_route' || st === 'arriving') && (
        <div className="grid grid-2" style={{ gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => onAction(order, 'delivered')}><Icon name="check" /> ENTREGADO</button>
          <button className="btn" disabled={busy} onClick={() => onAction(order, 'failed')}><Icon name="x" /> NO ENTREGADO</button>
        </div>
      )}
      {settings && null}
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
  const { user, logout, toast } = useApp();
  const me = useAsync(() => api.get('/api/courier/me'), []);
  const orders = useAsync(() => api.get('/api/courier/orders'), []);
  const [tab, setTab] = useState('active');
  const [sort, setSort] = useState('route');
  const [outcome, setOutcome] = useState(null);
  const [mapOrder, setMapOrder] = useState(null);
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
    return exists ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...list];
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
      orders.setData((list) => list.map((x) => (x.id === r.id ? r : x)));
      if (status === 'en_route') toast(`Vas hacia ${order.customer_name}. El cliente y la oficina ya lo saben.`, { type: 'success' });
    }
  };

  if (me.loading && !me.data) return <div className="fullscreen-center"><Spinner /></div>;
  if (!courier) return <div className="fullscreen-center"><Empty title="No se pudo cargar tu perfil de mensajero" /></div>;
  const activeOrder = sorted.find(({ o }) => ['en_route', 'arriving', 'arrived'].includes(o.status))?.o;

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="map-pin" style={{ '--pin': courierColor(courier.status), '--size': '34px', transform: 'none', borderRadius: '50%' }}><span style={{ transform: 'none' }}>{initials(user.name)}</span></div>
        <div className="spacer">
          <div className="bold">{user.name}</div>
          <div className="tiny" style={{ opacity: 0.8 }}>{courier.status_label}</div>
        </div>
        <OnlineIndicator />
        <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Cerrar sesión"><Icon name="logout" /></button>
      </header>

      <main className="stack" style={{ padding: 16 }}>
        <InstallBanner recommended storageKey="lrd_install_courier" />
        {pending > 0 && <div className="alert alert-warning small">{pending} acción(es) pendiente(s) de sincronizar. Se enviarán al recuperar la conexión.</div>}

        {!courier.shift_active ? (
          <div className="card card-body stack">
            <h2>Hola, {user.name.split(' ')[0]} 👋</h2>
            <p className="small muted">Inicia tu jornada para recibir y atender entregas.</p>
            <ShiftStart busy={busy} onStart={(share) => run(async () => setCourier(await api.post('/api/courier/shift/start', { sharing_location: share })), share ? 'Jornada iniciada con ubicación activa.' : 'Jornada iniciada.')} />
          </div>
        ) : (
          <div className="card card-body stack-sm">
            {courier.sharing_location ? (
              <div className="status-bar on"><span className="live-dot" /> UBICACIÓN ACTIVA {position?.accuracy ? <span className="tiny" style={{ fontWeight: 500 }}>(±{Math.round(position.accuracy)} m)</span> : ''}</div>
            ) : (
              <div className="status-bar off"><Icon name="crosshair" size={18} /> Ubicación no compartida</div>
            )}
            {trackError && <div className="alert alert-warning small">{trackError}</div>}
            {courier.sharing_location && (
              <div className="tiny muted">
                Mantén esta pantalla abierta mientras trabajas: los navegadores pausan el GPS cuando la app se cierra o queda en segundo plano.
                {wake.supported ? (wake.on ? ' La pantalla se mantendrá encendida.' : '') : ''}
              </div>
            )}
            <div className="grid grid-2" style={{ gap: 8 }}>
              {courier.sharing_location ? (
                <button className="btn btn-danger" disabled={busy} onClick={() => run(async () => setCourier(await api.post('/api/courier/sharing', { sharing: false })), 'Dejaste de compartir tu ubicación.')}>DEJAR DE COMPARTIR UBICACIÓN</button>
              ) : (
                <button className="btn btn-primary" disabled={busy || !settings.courier_tracking_enabled} onClick={() => run(async () => { await getCurrentPosition(); setCourier(await api.post('/api/courier/sharing', { sharing: true })); }, 'Ubicación activa.')}>COMPARTIR UBICACIÓN</button>
              )}
              <button className="btn" disabled={busy} onClick={() => run(async () => setCourier(await api.post('/api/courier/pause', { paused: courier.status !== 'paused' })))}>
                <Icon name={courier.status === 'paused' ? 'play' : 'pause'} /> {courier.status === 'paused' ? 'Reanudar' : 'Pausar'}
              </button>
            </div>
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <CourierBadge status={courier.status} />
              <PushButton className="btn btn-sm btn-ghost" label="Notificaciones" />
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => window.confirm('¿Terminar tu jornada? Se detendrá el seguimiento de ubicación.') && run(async () => setCourier(await api.post('/api/courier/shift/end')), 'Jornada terminada.')}>Terminar jornada</button>
            </div>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button className={`tab ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>MIS ENTREGAS ({orders.data?.length || 0})</button>
          <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Historial</button>
        </div>

        {tab === 'history' ? <History /> : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{activeOrder ? `Atendiendo: ${activeOrder.customer_name}` : 'Selecciona el cliente que vas a atender'}</span>
              <select className="select" style={{ width: 'auto', minHeight: 34 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
                <option value="route">Orden asignado</option>
                <option value="priority">Prioridad</option>
                <option value="distance">Cercanía</option>
              </select>
            </div>
            {orders.loading && !orders.data ? <Spinner center /> : sorted.length === 0 ? <Empty icon="box" title="No tienes entregas asignadas">Cuando te asignen un pedido aparecerá aquí al instante.</Empty> : (
              sorted.map(({ o, d }) => <DeliveryCard key={o.id} order={o} distanceM={d} active={o.id === activeOrder?.id} settings={settings} busy={busy} onAction={act} onMap={setMapOrder} />)
            )}
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
      {mapOrder && <OrderMap order={mapOrder} me={position || courier.location} onClose={() => setMapOrder(null)} />}
    </div>
  );
}
