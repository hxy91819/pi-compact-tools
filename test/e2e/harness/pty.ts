/**
 * Runs Pi's interactive TUI inside a real pseudo-terminal.
 *
 * Pi only renders its TUI when stdin is a terminal; without one it silently
 * falls back to a pipe mode that never paints the transcript. `script(1)`
 * allocates the pty, and `stty` fixes its size so wrapping is deterministic
 * instead of depending on whoever runs the test.
 *
 * GNU and BSD `script` take incompatible arguments, so the flavour is probed
 * once at startup.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Screen } from "./screen.ts";

const ANSI = {
  ctrlShiftO: "\x1b[111;6u",
  ctrlO: "\x0f",
  ctrlD: "\x04",
};

/** GNU util-linux and BSD script(1) disagree on argument order and flags. */
function isGnuScript(): Promise<boolean> {
  try {
    const probe = spawn("script", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    return new Promise<boolean>((resolve) => {
      let out = "";
      probe.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      probe.on("error", () => resolve(true));
      probe.on("close", (code) => resolve(code === 0 && out.includes("util-linux")));
    });
  } catch {
    return Promise.resolve(true);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface PiSessionOptions {
  /** Arguments passed to the `pi` binary. */
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  rows?: number;
  cols?: number;
}

export class PiSession {
  readonly screen: Screen;
  private readonly child: ChildProcess;
  private raw = "";
  private closed = false;

  private constructor(child: ChildProcess, rows: number, cols: number) {
    this.child = child;
    this.screen = new Screen(rows, cols);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.raw += text;
      this.screen.write(text);
    });
  }

  static async start(options: PiSessionOptions): Promise<PiSession> {
    const rows = options.rows ?? 45;
    const cols = options.cols ?? 140;
    // An explicit PI_BIN is resolved up front: the child's cwd is the scratch
    // workspace, so a relative path would be looked up in the wrong directory.
    // The default stays bare so it resolves through PATH.
    const piBin = process.env.PI_BIN ? path.resolve(process.env.PI_BIN) : "pi";
    const command = `stty rows ${rows} cols ${cols}; exec ${[piBin, ...options.args].map(shellQuote).join(" ")}`;

    const scriptArgs = (await isGnuScript())
      ? ["-q", "-e", "-c", command, "/dev/null"]
      : ["-q", "/dev/null", "sh", "-c", command];

    const child = spawn("script", scriptArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    return new PiSession(child, rows, cols);
  }

  send(data: string): void {
    this.child.stdin?.write(data);
  }

  press(key: keyof typeof ANSI): void {
    this.send(ANSI[key]);
  }

  /** Types text and submits it with Enter. */
  submit(text: string): void {
    this.send(`${text}\r`);
  }

  async waitFor(
    predicate: (screen: Screen) => boolean,
    timeoutMs: number,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(this.screen)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${description}.\n--- screen ---\n${this.screen.text()}`,
    );
  }

  async waitForTerminal(
    predicate: (screen: Screen, output: string) => boolean,
    timeoutMs: number,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(this.screen, this.raw)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
  }

  /** Waits until the terminal stops producing output, i.e. the UI is idle. */
  async waitForIdle(quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastLength = -1;
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.raw.length !== lastLength) {
        lastLength = this.raw.length;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= quietMs) {
        return;
      }
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for the terminal to go idle.`);
  }

  /**
   * Waits for a lifecycle marker appended by the mock provider. This is the
   * deterministic alternative to sleeping: the marker is written from inside
   * the running agent, so the UI has definitely reached that state.
   */
  async waitForSignal(read: () => string, expected: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (read().includes(expected)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for signal ${expected}.`);
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.send(ANSI.ctrlD);
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.send(ANSI.ctrlD);

    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      this.child.once("close", () => resolve());
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await Promise.race([exited, timeout]);

    // `script` puts the child in its own session, so the group has to be
    // signalled directly or Pi survives the test run.
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      try {
        process.kill(-this.child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    if (!this.child.killed && this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}
