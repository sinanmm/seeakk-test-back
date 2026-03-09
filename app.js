const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const authRoutes = require('./src/routes/Auth/authRoutes');
const logger = require("./src/utils/logger");
const { globalLimiter } = require("./src/middlewares/rateLimiter");
const { notFound, errorHandler } = require("./src/middlewares/errorMiddleware");

const app = express();

// middleware
app.use(morgan("combined", { stream: logger.stream }));
app.use(cors());
app.use(express.json());

// Apply global rate limiting to strictly restrict standard DDOS flooding
// Protects everything mapped under /api route endpoints.
app.use("/api/", globalLimiter);
app.use("/api/auth", authRoutes);

// test route
app.get("/", (req, res) => {
  res.send("SEEAKK CRM Backend Running 🚀");
});

// System global error handling boundary
app.use(notFound);
app.use(errorHandler);

module.exports = app;