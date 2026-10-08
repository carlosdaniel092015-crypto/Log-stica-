# Prompt para Claude Design — Entregas RD

Copia todo lo que está debajo de la línea y pégalo en Claude Design.

---

Diseña la interfaz completa de **Entregas RD**, una plataforma web de logística y gestión de entregas para **República Dominicana**. Debe verse moderna, profesional y sencilla, estar **completamente en español** y mostrar los montos en **RD$** (por ejemplo: RD$1,250). La aplicación funciona en navegador (móvil, tablet y computadora) y también se puede instalar como PWA, pero instalarla es opcional.

## Identidad visual
- Paleta: azul marino profundo `#0f2a4a` para la navegación y los encabezados, y azul `#2563eb` como color principal de acción. Fondos claros `#f3f5f9`, superficies blancas, bordes suaves `#e2e8f0` y texto `#0f172a`.
- Modo oscuro completo: fondo `#0b1220` y superficies `#111a2c`.
- Tipografía de sistema (system-ui / Inter), números con ancho tabular y esquinas redondeadas de 12px.
- Ícono: un pin de mapa azul con un check blanco sobre un cuadrado azul marino.
- Colores de estado (badges con punto de color, fondo tenue y texto del mismo tono):
  - Nuevo: gris pizarra `#64748b`
  - Preparando: ámbar `#d97706`
  - Listo para despacho: amarillo oscuro `#ca8a04`
  - Asignado: índigo `#6366f1`
  - En camino: azul `#2563eb`
  - Llegando: cian `#0891b2`
  - Llegué al destino: verde azulado `#0d9488`
  - **Entregado: verde `#16a34a`**
  - **No entregado: rojo `#dc2626`**
  - Cliente no disponible: naranja `#ea580c`
  - Reprogramado: morado `#9333ea`
  - Cancelado: gris `#6b7280`
- Estados del mensajero: Disponible (verde), En ruta (azul), En entrega (cian), Pausado (ámbar) y Fuera de servicio (gris).

## Roles y pantallas

### 1. Inicio de sesión
- Pantalla dividida. A la izquierda, un panel azul marino con el logo y beneficios (pedidos y mensajeros en tiempo real, tarifas automáticas por zona, seguimiento sin app). A la derecha, el formulario de correo y contraseña.
- Una nota: "¿Eres cliente? No necesitas cuenta: abre el enlace de seguimiento que te enviamos por WhatsApp, SMS o correo."
- Solo inician sesión el administrador, el despachador y el mensajero. **Los clientes no tienen cuenta.**

### 2. Panel administrativo (escritorio con menú lateral; en móvil, navegación inferior)
- **Menú lateral azul marino** agrupado:
  - Operación: Dashboard, Pedidos, Seguimiento en vivo, Mensajeros, Clientes, Inventario.
  - Cobertura: Tarifas de entrega, Zonas en el mapa, Provincias y sectores.
  - Administración: Usuarios, Auditoría, Configuración.
- **Barra superior**: título de la página, indicador "● En vivo" (tiempo real conectado) y campana de notificaciones con contador.
- **Dashboard**:
  - Tarjetas KPI: pedidos de hoy, pendientes, asignados, en ruta, entregados hoy, no entregados, mensajeros activos, clientes activos e ingresos por delivery (RD$).
  - Selector de rango (7, 14 o 30 días).
  - Gráficos: entregas por día (barras: entregados en azul, no entregados en naranja), ingresos por delivery (línea), entregas por mensajero y por zona (barras horizontales).
  - Tabla de rendimiento por mensajero.
- **Pedidos**:
  - Chips de filtro (Todos, Pendientes, Asignados, En camino, Entregados, No entregados, Cancelados), búsqueda, filtro de mensajero y fecha.
  - Tabla: #pedido, cliente, sector/zona, envío, total, pago, estado, selector de mensajero y botón compartir.
  - **Las filas de pedidos entregados se resaltan en verde suave y las de no entregados en rojo suave, y cambian solas en tiempo real.**
- **Nuevo pedido** (modal grande en tres pasos):
  1. Cliente: existente o nuevo.
  2. Dirección: buscador de Google Places, mapa con pin movible, botón "USAR MI UBICACIÓN ACTUAL" y selects de provincia, municipio y sector.
  3. Productos y pago.
  - Una caja destacada muestra la **zona tarifaria detectada y el precio del delivery**, por ejemplo: "Herrera · Sector — RD$250".
- **Detalle de pedido**: datos del cliente y la entrega, pago, mensajero y cambio de estado, mapa, línea de tiempo del historial (con hora y usuario), pruebas de entrega (foto, firma, quién recibió) y auditoría.
- **Compartir seguimiento** (modal): enlace con botón Copiar, botones grandes WhatsApp (verde), SMS y Correo, vista previa del mensaje y nota de que el enlace vence al entregar o cancelar.
- **Seguimiento en vivo**: mapa grande de Google Maps con marcadores circulares de colores e iniciales de cada mensajero (pulso animado si va en ruta) y una línea punteada hacia el cliente al que se dirige. Panel lateral con la lista de mensajeros (estado, "Hacia: María Rodríguez #1304", última actualización, pendientes y entregados hoy) y una leyenda de colores.
- **Mensajeros**: tabla con estado, jornada, ubicación activa, a quién se dirige y pendientes. Modal "Ruta" para reordenar entregas.
- **Inventario** (módulo nuevo):
  - Pestañas: Productos (SKU, nombre, precio, existencia en almacén), Inventario por mensajero (matriz mensajero × producto con botones Asignar y Devolver) y Solicitudes.
  - Solicitudes: tarjetas de entregas por aprobar y de reposición con las cantidades solicitadas, y botones "Aprobar" (verde) y "Rechazar".
  - "Entregas en vivo": feed con tarjetas **verdes (Entregado)** y **rojas (No entregado)** que aparecen solas.
  - Movimientos: historial de entradas y salidas.
- **Tarifas de entrega**: tabla (zona con punto de color, tipo, provincia, municipio, sector, área, precio editable en línea, estado activo/inactivo y editar) con botones Exportar CSV, Importar CSV y Nueva zona.
- **Zonas en el mapa**: mapa con polígonos y círculos de colores semitransparentes, panel con la lista de zonas y su precio, y un "probador": al tocar el mapa aparece una tarjeta con la zona y el precio.
- **Editor de zona** (modal extra grande): formulario a la izquierda (nombre, tipo, provincia, municipio, sector, precio RD$, prioridad, color) y, a la derecha, el mapa con las herramientas "Polígono", "Círculo", "Deshacer punto" y "Quitar área".
- **Configuración › Logística**: pestañas Empresa, Logística y tarifas, Seguimiento, Prueba de entrega, Notificaciones y Enlaces públicos, con interruptores (switches) y campos numéricos.
- Pantallas de Clientes, Provincias y sectores (tres columnas en cascada), Usuarios y Auditoría.

### 3. App del mensajero (mobile-first, 390px)
- **Encabezado azul marino**: avatar con iniciales, nombre, estado e indicador "En vivo".
- **Tarjeta de jornada**:
  - Antes de iniciar: botón verde grande "INICIAR JORNADA" y un modal que explica: "Para asignar rutas y permitir el seguimiento de tus entregas necesitamos acceso a tu ubicación mientras estás trabajando."
  - Ya iniciada: barra verde "● UBICACIÓN ACTIVA" con punto pulsante, botón rojo "DEJAR DE COMPARTIR UBICACIÓN", y los botones Pausar y Terminar jornada.
- **Pestañas**: MIS ENTREGAS, Mi inventario e Historial.
- **Tarjeta de entrega**:
  - Contenido: nombre del cliente, #pedido, badge de estado, dirección con ícono de pin, referencia, sector, teléfono, envío, monto a cobrar en negrita, método de pago, distancia y productos del pedido.
  - Cuatro botones cuadrados con ícono: VER MAPA, INICIAR RUTA, LLAMAR y WHATSAPP.
  - Botón "COMPARTIR SEGUIMIENTO CON EL CLIENTE".
  - Botón principal grande que cambia según el estado: azul "VOY HACIA ESTE CLIENTE", luego azul "LLEGUÉ", luego verde "ENTREGADO" y rojo "NO ENTREGADO".
  - La tarjeta del cliente que está atendiendo lleva un borde azul resaltado.
- **Modal de entrega**: chips Entregado / No entregado / Cliente no disponible / Reprogramado, nombre de quien recibió, casilla "Cobré RD$1,900 en efectivo", foto (cámara), área de firma con el dedo y notas.
- **Mi inventario**: lista de productos con su cantidad, solicitudes pendientes y botón "Solicitar inventario".

### 4. Seguimiento del cliente (página pública, sin cuenta, mobile-first)
- **Encabezado degradado** azul marino a azul con el logo de la empresa, "PEDIDO #1254", el estado grande ("En camino") y un mensaje ("Tu mensajero está en camino.").
- **Tarjeta superpuesta** con "Llegada estimada **9 min** · 1.5 km" en azul grande y un mapa con el pin rojo del cliente, el marcador del mensajero 🛵 con pulso y una línea punteada.
- **Línea de progreso vertical**: ✓ Pedido recibido, ✓ Preparando, ✓ Mensajero asignado, ● En camino, ○ Llegando, ○ Entregado (verde si está completado, azul con halo si es el paso actual, gris si está pendiente).
- **Tarjetas**:
  - Tu mensajero: nombre abreviado y vehículo.
  - Dirección de entrega: botones "Confirmar ubicación", "USAR MI UBICACIÓN ACTUAL", "Corregir en el mapa" y un campo para agregar referencia.
  - Detalle del pedido, historial con fecha y hora, y "¿Necesitas ayuda?" con Llamar y WhatsApp de la empresa.
  - Notificaciones opcionales.
- **Pantalla de cierre**: cuando el pedido se entrega o se cancela, una tarjeta centrada dice "Entregado — Por seguridad, el seguimiento de este pedido se cerró y este enlace ya no está activo."

## Componentes a incluir en el sistema de diseño
Botones (primario, éxito, peligro, fantasma, grande y bloque), badges de estado, tarjetas KPI, tablas con encabezado gris y fila al pasar el cursor, chips de filtro, switches, modales (en móvil se abren desde abajo), toasts con borde de color (verde para éxito, rojo para error), indicador "En vivo", indicador sin conexión, banner opcional "Instalar app", pines de mapa con forma de gota y la línea de tiempo.

## Requisitos
- Responsive: desktop 1440px, tablet 768px y móvil 390px.
- Accesible: contraste AA y textos o íconos acompañando al color (nunca solo color).
- Usa datos de ejemplo realistas de República Dominicana:
  - Sectores: Los Mina, Herrera, Piantini, Villa Mella, Los Alcarrizos, Boca Chica, Haina, Santiago, Autopista Duarte Km 9.
  - Nombres: María Rodríguez, Juan Pérez, Pedro Martínez.
  - Teléfonos: 809/829/849-555-XXXX.
  - Precios: Los Alcarrizos RD$200, Herrera RD$250, Haina RD$350, Santo Domingo Este RD$300, Boca Chica RD$500, Santiago RD$700.
