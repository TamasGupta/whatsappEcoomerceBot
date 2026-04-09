const sessions = new Map();

function getSession(phoneNumber) {
  if (!sessions.has(phoneNumber)) {
    sessions.set(phoneNumber, {
      step: "idle",
      cart: [],
      checkoutDraft: {
        shippingAddress: "",
        paymentMode: ""
      }
    });
  }

  return sessions.get(phoneNumber);
}

function resetSession(phoneNumber) {
  sessions.set(phoneNumber, {
    step: "idle",
    cart: [],
    checkoutDraft: {
      shippingAddress: "",
      paymentMode: ""
    }
  });

  return sessions.get(phoneNumber);
}

module.exports = {
  getSession,
  resetSession
};
