const { getSession, resetSession, saveSession } = require("./sessionStore");
const { createOrder } = require("../store/orders");
const {
  formatCurrency,
  formatProduct,
  getProductById,
  getProducts,
  searchProducts
} = require("../store/products");

function getHelpText() {
  return [
    "Welcome to the shop.",
    "",
    "Commands:",
    "`catalog` - list products",
    "`search <keyword>` - search products",
    "`view <product_id>` - product details",
    "`add <product_id> <qty>` - add to cart",
    "`cart` - see cart",
    "`remove <product_id>` - remove from cart",
    "`checkout` - place order",
    "`help` - show commands"
  ].join("\n");
}

function summarizeCatalog(products) {
  if (!products.length) {
    return "No products available right now.";
  }

  return [
    "Available products:",
    "",
    ...products.map(
      (product, index) =>
        `${index + 1}. ${product.name} (${product.id}) - ${formatCurrency(product.price)}`
    ),
    "",
    "Use `view <product_id>` or `add <product_id> <qty>`."
  ].join("\n");
}

function summarizeCart(session) {
  if (!session.cart.length) {
    return "Your cart is empty.";
  }

  const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return [
    "Your cart:",
    "",
    ...session.cart.map(
      (item, index) =>
        `${index + 1}. ${item.name} (${item.productId}) x ${item.quantity} = ${formatCurrency(
          item.price * item.quantity
        )}`
    ),
    "",
    `Total: ${formatCurrency(total)}`,
    "Type `checkout` to place the order."
  ].join("\n");
}

function addToCart(session, product, quantity) {
  const existingItem = session.cart.find((item) => item.productId === product.id);

  if (existingItem) {
    existingItem.quantity += quantity;
    return;
  }

  session.cart.push({
    productId: product.id,
    name: product.name,
    price: product.price,
    quantity
  });
}

function removeFromCart(session, productId) {
  const initialSize = session.cart.length;
  session.cart = session.cart.filter((item) => item.productId !== productId);
  return session.cart.length !== initialSize;
}

async function beginCheckout(from, session) {
  session.step = "awaiting_address";
  session.checkoutDraft = {
    shippingAddress: "",
    paymentMode: ""
  };
  await saveSession(from, session);

  return "Please send your full delivery address.";
}

async function finalizeOrder({ from, profileName, session }) {
  const order = await createOrder({
    customerPhone: from,
    customerName: profileName || "Customer",
    items: session.cart.map((item) => ({ ...item })),
    shippingAddress: session.checkoutDraft.shippingAddress,
    paymentMode: session.checkoutDraft.paymentMode
  });

  const total = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  await resetSession(from);

  return [
    `Order placed successfully: ${order.id}`,
    `Payment: ${order.paymentMode}`,
    `Total: ${formatCurrency(total)}`,
    `Shipping to: ${order.shippingAddress}`,
    "",
    "Reply `catalog` to continue shopping."
  ].join("\n");
}

async function handleCheckoutStep({ text, from, profileName, session }) {
  if (session.step === "awaiting_address") {
    session.checkoutDraft.shippingAddress = text;
    session.step = "awaiting_payment";
    await saveSession(from, session);
    return "Choose payment mode: `cod` or `upi`.";
  }

  if (session.step === "awaiting_payment") {
    const normalized = text.toLowerCase();
    if (!["cod", "upi"].includes(normalized)) {
      return "Invalid payment mode. Reply with `cod` or `upi`.";
    }

    session.checkoutDraft.paymentMode = normalized.toUpperCase();
    await saveSession(from, session);
    return finalizeOrder({ from, profileName, session });
  }

  return null;
}

async function handleIncomingText({ from, profileName, text }) {
  const session = await getSession(from);
  const trimmedText = text.trim();
  const normalized = trimmedText.toLowerCase();

  if (session.step !== "idle") {
    return handleCheckoutStep({ text: trimmedText, from, profileName, session });
  }

  if (!trimmedText || normalized === "help" || normalized === "menu" || normalized === "start") {
    return getHelpText();
  }

  if (normalized === "catalog") {
    return summarizeCatalog(getProducts());
  }

  if (normalized === "cart") {
    return summarizeCart(session);
  }

  if (normalized === "checkout") {
    if (!session.cart.length) {
      return "Your cart is empty. Add products before checkout.";
    }

    return beginCheckout(from, session);
  }

  if (normalized.startsWith("search ")) {
    const query = trimmedText.slice(7);
    const results = searchProducts(query);

    if (!results.length) {
      return `No products found for "${query}".`;
    }

    return summarizeCatalog(results);
  }

  if (normalized.startsWith("view ")) {
    const productId = trimmedText.split(/\s+/)[1];
    const product = getProductById(productId);

    if (!product) {
      return `Product ${productId} not found.`;
    }

    return `${formatProduct(product)}\n\nUse \`add ${product.id} 1\` to add it to your cart.`;
  }

  if (normalized.startsWith("add ")) {
    const [, productId, quantityRaw] = trimmedText.split(/\s+/);
    const quantity = Number(quantityRaw || 1);
    const product = getProductById(productId || "");

    if (!product) {
      return `Product ${productId || ""} not found.`;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return "Quantity must be a positive whole number.";
    }

    if (quantity > product.stock) {
      return `Only ${product.stock} units available for ${product.name}.`;
    }

    addToCart(session, product, quantity);
    await saveSession(from, session);
    return `${product.name} added to cart.\n\n${summarizeCart(session)}`;
  }

  if (normalized.startsWith("remove ")) {
    const productId = trimmedText.split(/\s+/)[1];
    const removed = removeFromCart(session, productId);

    if (removed) {
      await saveSession(from, session);
    }

    return removed ? summarizeCart(session) : `Product ${productId} is not in your cart.`;
  }

  return [
    "I did not understand that command.",
    "",
    getHelpText()
  ].join("\n");
}

module.exports = {
  handleIncomingText
};
