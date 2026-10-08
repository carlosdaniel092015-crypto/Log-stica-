'use strict';

/**
 * Inventario: productos, existencias por mensajero, productos de cada pedido,
 * solicitudes (entregas por aprobar y reposiciones) y movimientos.
 */
function timestamps(t) {
  t.timestamp('created_at', { useTz: true }).notNullable();
  t.timestamp('updated_at', { useTz: true }).notNullable();
}

exports.up = async function up(knex) {
  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary();
    t.string('sku', 60).notNullable().unique();
    t.string('name', 160).notNullable();
    t.string('description', 500);
    t.string('unit', 30).notNullable().defaultTo('unidad');
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.integer('warehouse_stock').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
  });

  await knex.schema.createTable('courier_stock', (t) => {
    t.uuid('id').primary();
    t.uuid('courier_id').notNullable().references('id').inTable('couriers').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.integer('quantity').notNullable().defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).notNullable();
    t.unique(['courier_id', 'product_id']);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products');
    t.string('product_name', 160).notNullable();
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['order_id']);
  });

  await knex.schema.createTable('inventory_requests', (t) => {
    t.uuid('id').primary();
    t.integer('request_number').notNullable().unique();
    t.uuid('courier_id').notNullable().references('id').inTable('couriers').onDelete('CASCADE');
    t.uuid('order_id').references('id').inTable('orders').onDelete('SET NULL');
    t.string('kind', 20).notNullable(); // delivery | restock
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.string('note', 500);
    t.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true });
    t.string('review_note', 500);
    timestamps(t);
    t.index(['status', 'created_at']);
    t.index(['courier_id']);
  });

  await knex.schema.createTable('inventory_request_items', (t) => {
    t.uuid('id').primary();
    t.uuid('request_id').notNullable().references('id').inTable('inventory_requests').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products');
    t.integer('quantity_requested').notNullable();
    t.integer('quantity_approved');
    t.index(['request_id']);
  });

  await knex.schema.createTable('inventory_movements', (t) => {
    t.uuid('id').primary();
    // assign | return | deliver | restock | reject_restore | warehouse_adjust
    t.string('type', 30).notNullable();
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.uuid('courier_id').references('id').inTable('couriers').onDelete('SET NULL');
    t.uuid('order_id').references('id').inTable('orders').onDelete('SET NULL');
    t.uuid('request_id').references('id').inTable('inventory_requests').onDelete('SET NULL');
    t.integer('courier_delta').notNullable().defaultTo(0);
    t.integer('warehouse_delta').notNullable().defaultTo(0);
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('note', 500);
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['courier_id', 'created_at']);
    t.index(['product_id']);
  });
};

exports.down = async function down(knex) {
  for (const t of ['inventory_movements', 'inventory_request_items', 'inventory_requests', 'order_items', 'courier_stock', 'products']) {
    await knex.schema.dropTableIfExists(t);
  }
};
