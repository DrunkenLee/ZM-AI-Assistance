const { Router } = require("express");

const validateRequest = require("../../middlewares/validateRequest");
const aiController = require("./ai.controller");
const { chatSchema } = require("./ai.schema");

const router = Router();

router.post("/chat", validateRequest(chatSchema), aiController.chat);

module.exports = router;
