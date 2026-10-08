import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { distance, duration, fullDateTime, money, PAYMENT_METHODS, time, whatsappUrl } from '../../lib/format';
import { getSocket } from '../../lib/socket';
import { pinElement } from '../../lib/maps';
import { MapView, fitTo, syncMarkers } from '../../components/Map';
import { UseMyLocationButton } from '../../components/AddressPicker';
import { Field, Modal, Spinner, useOnline } from '../../components/ui';
import { InstallBanner, PushButton } from '../../components/pwa';
import Icon from '../../components/Icon';
import { useApp } from '../../context/AppContext';

const ACTIVE = ['en_route', 'arriving', 'arrived'];
const NEGATIVE = ['failed', 'customer_unavailable', 'cancelled', 'rescheduled'];

function Steps({ steps }) {
  return (
    <ul className="timeline">
      {steps.map((s) => (
        <li key={s.key} className={s.state}>
          <span className="dot">{s.state === 'done' ? '✓' : ''}</span>
          <div className="tl-title">{s.label}</div>
        </li>
      ))}
    </ul>
  );
}

function LiveMap({ view, courierPos }) {
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const line = useRef(null);
  const fitted = useRef(false);
  const draw = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const items = [];
    if (view.destination) items.push({ id: 'dest', position: view.destination, content: pinElement({ color: '#dc2626', label: '' }), title: 'Tu ubicación de entrega' });
    if (courierPos?.lat != null) items.push({ id: 'courier', position: { lat: courierPos.lat, lng: courierPos.lng }, content: pinElement({ color: '#2563eb', label: '🛵', pulse: true, size: 40 }), title: 'Tu mensajero', zIndex: 10 });
    syncMarkers(markers.current, m.map, m.gm, items);
    if (view.destination && courierPos?.lat != null) {
      const path = [{ lat: courierPos.lat, lng: courierPos.lng }, view.destination];
      if (!line.current) line.current = new m.gm.maps.Polyline({ map: m.map, path, strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#2563eb', scale: 3 }, offset: '0', repeat: '14px' }] });
      else line.current.setPath(path);
    }
    if (!fitted.current) {
      fitted.current = true;
      fitTo(m.map, m.gm, items.map((i) => i.position), { maxZoom: 16, padding: 50 });
    }
  }, [view.destination, courierPos]);
  useEffect(draw, [draw]);
  return <MapView className="map" zoom={14} center={view.destination || undefined} onReady={(m) => { mapRef.current = m; draw(); }} />;
}

function FixLocationModal({ initial, onClose, onSave }) {
  const [pos, setPos] = useState(initial);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const markerRef = useRef(null);
  const onReady = ({ map, gm }) => {
    const m = new gm.marker.AdvancedMarkerElement({ map, position: pos, gmpDraggable: true, content: pinElement({ color: '#dc2626' }), title: 'Arrastra hasta tu ubicación' });
    markerRef.current = m;
    m.addListener('dragend', () => {
      const p = m.position;
      setPos({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng });
    });
    map.addListener('click', (e) => {
      const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      m.position = p;
      setPos(p);
    });
  };
  return (
    <Modal title="Corregir mi ubicación" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !pos} onClick={async () => { setBusy(true); await onSave({ ...pos, reference: reference || undefined, source: 'pin' }); setBusy(false); }}>Guardar ubicación</button></>}>
      <div className="stack-sm">
        <p className="small muted">Mueve el pin o toca el mapa en el punto exacto donde deseas recibir tu pedido.</p>
        <MapView className="map" center={pos || undefined} zoom={17} onReady={onReady} />
        <Field label="Referencia (opcional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej.: casa de dos niveles, portón negro" /></Field>
      </div>
    </Modal>
  );
}

export default function TrackingPage() {
  const { token } = useParams();
  const { toast } = useApp();
  const online = useOnline();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(null);
  const [courierPos, setCourierPos] = useState(null);
  const [fixing, setFixing] = useState(false);
  const [refText, setRefText] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((v) => {
    setView(v);
    setCourierPos(v.courier?.location || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/track/${token}`).then((v) => !cancelled && apply(v)).catch((err) => !cancelled && setError(err.message));
    const socket = getSocket();
    const join = () => socket.emit('track:join', { token }, (res) => { if (res?.ok && !cancelled) apply(res.view); });
    const onUpdate = (v) => apply(v);
    const onCourier = (p) => {
      setCourierPos(p.lat != null ? { lat: p.lat, lng: p.lng, updated_at: p.updated_at } : null);
      if (p.eta) setView((v) => (v ? { ...v, eta: { seconds: p.eta.seconds, distance_m: p.eta.distance_m, updated_at: p.updated_at } } : v));
    };
    const onClosed = (info) => {
      setClosed(info);
      setView(null);
      setCourierPos(null);
    };
    socket.on('connect', join);
    socket.on('tracking:update', onUpdate);
    socket.on('tracking:closed', onClosed);
    socket.on('tracking:courier', onCourier);
    if (socket.connected) join();
    return () => {
      cancelled = true;
      socket.off('connect', join);
      socket.off('tracking:update', onUpdate);
      socket.off('tracking:closed', onClosed);
      socket.off('tracking:courier', onCourier);
    };
  }, [token, apply]);

  useEffect(() => {
    if (view?.order_number) document.title = `Pedido #${view.order_number} · ${view.status_label}`;
  }, [view?.order_number, view?.status_label]);

  const post = async (path, body, msg) => {
    setBusy(true);
    try {
      apply(await api.post(`/api/track/${token}/${path}`, body));
      if (msg) toast(msg, { type: 'success' });
      return true;
    } catch (err) {
      toast(err.message, { type: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <div className="fullscreen-center">
        <div className="card card-body stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <img src="/icons/icon.svg" width="56" height="56" alt="" style={{ margin: '0 auto' }} />
          <div className="small muted">PEDIDO #{closed.order_number}</div>
          <h1>{closed.status_label}</h1>
          <p>{closed.message}</p>
          <p className="small muted">Por seguridad, el seguimiento de este pedido se cerró y este enlace ya no está activo.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fullscreen-center">
        <div className="card card-body stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <img src="/icons/icon.svg" width="56" height="56" alt="" style={{ margin: '0 auto' }} />
          <h1>Enlace no disponible</h1>
          <p className="muted">{error}</p>
          <p className="small muted">Si tu pedido ya fue entregado o cancelado, el seguimiento se cierra automáticamente por seguridad. Si necesitas ayuda, contacta a la empresa que te lo envió.</p>
        </div>
      </div>
    );
  }
  if (!view) return <div className="fullscreen-center"><Spinner /></div>;

  const c = view.company;
  const cur = c.currency_symbol;
  const active = ACTIVE.includes(view.status);
  const near = view.status === 'arriving' || (view.eta?.distance_m != null && view.eta.distance_m < 600);

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="track-hero">
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="company">
            <img src={c.company_logo_url || '/icons/icon-192.png'} alt="" />
            <span className="spacer">{c.company_name}</span>
            {!online && <span className="online-pill off">Sin conexión</span>}
          </div>
          <div style={{ marginTop: 18, opacity: 0.85 }} className="small">PEDIDO #{view.order_number}</div>
          <div className="track-status">{view.status_label}</div>
          <div style={{ opacity: 0.9 }}>{near && view.status !== 'arrived' ? 'Tu mensajero está cerca.' : view.message}</div>
        </div>
      </div>

      <div className="track-body">
        {NEGATIVE.includes(view.status) && (
          <div className={`alert ${view.status === 'rescheduled' ? 'alert-info' : 'alert-warning'}`}>
            {view.message}{view.scheduled_for ? ` Nueva fecha: ${fullDateTime(view.scheduled_for)}.` : ''}
          </div>
        )}

        {active && (
          <div className="card card-body stack-sm">
            {view.eta && (
              <div className="eta-box">
                <span className="small muted">Llegada estimada</span>
                <span className="value">{duration(view.eta.seconds)}</span>
                <span className="small muted">· {distance(view.eta.distance_m)}</span>
              </div>
            )}
            {view.courier?.location || courierPos || view.destination ? <LiveMap view={view} courierPos={courierPos} /> : null}
            {courierPos?.updated_at && <div className="tiny muted">Ubicación del mensajero actualizada a las {time(courierPos.updated_at)}</div>}
            {!courierPos && view.courier && <div className="small muted">La ubicación del mensajero no está disponible en este momento.</div>}
          </div>
        )}

        <div className="card card-body">
          <Steps steps={view.steps} />
        </div>

        {view.courier && (
          <div className="card card-body row">
            <div className="map-pin" style={{ '--pin': '#2563eb', transform: 'none', borderRadius: '50%' }}><span style={{ transform: 'none' }}>🛵</span></div>
            <div className="spacer">
              <div className="small muted">Tu mensajero</div>
              <div className="bold">{view.courier.name}</div>
              {view.courier.vehicle && <div className="tiny muted">{view.courier.vehicle}</div>}
            </div>
            {view.courier.phone && <a className="btn btn-sm" href={`tel:${view.courier.phone}`}><Icon name="phone" /> Llamar</a>}
            {view.courier.phone && <a className="btn btn-sm btn-success" href={whatsappUrl(view.courier.phone)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /></a>}
          </div>
        )}

        <div className="card card-body stack">
          <h3>Dirección de entrega</h3>
          <div>{view.address}</div>
          {view.sector_name && <div className="small muted">{view.sector_name}</div>}
          {view.reference && <div className="small">Referencia: {view.reference}</div>}
          {view.can_edit_location && (
            <>
              <div className={`alert ${view.location_confirmed ? 'alert-success' : 'alert-info'} small`}>
                {view.location_confirmed ? 'Ubicación confirmada. ¡Gracias!' : '¿Es correcta tu ubicación? Confírmala para que el mensajero llegue sin problemas.'}
              </div>
              <div className="row-wrap">
                {!view.location_confirmed && <button className="btn btn-primary" disabled={busy} onClick={() => post('confirm', {}, 'Ubicación confirmada.')}><Icon name="check" /> Confirmar ubicación</button>}
                <UseMyLocationButton className="btn" label="Usar mi ubicación actual" onLocated={(p) => post('location', { lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: 'gps' }, 'Gracias, recibimos tu ubicación.')} />
                <button className="btn" onClick={() => setFixing(true)}><Icon name="pin" /> Corregir en el mapa</button>
              </div>
              <form className="input-group" onSubmit={async (e) => { e.preventDefault(); if (await post('reference', { reference: refText }, 'Referencia agregada.')) setRefText(''); }}>
                <input className="input" placeholder="Agregar referencia (ej.: frente al colmado)" value={refText} onChange={(e) => setRefText(e.target.value)} minLength={2} maxLength={400} />
                <button className="btn" disabled={busy || refText.trim().length < 2}>Agregar</button>
              </form>
            </>
          )}
        </div>

        <div className="card card-body stack-sm">
          <h3>Detalle del pedido</h3>
          <dl className="kv">
            <dt>Cliente</dt><dd>{view.customer_name}</dd>
            <dt>Productos</dt><dd className="mono">{money(view.subtotal, cur)}</dd>
            <dt>Envío</dt><dd className="mono">{money(view.delivery_fee, cur)}</dd>
            <dt>Total</dt><dd className="mono bold">{money(view.total, cur)}</dd>
            <dt>Pago</dt><dd>{PAYMENT_METHODS[view.payment_method]} · {view.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}</dd>
          </dl>
        </div>

        <div className="card card-body">
          <h3 style={{ marginBottom: 8 }}>Historial</h3>
          {view.events.slice().reverse().map((e, i) => (
            <div key={i} className="row small" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="spacer">{e.label}</span>
              <span className="muted">{fullDateTime(e.at)}</span>
            </div>
          ))}
        </div>

        <div className="card card-body stack-sm">
          <h3>¿Necesitas ayuda?</h3>
          <div className="row-wrap">
            {c.company_phone && <a className="btn" href={`tel:${c.company_phone}`}><Icon name="phone" /> Llamar a {c.company_name}</a>}
            {c.company_whatsapp && <a className="btn btn-success" href={whatsappUrl(c.company_whatsapp, `Hola, consulto por mi pedido #${view.order_number}.`)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> WhatsApp</a>}
            {c.company_email && <a className="btn" href={`mailto:${c.company_email}?subject=${encodeURIComponent(`Pedido #${view.order_number}`)}`}><Icon name="mail" /> Correo</a>}
          </div>
          {c.business_hours && <div className="tiny muted">{c.business_hours}</div>}
          <div className="divider" />
          <PushButton endpoint={`/api/track/${token}/push`} label="Recibir notificaciones de este pedido" />
          <div className="tiny muted">Opcional. También puedes simplemente volver a abrir este enlace: siempre muestra el estado actualizado.</div>
        </div>

        <InstallBanner storageKey="lrd_install_tracking" />
        <p className="tiny muted" style={{ textAlign: 'center' }}>Este enlace es privado, solo muestra tu pedido y se desactiva al completarse la entrega. No necesitas cuenta ni instalar ninguna aplicación.</p>
      </div>

      {fixing && (
        <FixLocationModal
          initial={view.destination || { lat: 18.4861, lng: -69.9312 }}
          onClose={() => setFixing(false)}
          onSave={async (b) => { if (await post('location', b, 'Ubicación actualizada.')) setFixing(false); }}
        />
      )}
    </div>
  );
}
