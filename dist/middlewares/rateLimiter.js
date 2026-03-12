"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authLimiter = exports.globalLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../utils/logger"));
const getStore = (prefix) => {
    if (redis_1.redisClient.isReady) {
        return new rate_limit_redis_1.default({
            sendCommand: (...args) => redis_1.redisClient.sendCommand(args),
            prefix: prefix,
        });
    }
    return undefined;
};
exports.globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: getStore('rl:global:'),
    handler: (req, res, next, options) => {
        logger_1.default.warn('Global rate limit exceeded', { ip: req.ip, action: 'rate_limit_global' });
        res.status(options.statusCode).json({ message: 'Too many requests, please try again later.' });
    },
});
exports.authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: getStore('rl:auth:'),
    handler: (req, res, next, options) => {
        logger_1.default.warn('Auth rate limit exceeded (Brute-force protection)', {
            ip: req.ip,
            action: 'rate_limit_auth_block',
        });
        res.status(options.statusCode).json({
            message: 'Too many login attempts from this IP, please try again after 15 minutes.',
        });
    },
});
