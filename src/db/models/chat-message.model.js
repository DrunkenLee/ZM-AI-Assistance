const { DataTypes } = require("sequelize");
const { sequelize } = require("../sql-helper");

const CHAT_MESSAGE_ROLES = ["system", "user", "assistant", "tool"];

/**
 * A single message inside a chat session. Messages are immutable once written,
 * so only `created_at` is tracked (no updated_at). The DB also enforces the role
 * whitelist via a CHECK constraint; the model-level validator just fails faster.
 */
const ChatMessage = sequelize.define(
  "ChatMessage",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "session_id",
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
    role: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isIn: [CHAT_MESSAGE_ROLES],
      },
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tokenCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "token_count",
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "chat_messages",
    timestamps: true,
    updatedAt: false, // messages only carry created_at
  }
);

ChatMessage.ROLES = CHAT_MESSAGE_ROLES;

module.exports = ChatMessage;
