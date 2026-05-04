require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  PermissionFlagsBits,
} = require("discord.js");
const { QueryTypes } = require("sequelize");

const { connectSQL, sequelize } = require("../db/sql-helper");
const { createChatCompletion } = require("../modules/ai/ai.service");

const DEFAULT_PREFIX = "?";
const DISCORD_MAX_MESSAGE = 1900;
const DEFAULT_DAILY_PROMPT_LIMIT = 10;

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowedChannelIds(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function parseCsvSet(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function getRateLimitConfig() {
  const defaultDailyLimit = Math.max(
    0,
    parseInteger(process.env.DISCORD_DAILY_PROMPT_LIMIT, DEFAULT_DAILY_PROMPT_LIMIT)
  );

  const adminRoleNames = new Set(
    [...parseCsvSet(process.env.DISCORD_ADMIN_ROLE_NAMES || "admin")].map((value) =>
      value.toLowerCase()
    )
  );

  const adminRoleIds = parseCsvSet(process.env.DISCORD_ADMIN_ROLE_IDS || "");

  return {
    defaultDailyLimit,
    adminRoleNames,
    adminRoleIds,
  };
}

function isAdminBypassUser(message, rateLimitConfig) {
  const member = message?.member;
  if (!member) return false;

  if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const roles = member.roles?.cache;
  if (!roles) return false;

  for (const role of roles.values()) {
    if (rateLimitConfig.adminRoleIds.has(role.id)) {
      return true;
    }

    if (rateLimitConfig.adminRoleNames.has(String(role.name || "").toLowerCase())) {
      return true;
    }
  }

  return false;
}

function getNextUtcResetIso() {
  const now = new Date();
  const nextReset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  );
  return nextReset.toISOString();
}

async function consumeDailyPromptQuota(discordUserId, rateLimitConfig) {
  const defaultDailyLimit = rateLimitConfig.defaultDailyLimit;

  return sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `
        INSERT INTO discord_prompt_daily_limits (
          discord_user_id,
          current_date,
          used_count,
          daily_limit,
          created_at,
          updated_at
        )
        VALUES (:discordUserId, CURRENT_DATE, 0, :defaultDailyLimit, NOW(), NOW())
        ON CONFLICT (discord_user_id) DO NOTHING
      `,
      {
        replacements: { discordUserId, defaultDailyLimit },
        transaction,
      }
    );

    const resetRows = await sequelize.query(
      `
        UPDATE discord_prompt_daily_limits
        SET
          used_count = CASE WHEN current_date = CURRENT_DATE THEN used_count ELSE 0 END,
          current_date = CURRENT_DATE,
          updated_at = NOW()
        WHERE discord_user_id = :discordUserId
        RETURNING used_count, daily_limit
      `,
      {
        replacements: { discordUserId },
        transaction,
        type: QueryTypes.SELECT,
      }
    );

    const snapshot = resetRows?.[0];
    if (!snapshot) {
      throw new Error("Failed to load user prompt quota");
    }

    const usedCount = Math.max(0, Number(snapshot.used_count || 0));
    const dailyLimit = Math.max(0, Number(snapshot.daily_limit || defaultDailyLimit));

    if (usedCount >= dailyLimit) {
      return {
        allowed: false,
        usedCount,
        dailyLimit,
      };
    }

    const incrementRows = await sequelize.query(
      `
        UPDATE discord_prompt_daily_limits
        SET
          used_count = used_count + 1,
          updated_at = NOW()
        WHERE discord_user_id = :discordUserId
        RETURNING used_count, daily_limit
      `,
      {
        replacements: { discordUserId },
        transaction,
        type: QueryTypes.SELECT,
      }
    );

    const updated = incrementRows?.[0] || {};
    const finalUsedCount = Math.max(0, Number(updated.used_count || usedCount + 1));
    const finalDailyLimit = Math.max(0, Number(updated.daily_limit || dailyLimit));

    return {
      allowed: true,
      usedCount: finalUsedCount,
      dailyLimit: finalDailyLimit,
    };
  });
}

async function enforcePromptLimit(message, rateLimitConfig) {
  if (isAdminBypassUser(message, rateLimitConfig)) {
    return {
      allowed: true,
      bypassed: true,
    };
  }

  const discordUserId = String(message?.author?.id || "").trim();
  if (!discordUserId) {
    return {
      allowed: false,
      usedCount: 0,
      dailyLimit: rateLimitConfig.defaultDailyLimit,
    };
  }

  const quotaResult = await consumeDailyPromptQuota(discordUserId, rateLimitConfig);
  return {
    ...quotaResult,
    bypassed: false,
  };
}

function splitMessage(text, maxLength = DISCORD_MAX_MESSAGE) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];

  const chunks = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < 1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function getDiscordBotConfig() {
  const token = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "").trim();

  const allowedRaw =
    process.env.AllowedChannelIDs ||
    process.env.ALLOWED_CHANNEL_IDS ||
    process.env.AI_ALLOWED_CHANNEL_IDS ||
    process.env.AI_CHANNEL_ID ||
    "";

  const allowedChannelIds = parseAllowedChannelIds(allowedRaw);
  const promptPrefix = String(process.env.DISCORD_AI_PROMPT_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;

  return {
    token,
    allowedChannelIds,
    promptPrefix,
  };
}

async function handlePromptMessage(message, rawPrompt) {
  if (!rawPrompt) return;

  await message.channel.sendTyping();

  const result = await createChatCompletion(rawPrompt, {
    userId: `discord-${message.author.id}`,
  });

  const responseText = String(result?.content || "").trim() || "No response generated.";
  const chunks = splitMessage(responseText);

  if (chunks.length === 0) {
    await message.reply({
      content: "No response generated.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const content = chunks[idx];
    if (idx === 0) {
      await message.reply({
        content,
        allowedMentions: { parse: [] },
      });
      continue;
    }

    await message.channel.send({
      content,
      allowedMentions: { parse: [] },
    });
  }
}

async function startDiscordListener(options = {}) {
  const { token, allowedChannelIds, promptPrefix } = getDiscordBotConfig();
  const rateLimitConfig = getRateLimitConfig();
  const skipSqlConnect = Boolean(options.skipSqlConnect);
  const expectedBotId = String(
    process.env.APPLICATION_ID || process.env.DISCORD_APPLICATION_ID || ""
  ).trim();

  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required to run the Discord listener");
  }

  if (allowedChannelIds.size === 0) {
    console.warn("No AllowedChannelIDs configured. Listener will ignore all channels.");
  }

  if (!skipSqlConnect) {
    await connectSQL();
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once("clientReady", async () => {
    try {
      await client.user?.setPresence({
        status: "online",
        activities: [
          {
            name: "Jessica AI Support",
            type: ActivityType.Custom,
          },
        ],
      });
    } catch (_error) {
      // Presence update failure should not stop the listener.
    }

    console.log(`Discord listener ready as ${client.user?.tag || "unknown"}`);
    console.log(`Prompt prefix: ${promptPrefix}`);
    console.log(`Allowed channels: ${Array.from(allowedChannelIds).join(", ") || "none"}`);
    console.log(
      `Daily prompt limit (non-admin): ${rateLimitConfig.defaultDailyLimit} request(s) per UTC day`
    );
  });

  client.on("messageCreate", async (message) => {
    if (!message || message.author?.bot) return;
    if (!String(message.content || "").startsWith(promptPrefix)) return;

    if (!message.channelId || !allowedChannelIds.has(String(message.channelId))) {
      return;
    }

    const rawPrompt = String(message.content || "").slice(promptPrefix.length).trim();
    if (!rawPrompt) {
      await message.reply({
        content: `Usage: ${promptPrefix}<prompt>`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    try {
      const quota = await enforcePromptLimit(message, rateLimitConfig);
      if (!quota.allowed) {
        const resetAt = getNextUtcResetIso();
        await message.reply({
          content:
            `Daily prompt limit reached (${quota.usedCount}/${quota.dailyLimit}). ` +
            `Resets at ${resetAt}. Please contact @admin if you need a higher personal limit.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await handlePromptMessage(message, rawPrompt);
    } catch (error) {
      console.error("Discord listener prompt handler failed:", error);
      await message.reply({
        content: "Failed to process your prompt right now. Please try again.",
        allowedMentions: { parse: [] },
      });
    }
  });

  await client.login(token);

  if (expectedBotId && client.user?.id && client.user.id !== expectedBotId) {
    const actualBotId = client.user.id;
    const actualTag = client.user.tag || "unknown";
    await client.destroy();
    throw new Error(
      `DISCORD_BOT_TOKEN does not match expected APPLICATION_ID. ` +
      `Expected ${expectedBotId}, got ${actualBotId} (${actualTag}).`
    );
  }

  return client;
}

if (require.main === module) {
  startDiscordListener().catch((error) => {
    console.error("Failed to start Discord listener:", error);

    if (String(error?.message || "").includes("Used disallowed intents")) {
      console.error(
        "Enable MESSAGE CONTENT INTENT in Discord Developer Portal -> Bot for this application, then restart the listener."
      );
    }

    process.exit(1);
  });
}

module.exports = {
  startDiscordListener,
};
