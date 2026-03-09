const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").default;
const { redisClient } = require("../config/redis");
const logger = require("../utils/logger");

// We abstract out the store so we can intelligently fallback to local memory
// if Redis ever crashes, ensuring Rate Limiting still protects the server natively.
const getStore = (prefix) => {
    // Check if Redis is successfully connected and ready
    if (redisClient.isReady) {
        return new RedisStore({
            sendCommand: (...args) => redisClient.sendCommand(args),
            prefix: prefix,
        });
    }
    // Optional: Fallback to default in-memory store if Redis drops. Express-rate-limit 
    // does this automatically if a `store` isn't provided, but doing it explicitly guarantees no crashes.
    return undefined;
};

/**
 * Standard API Limiter
 * Applied globally across routine routes to prevent generic DDoS spam
 */
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    store: getStore('rl:global:'),
    handler: (req, res, next, options) => {
        logger.warn("Global rate limit exceeded", { ip: req.ip, action: "rate_limit_global" });
        res.status(options.statusCode).json({ message: "Too many requests, please try again later." });
    }
});

/**
 * Strict Security Auth Limiter
 * Applied specifically to endpoints like /login or /register 
 * to absolutely block brute-force and credential stuffing attacks natively.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 failed/successful auth attempts per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    store: getStore('rl:auth:'),
    handler: (req, res, next, options) => {
        logger.warn("Auth rate limit exceeded (Brute-force protection)", { ip: req.ip, action: "rate_limit_auth_block" });
        res.status(options.statusCode).json({
            message: "Too many login attempts from this IP, please try again after 15 minutes."
        });
    }
});

module.exports = {
    globalLimiter,
    authLimiter
};
