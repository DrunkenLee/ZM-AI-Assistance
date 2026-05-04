const { z } = require("zod");

const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
  }),
});

const registerSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
    discordId: z.string().trim().min(1).optional(),
    discordTag: z.string().trim().min(1).optional(),
  }),
});

module.exports = {
  loginSchema,
  registerSchema,
};
