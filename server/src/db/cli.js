'use strict';
const { db } = require('./index');

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'migrate') {
    const [batch, files] = await db.migrate.latest();
    console.log(`Migraciones aplicadas (lote ${batch}):`, files.length ? files.join(', ') : 'ninguna nueva');
  } else if (cmd === 'seed') {
    await db.migrate.latest();
    await db.seed.run();
    console.log('Datos de ejemplo cargados.');
  } else if (cmd === 'reset') {
    await db.migrate.rollback(undefined, true);
    await db.migrate.latest();
    await db.seed.run();
    console.log('Base de datos reiniciada con datos de ejemplo.');
  } else {
    console.log('Uso: node src/db/cli.js <migrate|seed|reset>');
  }
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await db.destroy();
  process.exit(1);
});
