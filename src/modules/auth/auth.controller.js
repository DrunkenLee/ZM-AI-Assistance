const authService = require("./auth.service");

async function login(req, res, next) {
  try {
    const result = await authService.login(req.validated.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function register(req, res, next) {
  try {
    const result = await authService.register(req.validated.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const userId = req.auth?.id;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload." });
    }

    const user = await authService.me(userId);
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  register,
  me,
};
