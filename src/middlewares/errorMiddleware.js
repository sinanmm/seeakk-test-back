const logger = require("../utils/logger");

/**
 * Fallback middleware for when a client attempts to hit an API route that does not exist.
 * This should be the last route handler in the app configuration.
 */
exports.notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error); // Passes the error to the global errorHandler below
};

/**
 * Global Error Handling Middleware.
 * Catches all unhandled exceptions, Mongoose CastErrors, ValidationErrors, etc.,
 * and returns a cleanly structured JSON response to the client.
 */
exports.errorHandler = (err, req, res, next) => {
    // If the status code was already set by another router (e.g., 400 Bad Request), preserve it.
    // Otherwise, default to a 500 Internal Server Error.
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    let message = err.message;

    // Generic Mongoose Cast Error (e.g., trying to fetch an invalid Object ID length)
    if (err.name === 'CastError' && err.kind === 'ObjectId') {
        statusCode = 404;
        message = "Resource not found (Invalid ID format).";
    }

    // Mongoose Validation Error
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // Duplicate Key Error (Unique Constraint failed in MongoDB)
    if (err.code === 11000) {
        statusCode = 400;
        message = `Duplicate field value entered: ${Object.keys(err.keyValue).join(', ')}`;
    }

    // Log the comprehensive stack trace and error message directly into the Winston Error Stream
    logger.error(err.message, {
        stack: err.stack,
        path: req.originalUrl,
        method: req.method,
        ip: req.ip
    });

    // Provide an error response (masking the stack trace cleanly if we are in Production Mode)
    res.status(statusCode).json({
        message: message,
        stack: process.env.NODE_ENV === "production" ? "🥞" : err.stack,
    });
};
