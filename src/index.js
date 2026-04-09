const express = require("express");
const { port, verifyToken } = require("./config");
const { sendTextMessage } = require("./services/whatsapp");
const { initializeDatabase } = require("./services/db");
const { handleIncomingText } = require("./bot/handlers");
const { loadProducts } = require("./store/products");

async function startServer() {
  loadProducts();
  await initializeDatabase();

  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      service: "whatsapp-ecommerce-bot",
      status: "ok"
    });
  });

  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  });

  app.post("/webhook", async (req, res) => {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message || message.type !== "text") {
        return res.sendStatus(200);
      }

      const from = message.from;
      const text = message.text?.body || "";
      const profileName = value?.contacts?.[0]?.profile?.name || "Customer";
      const reply = await handleIncomingText({ from, profileName, text });

      await sendTextMessage(from, reply);
      return res.sendStatus(200);
    } catch (error) {
      console.error(error);
      return res.sendStatus(500);
    }
  });

  app.listen(port, () => {
    console.log(`WhatsApp ecommerce bot listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start the bot:", error);
  process.exit(1);
});
