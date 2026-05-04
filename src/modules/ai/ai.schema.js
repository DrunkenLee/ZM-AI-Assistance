const { z } = require("zod");

const chatSchema = z.object({
  body: z.object({
    prompt: z
      .string({ required_error: "prompt is required" })
      .trim()
      .min(1, "prompt cannot be empty")
      .max(4000, "prompt must be <= 4000 characters"),
    userId: z.string().trim().min(1).max(100).optional(),
  }),
});

module.exports = {
  chatSchema,
};
