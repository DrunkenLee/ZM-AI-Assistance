"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("discord_prompt_daily_limits", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      discord_user_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      current_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_DATE"),
      },
      used_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      daily_limit: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 10,
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
    });

    await queryInterface.addConstraint("discord_prompt_daily_limits", {
      fields: ["used_count"],
      type: "check",
      name: "discord_prompt_daily_limits_used_count_non_negative",
      where: {
        used_count: {
          [Sequelize.Op.gte]: 0,
        },
      },
    });

    await queryInterface.addConstraint("discord_prompt_daily_limits", {
      fields: ["daily_limit"],
      type: "check",
      name: "discord_prompt_daily_limits_daily_limit_non_negative",
      where: {
        daily_limit: {
          [Sequelize.Op.gte]: 0,
        },
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("discord_prompt_daily_limits");
  },
};
