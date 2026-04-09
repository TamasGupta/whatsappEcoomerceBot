const { hasDatabase, query } = require("../services/db");

const orders = [];

async function createOrder({ customerPhone, customerName, items, shippingAddress, paymentMode }) {
  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (!hasDatabase) {
    const order = {
      id: `ORD-${String(orders.length + 1).padStart(4, "0")}`,
      customerPhone,
      customerName,
      items,
      shippingAddress,
      paymentMode,
      totalAmount,
      createdAt: new Date().toISOString()
    };

    orders.push(order);
    return order;
  }

  const insertOrder = await query(
    `
      INSERT INTO orders (
        customer_phone,
        customer_name,
        shipping_address,
        payment_mode,
        total_amount
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `,
    [customerPhone, customerName, shippingAddress, paymentMode, totalAmount]
  );

  const dbOrder = insertOrder.rows[0];
  const externalOrderId = `ORD-${String(dbOrder.id).padStart(4, "0")}`;

  await query(
    `
      UPDATE orders
      SET external_order_id = $1
      WHERE id = $2
    `,
    [externalOrderId, dbOrder.id]
  );

  for (const item of items) {
    await query(
      `
        INSERT INTO order_items (order_id, product_id, name, price, quantity)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [dbOrder.id, item.productId, item.name, item.price, item.quantity]
    );
  }

  return {
    id: externalOrderId,
    customerPhone,
    customerName,
    items,
    shippingAddress,
    paymentMode,
    totalAmount,
    createdAt: dbOrder.created_at
  };
}

function listOrders() {
  return orders;
}

module.exports = {
  createOrder,
  listOrders
};
