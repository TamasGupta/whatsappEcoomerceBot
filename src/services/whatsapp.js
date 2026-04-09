const { whatsappToken, phoneNumberId } = require("../config");

async function postMessage(to, payload) {
  if (!whatsappToken || !phoneNumberId) {
    console.log(`[mock-send] ${to}: ${JSON.stringify(payload)}`);
    return { mocked: true };
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        ...payload
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function sendTextMessage(to, body) {
  return postMessage(to, {
    type: "text",
    text: { body }
  });
}

async function sendInteractiveButtons(to, bodyText, buttons, options = {}) {
  return postMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      footer: options.footerText ? { text: options.footerText } : undefined,
      action: {
        buttons: buttons.map((button) => ({
          type: "reply",
          reply: {
            id: button.id,
            title: button.title
          }
        }))
      }
    }
  });
}

async function sendInteractiveList(to, bodyText, buttonText, sections, options = {}) {
  return postMessage(to, {
    type: "interactive",
    interactive: {
      type: "list",
      header: options.headerText ? { type: "text", text: options.headerText } : undefined,
      body: { text: bodyText },
      footer: options.footerText ? { text: options.footerText } : undefined,
      action: {
        button: buttonText,
        sections
      }
    }
  });
}

async function sendMessages(to, messages) {
  for (const message of messages) {
    if (message.type === "text") {
      await sendTextMessage(to, message.body);
      continue;
    }

    if (message.type === "buttons") {
      await sendInteractiveButtons(to, message.body, message.buttons, {
        footerText: message.footer
      });
      continue;
    }

    if (message.type === "list") {
      await sendInteractiveList(to, message.body, message.buttonText, message.sections, {
        headerText: message.header,
        footerText: message.footer
      });
      continue;
    }

    throw new Error(`Unsupported outgoing message type: ${message.type}`);
  }
}

module.exports = {
  sendMessages,
  sendTextMessage
};
