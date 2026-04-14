const { verifyToken } = require("../services/auth");
const { getUserById } = require("../store/marketplace");

async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token." });
  }

  const payload = verifyToken(token);

  if (!payload?.sub) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const user = await getUserById(payload.sub);

  if (!user) {
    return res.status(401).json({ error: "User not found." });
  }

  req.auth = {
    token: payload,
    user
  };

  return next();
}

function requireRole(roles) {
  const expectedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.auth?.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (!expectedRoles.includes(req.auth.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions." });
    }

    return next();
  };
}

module.exports = {
  authenticateRequest,
  requireRole
};
