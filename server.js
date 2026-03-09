require("dotenv").config();

const app = require("./app");
const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");

const PORT = process.env.PORT || 5000;
connectRedis();
connectDB();

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});