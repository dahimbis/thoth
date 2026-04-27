/**
 * App Launcher  - application launching and command execution.
 *
 * Supports three launch types:
 * - open-file: Open a file with the OS default application (Windows `start` command)
 * - open-app:  Launch a named application via the system shell
 * - exec:      Execute a command in a child process, returning stdout, stderr, and exit code
 *
 * Timeout handling uses AbortController to kill long-running processes.
 * Platform: Windows (win32) via `start` shell command.
 */

import { exec } from 'child_process';
import { emitActivity } from '../web/activity.js';

// ── Interfaces ───────────────────────────────────────

export interface LaunchRequest {
  type: 'open-file' | 'open-app' | 'exec';
  target: string;          // File path, app name, or command
  args?: string[];         // Additional arguments
  timeoutMs?: number;      // Default: 30000
}

export interface LaunchResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

// ── Constants ────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Main Entry Point ─────────────────────────────────

/**
 * Launch an application, open a file, or execute a command.
 */
export async function launch(request: LaunchRequest): Promise<LaunchResult> {
  let result: LaunchResult;

  switch (request.type) {
    case 'open-file':
      result = await openFile(request);
      emitActivity('app-launched', `Opened file: ${request.target}`, {
        type: request.type,
        target: request.target,
        success: result.success ? 1 : 0,
      });
      return result;
    case 'open-app':
      result = await openApp(request);
      emitActivity('app-launched', `Launched application: ${request.target}`, {
        type: request.type,
        target: request.target,
        success: result.success ? 1 : 0,
      });
      return result;
    case 'exec':
      result = await execCommand(request);
      emitActivity('command-executed', `Executed command: ${request.target}`, {
        target: request.target,
        exitCode: result.exitCode ?? -1,
        success: result.success ? 1 : 0,
      });
      return result;
    default:
      return {
        success: false,
        error: `Unknown launch type: ${(request as any).type}. Supported types: open-file, open-app, exec`,
      };
  }
}

// ── open-file ────────────────────────────────────────

/**
 * Open a file using the OS default application.
 * On Windows, uses `start "" "filepath"`.
 */
async function openFile(request: LaunchRequest): Promise<LaunchResult> {
  const { target, args = [], timeoutMs = DEFAULT_TIMEOUT_MS } = request;

  // Build the command: start "" "filepath" [args...]
  const escapedTarget = target.replace(/"/g, '\\"');
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const command = escapedArgs
    ? `start "" "${escapedTarget}" ${escapedArgs}`
    : `start "" "${escapedTarget}"`;

  return execWithTimeout(command, timeoutMs);
}

// ── open-app ─────────────────────────────────────────

/**
 * Launch a named application via the system shell.
 * On Windows, uses `start "" "appname"`.
 */
async function openApp(request: LaunchRequest): Promise<LaunchResult> {
  const { target, args = [], timeoutMs = DEFAULT_TIMEOUT_MS } = request;

  // Build the command: start "" "appname" [args...]
  const escapedTarget = target.replace(/"/g, '\\"');
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const command = escapedArgs
    ? `start "" "${escapedTarget}" ${escapedArgs}`
    : `start "" "${escapedTarget}"`;

  return execWithTimeout(command, timeoutMs);
}

// ── exec ─────────────────────────────────────────────

/**
 * Execute a command in a child process.
 * Returns stdout, stderr, and exit code.
 */
async function execCommand(request: LaunchRequest): Promise<LaunchResult> {
  const { target, args = [], timeoutMs = DEFAULT_TIMEOUT_MS } = request;

  // Build the full command string
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const command = escapedArgs ? `${target} ${escapedArgs}` : target;

  return execWithTimeout(command, timeoutMs);
}

// ── Timeout-Aware Execution ──────────────────────────

/**
 * Execute a shell command with AbortController-based timeout.
 * On timeout, the child process is killed and partial output is returned.
 */
function execWithTimeout(command: string, timeoutMs: number): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const { signal } = controller;

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const child = exec(
      command,
      {
        shell: 'cmd.exe',
        signal,
        windowsHide: true,
      },
      (error, childStdout, childStderr) => {
        clearTimeout(timer);

        // Capture any remaining output from the callback
        stdout += childStdout ?? '';
        stderr += childStderr ?? '';

        if (timedOut) {
          resolve({
            success: false,
            stdout: stdout || undefined,
            stderr: stderr || undefined,
            error: `Process timed out after ${timeoutMs}ms. Partial output may be available.`,
          });
          return;
        }

        if (error) {
          const errorMessage = formatError(error, command);
          resolve({
            success: false,
            stdout: stdout || undefined,
            stderr: stderr || undefined,
            exitCode: error.code != null ? Number(error.code) : undefined,
            error: errorMessage,
          });
          return;
        }

        resolve({
          success: true,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          exitCode: 0,
        });
      },
    );

    // Collect partial output as it streams in (useful for timeout scenarios)
    child.stdout?.on('data', (data: Buffer | string) => {
      stdout += String(data);
    });

    child.stderr?.on('data', (data: Buffer | string) => {
      stderr += String(data);
    });
  });
}

// ── Error Formatting ─────────────────────────────────

/**
 * Produce a descriptive error message, especially for "not found" scenarios.
 */
function formatError(error: any, command: string): string {
  const message = error.message ?? String(error);

  // Detect common "not found" patterns on Windows
  if (
    message.includes('is not recognized') ||
    message.includes('cannot find') ||
    message.includes('not found') ||
    message.includes('The system cannot find') ||
    message.includes('ENOENT')
  ) {
    // Extract the target from the command for a clearer message
    const target = extractTarget(command);
    return `Application or file not found: "${target}". Ensure the path or application name is correct and accessible.`;
  }

  return message;
}

/**
 * Extract the primary target from a command string for error messages.
 * Handles `start "" "target"` and plain commands.
 */
function extractTarget(command: string): string {
  // Match: start "" "target"
  const startMatch = command.match(/^start\s+""\s+"([^"]+)"/);
  if (startMatch?.[1]) return startMatch[1];

  // Plain command  - return the first token
  const firstToken = command.split(/\s+/)[0];
  return firstToken ?? command;
}
