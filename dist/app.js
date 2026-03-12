"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const authRoutes_1 = __importDefault(require("./routes/Auth/authRoutes"));
const workspaceRoutes_1 = __importDefault(require("./routes/Workspace/workspaceRoutes"));
const logger_1 = __importDefault(require("./utils/logger"));
const rateLimiter_1 = require("./middlewares/rateLimiter");
const errorMiddleware_1 = require("./middlewares/errorMiddleware");
const app = (0, express_1.default)();
// middleware
app.use((0, morgan_1.default)('combined', { stream: { write: (message) => logger_1.default.info(message.trim()) } }));
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Apply global rate limiting to strictly restrict standard DDOS flooding
// Protects everything mapped under /api route endpoints.
app.use('/api/', rateLimiter_1.globalLimiter);
app.use('/api/auth', authRoutes_1.default);
app.use('/api/workspace', workspaceRoutes_1.default);
// test route
app.get('/', (req, res) => {
    res.send('SEEAKK CRM Backend Running 🚀');
});
// System global error handling boundary
app.use(errorMiddleware_1.notFound);
app.use(errorMiddleware_1.errorHandler);
exports.default = app;
