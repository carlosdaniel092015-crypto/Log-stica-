'use strict';
const PDFDocument = require('pdfkit');

const PAYMENT_METHODS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', paid_online: 'Pagado en línea' };
const PAYMENT_STATUS = { pending: 'Pendiente', paid: 'Pagado', refunded: 'Reembolsado' };

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const ACCENT = '#1d4ed8';

function invoiceNumber(order) {
  return `F-${String(order.order_number).padStart(8, '0')}`;
}

/**
 * Factura en PDF con el logo y los datos de la empresa (el RNC solo aparece si está configurado).
 * Devuelve un Buffer listo para descargar o compartir.
 */
function buildInvoice({ order, items = [], settings, logo, proof }) {
  const cur = settings.currency_symbol || 'RD$';
  const money = (v) => `${cur}${Number(v || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = (iso) => new Date(iso).toLocaleString('es-DO', { timeZone: settings.timezone || 'America/Santo_Domingo', day: '2-digit', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 50,
    info: { Title: `Factura ${invoiceNumber(order)}`, Author: settings.company_name, Subject: `Pedido #${order.order_number}` },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // --- Encabezado: logo + empresa | FACTURA ---
  let textX = left;
  if (logo) {
    try {
      doc.image(logo.buffer, left, 50, { fit: [72, 72] });
      textX = left + 86;
    } catch {
      textX = left; // imagen dañada: se omite el logo
    }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text(settings.company_name, textX, 52, { width: 270 });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
  const companyLines = [
    settings.company_rnc && `RNC: ${settings.company_rnc}`,
    settings.company_address,
    [settings.company_phone && `Tel.: ${settings.company_phone}`, settings.company_email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  for (const line of companyLines) doc.text(line, textX, doc.y + 2, { width: 270 });
  const headerBottom = Math.max(doc.y, logo ? 124 : doc.y);

  doc.font('Helvetica-Bold').fontSize(22).fillColor(ACCENT).text('FACTURA', right - 200, 50, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
  doc.text(`No. ${invoiceNumber(order)}`, right - 200, doc.y + 4, { width: 200, align: 'right' });
  doc.text(`Pedido #${order.order_number}`, right - 200, doc.y + 2, { width: 200, align: 'right' });
  doc.text(date(order.delivered_at || order.created_at), right - 200, doc.y + 2, { width: 200, align: 'right' });

  let y = Math.max(headerBottom, doc.y) + 18;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(LINE).stroke();
  y += 14;

  // --- Cliente y pago ---
  const colW = width / 2 - 10;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('FACTURADO A', left, y);
  doc.text('PAGO', left + width / 2 + 10, y);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(order.customer_name, left, y + 14, { width: colW });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
  for (const line of [order.phone, order.address, [order.sector_name, order.municipality_name].filter(Boolean).join(', ')].filter(Boolean)) {
    doc.text(line, left, doc.y + 2, { width: colW });
  }
  const leftBottom = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  doc.text(`Tipo de pago: ${PAYMENT_METHODS[order.payment_method] || order.payment_method || '—'}`, left + width / 2 + 10, y + 14, { width: colW });
  doc.text(`Estado: ${PAYMENT_STATUS[order.payment_status] || order.payment_status || '—'}`, left + width / 2 + 10, doc.y + 3, { width: colW });
  if (proof?.receiver_name) doc.text(`Recibido por: ${proof.receiver_name}`, left + width / 2 + 10, doc.y + 3, { width: colW });
  y = Math.max(leftBottom, doc.y) + 22;

  // --- Detalle ---
  const cols = [
    { label: 'DESCRIPCIÓN', x: left + 10, w: width - 250, align: 'left' },
    { label: 'CANT.', x: right - 240, w: 50, align: 'right' },
    { label: 'PRECIO', x: right - 180, w: 80, align: 'right' },
    { label: 'IMPORTE', x: right - 90, w: 80, align: 'right' },
  ];
  doc.rect(left, y, width, 22).fill('#f1f5f9');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
  for (const c of cols) doc.text(c.label, c.x, y + 7, { width: c.w, align: c.align });
  y += 22;

  const rows = items.length
    ? items.map((i) => [i.name, String(i.quantity), money(i.unit_price), money(i.unit_price * i.quantity)])
    : Number(order.subtotal) > 0 ? [['Productos', '1', money(order.subtotal), money(order.subtotal)]] : [];
  rows.push([`Servicio de entrega${order.sector_name ? ` · ${order.sector_name}` : ''}`, '1', money(order.delivery_fee), money(order.delivery_fee)]);

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  for (const r of rows) {
    const h = Math.max(22, doc.heightOfString(r[0], { width: cols[0].w }) + 12);
    if (y + h > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    r.forEach((v, i) => doc.text(v, cols[i].x, y + 6, { width: cols[i].w, align: cols[i].align }));
    y += h;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // --- Totales ---
  const subtotal = items.length ? items.reduce((s, i) => s + i.unit_price * i.quantity, 0) : Number(order.subtotal) || 0;
  const extra = Math.round((Number(order.total) - subtotal - Number(order.delivery_fee)) * 100) / 100;
  y += 12;
  const totals = [['Subtotal', money(subtotal)], ['Envío', money(order.delivery_fee)]];
  if (extra !== 0) totals.push([extra < 0 ? 'Descuento' : 'Otros cargos', `${extra < 0 ? '-' : ''}${money(Math.abs(extra))}`]);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  for (const [label, value] of totals) {
    doc.text(label, right - 240, y, { width: 140, align: 'right' });
    doc.fillColor(INK).text(value, right - 90, y, { width: 80, align: 'right' }).fillColor(MUTED);
    y += 18;
  }
  doc.rect(right - 250, y, 250, 30).fill(ACCENT);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff');
  doc.text('TOTAL', right - 240, y + 9, { width: 140, align: 'right' });
  doc.text(money(order.total), right - 100, y + 9, { width: 90, align: 'right' });
  y += 50;

  // --- Pie ---
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  if (settings.invoice_note) doc.text(settings.invoice_note, left, y, { width });
  doc.fontSize(8).fillColor(MUTED).text(
    `Generado el ${date(new Date().toISOString())} · No sustituye un comprobante fiscal (NCF)`,
    left,
    doc.page.height - doc.page.margins.bottom - 20,
    { width, align: 'center', lineBreak: false }
  );

  doc.end();
  return done;
}

/** Responde con la factura del pedido (admin o mensajero; el permiso se valida antes). */
async function sendInvoice(req, res, order) {
  const { db } = require('../../db');
  const { getSettings, getLogo } = require('../settings/service');
  const { itemsForOrders } = require('../inventory/service');
  const { audit } = require('../audit/service');
  const [settings, logo, items, proof] = await Promise.all([
    getSettings(),
    getLogo(),
    itemsForOrders([order.id]),
    db('delivery_proofs').where({ order_id: order.id }).orderBy('created_at', 'desc').first('receiver_name'),
  ]);
  const pdf = await buildInvoice({ order, items: items[order.id] || [], settings, logo, proof });
  await audit(req, { action: 'order.invoice', entity: 'order', entityId: order.id, orderId: order.id });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="factura-${order.order_number}.pdf"`,
    'Cache-Control': 'no-store',
  }).send(pdf);
}

module.exports = { buildInvoice, invoiceNumber, sendInvoice };
