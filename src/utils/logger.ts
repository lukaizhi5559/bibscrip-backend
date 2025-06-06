// Logger utility for consistent logging across the application
import * as winston from 'winston';
import pino from 'pino';

// Environment configurations
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Winston logger configuration
const winstonLogger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: 'bibscrip-backend' },
  transports: [
    // Always log to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { timestamp, level, message, ...meta } = info;
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      ),
    }),
    // In production, add additional transports (like file or external services)
    ...(isDevelopment
      ? []
      : [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ])
  ],
});

// Pino logger for high performance logging
const pinoLogger = pino({
  level: logLevel,
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: true,
        },
      }
    : undefined,
});

// Log helper that provides both Winston and Pino loggers
// Use Winston for more structured/detailed logs and Pino for high-throughput logs
const logger = {
  // Winston methods for detailed logging
  info: (message: string, meta: Record<string, any> = {}) => {
    winstonLogger.info(message, meta);
  },
  error: (message: string, meta: Record<string, any> = {}) => {
    winstonLogger.error(message, meta);
  },
  warn: (message: string, meta: Record<string, any> = {}) => {
    winstonLogger.warn(message, meta);
  },
  debug: (message: string, meta: Record<string, any> = {}) => {
    winstonLogger.debug(message, meta);
  },
  
  // Pino methods for high performance logging
  pino: pinoLogger,
};

export { logger };
