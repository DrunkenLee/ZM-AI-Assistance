const { Router } = require("express");

const validateRequest = require("../../middlewares/validateRequest");
const authBearer = require("../../middlewares/authBearer");
const authController = require("./auth.controller");
const { loginSchema, registerSchema } = require("./auth.schema");

const router = Router();

router.post("/login", validateRequest(loginSchema), authController.login);
router.post("/register", validateRequest(registerSchema), authController.register);
router.get("/me", authBearer, authController.me);

module.exports = router;
