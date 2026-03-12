"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file"));
const path_1 = __importDefault(require("path"));
const logDir = path_1.default.join(__dirname, '../../logs');
const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json());
const securityRotator = new winston_daily_rotate_file_1.default({
    filename: `${logDir}/security-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '90d',
    level: 'info',
});
const errorRotator = new winston_daily_rotate_file_1.default({
    filename: `${logDir}/error-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
});
const accessRotator = new winston_daily_rotate_file_1.default({
    filename: `${logDir}/access-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
});
const logger = winston_1.default.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    transports: [securityRotator, errorRotator, accessRotator],
    exceptionHandlers: [new winston_daily_rotate_file_1.default({ filename: `${logDir}/exceptions-%DATE%.log` })],
    rejectionHandlers: [new winston_daily_rotate_file_1.default({ filename: `${logDir}/rejections-%DATE%.log` })],
});
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston_1.default.transports.Console({
        format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple()),
        level: 'debug',
    }));
}
exports.default = logger;
