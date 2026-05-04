const jwt = require("jsonwebtoken");

const env = require("../config/env");

module.exports = (req, res, next) => {
  const value = String(req.headers.authorization || "").trim();
  if (!value.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token." });
  }

  if (!env.jwtSecret) {
    return res.status(500).json({ error: "JWT_SECRET is missing on server." });
  }

  const token = value.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Missing Bearer token." });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    req.auth = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
};
