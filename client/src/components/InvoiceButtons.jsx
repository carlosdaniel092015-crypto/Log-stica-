import { useState } from 'react';
import { ApiError } from '../lib/api';
import Icon from './Icon';
import { useApp } from '../context/AppContext';

async function fetchPdf(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor. Verifica tu internet.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error || `Error ${res.status}`);
  }
  return res.blob();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Factura en PDF: "Enviar" abre el menú de compartir del teléfono (WhatsApp, correo…) con el
 * archivo adjunto; en computadoras sin esa opción, la descarga. "Ver" la abre en otra pestaña.
 * `base` es '/api/orders' (panel) o '/api/courier/orders' (mensajero).
 */
export default function InvoiceButtons({ order, base = '/api/orders', className = 'btn', compact = false }) {
  const { config, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const url = `${base}/${order.id}/invoice`;
  const name = `factura-${order.order_number}.pdf`;

  const send = async () => {
    setBusy(true);
    try {
      const blob = await fetchPdf(url);
      const file = new File([blob], name, { type: 'application/pdf' });
      const company = config?.company?.company_name || '';
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Factura #${order.order_number}`, text: `Factura del pedido #${order.order_number}${company ? ` · ${company}` : ''}` });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;
        }
      } else {
        download(blob, name);
        toast('Factura descargada. Adjúntala en WhatsApp o en el correo del cliente.', { type: 'success' });
      }
    } catch (err) {
      toast(err.message || 'No se pudo generar la factura.', { type: 'error', title: 'Factura' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={send} disabled={busy}>
        <Icon name="receipt" /> {busy ? 'Generando…' : compact ? 'FACTURA' : 'Enviar factura'}
      </button>
      {!compact && <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer"><Icon name="download" /> Ver PDF</a>}
    </>
  );
}
