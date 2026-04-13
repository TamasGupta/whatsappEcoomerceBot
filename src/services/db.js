const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "";
const databaseSsl = process.env.DATABASE_SSL;
const databaseSslRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;

let pool = null;
let databaseReady = false;

function parseBoolean(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function getSslConfig() {
  const explicitSsl = parseBoolean(databaseSsl);
  const explicitRejectUnauthorized = parseBoolean(databaseSslRejectUnauthorized);

  if (explicitSsl === false) {
    return undefined;
  }

  let sslMode = "";

  if (connectionString) {
    try {
      const parsedUrl = new URL(connectionString);
      sslMode = (parsedUrl.searchParams.get("sslmode") || "").toLowerCase();
    } catch (error) {
      console.warn("Could not parse DATABASE_URL for sslmode. Falling back to env-based SSL config.");
    }
  }

  const sslRequiredByUrl = ["require", "verify-ca", "verify-full", "prefer", "allow"].includes(sslMode);
  const shouldUseSsl = explicitSsl === true || sslRequiredByUrl;

  if (!shouldUseSsl) {
    return undefined;
  }

  return {
    rejectUnauthorized:
      explicitRejectUnauthorized !== undefined
        ? explicitRejectUnauthorized
        : ["verify-ca", "verify-full"].includes(sslMode)
  };
}

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: getSslConfig()
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasDatabaseConfig() {
  return Boolean(pool);
}

function isDatabaseReady() {
  return databaseReady;
}

async function query(text, params = []) {
  if (!pool || !databaseReady) {
    throw new Error("Database is not available.");
  }

  return pool.query(text, params);
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      phone_number TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'idle',
      cart JSONB NOT NULL DEFAULT '[]'::jsonb,
      checkout_draft JSONB NOT NULL DEFAULT '{"shippingAddress":"","paymentMode":""}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
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

  await pool.query(`
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

async function initializeDatabase() {
  if (!pool) {
    console.log("DATABASE_URL not set. Using in-memory sessions and orders.");
    return false;
  }

  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      await createTables();
      databaseReady = true;
      console.log("Database connected.");
      return true;
    } catch (error) {
      databaseReady = false;
      console.error(
        `Database init attempt ${attempt}/${maxAttempts} failed: ${error.code || error.message}`
      );

      if (attempt < maxAttempts) {
        await sleep(attempt * 2000);
      }
    }
  }

  console.error("Database unavailable after retries. Falling back to in-memory sessions and orders.");
  return false;
}

module.exports = {
  hasDatabaseConfig,
  initializeDatabase,
  isDatabaseReady,
  query
};
