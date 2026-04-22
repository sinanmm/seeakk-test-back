import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const logDir = path.join(__dirname, '../../logs');
fs.mkdirSync(logDir, { recursive: true });

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const securityRotator = new DailyRotateFile({
  filename: `${logDir}/security-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '90d',
  level: 'info',
});

const errorRotator = new DailyRotateFile({
  filename: `${logDir}/error-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
});

const accessRotator = new DailyRotateFile({
  filename: `${logDir}/access-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
});

const isProduction = process.env.NODE_ENV === 'production';
const enableProcessHandlers = process.env.LOG_PROCESS_HANDLERS !== 'false' && isProduction;

const loggerOptions: winston.LoggerOptions = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [securityRotator, errorRotator, accessRotator],
};

if (enableProcessHandlers) {
  loggerOptions.exceptionHandlers = [new DailyRotateFile({ filename: `${logDir}/exceptions-%DATE%.log` })];
  loggerOptions.rejectionHandlers = [new DailyRotateFile({ filename: `${logDir}/rejections-%DATE%.log` })];
}

const logger = winston.createLogger(loggerOptions);

if (!isProduction) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: 'debug',
    })
  );
}

export default logger;
