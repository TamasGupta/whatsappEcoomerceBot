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
  { id: "MENU_SEARCH", title: "Search" },
  { id: "MENU_CART", title: "Cart" }
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
    buttons("Use the menu or type a command.", HOME_BUTTONS, "Text commands still work."),
    text(
      [
        "Text commands:",
        "catalog",
        "search <keyword>",
        "view <product_id>",
        "add <product_id> <qty>",
        "cart",
        "remove <product_id>",
        "checkout"
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
      "Select a product to see details and add it to your cart.",
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

function summarizeCart(session) {
  if (!session.cart.length) {
    return "Your cart is empty.";
  }

  const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return [
    "Your cart:",
    ...session.cart.map(
      (item, index) =>
        `${index + 1}. ${item.name} x ${item.quantity} = ${formatCurrency(item.price * item.quantity)}`
    ),
    "",
    `Total: ${formatCurrency(total)}`
  ].join("\n");
}

function buildCartMessages(session) {
  if (!session.cart.length) {
    return [
      text("Your cart is empty right now."),
      buttons("Browse the catalog or search for products.", HOME_BUTTONS)
    ];
  }

  return [
    text(summarizeCart(session)),
    buttons(
      "Manage your cart.",
      [
        { id: "CHECKOUT_START", title: "Checkout" },
        { id: "MENU_BROWSE", title: "Shop More" },
        { id: "CART_CLEAR", title: "Clear Cart" }
      ],
      "Remove specific items with `remove <product_id>` if needed."
    )
  ];
}

function buildProductMessages(product, session) {
  const existing = session.cart.find((item) => item.productId === product.id);
  const cartNote = existing ? `Already in cart: ${existing.quantity}` : "Not in cart yet.";

  return [
    text(`${formatProduct(product)}\n${cartNote}`),
    buttons(
      "Choose an action for this product.",
      [
        { id: `ADD_${product.id}`, title: "Add 1" },
        { id: `BUY_${product.id}`, title: "Buy Now" },
        { id: "MENU_CART", title: "View Cart" }
      ],
      "Use text command add <product_id> <qty> for larger quantities."
    )
  ];
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

async function clearCart(from) {
  const session = await resetSession(from);
  return [
    text("Your cart has been cleared."),
    buttons("What would you like to do next?", HOME_BUTTONS)
  ];
}

async function beginCheckout(from, session) {
  session.step = "awaiting_address";
  session.checkoutDraft = {
    shippingAddress: "",
    paymentMode: ""
  };
  await saveSession(from, session);

  return [
    text("Please send your full delivery address."),
    text("Include name, house or street, area, city, state, and pincode.")
  ];
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
    text(
      [
        `Order placed successfully: ${order.id}`,
        `Payment: ${order.paymentMode}`,
        `Total: ${formatCurrency(total)}`,
        `Shipping to: ${order.shippingAddress}`
      ].join("\n")
    ),
    buttons("Want to keep shopping?", HOME_BUTTONS)
  ];
}

async function handleCheckoutStep({ input, from, profileName, session }) {
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
    session.step = "awaiting_payment";
    await saveSession(from, session);
    return [
      text("How would you like to pay?"),
      buttons(
        "Choose a payment mode.",
        [
          { id: "PAY_COD", title: "Cash on Delivery" },
          { id: "PAY_UPI", title: "UPI" }
        ],
        "Tap one option to confirm payment mode."
      )
    ];
  }

  if (session.step === "awaiting_payment") {
    const normalized = input.toLowerCase();
    if (!["cod", "upi"].includes(normalized)) {
      return [
        text("Invalid payment mode."),
        buttons("Choose a valid payment mode.", [
          { id: "PAY_COD", title: "Cash on Delivery" },
          { id: "PAY_UPI", title: "UPI" }
        ])
      ];
    }

    session.checkoutDraft.paymentMode = normalized.toUpperCase();
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

  if (command === "MENU_CART") {
    session.step = "idle";
    await saveSession(from, session);
    return buildCartMessages(session);
  }

  if (command === "CATALOG_ALL") {
    return buildProductListMessage("All Products", getProducts(), "No products available right now.");
  }

  if (command === "CHECKOUT_START") {
    if (!session.cart.length) {
      return [text("Your cart is empty."), buttons("Browse products to add items.", HOME_BUTTONS)];
    }

    return beginCheckout(from, session);
  }

  if (command === "CART_CLEAR") {
    return clearCart(from);
  }

  if (command === "PAY_COD") {
    if (session.step !== "awaiting_payment") {
      return [text("Start checkout first before choosing a payment mode.")];
    }

    return handleCheckoutStep({ input: "cod", from, profileName, session });
  }

  if (command === "PAY_UPI") {
    if (session.step !== "awaiting_payment") {
      return [text("Start checkout first before choosing a payment mode.")];
    }

    return handleCheckoutStep({ input: "upi", from, profileName, session });
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

    return buildProductMessages(product, session);
  }

  if (command.startsWith("ADD_") || command.startsWith("BUY_")) {
    const product = getProductById(command.replace(/^(ADD|BUY)_/, ""));
    if (!product) {
      return [text("That product is no longer available.")];
    }

    addToCart(session, product, 1);
    await saveSession(from, session);

    if (command.startsWith("BUY_")) {
      return [
        text(`${product.name} added to your cart.`),
        ...(await beginCheckout(from, session))
      ];
    }

    return [
      text(`${product.name} added to your cart.`),
      ...buildCartMessages(session)
    ];
  }

  return [text("I could not process that menu action."), ...helpMessages()];
}

async function handleTextCommand({ textInput, from, profileName, session }) {
  const trimmedText = textInput.trim();
  const normalized = trimmedText.toLowerCase();

  if (session.step !== "idle") {
    return handleCheckoutStep({ input: trimmedText, from, profileName, session });
  }

  if (!trimmedText || normalized === "help" || normalized === "menu" || normalized === "start") {
    return homeMessages(profileName);
  }

  if (normalized === "catalog") {
    return [buildCategoryListMessage()];
  }

  if (normalized === "cart") {
    return buildCartMessages(session);
  }

  if (normalized === "checkout") {
    if (!session.cart.length) {
      return [text("Your cart is empty. Add products before checkout."), buttons("Open the store.", HOME_BUTTONS)];
    }

    return beginCheckout(from, session);
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

    return buildProductMessages(product, session);
  }

  if (normalized.startsWith("add ")) {
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

    addToCart(session, product, quantity);
    await saveSession(from, session);
    return [
      text(`${product.name} added to your cart.`),
      ...buildCartMessages(session)
    ];
  }

  if (normalized.startsWith("remove ")) {
    const productId = trimmedText.split(/\s+/)[1];
    const initialSize = session.cart.length;
    session.cart = session.cart.filter((item) => item.productId !== productId);

    if (session.cart.length === initialSize) {
      return [text(`Product ${productId} is not in your cart.`)];
    }

    await saveSession(from, session);
    return buildCartMessages(session);
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
