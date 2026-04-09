const express = require("express");
const { port, verifyToken } = require("./config");
const { sendMessages } = require("./services/whatsapp");
const { initializeDatabase } = require("./services/db");
const { handleIncomingMessage } = require("./bot/handlers");
const { markIfNew } = require("./bot/messageDeduper");
const { loadProducts } = require("./store/products");

function extractIncomingInput(message) {
  if (message.type === "text") {
    return {
      inputType: "text",
      input: message.text?.body || ""
    };
  }

  if (message.type === "interactive") {
    const buttonReply = message.interactive?.button_reply?.id;
    const listReply = message.interactive?.list_reply?.id;

    if (buttonReply || listReply) {
      return {
        inputType: "interactive",
        input: buttonReply || listReply
      };
    }
  }

  return null;
}

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

      if (!message) {
        return res.sendStatus(200);
      }

      const incomingInput = extractIncomingInput(message);
      if (!incomingInput) {
        return res.sendStatus(200);
      }

      if (!markIfNew(message.id)) {
        return res.sendStatus(200);
      }

      const from = message.from;
      const profileName = value?.contacts?.[0]?.profile?.name || "Customer";
      res.sendStatus(200);

      void (async () => {
        try {
          const replies = await handleIncomingMessage({
            from,
            profileName,
            input: incomingInput.input,
            inputType: incomingInput.inputType
          });

          await sendMessages(from, replies);
        } catch (error) {
          console.error("Async webhook processing failed:", error);
        }
      })();

      return;
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
