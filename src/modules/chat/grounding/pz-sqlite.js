/**
 * Read-only access to the Project Zomboid account DB (/home/Zomboid/db/pzserver.db)
 * via Node's built-in `node:sqlite` (no extra dependency).
 *
 * The whitelist table stores account passwords (`password`, `encryptedPwd`,
 * `pwdEncryptType`). Those columns are NEVER selected — only an explicit safe
 * column list is read, and output is redacted as a final guarantee.
 */
const { redactSecrets } = require("../../../utils/redact");

const DB_PATH = "/home/pzserver/Zomboid/db/pzserver.db";

// Columns that must never leave this module.
const FORBIDDEN_COLS = new Set(["password", "encryptedpwd", "pwdencrypttype"]);

const SAFE_WHITELIST_COLS = [
  "username", "displayName", "admin", "moderator", "banned", "accesslevel",
  "steamid", "ownerid", "priority", "lastConnection", "world",
].filter((c) => !FORBIDDEN_COLS.has(c.toLowerCase()));

function openDb() {
  // Required lazily so the experimental-warning + load cost only happen on use.
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

/** Aggregate, secret-free counts about accounts and bans. */
function getPlayerSummary() {
  let db;
  try {
    db = openDb();
    const total = db.prepare("SELECT count(*) AS c FROM whitelist").get().c;
    const admins = db
      .prepare("SELECT count(*) AS c FROM whitelist WHERE admin = 1 OR lower(accesslevel) = 'admin'")
      .get().c;
    const banned = db.prepare("SELECT count(*) AS c FROM whitelist WHERE banned = 1").get().c;
    const bannedIds = db.prepare("SELECT count(*) AS c FROM bannedid").get().c;
    return redactSecrets(
      [
        "Player DB (pzserver.db, filtered):",
        `whitelisted accounts = ${total}`,
        `admins = ${admins}`,
        `banned (whitelist flag) = ${banned}`,
        `banned steamids = ${bannedIds}`,
      ].join("\n")
    );
  } catch {
    return null;
  } finally {
    try { db && db.close(); } catch { /* ignore */ }
  }
}

/** Look up whitelist players by username/displayName/steamid. Password columns excluded. */
function findPlayer(term) {
  const q = String(term || "").trim();
  if (!q) return null;

  let db;
  try {
    db = openDb();
    const cols = SAFE_WHITELIST_COLS.join(", ");
    const rows = db
      .prepare(
        `SELECT ${cols} FROM whitelist ` +
          `WHERE username LIKE ? OR displayName LIKE ? OR steamid = ? LIMIT 5`
      )
      .all(`%${q}%`, `%${q}%`, q);

    if (!rows.length) return `No whitelist player matched "${q}".`;

    const formatted = rows.map((row) =>
      Object.entries(row)
        .filter(([key]) => !FORBIDDEN_COLS.has(key.toLowerCase()))
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")
    );
    return redactSecrets(`Whitelist matches for "${q}" (filtered):\n${formatted.join("\n")}`);
  } catch {
    return null;
  } finally {
    try { db && db.close(); } catch { /* ignore */ }
  }
}

module.exports = { getPlayerSummary, findPlayer };
