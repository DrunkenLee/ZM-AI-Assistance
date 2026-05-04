const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const healthRoutes = require("./modules/health/health.routes");
const aiRoutes = require("./modules/ai/ai.routes");
const authRoutes = require("./modules/auth/auth.routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.json({
    service: "ZM AI Assistance API",
    status: "ok",
  });
});

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/auth", authRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
