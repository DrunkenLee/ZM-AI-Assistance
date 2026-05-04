const { sqlQuery } = require("../../db/sql-helper");

const SAFE_USER_COLUMNS = [
  "userid",
  "discordid",
  "steamid",
  "ownerid",
  "username1",
  "username2",
  "accesslevel",
  "createdAt",
  "updatedAt",
];

const FLEA_TABLE_WHITELIST = [
  "player_auctions",
  "player_auctions_table",
  "flea_market_listings",
  "flea_market_public_listings",
];

const SENSITIVE_KEY_PATTERN = /(password|secret|token|key)/i;

function isFleaUserIntent(prompt) {
  const text = String(prompt || "").toLowerCase();
  const hasFlea = text.includes("flea market") || (text.includes("flea") && text.includes("market"));
  const hasUser =
    text.includes("user") ||
    text.includes("discord") ||
    text.includes("steam") ||
    text.includes("player") ||
    text.includes("userid");
  return hasFlea && hasUser;
}

function containsSensitiveRequest(prompt) {
  const text = String(prompt || "").toLowerCase();
  return text.includes("password") || text.includes("pass");
}

function sanitizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function normalizeDiscordFromUserId(userId) {
  const text = String(userId || "").trim();
  if (!text) return null;

  const prefixedMatch = text.match(/^discord[-:_]?([a-z0-9]+)$/i);
  if (prefixedMatch) return prefixedMatch[1];

  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  return text;
}

function extractLookupIdentifiers(prompt, userId) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();

  const discordFromPrompt =
    text.match(/<@!?(\d+)>/)?.[1] ||
    text.match(/discord\s*[:=\-]?\s*(\d{3,25})/i)?.[1] ||
    null;
  const steamFromPrompt = text.match(/\b(\d{17})\b/)?.[1] || null;
  const numericUserId = text.match(/\buserid\s*[:=\-]?\s*(\d{1,20})\b/i)?.[1] || null;

  const discordFromUserId = normalizeDiscordFromUserId(userId);
  const usernameFromPrompt =
    text.match(/username\s*[:=\-]?\s*([a-z0-9_\-.]{2,40})/i)?.[1] ||
    text.match(/user\s+([a-z0-9_\-.]{2,40})/i)?.[1] ||
    null;

  return {
    discordid: discordFromPrompt || discordFromUserId || null,
    steamid: steamFromPrompt,
    userid: numericUserId,
    username: usernameFromPrompt,
    hasPromptUserWord: lower.includes("user"),
  };
}

async function findExistingFleaTables() {
  const rows = await sqlQuery(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (:tableNames)
    `,
    { tableNames: FLEA_TABLE_WHITELIST }
  );

  return rows
    .map((row) => String(row.table_name || "").trim())
    .filter((tableName) => FLEA_TABLE_WHITELIST.includes(tableName));
}

async function getColumnsForTable(tableName) {
  const rows = await sqlQuery(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :tableName
    `,
    { tableName }
  );

  return new Set(rows.map((row) => String(row.column_name || "").trim()));
}

function pickPredicate(columns, identifiers, firstUser) {
  const checks = [
    { col: "discordid", value: identifiers.discordid || firstUser?.discordid || null },
    { col: "seller_discordid", value: identifiers.discordid || firstUser?.discordid || null },
    { col: "steamid", value: identifiers.steamid || firstUser?.steamid || null },
    { col: "seller_steamid", value: identifiers.steamid || firstUser?.steamid || null },
    { col: "ownerid", value: firstUser?.ownerid || null },
    { col: "userid", value: identifiers.userid || firstUser?.userid || null },
    { col: "user_id", value: identifiers.userid || firstUser?.userid || null },
  ];

  for (const check of checks) {
    if (columns.has(check.col) && check.value) {
      return check;
    }
  }

  return null;
}

async function queryUsers(identifiers) {
  const where = [];
  const replacements = {
    limit: 5,
  };

  if (identifiers.discordid) {
    where.push("discordid = :discordid");
    replacements.discordid = identifiers.discordid;
  }

  if (identifiers.steamid) {
    where.push("steamid = :steamid");
    replacements.steamid = identifiers.steamid;
  }

  if (identifiers.userid) {
    where.push("userid = :userid");
    replacements.userid = identifiers.userid;
  }

  if (identifiers.username) {
    where.push("username1 ILIKE :username OR username2 ILIKE :username");
    replacements.username = `%${identifiers.username}%`;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" OR ")}` : "";

  const rows = await sqlQuery(
    `
      SELECT ${SAFE_USER_COLUMNS.map((col) => quoteIdentifier(col)).join(", ")}
      FROM zmusers
      ${whereSql}
      ORDER BY "updatedAt" DESC
      LIMIT :limit
    `,
    replacements
  );

  return rows.map(sanitizeRow);
}

async function queryFleaStatsForUser(existingTables, identifiers, firstUser) {
  const stats = [];

  for (const tableName of existingTables) {
    const columns = await getColumnsForTable(tableName);
    const predicate = pickPredicate(columns, identifiers, firstUser);

    const tableIdent = quoteIdentifier(tableName);

    if (predicate) {
      const colIdent = quoteIdentifier(predicate.col);
      const rows = await sqlQuery(
        `SELECT COUNT(*)::int AS total FROM ${tableIdent} WHERE ${colIdent} = :value`,
        { value: predicate.value }
      );

      stats.push({
        table: tableName,
        matchedBy: predicate.col,
        value: String(predicate.value),
        total: Number(rows?.[0]?.total || 0),
      });
      continue;
    }

    const rows = await sqlQuery(`SELECT COUNT(*)::int AS total FROM ${tableIdent}`);
    stats.push({
      table: tableName,
      matchedBy: null,
      value: null,
      total: Number(rows?.[0]?.total || 0),
    });
  }

  return stats;
}

function buildDbContext(users, fleaStats) {
  const userLines = users.length
    ? users
        .map((user, idx) => {
          const compact = [
            `userid=${user.userid ?? "n/a"}`,
            `discordid=${user.discordid ?? "n/a"}`,
            `steamid=${user.steamid ?? "n/a"}`,
            `username1=${user.username1 ?? "n/a"}`,
            `accesslevel=${user.accesslevel ?? "n/a"}`,
          ].join(", ");
          return `User ${idx + 1}: ${compact}`;
        })
        .join("\n")
    : "No matching user rows found in zmusers.";

  const fleaLines = fleaStats.length
    ? fleaStats
        .map((entry, idx) => {
          const basis = entry.matchedBy
            ? `matched by ${entry.matchedBy}=${entry.value}`
            : "counted all rows";
          return `Table ${idx + 1} (${entry.table}): total=${entry.total} (${basis})`;
        })
        .join("\n")
    : "No flea-market tables found in database.";

  return `[1] database/zmusers\n${userLines}\n\n[2] database/flea-market\n${fleaLines}`;
}

function buildDbResponse(users, fleaStats, checkedAt) {
  const userSummary = users.length
    ? `Matched ${users.length} user row(s) in zmusers.`
    : "No matching user rows were found in zmusers.";

  const fleaSummary = fleaStats.length
    ? fleaStats
        .map((entry) => `${entry.table}: ${entry.total}`)
        .join(" | ")
    : "No flea-market table was found in the current database.";

  return [
    userSummary,
    `Flea market stats: ${fleaSummary}`,
    `Checked at: ${checkedAt}`,
    "Sensitive fields are hidden.",
  ].join("\n");
}

async function getFleaUserDatabaseGrounding(prompt, options = {}) {
  if (!isFleaUserIntent(prompt)) {
    return { matched: false };
  }

  const checkedAt = new Date().toISOString();

  if (containsSensitiveRequest(prompt)) {
    return {
      matched: true,
      blocked: true,
      checkedAt,
      content: "I can query flea market user data, but I cannot reveal any password or credential fields.",
      sources: [
        {
          file: "database/zmusers",
          score: 100,
          sourceType: "database",
          checkedAt,
        },
      ],
    };
  }

  const identifiers = extractLookupIdentifiers(prompt, options.userId);
  const users = await queryUsers(identifiers);
  const existingTables = await findExistingFleaTables();
  const fleaStats = await queryFleaStatsForUser(existingTables, identifiers, users[0]);

  const context = buildDbContext(users, fleaStats);
  const content = buildDbResponse(users, fleaStats, checkedAt);

  return {
    matched: true,
    blocked: false,
    checkedAt,
    content,
    context,
    users,
    fleaStats,
    sources: [
      {
        file: "database/zmusers",
        score: users.length > 0 ? 100 : 40,
        sourceType: "database",
        checkedAt,
      },
      {
        file: "database/flea-market",
        score: fleaStats.length > 0 ? 90 : 30,
        sourceType: "database",
        checkedAt,
      },
    ],
  };
}

module.exports = {
  isFleaUserIntent,
  getFleaUserDatabaseGrounding,
};
