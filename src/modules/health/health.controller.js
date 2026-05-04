const { sequelize } = require("../../db/sql-helper");

async function getHealth(_req, res, next) {
  try {
    await sequelize.authenticate();

    return res.status(200).json({
      success: true,
      data: {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    error.status = 503;
    return next(error);
  }
}

module.exports = {
  getHealth,
};
