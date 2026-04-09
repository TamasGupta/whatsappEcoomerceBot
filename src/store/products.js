const fs = require("fs");
const { productsFile, currency } = require("../config");

let cachedProducts = [];

function loadProducts() {
  const raw = fs.readFileSync(productsFile, "utf-8");
  cachedProducts = JSON.parse(raw);
  return cachedProducts;
}

function getProducts() {
  if (!cachedProducts.length) {
    return loadProducts();
  }

  return cachedProducts;
}

function getProductById(id) {
  return getProducts().find((product) => product.id.toLowerCase() === id.toLowerCase());
}

function getCategories() {
  return [...new Set(getProducts().map((product) => product.category))].sort();
}

function getProductsByCategory(category) {
  return getProducts().filter(
    (product) => product.category.toLowerCase() === category.trim().toLowerCase()
  );
}

function searchProducts(query) {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }

  return getProducts().filter((product) => {
    const haystack = [
      product.id,
      product.name,
      product.category,
      product.description,
      ...(product.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(term);
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency
  }).format(amount);
}

function formatProduct(product) {
  return [
    `*${product.name}*`,
    `ID: ${product.id}`,
    `Category: ${product.category}`,
    `Price: ${formatCurrency(product.price)}`,
    `Stock: ${product.stock}`,
    product.description
  ].join("\n");
}

module.exports = {
  formatCurrency,
  formatProduct,
  getCategories,
  getProductById,
  getProducts,
  getProductsByCategory,
  loadProducts,
  searchProducts
};
