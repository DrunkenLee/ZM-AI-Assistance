"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // gen_random_uuid() is built into PostgreSQL core (v13+). pgcrypto provides it
    // on older versions; IF NOT EXISTS keeps this safe/idempotent and a no-op when
    // the extension is already present (so it works on managed PG without superuser).
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await queryInterface.createTable("chat_sessions", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      // Matches the existing auth system: zmusers.userid is a BIGINT primary key,
      // and JWTs carry that value as `req.auth.id`.
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: "zmusers", key: "userid" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Static fallback; the application sets the currently configured model
      // (env AI_MODEL) at creation time so each session remembers its own model.
      model: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "gpt-5",
      },
      system_prompt: {
        type: Sequelize.TEXT,
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
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex("chat_sessions", {
      name: "chat_sessions_user_id_updated_at_idx",
      fields: ["user_id", { name: "updated_at", order: "DESC" }],
    });

    // Keep updated_at fresh even for raw SQL updates that bypass Sequelize.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION chat_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS set_chat_sessions_updated_at ON chat_sessions;
      CREATE TRIGGER set_chat_sessions_updated_at
      BEFORE UPDATE ON chat_sessions
      FOR EACH ROW
      EXECUTE FUNCTION chat_set_updated_at();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "DROP TRIGGER IF EXISTS set_chat_sessions_updated_at ON chat_sessions;"
    );
    await queryInterface.dropTable("chat_sessions");
    await queryInterface.sequelize.query("DROP FUNCTION IF EXISTS chat_set_updated_at();");
  },
};
