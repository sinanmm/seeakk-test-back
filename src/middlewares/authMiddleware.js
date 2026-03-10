const jwt = require("jsonwebtoken");
const User = require("../models/Auth/user");
const logger = require("../utils/logger");

/**
 * Protect routes - Verifies JWT and injects User object into req
 */
exports.protect = async (req, res, next) => {
    try {
        let token;

        // Safely extract Authorization header regardless of casing
        const authHeader = req.headers.authorization || req.headers.Authorization || req.header("Authorization");

        logger.info("POSTMAN DEBUG -> RAW HEADER:", { authString: authHeader });

        if (authHeader) {
            // Check if it uses the standard "Bearer <token>" syntax (case insensitive)
            if (authHeader.toLowerCase().startsWith("bearer ")) {
                token = authHeader.substring(7).trim();
            } else {
                // Otherwise assume the entire header string is the raw token
                token = authHeader.trim();
            }
        }

        // Fallback checks for custom headers (useful for external scripts/clients)
        if (!token && req.headers["x-access-token"]) {
            token = req.headers["x-access-token"].trim();
        }

        // Ensure token isn't the literal string "null" or "undefined" from an unresolved Postman variable
        if (token === "null" || token === "undefined" || token === "") {
            token = null;
        }

        if (!token) {
            logger.warn("Access denied. No token provided / Token was empty space.", { action: 'auth_missing_token', ip: req.ip });
            return res.status(401).json({
                message: "Not authorized to access this route. No token provided.",
                diagnostic: "You did not send an 'Authorization' header. If using Postman, click the 'Authorization' tab, select 'Bearer Token', and paste your token inside.",
                rawHeaderReceived: authHeader || "NOTHING RECEIVED"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Populate the role so the RBAC middleware can read req.user.role.name
        const user = await User.findById(decoded.userId).populate("role");

        if (!user) {
            logger.warn("Access denied. Token user no longer exists.", { userId: decoded.userId, action: 'auth_ghost_user' });
            return res.status(401).json({ message: "The user belonging to this token no longer exists." });
        }

        if (!user.isActive) {
            logger.warn("Access denied. User is inactive.", { userId: user._id, action: 'auth_inactive_user' });
            return res.status(403).json({ message: "User account is suspended or inactive." });
        }

        req.user = user;
        next();
    } catch (error) {
        logger.error("Authentication Error", { error: error.message, action: 'auth_failed' });
        return res.status(401).json({
            message: "Not authorized. Token failed or expired.",
            diagnosticReason: error.message,
            solution: "Please log in again to receive a fresh, valid token."
        });
    }
};

/**
 * Role-Based Access Control (RBAC) - Restricts functionality by user role
 * @param  {...string} roles - Array of permitted roles (e.g., 'admin', 'manager')
 */
exports.authorize = (...roles) => {
    return (req, res, next) => {
        // If the User hasn't been assigned a role document yet, they effectively have no permissions
        if (!req.user || !req.user.role) {
            logger.warn("Access forbidden. User has no assigned role.", { userId: req.user?._id, action: 'rbac_forbidden_no_role' });
            return res.status(403).json({ message: "Forbidden: You do not have an assigned role to access this." });
        }

        // Since req.user.role is populated via the protect middleware, we extract the string name
        const userRole = req.user.role.name;

        if (!roles.includes(userRole)) {
            logger.warn(`Access forbidden. Required: ${roles.join(", ")}, Found: ${userRole}`, {
                userId: req.user._id,
                role: userRole,
                action: 'rbac_forbidden'
            });
            return res.status(403).json({ message: `Forbidden: The '${userRole}' role is not authorized to access this route.` });
        }

        next();
    };
};
