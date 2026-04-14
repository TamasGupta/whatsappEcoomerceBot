const express = require("express");
const path = require("path");
const { port, verifyToken, uploadsDir } = require("./config");
const { initializeDatabase } = require("./services/db");
const { sendMessages } = require("./services/whatsapp");
const { handleIncomingMessage } = require("./bot/handlers");
const { markIfNew } = require("./bot/messageDeduper");
const apiRouter = require("./routes/api");
const { ensureDirectory } = require("./services/storage");

function extractIncomingInput(message) {
  if (message.type === "text") {
    return {
      message: {
        kind: "text",
        value: message.text?.body || ""
      }
    };
  }

  if (message.type === "interactive") {
    const buttonReply = message.interactive?.button_reply?.id;
    const listReply = message.interactive?.list_reply?.id;

    if (buttonReply || listReply) {
      return {
        message: {
          kind: "interactive",
          value: buttonReply || listReply
        }
      };
    }
  }

  if (message.type === "image" || message.type === "document") {
    return {
      message: {
        kind: "media",
        value: message[message.type]?.caption || "",
        mediaId: message[message.type]?.id,
        mediaType: message.type
      }
    };
  }

  return null;
}

async function startServer() {
  ensureDirectory(uploadsDir);
  await initializeDatabase();

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use("/uploads", express.static(uploadsDir));
  app.use("/api", apiRouter);

  app.get("/", (_req, res) => {
    res.json({
      service: "marketplace-backend",
      clients: ["whatsapp-bot", "react-native-app"],
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
            message: incomingInput.message
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

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({
      error: error.message || "Unexpected server error."
    });
  });

  app.listen(port, () => {
    console.log(`Marketplace backend listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start the backend:", error);
  process.exit(1);
});
