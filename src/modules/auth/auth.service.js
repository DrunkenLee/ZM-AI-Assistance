const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const env = require("../../config/env");
const ZMUser = require("../../db/models/zm-user.model");

function ensureJwtConfigured() {
  if (!env.jwtSecret) {
    const error = new Error("JWT_SECRET is missing on server.");
    error.status = 500;
    throw error;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const data = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete data.password1;
  delete data.password2;
  return data;
}

function createToken(user) {
  ensureJwtConfigured();
  const userId = user.id ?? user.userid;
  return jwt.sign(
    { id: userId, username: user.username1 },
    env.jwtSecret,
    { expiresIn: env.authTokenExpiresIn }
  );
}

async function login({ username, password }) {
  ensureJwtConfigured();

  const user = await ZMUser.findOne({
    where: {
      [Op.or]: [{ username1: username }, { username2: username }],
      password1: password,
    },
  });

  if (!user) {
    const error = new Error("Invalid credentials");
    error.status = 401;
    throw error;
  }

  return {
    token: createToken(user),
    user: sanitizeUser(user),
  };
}

async function register({ username, password, discordId, discordTag }) {
  ensureJwtConfigured();

  const existing = await ZMUser.findOne({
    where: {
      [Op.or]: [
        { username1: { [Op.iLike]: username } },
        { username2: { [Op.iLike]: username } },
      ],
    },
  });

  if (existing) {
    const error = new Error("Username already registered");
    error.status = 409;
    throw error;
  }

  const user = await ZMUser.create({
    discordid: String(discordId || discordTag || "").trim() || null,
    username1: username,
    password1: password,
    username2: null,
    password2: null,
    extradata: {
      source: "api-register",
      auth: {
        registration: {
          registeredAt: new Date().toISOString(),
        },
      },
    },
  });

  return {
    token: createToken(user),
    user: sanitizeUser(user),
  };
}

async function me(userId) {
  const user = await ZMUser.findByPk(userId);
  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  return sanitizeUser(user);
}

module.exports = {
  login,
  register,
  me,
};
