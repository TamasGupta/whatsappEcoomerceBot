const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "";

let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes("render.com")
      ? {
          rejectUnauthorized: false
        }
      : undefined
  });
}

async function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return pool.query(text, params);
}

async function initializeDatabase() {
  if (!pool) {
    console.log("DATABASE_URL not set. Using in-memory sessions and orders.");
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      phone_number TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'idle',
      cart JSONB NOT NULL DEFAULT '[]'::jsonb,
      checkout_draft JSONB NOT NULL DEFAULT '{"shippingAddress":"","paymentMode":""}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      external_order_id TEXT UNIQUE,
      customer_phone TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      payment_mode TEXT NOT NULL,
      total_amount NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price NUMERIC(12, 2) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
  `);
}

module.exports = {
  hasDatabase: Boolean(pool),
  initializeDatabase,
  query
};
