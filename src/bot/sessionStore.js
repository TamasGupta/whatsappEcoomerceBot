const { hasDatabase, query } = require("../services/db");

const sessions = new Map();

function emptySession() {
  return {
    step: "idle",
    cart: [],
    checkoutDraft: {
      shippingAddress: "",
      paymentMode: ""
    }
  };
}

async function getSession(phoneNumber) {
  if (!hasDatabase) {
    if (!sessions.has(phoneNumber)) {
      sessions.set(phoneNumber, emptySession());
    }

    return sessions.get(phoneNumber);
  }

  const result = await query(
    `
      SELECT step, cart, checkout_draft
      FROM bot_sessions
      WHERE phone_number = $1
    `,
    [phoneNumber]
  );

  if (!result.rowCount) {
    const session = emptySession();
    await saveSession(phoneNumber, session);
    return session;
  }

  const row = result.rows[0];
  return {
    step: row.step,
    cart: row.cart || [],
    checkoutDraft: row.checkout_draft || emptySession().checkoutDraft
  };
}

async function saveSession(phoneNumber, session) {
  if (!hasDatabase) {
    sessions.set(phoneNumber, session);
    return session;
  }

  await query(
    `
      INSERT INTO bot_sessions (phone_number, step, cart, checkout_draft, updated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW())
      ON CONFLICT (phone_number)
      DO UPDATE SET
        step = EXCLUDED.step,
        cart = EXCLUDED.cart,
        checkout_draft = EXCLUDED.checkout_draft,
        updated_at = NOW()
    `,
    [phoneNumber, session.step, JSON.stringify(session.cart), JSON.stringify(session.checkoutDraft)]
  );

  return session;
}

async function resetSession(phoneNumber) {
  const session = emptySession();
  await saveSession(phoneNumber, session);
  return session;
}

module.exports = {
  getSession,
  resetSession,
  saveSession
};
