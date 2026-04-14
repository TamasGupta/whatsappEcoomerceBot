const { getSession, resetSession, saveSession } = require("./sessionStore");
const { downloadWhatsAppMedia } = require("../services/storage");
const { generateReceipt } = require("../services/receipt");
const {
  attachPaymentProof,
  createOrder,
  formatCurrency,
  getOrderById,
  getPublicProductById,
  listBuyerOrders,
  listPublicCategories,
  listPublicProducts,
  logActivity,
  updateOrderReceipt
} = require("../store/marketplace");

const HOME_BUTTONS = [
  { id: "MENU_BROWSE", title: "Browse" },
  { id: "MENU_SEARCH", title: "Search" },
  { id: "MENU_ORDERS", title: "My Orders" }
];

function text(body) {
  return { type: "text", body };
}

function image(imageUrl, caption) {
  return { type: "image", imageUrl, caption };
}

function buttons(body, buttonList, footer) {
  return { type: "buttons", body, buttons: buttonList, footer };
}

function list(header, body, buttonText, sections, footer) {
  return { type: "list", header, body, buttonText, sections, footer };
}

function homeMessages(profileName) {
  return [
    text(
      [
        `Hi ${profileName || "there"}, welcome to Marketplace Bot.`,
        "1. Browse Products",
        "2. Search Product",
        "3. My Orders"
      ].join("\n")
    ),
    buttons("Choose an option.", HOME_BUTTONS, "You can also type 1, 2, or 3.")
  ];
}

async function buildCategoryListMessage() {
  const categories = await listPublicCategories();

  if (!categories.length) {
    return [
      text("No products are available right now."),
      buttons("Choose another action.", HOME_BUTTONS, "Ask the admin to publish active products.")
    ];
  }

  const sections = [
    {
      title: "Categories",
      rows: categories.map((category) => ({
        id: `CATEGORY_${category.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
        title: category.slice(0, 24),
        description: `Browse ${category}`
      }))
    }
  ];

  return list("Browse Products", "Pick a category.", "Open Categories", sections, "Shared backend catalog");
}

function buildProductListMessage(title, products, emptyMessage) {
  if (!products.length) {
    return [text(emptyMessage), buttons("Choose another action.", HOME_BUTTONS)];
  }

  return [
    list(
      title,
      "Select a product to view details.",
      "View Products",
      [
        {
          title: title.slice(0, 24),
          rows: products.slice(0, 10).map((product) => ({
            id: `PRODUCT_${product.id}`,
            title: product.name.slice(0, 24),
            description: `${formatCurrency(product.price)} | MOQ ${product.moq}`
          }))
        }
      ],
      "Showing up to 10 products."
    )
  ];
}

function buildProductCaption(product) {
  return [
    `*${product.name}*`,
    `Price: ${formatCurrency(product.price)}`,
    `MOQ: ${product.moq}`,
    `Stock: ${product.stock}`,
    `Seller: ${product.seller_name}`,
    product.description || ""
  ]
    .filter(Boolean)
    .join("\n");
}

function productMessages(product) {
  const replies = [];

  if (product.image_url) {
    replies.push(image(product.image_url, buildProductCaption(product)));
  } else {
    replies.push(text(buildProductCaption(product)));
  }

  replies.push(
    buttons(
      "Choose an action.",
      [
        { id: `BUY_${product.id}`, title: "Buy" },
        { id: `NEXT_${product.category}`, title: "Next" },
        { id: "MENU_BROWSE", title: "Menu" }
      ],
      "Buy starts an order flow."
    )
  );

  return replies;
}

async function showMyOrders(phone) {
  const orders = await listBuyerOrders(phone);

  if (!orders.length) {
    return [text("You have no recent orders."), buttons("Back to menu.", HOME_BUTTONS)];
  }

  return [
    text(
      [
        "Your recent orders:",
        ...orders.map(
          (order) =>
            `${order.id} | ${order.status} | ${order.payment_mode} | ${formatCurrency(order.total_amount)}`
        )
      ].join("\n")
    )
  ];
}

async function beginBuyFlow({ from, session, product }) {
  session.currentStep = "awaiting_quantity";
  session.selectedProductId = product.id;
  session.selectedQuantity = null;
  await saveSession(from, session);

  return [text(`Enter quantity for ${product.name}. Minimum order quantity is ${product.moq}.`)];
}

async function createOrderForSession({ from, profileName, session, paymentMode }) {
  const product = await getPublicProductById(session.selectedProductId);

  if (!product) {
    await resetSession(from);
    return [text("This product is no longer available.")];
  }

  const status = paymentMode === "prepaid" ? "pending" : "pending_seller_confirmation";
  const orderId = await createOrder({
    buyerPhone: from,
    buyerName: profileName || "Buyer",
    sellerId: product.seller_id,
    items: [
      {
        product_id: product.id,
        product_name: product.name,
        quantity: session.selectedQuantity,
        price: product.price,
        image_url: product.image_url
      }
    ],
    address: session.pendingOrder.address,
    paymentMode,
    status
  });

  await logActivity({
    actorRole: "buyer",
    action: "order_created_from_whatsapp",
    entityType: "order",
    entityId: orderId,
    details: { buyerPhone: from, productId: product.id, paymentMode }
  });

  const order = await getOrderById(orderId);

  if (paymentMode === "prepaid") {
    session.currentStep = "awaiting_payment_proof";
    session.pendingOrder = {
      orderId,
      paymentMode
    };
    await saveSession(from, session);

    return [
      text(
        [
          `Order created: ${order.id}`,
          `Amount: ${formatCurrency(order.total_amount)}`,
          `Payment details: ${product.payment_details || "Seller will share payment details soon."}`,
          "Upload payment proof image to continue."
        ].join("\n")
      )
    ];
  }

  await resetSession(from);
  return [
    text(
      [
        `Order created: ${order.id}`,
        `Status: ${order.status}`,
        `Amount: ${formatCurrency(order.total_amount)}`,
        "Seller will confirm this order."
      ].join("\n")
    ),
    buttons("Anything else?", HOME_BUTTONS)
  ];
}

async function handleStep({ from, profileName, session, message }) {
  if (session.currentStep === "awaiting_search" && message.kind === "text") {
    session.currentStep = "idle";
    session.searchQuery = message.value;
    await saveSession(from, session);
    const products = await listPublicProducts({ search: message.value, limit: 10 });
    return buildProductListMessage("Search Results", products, `No products found for "${message.value}".`);
  }

  if (session.currentStep === "awaiting_quantity" && message.kind === "text") {
    const product = await getPublicProductById(session.selectedProductId);

    if (!product) {
      await resetSession(from);
      return [text("This product is no longer available.")];
    }

    const quantity = Number(message.value);

    if (!Number.isInteger(quantity) || quantity < product.moq) {
      return [text(`Enter a whole number quantity of at least ${product.moq}.`)];
    }

    if (quantity > product.stock) {
      return [text(`Only ${product.stock} units are available.`)];
    }

    session.selectedQuantity = quantity;
    session.currentStep = "awaiting_address";
    await saveSession(from, session);
    return [text("Send your delivery address.")];
  }

  if (session.currentStep === "awaiting_address" && message.kind === "text") {
    session.pendingOrder = {
      ...(session.pendingOrder || {}),
      address: message.value
    };
    session.currentStep = "awaiting_payment_mode";
    await saveSession(from, session);

    return [
      buttons(
        "Select payment mode.",
        [
          { id: "PAY_prepaid", title: "Prepaid" },
          { id: "PAY_cod", title: "COD" },
          { id: "PAY_after_sales", title: "After Sales" }
        ],
        "Choose how you want to pay."
      )
    ];
  }

  if (session.currentStep === "awaiting_payment_proof" && message.kind === "media") {
    const stored = await downloadWhatsAppMedia(message.mediaId, `${session.pendingOrder.orderId}_${Date.now()}`);
    await attachPaymentProof({
      orderId: session.pendingOrder.orderId,
      proofUrl: stored.publicUrl
    });

    const order = await getOrderById(session.pendingOrder.orderId);
    const receipt = generateReceipt(order);
    await updateOrderReceipt(order.id, receipt.publicUrl);
    await resetSession(from);

    return [
      text(
        [
          "Payment proof received.",
          `Order: ${order.id}`,
          `Receipt: ${receipt.publicUrl}`,
          "Seller will review your order."
        ].join("\n")
      ),
      buttons("Return to menu.", HOME_BUTTONS)
    ];
  }

  if (session.currentStep === "awaiting_payment_proof") {
    return [text("Upload an image or document as payment proof.")];
  }

  return null;
}

async function handleCommand({ from, profileName, session, message }) {
  const input = message.kind === "text" ? message.value.trim() : message.value;
  const normalized = String(input || "").toLowerCase();

  if (session.currentStep !== "idle") {
    const stepReply = await handleStep({ from, profileName, session, message });
    if (stepReply) {
      return stepReply;
    }
  }

  if (message.kind === "interactive") {
    if (input === "MENU_BROWSE") {
      session.currentStep = "idle";
      await saveSession(from, session);
      return await buildCategoryListMessage();
    }

    if (input === "MENU_SEARCH") {
      session.currentStep = "awaiting_search";
      await saveSession(from, session);
      return [text("Send a product keyword to search.")];
    }

    if (input === "MENU_ORDERS") {
      return showMyOrders(from);
    }

    if (input.startsWith("CATEGORY_")) {
      const category = input.replace("CATEGORY_", "").replace(/_/g, " ");
      const products = await listPublicProducts({ category, limit: 10 });
      return buildProductListMessage(category, products, `No products found in ${category}.`);
    }

    if (input.startsWith("PRODUCT_")) {
      const product = await getPublicProductById(input.replace("PRODUCT_", ""));
      return product ? productMessages(product) : [text("Product not found.")];
    }

    if (input.startsWith("BUY_")) {
      const product = await getPublicProductById(input.replace("BUY_", ""));
      return product ? beginBuyFlow({ from, session, product }) : [text("Product not found.")];
    }

    if (input.startsWith("NEXT_")) {
      const category = input.replace("NEXT_", "");
      const products = await listPublicProducts({ category, limit: 10 });
      return buildProductListMessage(category, products, `No more products found in ${category}.`);
    }

    if (input.startsWith("PAY_")) {
      return createOrderForSession({
        from,
        profileName,
        session,
        paymentMode: input.replace("PAY_", "")
      });
    }
  }

  if (message.kind === "text") {
    if (["hi", "hello", "start", "menu"].includes(normalized)) {
      return homeMessages(profileName);
    }

    if (normalized === "1") {
      return await buildCategoryListMessage();
    }

    if (normalized === "2") {
      session.currentStep = "awaiting_search";
      await saveSession(from, session);
      return [text("Send a product keyword to search.")];
    }

    if (normalized === "3") {
      return showMyOrders(from);
    }

    const products = await listPublicProducts({ search: input, limit: 10 });

    if (products.length) {
      return buildProductListMessage("Search Results", products, "No products found.");
    }
  }

  return [
    text("I did not understand that."),
    buttons("Choose an option.", HOME_BUTTONS)
  ];
}

async function handleIncomingMessage({ from, profileName, message }) {
  const session = await getSession(from);
  return handleCommand({ from, profileName, session, message });
}

module.exports = {
  handleIncomingMessage
};
