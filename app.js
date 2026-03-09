const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const authRoutes = require('./src/routes/Auth/authRoutes');
const logger = require("./src/utils/logger");

const app = express();

// middleware
app.use(morgan("combined", { stream: logger.stream }));
app.use(cors());
app.use(express.json());


app.use("/api/auth", authRoutes);
// test route
app.get("/", (req, res) => {
  res.send("SEEAKK CRM Backend Running 🚀");
});

module.exports = app;