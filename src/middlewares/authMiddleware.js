const jwt = require("jsonwebtoken");
const User = require("../models/Auth/user");
const logger = require("../utils/logger");

/**
 * Protect routes - Verifies JWT and injects User object into req
 */
exports.protect = async (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            logger.warn("Access denied. No token provided.", { action: 'auth_missing_token', ip: req.ip });
            return res.status(401).json({ message: "Not authorized to access this route. No token provided." });
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
        return res.status(401).json({ message: "Not authorized. Token failed or expired." });
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
