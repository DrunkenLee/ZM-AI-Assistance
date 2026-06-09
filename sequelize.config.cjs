require("dotenv").config();

const parseBoolean = (value, fallback = false) => {
  if (typeof value !== "string") return fallback;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
};

const resolveDbUrl = () => {
  const target = (process.env.DB_TARGET || "remote").toLowerCase();
  if (target === "prod" && process.env.DATABASE_URL_PROD) {
    return process.env.DATABASE_URL_PROD;
  }

  if (target === "remote" && process.env.DATABASE_URL_REMOTE) {
    return process.env.DATABASE_URL_REMOTE;
  }

  return process.env.DATABASE_URL_REMOTE || process.env.DATABASE_URL_PROD;
};

const dbUrl = resolveDbUrl();
const useSsl = parseBoolean(process.env.DB_SSL, false);

const config = {
  url: dbUrl,
  dialect: "postgres",
  logging: false,
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {},
};

module.exports = {
  development: config,
  test: config,
  production: config,
};
