"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("ai_request_logs", "user_id", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addIndex("ai_request_logs", ["user_id", "created_at"], {
      name: "ai_request_logs_user_id_created_at_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("ai_request_logs", "ai_request_logs_user_id_created_at_idx");
    await queryInterface.removeColumn("ai_request_logs", "user_id");
  },
};
