const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  verifyToken: process.env.VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  databaseUrl: process.env.DATABASE_URL || "",
  currency: process.env.CATALOG_CURRENCY || "INR",
  productsFile: path.join(process.cwd(), "data", "products.json")
};
