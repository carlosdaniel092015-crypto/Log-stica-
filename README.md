# Entregas RD — Plataforma de logística y seguimiento de entregas

Aplicación web para gestionar entregas en **República Dominicana**: pedidos, mensajeros, zonas y tarifas en **RD$**, seguimiento en tiempo real con **Google Maps Platform** y un enlace privado para que el cliente siga su pedido. **El cliente no tiene cuenta**: solo recibe el enlace, que comparte el administrador o el mensajero.

Funciona completa desde el navegador (móvil, tablet y computadora). La instalación como **PWA es opcional** (recomendada para mensajeros).

---

## Inicio rápido

Requisitos: Node.js 20 o superior.

```bash
npm install
cp .env.example .env          # opcional en desarrollo
npm run seed                  # crea la base de datos con datos de ejemplo de RD
npm run build                 # compila el frontend
npm start                     # http://localhost:3000
```

Desarrollo con recarga en caliente: `npm run dev` (API en :3000 y Vite en :5173).

### Usuarios de demostración

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@demo.do | Admin123! |
| Despachador | despacho@demo.do | Despacho123! |
| Mensajeros | juan@demo.do · pedro@demo.do · ana@demo.do | Mensajero123! |

Al cargar los datos de ejemplo (`npm run seed`) se imprime un **enlace de seguimiento** de un pedido que está en camino. Ábrelo en otro navegador o en modo incógnito para ver la experiencia del cliente.

> `npm run seed` y `npm run reset` **borran los datos existentes**. En producción no se ejecutan, salvo que se defina `SEED_FORCE=true`.

### Pruebas

```bash
npm test                                                     # SQLite en memoria
TEST_DATABASE_URL=postgres://usuario@host/db_pruebas npm test   # PostgreSQL (borra esa base)
```

Cubren autenticación, permisos por rol (los clientes no tienen cuenta), detección de zonas y precios, el flujo completo de un pedido (crear → asignar → "Voy hacia este cliente" → llegando → entregado con evidencia), el seguimiento por token (incluido un token alterado o revocado, y el vencimiento automático al entregar o cancelar), el compartir del mensajero, la importación y exportación de tarifas, la protección CSRF y los eventos en tiempo real.

---

## Funcionalidades

**Administrador / despachador** (`/admin`)
- Dashboard: pedidos de hoy, pendientes, asignados, en ruta, entregados, no entregados, mensajeros y clientes activos e ingresos por delivery. Gráficos de entregas por día, ingresos, entregas por mensajero y por zona, y rendimiento por mensajero.
- Pedidos: creación con búsqueda de dirección (Google Places), **detección automática de zona y precio**, modificación manual del costo (con permiso), asignación y reasignación de mensajeros, cambio de estado, historial con fecha, hora, usuario y coordenadas, pruebas de entrega (foto, firma, quien recibió) y auditoría.
- Compartir el enlace de seguimiento por **WhatsApp, SMS, correo o copiándolo**. El enlace se puede regenerar o revocar mientras el pedido esté abierto.
- **Seguimiento en vivo**: mapa con los mensajeros en jornada, el pedido y el cliente al que se dirige cada uno, última actualización, pendientes y entregados del día.
- Mensajeros (orden de ruta definido por el administrador), clientes (lista y mapa, direcciones guardadas, historial).
- **Tarifas de entrega**: tabla con búsqueda, filtros, edición rápida de precio, activar/desactivar, historial de precios e importación/exportación CSV o JSON.
- **Zonas en el mapa**: dibujo de polígonos y círculos y probador de tarifa (tocas el mapa y muestra la zona y el precio).
- Provincias, municipios, distritos municipales y sectores, todos editables.
- Usuarios, roles y permisos, auditoría y **Configuración › Logística**.

**Mensajero** (`/mensajero`, diseño mobile-first)
- Iniciar y terminar la jornada, con el permiso de ubicación pedido de forma explícita. Indicador **UBICACIÓN ACTIVA** y botón **DEJAR DE COMPARTIR UBICACIÓN**.
- **MIS ENTREGAS**, ordenadas por orden asignado, prioridad o cercanía. Botones VER MAPA, INICIAR RUTA, LLAMAR, WHATSAPP, **VOY HACIA ESTE CLIENTE**, LLEGUÉ, ENTREGADO y NO ENTREGADO.
- Evidencia de entrega: nombre de quien recibe, notas, foto (comprimida en el dispositivo), firma, coordenadas (si hay permiso) y cobro en efectivo.
- **COMPARTIR SEGUIMIENTO CON EL CLIENTE** desde cada entrega (WhatsApp, SMS, correo o copiar); el mensajero solo comparte, no puede regenerar ni revocar.
- Modo sin conexión: las acciones se guardan en el dispositivo y se envían al volver internet.

**Cliente** (`/seguimiento/<token>`, sin cuenta ni inicio de sesión)
- Número y estado del pedido, progreso (✓ Recibido → Preparando → Mensajero asignado → En camino → Llegando → Entregado), mensajero, mapa con su ubicación (si la empresa lo permite), tiempo estimado de llegada y mensajes como "Tu mensajero está cerca".
- Confirmar la ubicación, compartirla (**USAR MI UBICACIÓN ACTUAL**, con aviso previo), corregir el pin y agregar referencias.
- Contactar con la empresa o con el mensajero (si está permitido) y activar notificaciones opcionales.

**Cierre automático del enlace:** en cuanto el pedido se marca como **Entregado** o **Cancelado** (por el mensajero o el administrador), todos sus enlaces se revocan, la página abierta del cliente muestra el cierre y deja de recibir datos, y el enlace responde "no disponible". No se puede volver a generar mientras el pedido siga cerrado. Así el cliente no puede seguir viendo al mensajero después de la entrega.

---

## Arquitectura

```
client/   React + Vite (SPA/PWA): pantallas, Google Maps JS API, Socket.IO, service worker
server/   Node.js + Express 5 + Socket.IO + Knex
  src/modules/
    auth/          inicio de sesión del personal y mensajeros, contraseñas (bcrypt), sesiones JWT en cookie httpOnly
    users/         usuarios, roles y permisos
    geo/           provincias, municipios, sectores y resolución de dirección → división territorial
    zones/         zonas, tarifas (con historial) y motor de cotización
    orders/        pedidos, máquina de estados, asignaciones, evidencias y eventos
    couriers/      jornada, ubicación, ETA y estado del mensajero
    tracking/      enlaces privados (token de 256 bits, guardado hasheado y cifrado), compartir y vista pública
    notifications/ notificaciones internas, Web Push y canales futuros (WhatsApp, SMS, correo)
    maps/          Geocoding API y Routes API desde el servidor
    dashboard/  audit/  settings/  customers/
  src/realtime/    salas de Socket.IO: personal, mensajero, usuario y seguimiento de cada pedido
  src/db/          migraciones (SQLite o PostgreSQL) y datos de ejemplo de RD
```

**Base de datos.** Tablas: `users`, `roles`, `customers`, `customer_addresses`, `couriers`, `courier_locations`, `orders`, `order_status_history`, `delivery_assignments`, `delivery_proofs`, `delivery_zones`, `delivery_rates`, `provinces`, `municipalities`, `sectors`, `tracking_links`, `notifications`, `push_subscriptions`, `audit_logs`, `settings` y `branches` (preparada para varias sucursales). Todas usan UUID, claves foráneas, índices y timestamps. **Ninguna provincia, sector ni precio está escrito en el código**: los datos de ejemplo están en `server/src/db/seeds/data/dominican-republic.json` y todo se edita desde el panel.

**Detección de zona y precio** (siempre en el servidor):
1. La dirección se resuelve a provincia, municipio y sector a partir de los componentes de Google. Si no coinciden, se usa el centroide registrado más cercano, marcado como aproximado.
2. Una zona coincide si el punto cae dentro de su polígono o círculo. Si la zona no tiene área (o la dirección no tiene coordenadas), coincide por división territorial.
3. Si coinciden varias, se aplica la prioridad configurable (por defecto: personalizada > sector > municipio > provincia), después la prioridad numérica de la zona y por último la zona más pequeña.
4. Se aplican el precio mínimo, la tarifa predeterminada (opcional) y el aviso de distancia máxima.

**Estados del pedido**: Nuevo, Preparando, Listo para despacho, Asignado, En camino, Llegando (automático al entrar en el radio configurado), Llegué al destino, Entregado, No entregado, Cliente no disponible, Reprogramado y Cancelado. Las transiciones se validan en el servidor según el rol.

---

## Google Maps Platform

Activa en Google Cloud las APIs **Maps JavaScript API**, **Places API (New)**, **Geocoding API** y **Routes API**, y crea **dos claves**:

| Clave | Variable | Restricciones |
|---|---|---|
| Navegador (pública) | `GOOGLE_MAPS_BROWSER_KEY` | HTTP referrers: `https://tudominio.com/*`. APIs: Maps JavaScript API y Places API (New) |
| Servidor (privada) | `GOOGLE_MAPS_SERVER_KEY` | Direcciones IP del servidor. APIs: Geocoding API y Routes API |

También necesitas `GOOGLE_MAPS_MAP_ID`, un Map ID de tipo JavaScript para los marcadores avanzados; `DEMO_MAP_ID` sirve para pruebas.

- El autocompletado usa `PlaceAutocompleteElement`, limitado a República Dominicana.
- El dibujo de zonas usa una herramienta propia, porque la Drawing Library de Google fue retirada.
- El tiempo estimado de llegada usa Routes API (`computeRoutes`, `TWO_WHEELER`) como máximo una vez cada 45 segundos por pedido. Sin clave de servidor, se estima con la distancia en línea recta × 1,35 y la velocidad promedio configurada.
- **Sin clave de navegador** la plataforma sigue funcionando: los mapas muestran un aviso y las direcciones se capturan escribiéndolas y eligiendo provincia, municipio y sector.

---

## Ubicación y PWA: comportamiento real en cada plataforma

- Los permisos de **ubicación, cámara y notificaciones se piden por separado y solo cuando la persona pulsa el botón correspondiente**. Instalar la PWA no concede ningún permiso.
- Antes de pedir la ubicación se explica para qué se usa. Si la persona la rechaza, el sistema sigue funcionando: buscar la dirección, escribirla o marcarla en el mapa.
- **Mensajeros**: la ubicación se envía solo con la jornada activa y el permiso concedido, con la frecuencia configurada. El historial se guarda únicamente si hubo un desplazamiento de 25 m o más (o cada 2 minutos) y se borra automáticamente al cumplirse los días de retención configurados.
- **Limitación de la web**: ni Android ni iOS permiten que una PWA o página web siga obteniendo el GPS cuando está cerrada o en segundo plano. La app lo indica al mensajero, mantiene la pantalla encendida con *Screen Wake Lock* (si el navegador lo admite) y reenvía la ubicación al volver a primer plano. Para rastrear en segundo plano de forma continua se necesitaría una app nativa (ya contemplada en la arquitectura).
- Web Push funciona en Chrome, Edge y Firefox, y en Android. En iOS, a partir de 16.4, funciona solo si la PWA está instalada en la pantalla de inicio. Siempre es opcional: el enlace de seguimiento muestra el estado actualizado en todo momento.
- Modo offline limitado: el service worker guarda en caché la aplicación y la lista de entregas del mensajero. Las acciones se envían cuando vuelve la conexión, con Background Sync donde está disponible.

---

## Seguridad

- **HTTPS obligatorio** en producción (redirección y HSTS) y cabeceras de seguridad con Helmet (CSP incluida).
- Contraseñas con **bcrypt**. Sesión JWT en una cookie `httpOnly`, `SameSite=Lax` y `Secure`. Al desactivar un usuario o cambiar su contraseña se invalidan todas sus sesiones.
- Protección **CSRF**: las peticiones que modifican datos deben enviarse como JSON.
- Autorización en el servidor:
  - El mensajero solo ve y modifica sus pedidos asignados.
  - Los clientes no tienen cuenta: solo el enlace de su pedido, que vence al entregarlo o cancelarlo.
  - El personal accede según los permisos de su rol.
- **Enlaces de seguimiento**:
  - Token aleatorio de 256 bits, guardado como hash SHA-256 y cifrado con AES-256-GCM (para poder volver a compartirlo).
  - Tienen vencimiento configurable, se revocan automáticamente al entregar o cancelar el pedido, se pueden revocar a mano y responden con el mismo error si el enlace no existe o venció.
  - Solo dan acceso al pedido de ese token.
- **Rate limiting** global, en el inicio de sesión y en las rutas públicas, y validación de todas las entradas con zod.
- **Auditoría** de los cambios importantes: usuario, acción, fecha y hora, pedido, valor anterior, valor nuevo, IP y navegador.
- Las evidencias (fotos y firmas) se sirven solo a personal autorizado o al mensajero que las registró.

---

## Producción

```bash
cp .env.example .env    # define JWT_SECRET, DATA_ENCRYPTION_KEY, PUBLIC_BASE_URL, claves de Google y ADMIN_*
POSTGRES_PASSWORD=... docker compose up -d --build
```

Coloca un proxy con HTTPS delante (Nginx, Caddy, Traefik o el balanceador de tu proveedor) que permita **WebSockets** (`/socket.io`). Las migraciones se aplican al iniciar el servidor. Si `ADMIN_EMAIL` y `ADMIN_PASSWORD` están definidos y la base está vacía, se crea el primer administrador.

Para escalar a varias instancias, usa el adaptador de Redis de Socket.IO y guarda las evidencias en un almacenamiento de objetos (S3 o GCS).

## Preparado para crecer

La arquitectura deja puntos de extensión para:
- Optimización de rutas con varias paradas (`route_order`; la Routes API ya está integrada).
- Varias sucursales y almacenes (`branches`).
- Cobro contra entrega y liquidación diaria (método y estado de pago y `cash_collected` en las evidencias).
- Canales de WhatsApp Business, SMS y correo (`notifications/channels.js`).
- Webhooks y API pública (la API REST ya está separada por módulos).
- Importación y exportación (CSV y JSON de tarifas ya disponibles), reportes, facturación y una app nativa.
