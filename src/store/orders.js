const orders = [];

function createOrder({ customerPhone, customerName, items, shippingAddress, paymentMode }) {
  const order = {
    id: `ORD-${String(orders.length + 1).padStart(4, "0")}`,
    customerPhone,
    customerName,
    items,
    shippingAddress,
    paymentMode,
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  return order;
}

function listOrders() {
  return orders;
}

module.exports = {
  createOrder,
  listOrders
};
