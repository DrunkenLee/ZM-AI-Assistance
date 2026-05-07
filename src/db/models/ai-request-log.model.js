const { DataTypes } = require("sequelize");
const { sequelize } = require("../sql-helper");

const AiRequestLog = sequelize.define(
  "AiRequestLog",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    prompt: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    response: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "user_id",
    },
  },
  {
    tableName: "ai_request_logs",
  }
);

module.exports = AiRequestLog;
