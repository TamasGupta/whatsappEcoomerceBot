const express = require("express");
const { signToken } = require("../services/auth");
const { saveDataUrl } = require("../services/storage");
const { generateReceipt } = require("../services/receipt");
const { authenticateRequest, requireRole } = require("../middleware/auth");
const {
  attachPaymentProof,
  authenticateUser,
  createOrder,
  createProduct,
  createSellerAccount,
  formatCurrency,
  getAdminAnalytics,
  getOrderById,
  getPublicProductById,
  getSellerDashboard,
  listActivityLogs,
  listAdminSellers,
  listPublicCategories,
  listPublicProducts,
  listSellerOrders,
  listSellerProducts,
  logActivity,
  setSellerSubscription,
  updateOrderReceipt,
  updateOrderStatus,
  updateProduct,
  updateSellerStatus,
  deleteProduct
} = require("../store/marketplace");

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sanitizeAuthUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    email: user.email,
    status: user.status,
    sellerId: user.seller_id || null,
    subscriptionStatus: user.subscription_status || null,
    trialEndDate: user.trial_end_date || null,
    isActive: user.is_active ?? null
  };
}

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "marketplace-backend" });
});

router.post(
  "/auth/signup",
  asyncRoute(async (req, res) => {
    const { name, phone, email, password, paymentDetails } = req.body || {};

    if (!name || !phone || !email || !password) {
      return res.status(400).json({ error: "name, phone, email, and password are required." });
    }

    const user = await createSellerAccount({ name, phone, email, password, paymentDetails });
    await logActivity({
      actorUserId: user.id,
      actorRole: "seller",
      action: "seller_signup",
      entityType: "seller",
      entityId: user.sellerId,
      details: { email: user.email, phone: user.phone }
    });

    return res.status(201).json({
      message: "Seller account created. Awaiting admin approval.",
      user
    });
  })
);

router.post(
  "/auth/login",
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required." });
    }

    const user = await authenticateUser({ email, password });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = signToken({
      sub: user.id,
      role: user.role,
      sellerId: user.seller_id || null
    });

    return res.json({
      token,
      user: sanitizeAuthUser(user)
    });
  })
);

router.get(
  "/auth/me",
  authenticateRequest,
  asyncRoute(async (req, res) => {
    res.json({ user: sanitizeAuthUser(req.auth.user) });
  })
);

router.get(
  "/products",
  asyncRoute(async (req, res) => {
    const { category, q, limit } = req.query;
    const products = await listPublicProducts({
      category: category || null,
      search: q || null,
      limit: Number(limit || 25)
    });

    res.json({ products });
  })
);

router.get(
  "/products/categories",
  asyncRoute(async (_req, res) => {
    const categories = await listPublicCategories();
    res.json({ categories });
  })
);

router.get(
  "/products/search",
  asyncRoute(async (req, res) => {
    const products = await listPublicProducts({
      search: req.query.q || "",
      limit: Number(req.query.limit || 25)
    });

    res.json({ products });
  })
);

router.get(
  "/products/:id",
  asyncRoute(async (req, res) => {
    const product = await getPublicProductById(req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ product });
  })
);

router.post(
  "/orders",
  asyncRoute(async (req, res) => {
    const { buyerPhone, buyerName, productId, quantity, address, paymentMode } = req.body || {};

    if (!buyerPhone || !buyerName || !productId || !quantity || !address || !paymentMode) {
      return res.status(400).json({ error: "Missing required order fields." });
    }

    const product = await getPublicProductById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    const orderQuantity = Number(quantity);

    if (!Number.isInteger(orderQuantity) || orderQuantity < product.moq) {
      return res.status(400).json({ error: `Minimum order quantity is ${product.moq}.` });
    }

    if (orderQuantity > product.stock) {
      return res.status(400).json({ error: `Only ${product.stock} units are available.` });
    }

    const status = paymentMode === "prepaid" ? "pending" : "pending_seller_confirmation";
    const orderId = await createOrder({
      buyerPhone,
      buyerName,
      sellerId: product.seller_id,
      items: [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: orderQuantity,
          price: product.price,
          image_url: product.image_url
        }
      ],
      address,
      paymentMode,
      status
    });

    await logActivity({
      actorRole: "buyer",
      action: "order_created",
      entityType: "order",
      entityId: orderId,
      details: { buyerPhone, paymentMode, productId: product.id }
    });

    const order = await getOrderById(orderId);
    return res.status(201).json({ order });
  })
);

router.get(
  "/orders/:id",
  asyncRoute(async (req, res) => {
    const order = await getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    res.json({ order });
  })
);

router.post(
  "/orders/:id/payment-proof",
  asyncRoute(async (req, res) => {
    const { proofDataUrl, notes } = req.body || {};

    if (!proofDataUrl) {
      return res.status(400).json({ error: "proofDataUrl is required." });
    }

    const order = await getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    const stored = saveDataUrl(proofDataUrl, "payments", req.params.id);
    await attachPaymentProof({
      orderId: req.params.id,
      proofUrl: stored.publicUrl,
      notes: notes || "Uploaded from API client"
    });

    const updatedOrder = await getOrderById(req.params.id);
    const receipt = generateReceipt(updatedOrder);
    await updateOrderReceipt(req.params.id, receipt.publicUrl);

    res.json({
      message: "Payment proof uploaded.",
      proofUrl: stored.publicUrl,
      receiptUrl: receipt.publicUrl
    });
  })
);

router.use(authenticateRequest);

router.post(
  "/products",
  requireRole("seller"),
  asyncRoute(async (req, res) => {
    const { imageDataUrl, ...input } = req.body || {};
    const image = imageDataUrl ? saveDataUrl(imageDataUrl, "products", Date.now().toString()) : null;
    const product = await createProduct({
      sellerId: req.auth.user.seller_id,
      input: {
        ...input,
        imageUrl: image?.publicUrl || input.imageUrl || null
      }
    });

    await logActivity({
      actorUserId: req.auth.user.id,
      actorRole: "seller",
      action: "product_created",
      entityType: "product",
      entityId: product.id,
      details: { sellerId: req.auth.user.seller_id }
    });

    res.status(201).json({ product });
  })
);

router.put(
  "/products/:id",
  requireRole("seller"),
  asyncRoute(async (req, res) => {
    const { imageDataUrl, ...input } = req.body || {};
    const image = imageDataUrl ? saveDataUrl(imageDataUrl, "products", req.params.id) : null;
    const product = await updateProduct({
      sellerId: req.auth.user.seller_id,
      productId: req.params.id,
      input: {
        ...input,
        imageUrl: image?.publicUrl || input.imageUrl
      }
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ product });
  })
);

router.delete(
  "/products/:id",
  requireRole("seller"),
  asyncRoute(async (req, res) => {
    const deleted = await deleteProduct({
      sellerId: req.auth.user.seller_id,
      productId: req.params.id
    });

    if (!deleted) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ message: "Product deleted." });
  })
);

router.get(
  "/seller/dashboard",
  requireRole("seller"),
  asyncRoute(async (req, res) => {
    const [dashboard, products, orders] = await Promise.all([
      getSellerDashboard(req.auth.user.seller_id),
      listSellerProducts(req.auth.user.seller_id),
      listSellerOrders(req.auth.user.seller_id)
    ]);

    res.json({ dashboard, products, orders });
  })
);

router.put(
  "/orders/:id/status",
  requireRole(["seller", "admin"]),
  asyncRoute(async (req, res) => {
    const { status, notes } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: "status is required." });
    }

    const updated = await updateOrderStatus({
      sellerId: req.auth.user.role === "seller" ? req.auth.user.seller_id : null,
      orderId: req.params.id,
      status,
      notes
    });

    if (!updated) {
      return res.status(404).json({ error: "Order not found." });
    }

    await logActivity({
      actorUserId: req.auth.user.id,
      actorRole: req.auth.user.role,
      action: "order_status_updated",
      entityType: "order",
      entityId: req.params.id,
      details: { status, notes }
    });

    const order = await getOrderById(req.params.id);
    res.json({ order });
  })
);

router.get(
  "/admin/sellers",
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const sellers = await listAdminSellers();
    res.json({ sellers });
  })
);

router.put(
  "/admin/sellers/:id/status",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const { status, reason } = req.body || {};
    const isActive = status === "active";
    const updated = await updateSellerStatus({
      sellerId: req.params.id,
      status,
      isActive,
      reason,
      adminUserId: req.auth.user.id
    });

    if (!updated) {
      return res.status(404).json({ error: "Seller not found." });
    }

    await logActivity({
      actorUserId: req.auth.user.id,
      actorRole: "admin",
      action: "seller_status_updated",
      entityType: "seller",
      entityId: req.params.id,
      details: { status, reason }
    });

    res.json({ message: "Seller status updated." });
  })
);

router.put(
  "/admin/sellers/:id/subscription",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const { subscriptionStatus, trialEndDate } = req.body || {};

    if (!subscriptionStatus) {
      return res.status(400).json({ error: "subscriptionStatus is required." });
    }

    const updated = await setSellerSubscription({
      sellerId: req.params.id,
      subscriptionStatus,
      trialEndDate: trialEndDate || null
    });

    if (!updated) {
      return res.status(404).json({ error: "Seller not found." });
    }

    res.json({ message: "Subscription updated." });
  })
);

router.get(
  "/admin/analytics",
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const analytics = await getAdminAnalytics();
    res.json({
      analytics,
      formattedGrossValue: formatCurrency(analytics.grossValue)
    });
  })
);

router.get(
  "/admin/activity-logs",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const logs = await listActivityLogs(Number(req.query.limit || 50));
    res.json({ logs });
  })
);

module.exports = router;
