const { z } = require("zod");

// Version-agnostic UUID check (avoids relying on zod string-format helpers).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sessionIdParam = z
  .string({ required_error: "session id is required" })
  .trim()
  .regex(UUID_REGEX, "Invalid session id");

const createSessionSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    system_prompt: z.string().trim().min(1).max(8000).optional(),
  }),
});

const sessionMessagesSchema = z.object({
  params: z.object({
    sessionId: sessionIdParam,
  }),
});

const sendMessageSchema = z.object({
  params: z.object({
    sessionId: sessionIdParam,
  }),
  body: z.object({
    message: z
      .string({ required_error: "message is required" })
      .trim()
      .min(1, "message cannot be empty")
      .max(8000, "message must be <= 8000 characters"),
  }),
});

const updateSessionSchema = z.object({
  params: z.object({
    sessionId: sessionIdParam,
  }),
  body: z
    .object({
      // nullable so callers can explicitly clear the title/system_prompt.
      title: z.string().trim().max(120).nullable().optional(),
      system_prompt: z.string().trim().max(8000).nullable().optional(),
    })
    .refine(
      (body) => body.title !== undefined || body.system_prompt !== undefined,
      { message: "Provide title or system_prompt to update." }
    ),
});

const deleteSessionSchema = z.object({
  params: z.object({
    sessionId: sessionIdParam,
  }),
});

module.exports = {
  createSessionSchema,
  sessionMessagesSchema,
  sendMessageSchema,
  updateSessionSchema,
  deleteSessionSchema,
};
