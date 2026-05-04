require("dotenv").config();

const app = require("./app");
const { connectSQL, sequelize } = require("./db/sql-helper");

const PORT = Number(process.env.PORT || 3002);

async function bootstrap() {
  await connectSQL();

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap().catch(async (error) => {
  console.error("Failed to start server:", error);
  try {
    await sequelize.close();
  } catch (_closeError) {
    // Ignore close errors during startup failure.
  }
  process.exit(1);
});
