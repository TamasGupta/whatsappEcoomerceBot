const { getSession, resetSession, saveSession } = require("./sessionStore");
const { createOrder } = require("../store/orders");
const {
  formatCurrency,
  formatProduct,
  getCategories,
  getProductById,
  getProducts,
  getProductsByCategory,
  searchProducts
} = require("../store/products");

const HOME_BUTTONS = [
  { id: "MENU_BROWSE", title: "Browse" },
  { id: "MENU_SEARCH", title: "Search" }
];

function text(body) {
  return { type: "text", body };
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
        `Hi ${profileName || "there"}, welcome to MotoCommerce.`,
        "Browse products, search quickly, and place your order right here on WhatsApp."
      ].join("\n\n")
    ),
    buttons("Choose what you want to do next.", HOME_BUTTONS, "You can also type help anytime.")
  ];
}

function helpMessages() {
  return [
    buttons("Use the menu or type a command.", HOME_BUTTONS, "Quick ordering is enabled."),
    text(
      [
        "Text commands:",
        "catalog",
        "search <keyword>",
        "view <product_id>",
        "order <product_id> <qty>",
        "help"
      ].join("\n")
    )
  ];
}

function buildCategoryListMessage() {
  const categories = getCategories();
  const sections = [
    {
      title: "Shop By Category",
      rows: categories.map((category) => ({
        id: `CATEGORY_${category.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
        title: category.slice(0, 24),
        description: `${getProductsByCategory(category).length} products`
      }))
    },
    {
      title: "Quick Access",
      rows: [
        {
          id: "CATALOG_ALL",
          title: "All Products",
          description: `See all ${getProducts().length} items`
        }
      ]
    }
  ];

  return list(
    "Catalog",
    "Pick a category to explore the catalog.",
    "Open Catalog",
    sections,
    "Tap a category to continue."
  );
}

function buildProductListMessage(title, products, emptyMessage) {
  if (!products.length) {
    return [text(emptyMessage), buttons("Go back to the main menu.", HOME_BUTTONS)];
  }

  return [
    list(
      title,
      "Select a product to see details and order it.",
      "View Products",
      [
        {
          title: title.slice(0, 24),
          rows: products.slice(0, 10).map((product) => ({
            id: `PRODUCT_${product.id}`,
            title: product.name.slice(0, 24),
            description: `${formatCurrency(product.price)} | Stock ${product.stock}`
          }))
        }
      ],
      "Showing up to 10 products per menu."
    )
  ];
}

function setPendingOrder(session, product, quantity) {
  session.cart = [
    {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity
    }
  ];
}

function getPendingOrder(session) {
  return session.cart || [];
}

function buildOrderPreview(items) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return [
    "Order summary:",
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.name} x ${item.quantity} = ${formatCurrency(item.price * item.quantity)}`
    ),
    "",
    `Total: ${formatCurrency(total)}`
  ].join("\n");
}

function buildProductMessages(product) {
  return [
    text(formatProduct(product)),
    buttons(
      "Choose an action for this product.",
      [
        { id: `ORDER_${product.id}`, title: "Order Now" },
        { id: "MENU_BROWSE", title: "Browse" },
        { id: "MENU_SEARCH", title: "Search" }
      ],
      "Use text command order <product_id> <qty> for custom quantity."
    )
  ];
}

async function beginOrder(from, session, product, quantity) {
  setPendingOrder(session, product, quantity);
  session.step = "awaiting_address";
  session.checkoutDraft = {
    shippingAddress: "",
    paymentMode: "PENDING"
  };
  await saveSession(from, session);

  return [
    text(buildOrderPreview(getPendingOrder(session))),
    text("Please send your full delivery address to confirm this order.")
  ];
}

async function finalizeOrder({ from, profileName, session }) {
  const items = getPendingOrder(session);
  const order = await createOrder({
    customerPhone: from,
    customerName: profileName || "Customer",
    items: items.map((item) => ({ ...item })),
    shippingAddress: session.checkoutDraft.shippingAddress,
    paymentMode: "PENDING"
  });

  const total = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  await resetSession(from);

  return [
    text(
      [
        `Order confirmed: ${order.id}`,
        buildOrderPreview(order.items),
        `Delivery address: ${order.shippingAddress}`,
        "Payment: To be configured later"
      ].join("\n\n")
    ),
    buttons("Want to order another product?", HOME_BUTTONS)
  ];
}

async function handleStep({ input, from, profileName, session }) {
  if (session.step === "awaiting_search") {
    session.step = "idle";
    await saveSession(from, session);
    const results = searchProducts(input);

    if (!results.length) {
      return [
        text(`No products found for "${input}".`),
        buttons("Try browsing categories or search again.", HOME_BUTTONS)
      ];
    }

    return buildProductListMessage("Search Results", results, "No matching products found.");
  }

  if (session.step === "awaiting_address") {
    session.checkoutDraft.shippingAddress = input;
    await saveSession(from, session);
    return finalizeOrder({ from, profileName, session });
  }

  return null;
}

async function handleInteractiveCommand({ command, from, profileName, session }) {
  if (command === "MENU_BROWSE") {
    session.step = "idle";
    await saveSession(from, session);
    return [buildCategoryListMessage()];
  }

  if (command === "MENU_SEARCH") {
    session.step = "awaiting_search";
    await saveSession(from, session);
    return [text("Send a keyword to search the catalog. Example: earphones, jeans, bottle")];
  }

  if (command === "CATALOG_ALL") {
    return buildProductListMessage("All Products", getProducts(), "No products available right now.");
  }

  if (command.startsWith("CATEGORY_")) {
    const normalizedCategory = command.replace("CATEGORY_", "").replace(/_/g, " ");
    const category = getCategories().find(
      (item) => item.toLowerCase() === normalizedCategory.toLowerCase()
    );

    if (!category) {
      return [text("That category is no longer available."), buildCategoryListMessage()];
    }

    return buildProductListMessage(
      category,
      getProductsByCategory(category),
      `No products available in ${category} right now.`
    );
  }

  if (command.startsWith("PRODUCT_")) {
    const product = getProductById(command.replace("PRODUCT_", ""));
    if (!product) {
      return [text("That product is no longer available."), buildCategoryListMessage()];
    }

    return buildProductMessages(product);
  }

  if (command.startsWith("ORDER_")) {
    const product = getProductById(command.replace("ORDER_", ""));
    if (!product) {
      return [text("That product is no longer available.")];
    }

    return beginOrder(from, session, product, 1);
  }

  return [text("I could not process that menu action."), ...helpMessages()];
}

async function handleTextCommand({ textInput, from, profileName, session }) {
  const trimmedText = textInput.trim();
  const normalized = trimmedText.toLowerCase();

  if (session.step !== "idle") {
    return handleStep({ input: trimmedText, from, profileName, session });
  }

  if (!trimmedText || normalized === "help" || normalized === "menu" || normalized === "start") {
    return homeMessages(profileName);
  }

  if (normalized === "catalog") {
    return [buildCategoryListMessage()];
  }

  if (normalized.startsWith("search ")) {
    const query = trimmedText.slice(7);
    const results = searchProducts(query);

    if (!results.length) {
      return [text(`No products found for "${query}".`), buttons("Try another search or browse.", HOME_BUTTONS)];
    }

    return buildProductListMessage("Search Results", results, `No products found for "${query}".`);
  }

  if (normalized.startsWith("view ")) {
    const productId = trimmedText.split(/\s+/)[1];
    const product = getProductById(productId);

    if (!product) {
      return [text(`Product ${productId} not found.`)];
    }

    return buildProductMessages(product);
  }

  if (normalized.startsWith("order ")) {
    const [, productId, quantityRaw] = trimmedText.split(/\s+/);
    const quantity = Number(quantityRaw || 1);
    const product = getProductById(productId || "");

    if (!product) {
      return [text(`Product ${productId || ""} not found.`)];
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return [text("Quantity must be a positive whole number.")];
    }

    if (quantity > product.stock) {
      return [text(`Only ${product.stock} units available for ${product.name}.`)];
    }

    return beginOrder(from, session, product, quantity);
  }

  return [...helpMessages()];
}

async function handleIncomingMessage({ from, profileName, input, inputType }) {
  const session = await getSession(from);

  if (inputType === "interactive") {
    return handleInteractiveCommand({ command: input, from, profileName, session });
  }

  return handleTextCommand({ textInput: input, from, profileName, session });
}

module.exports = {
  handleIncomingMessage
};
