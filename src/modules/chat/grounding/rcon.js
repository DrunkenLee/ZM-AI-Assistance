/**
 * Minimal, read-only Source RCON client for the local Project Zomboid server.
 *
 * Scope is deliberately tiny: the ONLY command this module can ever send is the
 * hardcoded read-only `players` query. The model cannot run arbitrary RCON
 * (no kick/ban/quit/grantadmin), so granting Jessica "live players" access can
 * never become server control. Output is redacted as a final guarantee.
 *
 * Zero dependencies (uses node:net); parser ported from ZonaMerahHelper's
 * proven gamePresenceLookup.
 */
const net = require("net");

const { redactSecrets } = require("../../../utils/redact");

const RCON_TIMEOUT_MS = Number(process.env.RCON_PRESENCE_TIMEOUT_MS) || 8000;

// Source RCON packet types.
const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;

// ANSI escape stripper, built without embedding literal control bytes in source.
const ANSI_ESCAPE_REGEX = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])",
  "g"
);
const PLAYER_HEADER_REGEX = /^players connected\b/i;
const NO_PLAYERS_HEADER_REGEX = /^no players connected\b/i;
const SYSTEM_NOISE_REGEX =
  /^(send pzserver:|sending command to console:|command sent|linuxgsm|usage:|error:|warning:|info:)/i;

function normalizeSecret(value) {
  return String(value ?? "").replace(/^"|"$/g, "").trim();
}

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body, "ascii");
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + body + two null bytes
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  // trailing two bytes already zero from Buffer.alloc
  return buf;
}

// Pull every complete packet out of the running buffer; returns [packets, rest].
function drainPackets(buffer) {
  const packets = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const size = buffer.readInt32LE(offset);
    if (buffer.length - offset - 4 < size) break; // incomplete packet
    const id = buffer.readInt32LE(offset + 4);
    const body = buffer.toString("ascii", offset + 12, offset + 4 + size - 2);
    packets.push({ id, body });
    offset += 4 + size;
  }
  return [packets, buffer.slice(offset)];
}

// Connect, authenticate, send `players`, resolve the raw response text.
function runPlayersCommand() {
  const host = String(process.env.RCON_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(process.env.RCON_PORT || 27015);
  const password = normalizeSecret(process.env.RCON_PASSWORD);

  if (!password || !Number.isFinite(port) || port <= 0) {
    return Promise.reject(new Error("RCON is not configured."));
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let authed = false;
    let responseText = "";
    let settleTimer = null;
    let done = false;

    const AUTH_ID = 1;
    const CMD_ID = 2;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (settleTimer) clearTimeout(settleTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve(responseText);
    };

    socket.setTimeout(RCON_TIMEOUT_MS, () => finish(new Error("RCON timeout")));
    socket.on("error", (err) => finish(err));

    socket.connect(port, host, () => {
      socket.write(buildPacket(AUTH_ID, SERVERDATA_AUTH, password));
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const [packets, rest] = drainPackets(buffer);
      buffer = rest;

      for (const pkt of packets) {
        if (!authed) {
          // Auth response id === -1 means the password was rejected.
          if (pkt.id === -1) return finish(new Error("RCON auth failed"));
          authed = true;
          socket.write(buildPacket(CMD_ID, SERVERDATA_EXECCOMMAND, "players"));
          continue;
        }
        responseText += pkt.body;
        // Responses may span multiple packets; settle shortly after the last one.
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => finish(null), 200);
      }
    });
  });
}

function sanitize(value) {
  return String(value ?? "").replace(ANSI_ESCAPE_REGEX, "").replace(/\r/g, "");
}

function extractPlayerName(line) {
  const withId = line.match(/^-?\s*(.*?)\s*\(id=.*\)\s*$/i);
  if (withId && withId[1]) return withId[1].trim();
  const dashed = line.match(/^-+\s*(.+)$/);
  if (dashed && dashed[1]) return dashed[1].trim();
  if (/^[A-Za-z0-9_.-]+$/.test(line)) return line.trim();
  return null;
}

function isLikelyPlayerName(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 64) return false;
  if (PLAYER_HEADER_REGEX.test(candidate) || NO_PLAYERS_HEADER_REGEX.test(candidate)) return false;
  if (SYSTEM_NOISE_REGEX.test(candidate)) return false;
  return true;
}

function parsePlayers(raw) {
  const cleaned = sanitize(raw);
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const players = [];
  for (const line of lines) {
    if (PLAYER_HEADER_REGEX.test(line) || NO_PLAYERS_HEADER_REGEX.test(line)) continue;
    if (SYSTEM_NOISE_REGEX.test(line)) continue;
    const name = extractPlayerName(line);
    if (isLikelyPlayerName(name)) players.push(name);
  }
  return [...new Set(players)];
}

/**
 * Get the live online player list as a filtered grounding block.
 * @param {string} [askedName] optional username the user asked about
 * @returns {Promise<string|null>}
 */
async function getOnlinePlayers(askedName) {
  let raw;
  try {
    raw = await runPlayersCommand();
  } catch (error) {
    console.error("RCON players lookup failed:", error?.message || error);
    return null;
  }

  const players = parsePlayers(raw);
  const lines = [
    "Live players (RCON `players`, real-time):",
    `online count = ${players.length}`,
    players.length ? `online = ${players.join(", ")}` : "online = (none)",
  ];

  const term = String(askedName || "").trim();
  if (term) {
    const isOnline = players.some((p) => p.toLowerCase() === term.toLowerCase());
    lines.push(`requested "${term}" online = ${isOnline ? "yes" : "no"}`);
  }

  return redactSecrets(lines.join("\n"));
}

module.exports = { getOnlinePlayers, parsePlayers };
