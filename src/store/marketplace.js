const { currency } = require("../config");
const { query, withTransaction } = require("../services/db");
const {
  createId,
  createPasswordHash,
  normalizeEmail,
  normalizePhone,
  verifyPassword
} = require("../services/auth");

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency
  }).format(Number(amount || 0));
}

function parseTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  return [];
}

async function logActivity({ actorUserId = null, actorRole = null, action, entityType, entityId, details = {} }) {
  await query(
    `
      INSERT INTO activity_logs (id, actor_user_id, actor_role, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [createId("log"), actorUserId, actorRole, action, entityType, entityId, JSON.stringify(details)]
  );
}

async function createSellerAccount({ name, phone, email, password, paymentDetails = "" }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  return withTransaction(async (client) => {
    const existing = await client.query(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = $1 OR phone = $2
        LIMIT 1
      `,
      [normalizedEmail, normalizedPhone]
    );

    if (existing.rowCount) {
      throw new Error("A user with this email or phone already exists.");
    }

    const userId = createId("user");
    const sellerId = createId("seller");
    const passwordHash = createPasswordHash(password);

    await client.query(
      `
        INSERT INTO users (id, role, name, phone, email, password_hash, status)
        VALUES ($1, 'seller', $2, $3, $4, $5, 'pending')
      `,
      [userId, name, normalizedPhone, normalizedEmail, passwordHash]
    );

    await client.query(
      `
        INSERT INTO sellers (
          id,
          user_id,
          subscription_status,
          trial_end_date,
          is_active,
          payment_details
        )
        VALUES ($1, $2, 'trial', NOW() + INTERVAL '30 days', FALSE, $3)
      `,
      [sellerId, userId, paymentDetails]
    );

    return {
      id: userId,
      role: "seller",
      name,
      phone: normalizedPhone,
      email: normalizedEmail,
      sellerId
    };
  });
}

async function authenticateUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const result = await query(
    `
      SELECT
        u.id,
        u.role,
        u.name,
        u.phone,
        u.email,
        u.password_hash,
        u.status,
        s.id AS seller_id,
        s.subscription_status,
        s.trial_end_date,
        s.is_active
      FROM users u
      LEFT JOIN sellers s ON s.user_id = u.id
      WHERE LOWER(u.email) = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  if (!result.rowCount) {
    return null;
  }

  const user = result.rows[0];

  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }

  return user;
}

async function getUserById(userId) {
  const result = await query(
    `
      SELECT
        u.id,
        u.role,
        u.name,
        u.phone,
        u.email,
        u.status,
        s.id AS seller_id,
        s.subscription_status,
        s.trial_end_date,
        s.is_active,
        s.payment_details,
        s.status_reason
      FROM users u
      LEFT JOIN sellers s ON s.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function listPublicCategories() {
  const result = await query(
    `
      SELECT DISTINCT p.category
      FROM products p
      JOIN sellers s ON s.id = p.seller_id
      JOIN users u ON u.id = s.user_id
      WHERE p.is_active = TRUE
        AND s.is_active = TRUE
        AND u.status = 'active'
      ORDER BY p.category ASC
    `
  );

  return result.rows.map((row) => row.category);
}

async function listPublicProducts({ category = null, search = null, limit = 25 } = {}) {
  const params = [];
  const conditions = ["p.is_active = TRUE", "s.is_active = TRUE", "u.status = 'active'"];

  if (category) {
    params.push(category);
    conditions.push(`LOWER(p.category) = LOWER($${params.length})`);
  }

  if (search) {
    params.push(`%${String(search).trim()}%`);
    const idx = params.length;
    conditions.push(
      `(p.name ILIKE $${idx} OR p.category ILIKE $${idx} OR p.description ILIKE $${idx} OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(p.tags) AS tag
        WHERE tag ILIKE $${idx}
      ))`
    );
  }

  params.push(limit);

  const result = await query(
    `
      SELECT
        p.id,
        p.seller_id,
        p.name,
        p.price,
        p.category,
        p.tags,
        p.image_url,
        p.description,
        p.moq,
        p.stock,
        seller_user.name AS seller_name
      FROM products p
      JOIN sellers s ON s.id = p.seller_id
      JOIN users u ON u.id = s.user_id
      JOIN users seller_user ON seller_user.id = s.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function getPublicProductById(productId) {
  const result = await query(
    `
      SELECT
        p.id,
        p.seller_id,
        p.name,
        p.price,
        p.category,
        p.tags,
        p.image_url,
        p.description,
        p.moq,
        p.stock,
        seller_user.name AS seller_name,
        s.payment_details
      FROM products p
      JOIN sellers s ON s.id = p.seller_id
      JOIN users u ON u.id = s.user_id
      JOIN users seller_user ON seller_user.id = s.user_id
      WHERE p.id = $1
        AND p.is_active = TRUE
        AND s.is_active = TRUE
        AND u.status = 'active'
      LIMIT 1
    `,
    [productId]
  );

  return result.rows[0] || null;
}

async function createProduct({ sellerId, input }) {
  const productId = createId("prod");
  const result = await query(
    `
      INSERT INTO products (
        id,
        seller_id,
        name,
        price,
        category,
        tags,
        image_url,
        description,
        moq,
        stock,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, TRUE)
      RETURNING *
    `,
    [
      productId,
      sellerId,
      input.name,
      Number(input.price),
      input.category,
      JSON.stringify(parseTags(input.tags)),
      input.imageUrl || null,
      input.description || "",
      Number(input.moq || 1),
      Number(input.stock || 0)
    ]
  );

  return result.rows[0];
}

async function updateProduct({ sellerId, productId, input }) {
  const existing = await query(
    `
      SELECT *
      FROM products
      WHERE id = $1 AND seller_id = $2
      LIMIT 1
    `,
    [productId, sellerId]
  );

  if (!existing.rowCount) {
    return null;
  }

  const current = existing.rows[0];
  const result = await query(
    `
      UPDATE products
      SET
        name = $3,
        price = $4,
        category = $5,
        tags = $6::jsonb,
        image_url = $7,
        description = $8,
        moq = $9,
        stock = $10,
        is_active = $11,
        updated_at = NOW()
      WHERE id = $1 AND seller_id = $2
      RETURNING *
    `,
    [
      productId,
      sellerId,
      input.name ?? current.name,
      Number(input.price ?? current.price),
      input.category ?? current.category,
      JSON.stringify(parseTags(input.tags ?? current.tags)),
      input.imageUrl ?? current.image_url,
      input.description ?? current.description,
      Number(input.moq ?? current.moq),
      Number(input.stock ?? current.stock),
      input.isActive ?? current.is_active
    ]
  );

  return result.rows[0];
}

async function deleteProduct({ sellerId, productId }) {
  const result = await query(
    `
      DELETE FROM products
      WHERE id = $1 AND seller_id = $2
      RETURNING id
    `,
    [productId, sellerId]
  );

  return Boolean(result.rowCount);
}

async function listSellerProducts(sellerId) {
  const result = await query(
    `
      SELECT *
      FROM products
      WHERE seller_id = $1
      ORDER BY created_at DESC
    `,
    [sellerId]
  );

  return result.rows;
}

async function createBuyerIfMissing({ phone, name }) {
  const normalizedPhone = normalizePhone(phone);
  const existing = await query(
    `
      SELECT id, role, name, phone
      FROM users
      WHERE phone = $1
      LIMIT 1
    `,
    [normalizedPhone]
  );

  if (existing.rowCount) {
    return existing.rows[0];
  }

  const userId = createId("user");
  const result = await query(
    `
      INSERT INTO users (id, role, name, phone, status)
      VALUES ($1, 'buyer', $2, $3, 'active')
      RETURNING id, role, name, phone
    `,
    [userId, name || "Buyer", normalizedPhone]
  );

  return result.rows[0];
}

async function createOrder({ buyerPhone, buyerName, sellerId, items, address, paymentMode, status, notes = null }) {
  const buyer = await createBuyerIfMissing({ phone: buyerPhone, name: buyerName });

  return withTransaction(async (client) => {
    const orderId = createId("ord");
    const totalAmount = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

    await client.query(
      `
        INSERT INTO orders (
          id,
          buyer_user_id,
          buyer_phone,
          buyer_name,
          seller_id,
          status,
          payment_mode,
          total_amount,
          address,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [orderId, buyer.id, buyerPhone, buyerName, sellerId, status, paymentMode, totalAmount, address, notes]
    );

    for (const item of items) {
      await client.query(
        `
          INSERT INTO order_items (
            id,
            order_id,
            product_id,
            product_name,
            quantity,
            price,
            image_url
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          createId("item"),
          orderId,
          item.product_id,
          item.product_name,
          item.quantity,
          item.price,
          item.image_url || null
        ]
      );
    }

    if (paymentMode === "prepaid") {
      await client.query(
        `
          INSERT INTO payments (id, order_id, type, status, amount)
          VALUES ($1, $2, 'prepaid', 'awaiting_proof', $3)
        `,
        [createId("pay"), orderId, totalAmount]
      );
    }

    return orderId;
  });
}

async function getOrderById(orderId) {
  const orderResult = await query(
    `
      SELECT
        o.*,
        seller_user.name AS seller_name,
        seller_user.phone AS seller_phone,
        s.payment_details
      FROM orders o
      JOIN sellers s ON s.id = o.seller_id
      JOIN users seller_user ON seller_user.id = s.user_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId]
  );

  if (!orderResult.rowCount) {
    return null;
  }

  const itemsResult = await query(
    `
      SELECT product_id, product_name, quantity, price, image_url
      FROM order_items
      WHERE order_id = $1
      ORDER BY created_at ASC
    `,
    [orderId]
  );

  const paymentsResult = await query(
    `
      SELECT id, type, status, amount, proof_url, notes, created_at
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
    `,
    [orderId]
  );

  return {
    ...orderResult.rows[0],
    items: itemsResult.rows,
    payments: paymentsResult.rows
  };
}

async function listBuyerOrders(phone) {
  const result = await query(
    `
      SELECT id, status, payment_mode, total_amount, created_at
      FROM orders
      WHERE buyer_phone = $1
      ORDER BY created_at DESC
      LIMIT 5
    `,
    [normalizePhone(phone)]
  );

  return result.rows;
}

async function attachPaymentProof({ orderId, proofUrl, notes = "Uploaded from WhatsApp" }) {
  const result = await query(
    `
      UPDATE payments
      SET proof_url = $2, status = 'submitted', notes = $3, updated_at = NOW()
      WHERE order_id = $1
      RETURNING id
    `,
    [orderId, proofUrl, notes]
  );

  if (!result.rowCount) {
    return false;
  }

  await query(
    `
      UPDATE orders
      SET status = 'pending', updated_at = NOW()
      WHERE id = $1
    `,
    [orderId]
  );

  return true;
}

async function updateOrderReceipt(orderId, receiptUrl) {
  await query(
    `
      UPDATE orders
      SET receipt_url = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [orderId, receiptUrl]
  );
}

async function listSellerOrders(sellerId) {
  const result = await query(
    `
      SELECT
        o.id,
        o.buyer_name,
        o.buyer_phone,
        o.status,
        o.payment_mode,
        o.total_amount,
        o.address,
        o.created_at
      FROM orders o
      WHERE o.seller_id = $1
      ORDER BY o.created_at DESC
    `,
    [sellerId]
  );

  return result.rows;
}

async function updateOrderStatus({ sellerId = null, orderId, status, notes = null }) {
  const params = [orderId, status, notes];
  const sellerCondition = sellerId ? "AND seller_id = $4" : "";

  if (sellerId) {
    params.push(sellerId);
  }

  const result = await query(
    `
      UPDATE orders
      SET status = $2, notes = COALESCE($3, notes), updated_at = NOW()
      WHERE id = $1
      ${sellerCondition}
      RETURNING id
    `,
    params
  );

  return Boolean(result.rowCount);
}

async function getSellerDashboard(sellerId) {
  const [productCount, orderCounts, sellerInfo] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM products WHERE seller_id = $1`, [sellerId]),
    query(
      `
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE status = 'pending_seller_confirmation')::int AS awaiting_confirmation,
          COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_orders,
          COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_orders,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue
        FROM orders
        WHERE seller_id = $1
      `,
      [sellerId]
    ),
    query(
      `
        SELECT
          s.id,
          s.subscription_status,
          s.trial_end_date,
          s.is_active,
          s.payment_details,
          s.status_reason
        FROM sellers s
        WHERE s.id = $1
        LIMIT 1
      `,
      [sellerId]
    )
  ]);

  return {
    seller: sellerInfo.rows[0] || null,
    metrics: {
      products: productCount.rows[0]?.count || 0,
      totalOrders: orderCounts.rows[0]?.total_orders || 0,
      awaitingConfirmation: orderCounts.rows[0]?.awaiting_confirmation || 0,
      acceptedOrders: orderCounts.rows[0]?.accepted_orders || 0,
      deliveredOrders: orderCounts.rows[0]?.delivered_orders || 0,
      revenue: Number(orderCounts.rows[0]?.revenue || 0)
    }
  };
}

async function listAdminSellers() {
  const result = await query(
    `
      SELECT
        s.id,
        u.name,
        u.email,
        u.phone,
        u.status,
        s.subscription_status,
        s.trial_end_date,
        s.is_active,
        s.payment_details,
        s.status_reason,
        s.created_at
      FROM sellers s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
    `
  );

  return result.rows;
}

async function updateSellerStatus({ sellerId, status, isActive, reason, adminUserId }) {
  const normalizedStatus = status || (isActive ? "active" : "inactive");

  const result = await query(
    `
      UPDATE users
      SET status = $2, updated_at = NOW()
      WHERE id = (SELECT user_id FROM sellers WHERE id = $1)
      RETURNING id
    `,
    [sellerId, normalizedStatus]
  );

  if (!result.rowCount) {
    return false;
  }

  await query(
    `
      UPDATE sellers
      SET
        is_active = $2,
        status_reason = $3,
        approved_by = $4,
        approved_at = CASE WHEN $2 = TRUE THEN NOW() ELSE approved_at END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [sellerId, Boolean(isActive), reason || null, adminUserId]
  );

  return true;
}

async function setSellerSubscription({ sellerId, subscriptionStatus, trialEndDate = null }) {
  const result = await query(
    `
      UPDATE sellers
      SET
        subscription_status = $2,
        trial_end_date = COALESCE($3, trial_end_date),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [sellerId, subscriptionStatus, trialEndDate]
  );

  return Boolean(result.rowCount);
}

async function getAdminAnalytics() {
  const result = await query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM sellers) AS sellers,
        (SELECT COUNT(*)::int FROM sellers WHERE is_active = TRUE) AS active_sellers,
        (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE) AS active_products,
        (SELECT COUNT(*)::int FROM orders) AS total_orders,
        (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM orders) AS gross_value
    `
  );

  return {
    sellers: result.rows[0]?.sellers || 0,
    activeSellers: result.rows[0]?.active_sellers || 0,
    activeProducts: result.rows[0]?.active_products || 0,
    totalOrders: result.rows[0]?.total_orders || 0,
    grossValue: Number(result.rows[0]?.gross_value || 0)
  };
}

async function listActivityLogs(limit = 50) {
  const result = await query(
    `
      SELECT *
      FROM activity_logs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

module.exports = {
  attachPaymentProof,
  authenticateUser,
  createOrder,
  createProduct,
  createSellerAccount,
  deleteProduct,
  formatCurrency,
  getAdminAnalytics,
  getOrderById,
  getPublicProductById,
  getSellerDashboard,
  getUserById,
  listActivityLogs,
  listAdminSellers,
  listBuyerOrders,
  listPublicCategories,
  listPublicProducts,
  listSellerOrders,
  listSellerProducts,
  logActivity,
  setSellerSubscription,
  updateOrderReceipt,
  updateOrderStatus,
  updateProduct,
  updateSellerStatus
};
