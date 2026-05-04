require("dotenv").config();

const { connectSQL } = require("../src/db/sql-helper");

async function main() {
  await connectSQL();
  console.log("Database connection is healthy.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Database health check failed:", error.message);
  process.exit(1);
});
