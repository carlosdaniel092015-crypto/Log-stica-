import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { distance, duration, money, PAYMENT_METHODS, time, whatsappUrl } from '../../lib/format';
import { getSocket } from '../../lib/socket';
import { MapView } from '../../components/Map';
import { Spinner, useOnline } from '../../components/ui';
import { InstallBanner } from '../../components/pwa';
import { enablePush, pushPermission, pushSupported } from '../../lib/push';
import Icon from '../../components/Icon';
import { useApp } from '../../context/AppContext';

const ACTIVE = ['en_route', 'arriving', 'arrived'];
const NEGATIVE = ['failed', 'customer_unavailable', 'rescheduled'];
const STEP_STATUSES = { received: ['new'], preparing: ['preparing', 'ready'], assigned: ['assigned'], en_route: ['en_route'], arriving: ['arriving', 'arrived'], delivered: ['delivered'] };

function dayTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short' })} · ${time(iso)}`;
}

function Steps({ steps, events }) {
  const firstAt = (key) => events.find((e) => STEP_STATUSES[key]?.includes(e.status))?.at;
  return (
    <ul className="timeline">
      {steps.map((s) => {
        const at = s.state !== 'pending' ? firstAt(s.key) : null;
        return (
          <li key={s.key} className={s.state}>
            <span className="dot">{s.state === 'done' ? '✓' : ''}</span>
            <div className="tl-title">{s.label}</div>
            {at && <div className="small muted">{time(at)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function LiveMap({ view, courierPos }) {
  const hRef = useRef(null);
  const fitted = useRef(false);
  const draw = useCallback(() => {
    const h = hRef.current;
    if (!h) return;
    const dest = view.destination;
    const markers = [];
    if (dest) markers.push({ id: 'dest', ...dest, kind: 'dest', color: '#dc2626', size: 34, title: 'Tu dirección' });
    if (courierPos?.lat != null) markers.push({ id: 'moto', lat: courierPos.lat, lng: courierPos.lng, kind: 'moto', color: '#2563eb', title: 'Tu mensajero' });
    h.setMarkers(markers);
    h.setLines(dest && courierPos?.lat != null ? [{ id: 'r', from: [courierPos.lat, courierPos.lng], to: [dest.lat, dest.lng], color: '#2563eb' }] : []);
    if (!fitted.current && markers.length) {
      fitted.current = true;
      h.fit(markers, { maxZoom: 16, padding: 50 });
    }
  }, [view.destination, courierPos]);
  useEffect(draw, [draw]);
  return <MapView className="map track-map" zoom={14} center={view.destination || undefined} onReady={(h) => { hRef.current = h; draw(); }} />;
}

/** Interruptor de notificaciones opcionales para este pedido. */
function NotifyToggle({ token }) {
  const { config, toast } = useApp();
  const key = `lrd_push_track_${token.slice(0, 12)}`;
  const [on, setOn] = useState(() => {
    try {
      return pushPermission() === 'granted' && localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (!pushSupported() || !config?.vapidPublicKey) return null;
  const toggle = async () => {
    if (on) {
      setOn(false);
      try {
        localStorage.removeItem(key);
      } catch {
        /* sin almacenamiento */
      }
      toast('Notificaciones desactivadas en este dispositivo.');
      return;
    }
    try {
      await enablePush(config.vapidPublicKey, `/api/track/${token}/push`);
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* sin almacenamiento */
      }
      setOn(true);
      toast('Te avisaremos cuando el mensajero esté llegando.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'warning' });
    }
  };
  return (
    <section className="card card-body row">
      <div className="spacer">
        <div className="bold">Notificaciones</div>
        <div className="small muted">Opcional: avísame cuando el mensajero esté llegando</div>
      </div>
      <label className="switch"><input type="checkbox" role="switch" checked={on} onChange={toggle} aria-label="Notificaciones" /><span /></label>
    </section>
  );
}

function ClosedCard({ title, message, footer, ok = true }) {
  return (
    <div className="fullscreen-center">
      <div className="card card-body stack" style={{ maxWidth: 420, textAlign: 'center', alignItems: 'center', padding: '28px 24px' }}>
        <img src="/icons/icon.svg" width="44" height="44" alt="" />
        <span className="closed-icon" style={{ '--c': ok ? 'var(--success)' : 'var(--muted)' }}><Icon name={ok ? 'check' : 'link'} size={30} /></span>
        <h1>{title}</h1>
        <p style={{ color: 'var(--text-2)' }}>{message}</p>
        {footer && <div className="small muted">{footer}</div>}
      </div>
    </div>
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
    return <ClosedCard title={closed.status_label} message="Por seguridad, el seguimiento de este pedido se cerró y este enlace ya no está activo." footer={`Pedido #${closed.order_number}`} ok={closed.status === 'delivered'} />;
  }
  if (error) {
    return <ClosedCard ok={false} title="Enlace no disponible" message={error} footer="Si tu pedido ya fue entregado o cancelado, el seguimiento se cierra automáticamente por seguridad. Si necesitas ayuda, contacta a la empresa que te lo envió." />;
  }
  if (!view) return <div className="fullscreen-center"><Spinner /></div>;

  const c = view.company;
  const cur = c.currency_symbol;
  const active = ACTIVE.includes(view.status);
  const near = view.status === 'arriving' || (view.eta?.distance_m != null && view.eta.distance_m < 500);
  const extra = Math.round((view.total - view.subtotal - view.delivery_fee) * 100) / 100;

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="track-hero">
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="company">
            <img src={c.company_logo_url || '/icons/icon.svg'} alt="" />
            <span className="spacer">{c.company_name}</span>
            {!online && <span className="live-pill offline">Sin conexión</span>}
          </div>
          <div className="track-order-no">PEDIDO #{view.order_number}</div>
          <div className="track-status">{near && view.status === 'en_route' ? 'Llegando' : view.status_label}</div>
          <div style={{ color: '#dbeafe' }}>{near && view.status !== 'arrived' ? 'Tu mensajero está a menos de 500 m.' : view.message}</div>
        </div>
      </div>

      <div className="track-body">
        {NEGATIVE.includes(view.status) && (
          <div className={`alert ${view.status === 'rescheduled' ? 'alert-info' : 'alert-warning'}`}>
            {view.message}{view.scheduled_for ? ` Nueva fecha: ${dayTime(view.scheduled_for)}.` : ''}
          </div>
        )}

        {active && (
          <section className="card" style={{ overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
            <div className="eta-box" style={{ padding: '14px 16px', flexWrap: 'wrap' }}>
              <span className="small muted bold">Llegada estimada</span>
              <span className="value">{view.eta ? duration(view.eta.seconds) : '—'}</span>
              {view.eta && <span className="eta-dist">· {distance(view.eta.distance_m)}</span>}
            </div>
            {view.destination || courierPos ? <LiveMap view={view} courierPos={courierPos} /> : null}
            {!courierPos && view.courier && <div className="small muted" style={{ padding: '8px 16px' }}>La ubicación del mensajero no está disponible en este momento.</div>}
          </section>
        )}

        <section className="card card-body">
          <Steps steps={view.steps} events={view.events} />
        </section>

        {view.courier && (
          <section className="card card-body row">
            <span className="avatar lg soft" style={{ '--av': 'var(--primary)', width: 46, height: 46 }}>{view.courier.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
            <div className="spacer">
              <div className="small muted bold">Tu mensajero</div>
              <div className="bold" style={{ fontSize: '1.05rem' }}>{view.courier.name}</div>
              {view.courier.vehicle && <div className="small" style={{ color: 'var(--text-2)' }}>{view.courier.vehicle}</div>}
            </div>
            {view.courier.phone && <a className="btn btn-sm btn-icon" href={`tel:${view.courier.phone}`} aria-label="Llamar al mensajero"><Icon name="phone" /></a>}
            {view.courier.phone && <a className="btn btn-sm btn-icon btn-wa" href={whatsappUrl(view.courier.phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp del mensajero"><Icon name="whatsapp" /></a>}
          </section>
        )}

        <section className="card card-body stack-sm">
          <h2 style={{ fontSize: '1rem' }}>Dirección de entrega</h2>
          <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: 'var(--danger)', marginTop: 2 }}><Icon name="pin" size={18} /></span>
            <div>
              <div className="bold">{view.address}</div>
              <div className="small muted">{[view.sector_name, view.reference].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          {view.can_edit_location && (
            <>
              <label className="field">
                <span>Agregar referencia</span>
                <form className="input-group" onSubmit={async (e) => { e.preventDefault(); if (await post('reference', { reference: refText }, 'Referencia enviada al mensajero.')) setRefText(''); }}>
                  <input className="input input-lg" placeholder="Ej.: portón negro, timbre a la derecha" value={refText} onChange={(e) => setRefText(e.target.value)} minLength={2} maxLength={400} />
                  <button className="btn" style={{ minHeight: 46 }} disabled={busy || refText.trim().length < 2}>Guardar</button>
                </form>
              </label>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-title"><h3>Detalle del pedido</h3></div>
          <div className="card-body stack-sm" style={{ fontSize: '0.92rem' }}>
            {view.items?.map((i, k) => <div key={k} className="row"><span className="spacer">{i.quantity}× {i.name}</span><span className="mono">{money(i.total, cur)}</span></div>)}
            {!view.items?.length && view.subtotal > 0 && <div className="row"><span className="spacer">Productos</span><span className="mono">{money(view.subtotal, cur)}</span></div>}
            <div className="row muted"><span className="spacer">Delivery{view.sector_name ? ` · ${view.sector_name}` : ''}</span><span className="mono">{money(view.delivery_fee, cur)}</span></div>
            {extra !== 0 && <div className="row muted"><span className="spacer">{extra < 0 ? 'Descuento' : 'Otros cargos'}</span><span className="mono">{extra < 0 ? '−' : ''}{money(Math.abs(extra), cur)}</span></div>}
            <div className="row" style={{ fontWeight: 800, fontSize: '1.08rem', paddingTop: 8, borderTop: '1px solid var(--border)' }}><span className="spacer">{view.payment_status === 'paid' ? 'Total pagado' : 'Total a pagar'}</span><span className="mono">{money(view.total, cur)}</span></div>
            <div className="small muted">{view.payment_status === 'paid' ? 'Pagado' : view.payment_method === 'cash' ? 'Pago en efectivo al recibir' : `Pago: ${PAYMENT_METHODS[view.payment_method]}`}</div>
          </div>
        </section>

        <section className="card">
          <div className="card-title"><h3>Historial</h3></div>
          {view.events.slice().reverse().map((e, i) => (
            <div key={i} className="list-item small"><span className="spacer">{e.label}</span><span className="muted nowrap">{dayTime(e.at)}</span></div>
          ))}
        </section>

        <NotifyToggle token={token} />

        <section className="card card-body stack-sm">
          <h2 style={{ fontSize: '1rem' }}>¿Necesitas ayuda?</h2>
          <div className="grid grid-2" style={{ gap: 8 }}>
            {c.company_phone && <a className="btn btn-lg" href={`tel:${c.company_phone}`}><Icon name="phone" /> Llamar</a>}
            {c.company_whatsapp && <a className="btn btn-lg btn-success" href={whatsappUrl(c.company_whatsapp, `Hola, consulto por mi pedido #${view.order_number}.`)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> WhatsApp</a>}
          </div>
          {!c.company_phone && !c.company_whatsapp && c.company_email && <a className="btn" href={`mailto:${c.company_email}?subject=${encodeURIComponent(`Pedido #${view.order_number}`)}`}><Icon name="mail" /> Escribir por correo</a>}
          {c.business_hours && <div className="tiny muted">{c.business_hours}</div>}
        </section>

        <InstallBanner storageKey="lrd_install_tracking" />
        <p className="tiny muted" style={{ textAlign: 'center' }}>No necesitas cuenta ni app. Este enlace vence cuando el pedido se entrega o se cancela.</p>
      </div>

    </div>
  );
}
