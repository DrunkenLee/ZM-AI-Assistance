const aiService = require("./ai.service");

async function chat(req, res, next) {
  try {
    const { prompt, userId } = req.validated.body;
    const result = await aiService.createChatCompletion(prompt, { userId });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  chat,
};
