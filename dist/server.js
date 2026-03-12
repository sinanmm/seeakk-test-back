"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app_1 = __importDefault(require("./app"));
const db_1 = __importDefault(require("./config/db"));
const redis_1 = require("./config/redis");
const PORT = process.env.PORT || 5000;
(0, redis_1.connectRedis)();
(0, db_1.default)();
app_1.default.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
