const { Pool } = require("pg");

const sourceUrl = process.env.SOURCE_DATABASE_URL || "";
const targetUrl = process.env.TARGET_DATABASE_URL || "";

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

function getSslConfig(connectionString, sslEnvName, rejectEnvName) {
  const explicitSsl = parseBoolean(process.env[sslEnvName]);
  const explicitRejectUnauthorized = parseBoolean(process.env[rejectEnvName]);

  if (explicitSsl === false) {
    return undefined;
  }

  let sslMode = "";

  try {
    const parsedUrl = new URL(connectionString);
    sslMode = (parsedUrl.searchParams.get("sslmode") || "").toLowerCase();
  } catch (error) {
    console.warn(`Could not parse ${sslEnvName.replace("_SSL", "_DATABASE_URL")} for sslmode.`);
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

function createPool(connectionString, sslEnvName, rejectEnvName) {
  return new Pool({
    connectionString,
    ssl: getSslConfig(connectionString, sslEnvName, rejectEnvName)
  });
}

async function createTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      phone_number TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'idle',
      cart JSONB NOT NULL DEFAULT '[]'::jsonb,
      checkout_draft JSONB NOT NULL DEFAULT '{"shippingAddress":"","paymentMode":""}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
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

  await client.query(`
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

async function copyBotSessions(sourceClient, targetClient) {
  const { rows } = await sourceClient.query(`
    SELECT phone_number, step, cart, checkout_draft, updated_at
    FROM bot_sessions
    ORDER BY phone_number
  `);

  for (const row of rows) {
    await targetClient.query(
      `
        INSERT INTO bot_sessions (phone_number, step, cart, checkout_draft, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (phone_number) DO UPDATE
        SET
          step = EXCLUDED.step,
          cart = EXCLUDED.cart,
          checkout_draft = EXCLUDED.checkout_draft,
          updated_at = EXCLUDED.updated_at
      `,
      [row.phone_number, row.step, row.cart, row.checkout_draft, row.updated_at]
    );
  }

  return rows.length;
}

async function copyOrders(sourceClient, targetClient) {
  const { rows } = await sourceClient.query(`
    SELECT id, external_order_id, customer_phone, customer_name, shipping_address, payment_mode, total_amount, created_at
    FROM orders
    ORDER BY id
  `);

  for (const row of rows) {
    await targetClient.query(
      `
        INSERT INTO orders (
          id,
          external_order_id,
          customer_phone,
          customer_name,
          shipping_address,
          payment_mode,
          total_amount,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE
        SET
          external_order_id = EXCLUDED.external_order_id,
          customer_phone = EXCLUDED.customer_phone,
          customer_name = EXCLUDED.customer_name,
          shipping_address = EXCLUDED.shipping_address,
          payment_mode = EXCLUDED.payment_mode,
          total_amount = EXCLUDED.total_amount,
          created_at = EXCLUDED.created_at
      `,
      [
        row.id,
        row.external_order_id,
        row.customer_phone,
        row.customer_name,
        row.shipping_address,
        row.payment_mode,
        row.total_amount,
        row.created_at
      ]
    );
  }

  if (rows.length > 0) {
    await targetClient.query(`
      SELECT setval(
        pg_get_serial_sequence('orders', 'id'),
        COALESCE((SELECT MAX(id) FROM orders), 1),
        true
      )
    `);
  }

  return rows.length;
}

async function copyOrderItems(sourceClient, targetClient) {
  const { rows } = await sourceClient.query(`
    SELECT id, order_id, product_id, name, price, quantity
    FROM order_items
    ORDER BY id
  `);

  for (const row of rows) {
    await targetClient.query(
      `
        INSERT INTO order_items (id, order_id, product_id, name, price, quantity)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET
          order_id = EXCLUDED.order_id,
          product_id = EXCLUDED.product_id,
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          quantity = EXCLUDED.quantity
      `,
      [row.id, row.order_id, row.product_id, row.name, row.price, row.quantity]
    );
  }

  if (rows.length > 0) {
    await targetClient.query(`
      SELECT setval(
        pg_get_serial_sequence('order_items', 'id'),
        COALESCE((SELECT MAX(id) FROM order_items), 1),
        true
      )
    `);
  }

  return rows.length;
}

async function ensureSourceTablesExist(sourceClient) {
  await sourceClient.query("SELECT 1 FROM bot_sessions LIMIT 1");
  await sourceClient.query("SELECT 1 FROM orders LIMIT 1");
  await sourceClient.query("SELECT 1 FROM order_items LIMIT 1");
}

async function main() {
  if (!sourceUrl || !targetUrl) {
    throw new Error("Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL before running this migration.");
  }

  const sourcePool = createPool(
    sourceUrl,
    "SOURCE_DATABASE_SSL",
    "SOURCE_DATABASE_SSL_REJECT_UNAUTHORIZED"
  );
  const targetPool = createPool(
    targetUrl,
    "TARGET_DATABASE_SSL",
    "TARGET_DATABASE_SSL_REJECT_UNAUTHORIZED"
  );

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    await ensureSourceTablesExist(sourceClient);
    await targetClient.query("BEGIN");
    await createTables(targetClient);

    const sessionsCount = await copyBotSessions(sourceClient, targetClient);
    const ordersCount = await copyOrders(sourceClient, targetClient);
    const orderItemsCount = await copyOrderItems(sourceClient, targetClient);

    await targetClient.query("COMMIT");

    console.log(`Migrated ${sessionsCount} sessions, ${ordersCount} orders, and ${orderItemsCount} order items.`);
  } catch (error) {
    await targetClient.query("ROLLBACK");
    throw error;
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
