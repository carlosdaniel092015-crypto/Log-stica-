'use strict';

/**
 * Esquema inicial de la plataforma de logística.
 * Las fechas se guardan como timestamptz (PostgreSQL) o texto ISO-8601 UTC (SQLite).
 * Los campos JSON se guardan como texto para mantener compatibilidad entre motores.
 */

function timestamps(t) {
  t.timestamp('created_at', { useTz: true }).notNullable();
  t.timestamp('updated_at', { useTz: true }).notNullable();
}

exports.up = async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.string('id', 32).primary(); // admin | courier | customer
    t.string('name', 80).notNullable();
    t.text('permissions').notNullable().defaultTo('[]');
    timestamps(t);
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('role_id', 32).notNullable().references('id').inTable('roles');
    t.string('name', 160).notNullable();
    t.string('email', 190).notNullable().unique();
    t.string('phone', 40);
    t.string('password_hash', 120).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('token_version').notNullable().defaultTo(0);
    t.timestamp('last_login_at', { useTz: true });
    timestamps(t);
    t.index(['role_id', 'active']);
  });

  // Preparado para múltiples sucursales / almacenes.
  await knex.schema.createTable('branches', (t) => {
    t.uuid('id').primary();
    t.string('name', 160).notNullable();
    t.string('address', 300);
    t.double('lat');
    t.double('lng');
    t.string('phone', 40);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
  });

  await knex.schema.createTable('provinces', (t) => {
    t.uuid('id').primary();
    t.string('name', 120).notNullable().unique();
    t.string('code', 10);
    t.double('lat');
    t.double('lng');
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
  });

  await knex.schema.createTable('municipalities', (t) => {
    t.uuid('id').primary();
    t.uuid('province_id').notNullable().references('id').inTable('provinces').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('kind', 30).notNullable().defaultTo('municipio'); // municipio | distrito_municipal
    t.double('lat');
    t.double('lng');
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
    t.unique(['province_id', 'name']);
  });

  await knex.schema.createTable('sectors', (t) => {
    t.uuid('id').primary();
    t.uuid('municipality_id').notNullable().references('id').inTable('municipalities').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.double('lat');
    t.double('lng');
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
    t.unique(['municipality_id', 'name']);
  });

  await knex.schema.createTable('delivery_zones', (t) => {
    t.uuid('id').primary();
    t.string('name', 160).notNullable();
    t.string('kind', 20).notNullable(); // province | municipality | sector | custom
    t.uuid('province_id').references('id').inTable('provinces').onDelete('SET NULL');
    t.uuid('municipality_id').references('id').inTable('municipalities').onDelete('SET NULL');
    t.uuid('sector_id').references('id').inTable('sectors').onDelete('SET NULL');
    t.string('geometry_type', 10).notNullable().defaultTo('none'); // none | polygon | circle
    t.text('polygon'); // JSON [[lat,lng], ...]
    t.double('center_lat');
    t.double('center_lng');
    t.double('radius_m');
    t.integer('priority').notNullable().defaultTo(0); // desempate manual (mayor gana)
    t.string('color', 9).notNullable().defaultTo('#2563eb');
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
    t.index(['active', 'kind']);
  });

  // Historial de precios: la tarifa vigente es la más reciente de cada zona.
  await knex.schema.createTable('delivery_rates', (t) => {
    t.uuid('id').primary();
    t.uuid('zone_id').notNullable().references('id').inTable('delivery_zones').onDelete('CASCADE');
    t.decimal('price', 12, 2).notNullable();
    t.string('currency', 3).notNullable().defaultTo('DOP');
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('effective_from', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['zone_id', 'effective_from']);
  });

  await knex.schema.createTable('customers', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').unique().references('id').inTable('users').onDelete('SET NULL');
    t.string('name', 160).notNullable();
    t.string('phone', 40).notNullable();
    t.string('whatsapp', 40);
    t.string('email', 190);
    t.text('notes');
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(t);
    t.index(['phone']);
  });

  await knex.schema.createTable('customer_addresses', (t) => {
    t.uuid('id').primary();
    t.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.string('label', 80);
    t.string('formatted_address', 400).notNullable();
    t.double('lat');
    t.double('lng');
    t.string('place_id', 300);
    t.uuid('province_id').references('id').inTable('provinces').onDelete('SET NULL');
    t.uuid('municipality_id').references('id').inTable('municipalities').onDelete('SET NULL');
    t.uuid('sector_id').references('id').inTable('sectors').onDelete('SET NULL');
    t.string('reference', 400);
    t.boolean('is_default').notNullable().defaultTo(false);
    timestamps(t);
    t.index(['customer_id']);
  });

  await knex.schema.createTable('couriers', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('branch_id').references('id').inTable('branches').onDelete('SET NULL');
    t.string('vehicle', 80);
    t.string('plate', 20);
    // available | en_route | delivering | paused | off_duty
    t.string('status', 20).notNullable().defaultTo('off_duty');
    t.boolean('shift_active').notNullable().defaultTo(false);
    t.timestamp('shift_started_at', { useTz: true });
    t.boolean('sharing_location').notNullable().defaultTo(false);
    t.double('last_lat');
    t.double('last_lng');
    t.double('last_accuracy');
    t.timestamp('last_location_at', { useTz: true });
    t.uuid('current_order_id');
    timestamps(t);
  });

  await knex.schema.createTable('courier_locations', (t) => {
    t.uuid('id').primary();
    t.uuid('courier_id').notNullable().references('id').inTable('couriers').onDelete('CASCADE');
    t.uuid('order_id');
    t.double('lat').notNullable();
    t.double('lng').notNullable();
    t.double('accuracy');
    t.double('speed');
    t.double('heading');
    t.timestamp('recorded_at', { useTz: true }).notNullable();
    t.index(['courier_id', 'recorded_at']);
  });

  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary();
    t.integer('order_number').notNullable().unique();
    t.uuid('branch_id').references('id').inTable('branches').onDelete('SET NULL');
    t.uuid('customer_id').notNullable().references('id').inTable('customers');
    t.uuid('address_id').references('id').inTable('customer_addresses').onDelete('SET NULL');
    t.string('customer_name', 160).notNullable();
    t.string('phone', 40).notNullable();
    t.string('address', 400).notNullable();
    t.double('lat');
    t.double('lng');
    t.string('place_id', 300);
    t.string('reference', 400);
    t.uuid('province_id').references('id').inTable('provinces').onDelete('SET NULL');
    t.uuid('municipality_id').references('id').inTable('municipalities').onDelete('SET NULL');
    t.uuid('sector_id').references('id').inTable('sectors').onDelete('SET NULL');
    t.uuid('zone_id').references('id').inTable('delivery_zones').onDelete('SET NULL');
    t.decimal('delivery_fee', 12, 2).notNullable().defaultTo(0);
    t.boolean('fee_overridden').notNullable().defaultTo(false);
    t.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
    t.decimal('total', 12, 2).notNullable().defaultTo(0);
    t.string('payment_method', 20).notNullable().defaultTo('cash'); // cash | card | transfer | paid_online
    t.string('payment_status', 20).notNullable().defaultTo('pending'); // pending | paid | refunded
    t.string('status', 30).notNullable().defaultTo('new');
    t.integer('priority').notNullable().defaultTo(0);
    t.integer('route_order');
    t.uuid('courier_id').references('id').inTable('couriers').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('scheduled_for', { useTz: true });
    t.timestamp('assigned_at', { useTz: true });
    t.timestamp('departed_at', { useTz: true });
    t.timestamp('arrived_at', { useTz: true });
    t.timestamp('delivered_at', { useTz: true });
    t.integer('eta_seconds');
    t.double('eta_distance_m');
    t.timestamp('eta_updated_at', { useTz: true });
    t.boolean('location_confirmed').notNullable().defaultTo(false);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    timestamps(t);
    t.index(['status']);
    t.index(['courier_id', 'status']);
    t.index(['customer_id']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('order_status_history', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.string('from_status', 30);
    t.string('to_status', 30).notNullable();
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('actor_role', 20);
    t.string('note', 500);
    t.double('lat');
    t.double('lng');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['order_id', 'created_at']);
  });

  await knex.schema.createTable('delivery_assignments', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.uuid('courier_id').notNullable().references('id').inTable('couriers').onDelete('CASCADE');
    t.uuid('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('assigned_at', { useTz: true }).notNullable();
    t.timestamp('unassigned_at', { useTz: true });
    t.string('reason', 300);
    t.index(['order_id']);
    t.index(['courier_id', 'unassigned_at']);
  });

  await knex.schema.createTable('delivery_proofs', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.uuid('courier_id').references('id').inTable('couriers').onDelete('SET NULL');
    t.string('outcome', 30).notNullable(); // delivered | failed | customer_unavailable
    t.string('receiver_name', 160);
    t.text('notes');
    t.string('photo_path', 300);
    t.string('signature_path', 300);
    t.double('lat');
    t.double('lng');
    t.double('accuracy');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['order_id']);
  });

  await knex.schema.createTable('tracking_links', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique(); // SHA-256 del token
    t.text('token_encrypted').notNullable(); // AES-256-GCM, para poder volver a compartirlo
    t.timestamp('expires_at', { useTz: true });
    t.timestamp('revoked_at', { useTz: true });
    t.timestamp('last_accessed_at', { useTz: true });
    t.integer('access_count').notNullable().defaultTo(0);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['order_id']);
  });

  await knex.schema.createTable('push_subscriptions', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.uuid('tracking_link_id').references('id').inTable('tracking_links').onDelete('CASCADE');
    t.text('endpoint').notNullable();
    t.string('endpoint_hash', 64).notNullable().unique();
    t.string('p256dh', 200).notNullable();
    t.string('auth', 100).notNullable();
    t.string('user_agent', 300);
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['user_id']);
    t.index(['tracking_link_id']);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary();
    t.string('audience', 20).notNullable(); // admin | courier | customer
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.uuid('order_id').references('id').inTable('orders').onDelete('CASCADE');
    t.string('channel', 20).notNullable().defaultTo('in_app'); // in_app | push | whatsapp | sms | email
    t.string('title', 200).notNullable();
    t.string('body', 1000).notNullable();
    t.string('status', 20).notNullable().defaultTo('sent'); // queued | sent | failed | skipped
    t.string('error', 500);
    t.timestamp('read_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['audience', 'created_at']);
    t.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('user_name', 160);
    t.string('action', 80).notNullable();
    t.string('entity', 60).notNullable();
    t.string('entity_id', 64);
    t.uuid('order_id');
    t.text('old_value');
    t.text('new_value');
    t.string('ip', 64);
    t.string('user_agent', 300);
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['entity', 'entity_id']);
    t.index(['created_at']);
    t.index(['order_id']);
  });

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 80).primary();
    t.text('value').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable();
  });
};

exports.down = async function down(knex) {
  const tables = [
    'settings', 'audit_logs', 'notifications', 'push_subscriptions', 'tracking_links',
    'delivery_proofs', 'delivery_assignments', 'order_status_history', 'orders',
    'courier_locations', 'couriers', 'customer_addresses', 'customers', 'delivery_rates',
    'delivery_zones', 'sectors', 'municipalities', 'provinces', 'branches', 'users', 'roles',
  ];
  for (const table of tables) await knex.schema.dropTableIfExists(table);
};
