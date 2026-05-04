const { Sequelize, QueryTypes } = require("sequelize");
const env = require("../config/env");

const sequelize = new Sequelize(env.databaseUrl, {
  dialect: "postgres",
  logging: env.nodeEnv === "development" ? console.log : false,
  dialectOptions: env.dbSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {},
  define: {
    underscored: true,
    freezeTableName: false,
    timestamps: true,
  },
  pool: {
    max: 10,
    min: 0,
    idle: 10000,
    acquire: 30000,
  },
});

async function connectSQL() {
  await sequelize.authenticate();
  console.log("SQL connected.");
}

async function sqlQuery(sql, replacements = {}, options = {}) {
  return sequelize.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
    ...options,
  });
}

module.exports = {
  sequelize,
  connectSQL,
  sqlQuery,
};
