const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Logs will be stored in the root /logs directory
const logDir = path.join(__dirname, '../../logs');

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json() // Parse everything natively as JSON for ELK/Datadog compatibility
);

// Specifically isolated Security events (Logins, Failed logins, Password resets)
const securityRotator = new DailyRotateFile({
    filename: `${logDir}/security-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',       // Max file size
    maxFiles: '90d',      // Security logs often need 90-day retention for compliance
    level: 'info'
});

// General errors (500s, Unhandled exceptions)
const errorRotator = new DailyRotateFile({
    filename: `${logDir}/error-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error'
});

// Access/Traffic logs (Morgan HTTP streams)
const accessRotator = new DailyRotateFile({
    filename: `${logDir}/access-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
});

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    transports: [
        securityRotator,
        errorRotator,
        accessRotator
    ],
    exceptionHandlers: [
        new DailyRotateFile({ filename: `${logDir}/exceptions-%DATE%.log` })
    ],
    rejectionHandlers: [
        new DailyRotateFile({ filename: `${logDir}/rejections-%DATE%.log` })
    ]
});

// If we're not in prod, mirror it to the terminal cleanly
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
        level: 'debug'
    }));
}

// Stream hook to pipe Morgan directly into Winston JSON Access Logs
logger.stream = {
    write: (message) => {
        // Pipe all standard HTTP hits into Access log quietly
        logger.info(message.substring(0, message.lastIndexOf('\n')), { context: 'HTTP_ACCESS' });
    }
};

module.exports = logger;
