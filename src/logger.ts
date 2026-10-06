/**
 * Structured stderr logging with levels.
 * MCP uses stdout for protocol, so all logs go to stderr.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(prefix: string, level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${prefix}] ${level.toUpperCase()}: ${message}`;
}

function createLogger(prefix: string) {
  return {
    debug(message: string): void {
      if (shouldLog('debug')) {
        process.stderr.write(formatMessage(prefix, 'debug', message) + '\n');
      }
    },
    info(message: string): void {
      if (shouldLog('info')) {
        process.stderr.write(formatMessage(prefix, 'info', message) + '\n');
      }
    },
    warn(message: string): void {
      if (shouldLog('warn')) {
        process.stderr.write(formatMessage(prefix, 'warn', message) + '\n');
      }
    },
    error(message: string): void {
      if (shouldLog('error')) {
        process.stderr.write(formatMessage(prefix, 'error', message) + '\n');
      }
    },
  };
}

export const ipcLog = createLogger('IPC');
export const launcherLog = createLogger('LAUNCHER');
export const serverLog = createLogger('SERVER');
export const watcherLog = createLogger('WATCHER');
export const headlessLog = createLogger('HEADLESS');
