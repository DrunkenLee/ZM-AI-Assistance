const { DataTypes } = require("sequelize");
const { sequelize } = require("../sql-helper");

/**
 * A chat session groups an ordered conversation for a single user.
 * Soft deletes are handled by Sequelize `paranoid` mode, which sets `deleted_at`
 * on destroy() and automatically excludes soft-deleted rows from every query.
 */
const ChatSession = sequelize.define(
  "ChatSession",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    model: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    systemPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "system_prompt",
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "chat_sessions",
    timestamps: true,
    paranoid: true, // soft delete via deleted_at
  }
);

module.exports = ChatSession;
