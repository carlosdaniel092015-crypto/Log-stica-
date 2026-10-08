/**
 * En el teléfono las tablas se muestran como tarjetas (ver styles.css, max-width 760px).
 * Cada celda necesita el nombre de su columna: se toma del encabezado de la tabla y se
 * pone en data-label, así ninguna pantalla tiene que hacerlo a mano.
 */
function labelTable(table) {
  const heads = [...table.querySelectorAll(':scope > thead > tr > th')].map((th) => th.textContent.trim());
  if (!heads.length) return;
  for (const row of table.querySelectorAll(':scope > tbody > tr')) {
    let col = 0;
    for (const cell of row.children) {
      const label = heads[col] || '';
      if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
      col += Number(cell.getAttribute('colspan') || 1);
    }
  }
}

/** Observa un contenedor y etiqueta sus tablas cada vez que cambian. Devuelve la función para dejar de observar. */
export function watchResponsiveTables(root) {
  if (!root) return () => {};
  let scheduled = false;
  const run = () => {
    scheduled = false;
    root.querySelectorAll('table.table').forEach(labelTable);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  };
  run();
  const mo = new MutationObserver(schedule);
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  return () => mo.disconnect();
}
