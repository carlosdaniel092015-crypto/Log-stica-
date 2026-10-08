'use strict';
/**
 * Canales externos de notificación (WhatsApp, SMS, correo).
 * Cada canal expone `isConfigured()` y `send({ to, body, subject })`.
 * Para integrar un proveedor real (WhatsApp Cloud API, Twilio, SendGrid, etc.)
 * basta con implementar `send` y registrar las credenciales en variables de entorno.
 */

function envProvider(name, requiredEnv) {
  return {
    name,
    isConfigured: () => requiredEnv.every((k) => !!process.env[k]),
    async send({ to, body }) {
      if (!this.isConfigured()) return { status: 'skipped', error: `Canal ${name} no configurado` };
      // Punto de integración del proveedor. Se deja registrado para auditoría.
      console.info(`[${name}] → ${to}: ${body.slice(0, 80)}`);
      return { status: 'queued' };
    },
  };
}

const channels = {
  whatsapp: envProvider('whatsapp', ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']),
  sms: envProvider('sms', ['SMS_PROVIDER_API_KEY']),
  email: envProvider('email', ['SMTP_URL']),
};

function availableChannels() {
  return Object.fromEntries(Object.entries(channels).map(([k, c]) => [k, c.isConfigured()]));
}

module.exports = { channels, availableChannels };
