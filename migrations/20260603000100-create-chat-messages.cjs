"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("chat_messages", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "chat_sessions", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      // Denormalized owner copy (matches chat_sessions.user_id). Nullable because
      // assistant/system/tool messages are not authored by a specific user.
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      role: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      token_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal("'{}'::jsonb"),
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addConstraint("chat_messages", {
      fields: ["role"],
      type: "check",
      name: "chat_messages_role_check",
      where: {
        role: { [Sequelize.Op.in]: ["system", "user", "assistant", "tool"] },
      },
    });

    await queryInterface.addIndex("chat_messages", {
      name: "chat_messages_session_id_created_at_idx",
      fields: ["session_id", { name: "created_at", order: "ASC" }],
    });

    await queryInterface.addIndex("chat_messages", {
      name: "chat_messages_session_id_id_idx",
      fields: ["session_id", "id"],
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("chat_messages");
  },
};
