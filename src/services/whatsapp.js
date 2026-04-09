const { whatsappToken, phoneNumberId } = require("../config");

async function sendTextMessage(to, body) {
  if (!whatsappToken || !phoneNumberId) {
    console.log(`[mock-send] ${to}: ${body}`);
    return { mocked: true };
  }
  //check
  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

module.exports = {
  sendTextMessage,
};
