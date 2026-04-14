const { hasDatabaseConfig, isDatabaseReady, query } = require("../services/db");

const sessions = new Map();

function emptySession() {
  return {
    currentStep: "idle",
    selectedProductId: null,
    selectedQuantity: null,
    pendingOrder: null,
    searchQuery: null
  };
}

async function getSession(phoneNumber) {
  if (!hasDatabaseConfig() || !isDatabaseReady()) {
    if (!sessions.has(phoneNumber)) {
      sessions.set(phoneNumber, emptySession());
    }

    return sessions.get(phoneNumber);
  }

  const result = await query(
    `
      SELECT current_step, session_data
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

  return {
    ...emptySession(),
    ...(result.rows[0].session_data || {}),
    currentStep: result.rows[0].current_step || "idle"
  };
}

async function saveSession(phoneNumber, session) {
  const normalized = {
    ...emptySession(),
    ...session
  };

  if (!hasDatabaseConfig() || !isDatabaseReady()) {
    sessions.set(phoneNumber, normalized);
    return normalized;
  }

  await query(
    `
      INSERT INTO bot_sessions (phone_number, current_step, session_data, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (phone_number)
      DO UPDATE SET
        current_step = EXCLUDED.current_step,
        session_data = EXCLUDED.session_data,
        updated_at = NOW()
    `,
    [phoneNumber, normalized.currentStep, JSON.stringify(normalized)]
  );

  return normalized;
}

async function resetSession(phoneNumber) {
  const session = emptySession();
  return saveSession(phoneNumber, session);
}

module.exports = {
  emptySession,
  getSession,
  resetSession,
  saveSession
};
