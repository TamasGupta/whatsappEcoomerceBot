const { Pool } = require("pg");
const { databaseUrl, defaultAdminEmail, defaultAdminPassword } = require("../config");
const { createPasswordHash, normalizeEmail } = require("./auth");

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

  if (databaseUrl) {
    try {
      const parsedUrl = new URL(databaseUrl);
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

if (databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
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

async function withTransaction(callback) {
  if (!pool || !databaseReady) {
    throw new Error("Database is not available.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'buyer')),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
    ON users (phone)
    WHERE phone IS NOT NULL;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
    ON users (LOWER(email))
    WHERE email IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      subscription_status TEXT NOT NULL DEFAULT 'trial',
      trial_end_date TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      payment_details TEXT,
      status_reason TEXT,
      approved_by TEXT REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      category TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      image_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      moq INTEGER NOT NULL DEFAULT 1 CHECK (moq > 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS products_search_idx
    ON products (LOWER(name), LOWER(category));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      buyer_phone TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      payment_mode TEXT NOT NULL,
      total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
      address TEXT NOT NULL,
      notes TEXT,
      receipt_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      proof_url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      phone_number TEXT PRIMARY KEY,
      current_step TEXT NOT NULL DEFAULT 'idle',
      session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureDefaultAdmin() {
  const email = normalizeEmail(defaultAdminEmail);
  const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1", [email]);

  if (existing.rowCount) {
    return;
  }

  const passwordHash = createPasswordHash(defaultAdminPassword);

  await pool.query(
    `
      INSERT INTO users (id, role, name, email, password_hash, status)
      VALUES ('user_admin_default', 'admin', 'System Admin', $1, $2, 'active')
      ON CONFLICT (id) DO NOTHING
    `,
    [email, passwordHash]
  );

  console.log(`Default admin available at ${email}`);
}

async function initializeDatabase() {
  if (!pool) {
    console.log("DATABASE_URL not set. Database-backed marketplace features are unavailable.");
    return false;
  }

  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      await createTables();
      await ensureDefaultAdmin();
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

  console.error("Database unavailable after retries.");
  return false;
}

module.exports = {
  hasDatabaseConfig,
  initializeDatabase,
  isDatabaseReady,
  query,
  withTransaction
};
