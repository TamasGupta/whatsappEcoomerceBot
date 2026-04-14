const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  verifyToken: process.env.VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  databaseUrl: process.env.DATABASE_URL || "",
  currency: process.env.CATALOG_CURRENCY || "INR",
  jwtSecret: process.env.JWT_SECRET || "change-this-jwt-secret",
  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL || "admin@marketplace.local",
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || "admin12345",
  uploadsDir: path.join(process.cwd(), "data", "uploads")
};
