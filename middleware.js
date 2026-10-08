/**
 * Vercel Routing Middleware: reenvía la API al backend (Easypanel, Dokploy o cualquier
 * servidor Docker). Así el navegador ve un solo dominio y la cookie de sesión funciona.
 * El tiempo real (Socket.IO) se conecta directo al backend, porque Vercel no reenvía WebSockets.
 *
 * Variable en Vercel: BACKEND_URL=https://api.tudominio.com
 */
export const config = { matcher: ['/api/:path*', '/healthz'] };

export default function middleware(request) {
  const backend = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!backend) {
    return new Response(JSON.stringify({ error: 'Falta la variable BACKEND_URL en Vercel.' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const url = new URL(request.url);
  return new Response(null, { headers: { 'x-middleware-rewrite': `${backend}${url.pathname}${url.search}` } });
}
