const { Router } = require("express");

const validateRequest = require("../../middlewares/validateRequest");
const authBearer = require("../../middlewares/authBearer");
const chatController = require("./chat.controller");
const {
  createSessionSchema,
  sessionMessagesSchema,
  sendMessageSchema,
  updateSessionSchema,
  deleteSessionSchema,
} = require("./chat.schema");

const router = Router();

// Every chat route requires a valid Bearer token; ownership is enforced per request.
router.use(authBearer);

router.post("/sessions", validateRequest(createSessionSchema), chatController.createSession);
router.get("/sessions", chatController.listSessions);
router.get(
  "/sessions/:sessionId/messages",
  validateRequest(sessionMessagesSchema),
  chatController.getSessionMessages
);
router.post(
  "/sessions/:sessionId/messages",
  validateRequest(sendMessageSchema),
  chatController.sendMessage
);
router.patch(
  "/sessions/:sessionId",
  validateRequest(updateSessionSchema),
  chatController.updateSession
);
router.delete(
  "/sessions/:sessionId",
  validateRequest(deleteSessionSchema),
  chatController.deleteSession
);

module.exports = router;
