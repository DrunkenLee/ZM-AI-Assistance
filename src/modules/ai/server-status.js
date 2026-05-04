const net = require("net");

const STATUS_KEYWORDS = [
  "online",
  "offline",
  "status",
  "ping",
  "reachable",
  "up",
  "down",
  "latency",
  "alive",
];

const TARGET_KEYWORDS = ["server", "zona merah", "ip", "host", "rcon"];

function isServerStatusIntent(prompt) {
  const text = String(prompt || "").toLowerCase();
  const hasStatus = STATUS_KEYWORDS.some((keyword) => text.includes(keyword));
  const hasTarget = TARGET_KEYWORDS.some((keyword) => text.includes(keyword));
  return hasStatus && hasTarget;
}

function normalizeHost(env) {
  return String(env.serverStatusHost || env.rconHost || "").trim();
}

function normalizePorts(env) {
  const base = Array.isArray(env.serverStatusPorts) ? env.serverStatusPorts : [];
  const unique = Array.from(
    new Set(base.map((port) => Number(port)).filter((port) => Number.isFinite(port) && port > 0))
  );
  if (unique.length > 0) return unique;

  const fallback = Number(env.rconPort || 0);
  return Number.isFinite(fallback) && fallback > 0 ? [fallback] : [];
}

async function tcpProbe(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      const latencyMs = Date.now() - startedAt;
      finish({
        ok: true,
        latencyMs,
      });
    });

    socket.once("timeout", () => {
      finish({
        ok: false,
        error: "timeout",
      });
    });

    socket.once("error", (error) => {
      finish({
        ok: false,
        error: error?.code || error?.message || "connection_error",
      });
    });

    socket.connect(port, host);
  });
}

async function checkPortWithAttempts(host, port, attempts, timeoutMs) {
  const checks = [];

  for (let idx = 0; idx < attempts; idx += 1) {
    const probe = await tcpProbe(host, port, timeoutMs);
    checks.push(probe);
    if (probe.ok) break;
  }

  const successful = checks.filter((entry) => entry.ok);
  const bestLatencyMs =
    successful.length > 0
      ? Math.min(...successful.map((entry) => Number(entry.latencyMs || Number.MAX_SAFE_INTEGER)))
      : null;

  return {
    port,
    online: successful.length > 0,
    bestLatencyMs,
    attempts: checks.length,
    lastError: successful.length > 0 ? null : checks[checks.length - 1]?.error || "unknown",
  };
}

function buildStatusSummary(result) {
  if (!result.available) {
    return "Server status check is not configured. Add SERVER_STATUS_HOST or RCON_HOST and at least one status port.";
  }

  if (result.online) {
    const reachablePorts = result.portChecks
      .filter((entry) => entry.online)
      .map((entry) => entry.port)
      .join(", ");

    return [
      `Zona Merah status: ONLINE`,
      `Host: ${result.host}`,
      `Reachable port(s): ${reachablePorts}`,
      `Best latency: ${result.bestLatencyMs} ms`,
      `Checked at: ${result.checkedAt}`,
    ].join("\n");
  }

  return [
    `Zona Merah status: UNREACHABLE`,
    `Host: ${result.host}`,
    `Ports checked: ${result.ports.join(", ")}`,
    `Last error: ${result.lastError || "unknown"}`,
    `Checked at: ${result.checkedAt}`,
  ].join("\n");
}

async function getLiveServerStatus(env) {
  const host = normalizeHost(env);
  const ports = normalizePorts(env);
  const attempts = Math.max(1, Number(env.serverStatusAttempts || 2));
  const timeoutMs = Math.max(500, Number(env.serverStatusTimeoutMs || 2500));
  const checkedAt = new Date().toISOString();

  if (!host || ports.length === 0) {
    return {
      available: false,
      online: false,
      host,
      ports,
      checkedAt,
      portChecks: [],
      bestLatencyMs: null,
      lastError: "not_configured",
      content: buildStatusSummary({
        available: false,
        online: false,
        host,
        ports,
        checkedAt,
        portChecks: [],
        bestLatencyMs: null,
        lastError: "not_configured",
      }),
      sources: [
        {
          file: "live/server-status",
          score: 100,
          sourceType: "live_check",
          checkedAt,
        },
      ],
    };
  }

  const portChecks = [];
  for (const port of ports) {
    const result = await checkPortWithAttempts(host, port, attempts, timeoutMs);
    portChecks.push(result);
  }

  const successful = portChecks.filter((entry) => entry.online);
  const online = successful.length > 0;
  const bestLatencyMs =
    successful.length > 0
      ? Math.min(...successful.map((entry) => Number(entry.bestLatencyMs || Number.MAX_SAFE_INTEGER)))
      : null;
  const lastError = online ? null : portChecks[portChecks.length - 1]?.lastError || "unreachable";

  const data = {
    available: true,
    online,
    host,
    ports,
    checkedAt,
    portChecks,
    bestLatencyMs,
    lastError,
  };

  return {
    ...data,
    content: buildStatusSummary(data),
    sources: [
      {
        file: "live/server-status",
        score: 100,
        sourceType: "live_check",
        checkedAt,
        host,
        ports,
      },
    ],
  };
}

module.exports = {
  isServerStatusIntent,
  getLiveServerStatus,
};
