const processedMessages = new Map();
const TTL_MS = 10 * 60 * 1000;

function pruneExpired() {
  const now = Date.now();

  for (const [messageId, expiresAt] of processedMessages.entries()) {
    if (expiresAt <= now) {
      processedMessages.delete(messageId);
    }
  }
}

function markIfNew(messageId) {
  if (!messageId) {
    return true;
  }

  pruneExpired();

  if (processedMessages.has(messageId)) {
    return false;
  }

  processedMessages.set(messageId, Date.now() + TTL_MS);
  return true;
}

module.exports = {
  markIfNew
};
