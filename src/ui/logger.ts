import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  course?: string;
  task?: string;
  action: string;
  status?: string;
}

const LEVEL_COLORS: Record<LogLevel, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  success: chalk.green,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  success: 'OK ',
};

let currentLogLevel: LogLevel = 'info';
const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
};

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_PRIORITY[level]! >= LOG_PRIORITY[currentLogLevel]!;
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function formatEntry(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const label = LEVEL_LABELS[entry.level]!;

  const parts = [
    chalk.dim(entry.timestamp),
    color(`[${label}]`),
  ];

  if (entry.course) {
    parts.push(chalk.cyan(`[${entry.course}]`));
  }
  if (entry.task) {
    parts.push(chalk.magenta(`[${entry.task}]`));
  }

  parts.push(entry.action);

  if (entry.status) {
    parts.push(chalk.dim(`(${entry.status})`));
  }

  return parts.join(' ');
}

export function log(
  level: LogLevel,
  action: string,
  opts?: { course?: string; task?: string; status?: string },
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    action,
    ...opts,
  };

  const formatted = formatEntry(entry);

  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // Broadcast to web dashboard if available
  if (_sseEmitter) {
    _sseEmitter(level, action, opts);
  }
}

// ── Web Dashboard Integration ────────────────────────
type SSEEmitter = (level: string, message: string, meta?: Record<string, string>) => void;
let _sseEmitter: SSEEmitter | null = null;

/** Register an SSE emitter so log messages are broadcast to web clients */
export function setSSEEmitter(emitter: SSEEmitter): void {
  _sseEmitter = emitter;
}

// Convenience methods
export const logger = {
  debug: (action: string, opts?: { course?: string; task?: string; status?: string }) =>
    log('debug', action, opts),
  info: (action: string, opts?: { course?: string; task?: string; status?: string }) =>
    log('info', action, opts),
  warn: (action: string, opts?: { course?: string; task?: string; status?: string }) =>
    log('warn', action, opts),
  error: (action: string, opts?: { course?: string; task?: string; status?: string }) =>
    log('error', action, opts),
  success: (action: string, opts?: { course?: string; task?: string; status?: string }) =>
    log('success', action, opts),

  /** Structured status line matching the BEHAVIOR_RULES format */
  status: (course: string, task: string, action: string, status: string) =>
    log('info', action, { course, task, status }),
};
