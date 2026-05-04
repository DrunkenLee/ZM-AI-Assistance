require("dotenv").config();

const app = require("./app");
const { connectSQL, sequelize } = require("./db/sql-helper");
const { startDiscordListener } = require("./discord/listener");

const PORT = Number(process.env.PORT || 3002);
const START_DISCORD_LISTENER_WITH_SERVER = ["true", "1", "yes", "on"].includes(
  String(process.env.DISCORD_LISTENER_WITH_SERVER || "true").toLowerCase()
);

let listenerClient = null;
let httpServer = null;

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);

  try {
    if (listenerClient) {
      await listenerClient.destroy();
      listenerClient = null;
    }
  } catch (_listenerError) {
    // Ignore listener shutdown errors.
  }

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  } catch (_httpError) {
    // Ignore HTTP shutdown errors.
  }

  try {
    await sequelize.close();
  } catch (_dbError) {
    // Ignore DB shutdown errors.
  }

  process.exit(0);
}

async function bootstrap() {
  await connectSQL();

  httpServer = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  if (START_DISCORD_LISTENER_WITH_SERVER) {
    try {
      listenerClient = await startDiscordListener({ skipSqlConnect: true });
      console.log("Discord listener started via server bootstrap.");
    } catch (error) {
      console.error("Discord listener failed to start from server bootstrap:", error);
    }
  } else {
    console.log("Discord listener auto-start disabled (DISCORD_LISTENER_WITH_SERVER=false).");
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

bootstrap().catch(async (error) => {
  console.error("Failed to start server:", error);
  try {
    await sequelize.close();
  } catch (_closeError) {
    // Ignore close errors during startup failure.
  }
  process.exit(1);
});
