const express = require("express");
const cors = require("cors");
const authRoutes = require('./src/routes/Auth/authRoutes')
const app = express();

// middleware
app.use(cors());
app.use(express.json());


app.use("/api/auth",authRoutes);
// test route
app.get("/", (req, res) => {
  res.send("SEEAKK CRM Backend Running 🚀");
});

module.exports = app;