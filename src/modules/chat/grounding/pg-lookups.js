/**
 * Read-only, parameterized lookups against the app postgres DB (zmdb).
 * No model-authored SQL: only the fixed queries below run. The zmusers table
 * holds account passwords (password1/password2) — those columns are never
 * selected, and output is redacted as a final guarantee.
 */
const { sqlQuery } = require("../../../db/sql-helper");
const { redactSecrets } = require("../../../utils/redact");

// password1, password2 and extradata are intentionally excluded.
const SAFE_USER_COLS = [
  "userid", "discordid", "steamid", "ownerid",
  "username1", "username2", "accesslevel", '"createdAt"', '"updatedAt"',
];

/** Count of registered app users. */
async function getUserStats() {
  try {
    const rows = await sqlQuery("SELECT count(*)::int AS c FROM zmusers");
    const count = rows?.[0]?.c ?? 0;
    return redactSecrets(`App DB (postgres zmusers): registered users = ${count}`);
  } catch {
    return null;
  }
}

/** Find app users by discordid/steamid/username. Password columns excluded. */
async function findAppUser(term) {
  const q = String(term || "").trim();
  if (!q) return null;

  try {
    const cols = SAFE_USER_COLS.join(", ");
    const rows = await sqlQuery(
      `SELECT ${cols} FROM zmusers ` +
        "WHERE discordid = :q OR steamid = :q OR username1 ILIKE :like OR username2 ILIKE :like " +
        "LIMIT 5",
      { q, like: `%${q}%` }
    );

    if (!rows.length) return `No app user matched "${q}".`;

    const formatted = rows.map((row) =>
      Object.entries(row)
        .filter(([key]) => !/password|secret|token|key/i.test(key))
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")
    );
    return redactSecrets(`App users matching "${q}" (postgres, filtered):\n${formatted.join("\n")}`);
  } catch {
    return null;
  }
}

module.exports = { getUserStats, findAppUser };
