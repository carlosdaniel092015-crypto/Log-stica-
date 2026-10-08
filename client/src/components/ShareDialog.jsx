import { useState } from 'react';
import { api } from '../lib/api';
import { fullDateTime } from '../lib/format';
import Icon from './Icon';
import { Modal, Spinner, useAction, useAsync } from './ui';
import { useApp } from '../context/AppContext';

/** Compartir el enlace privado de seguimiento por WhatsApp, SMS, correo o copiándolo. */
export default function ShareDialog({ orderId, orderNumber, onClose }) {
  const { toast } = useApp();
  const { data, loading, reload } = useAsync(() => api.get(`/api/orders/${orderId}/share`), [orderId]);
  const [busy, run] = useAction();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('No se pudo copiar automáticamente. Selecciona el enlace y cópialo.', { type: 'warning' });
    }
  };

  return (
    <Modal title={`Compartir seguimiento — Pedido #${orderNumber}`} onClose={onClose}>
      {loading || !data ? (
        <Spinner center />
      ) : (
        <div className="stack">
          <p className="small muted">El cliente abre este enlace desde cualquier navegador. No necesita instalar ninguna aplicación ni crear una cuenta. El enlace solo da acceso a este pedido.</p>
          <div className="input-group">
            <input className="input mono" readOnly value={data.url} onFocus={(e) => e.target.select()} aria-label="Enlace de seguimiento" />
            <button className="btn" onClick={copy}><Icon name="copy" /> {copied ? 'Copiado' : 'Copiar'}</button>
          </div>
          <div className="grid grid-3" style={{ gap: 8 }}>
            <a className="btn btn-success" href={data.whatsapp_url} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> WhatsApp</a>
            <a className="btn" href={data.sms_url}><Icon name="sms" /> SMS</a>
            {data.email_url ? <a className="btn" href={data.email_url}><Icon name="mail" /> Correo</a> : <button className="btn" disabled title="El cliente no tiene correo registrado"><Icon name="mail" /> Correo</button>}
          </div>
          {navigator.share && (
            <button className="btn" onClick={() => navigator.share({ title: `Pedido #${orderNumber}`, text: data.message }).catch(() => {})}>
              <Icon name="share" /> Compartir con otra app
            </button>
          )}
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Ver mensaje</summary>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginTop: 8 }}>{data.message}</pre>
          </details>
          <div className="small muted">
            {data.expires_at ? `Vence: ${fullDateTime(data.expires_at)}` : 'Sin vencimiento'} · Abierto {data.access_count} {data.access_count === 1 ? 'vez' : 'veces'}
          </div>
          <div className="row-wrap">
            <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => { await api.post(`/api/orders/${orderId}/tracking-link`); await reload(); }, 'Se generó un enlace nuevo; el anterior dejó de funcionar.')}>
              <Icon name="refresh" /> Generar enlace nuevo
            </button>
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => window.confirm('¿Revocar el enlace? El cliente ya no podrá abrirlo.') && run(async () => { await api.del(`/api/orders/${orderId}/tracking-link`); onClose(); }, 'Enlace revocado.')}>
              Revocar enlace
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
