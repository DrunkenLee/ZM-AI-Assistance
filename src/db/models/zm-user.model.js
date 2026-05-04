const { DataTypes } = require("sequelize");
const { sequelize } = require("../sql-helper");

const ZMUser = sequelize.define(
  "ZMUser",
  {
    id: {
      type: DataTypes.BIGINT,
      field: "userid",
      primaryKey: true,
      autoIncrement: true,
    },
    discordid: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    steamid: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ownerid: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    username1: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    password1: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    username2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    password2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    extradata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    accesslevel: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: "zmusers",
    timestamps: true,
    underscored: false,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }
);

module.exports = ZMUser;
