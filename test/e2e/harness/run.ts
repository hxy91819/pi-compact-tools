/**
 * Shared setup for the end-to-end tests: an isolated Pi home, a scratch
 * workspace, and a scripted model, so every run starts from a known state and
 * never touches the developer's real `~/.pi` configuration.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PiSession } from "./pty.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

export const MOCK_PROVIDER = "pi-compact-tools-mock";
export const MOCK_MODEL = "e2e-mock-model";
/**
 * Defaults to the working tree. The release pipeline overrides this to run the
 * same suite against the copy produced by `pi install`, so a broken package
 * manifest or tag is caught before publishing.
 */
export const EXTENSION_UNDER_TEST =
  process.env.PI_COMPACT_TOOLS_EXTENSION ?? join(here, "..", "..", "..", "extensions", "compact-tools.ts");
export const MOCK_PROVIDER_PATH = join(here, "..", "fixtures", "mock-provider.ts");

export const TOOLS = "bash,read,write,edit,grep,find,ls";
export const NOTE_CONTENT = "NOTE-FILE-CONTENT";

export interface ScenarioOptions {
  tuiMode: "fullscreen" | "regular";
  responses: unknown[];
  /** Files written into the scratch workspace before Pi starts. */
  files?: Record<string, string>;
}

export class Scenario {
  readonly root: string;
  readonly workspace: string;
  readonly agentDir: string;
  readonly signalFile: string;
  private readonly session: PiSession;

  private constructor(
    root: string,
    workspace: string,
    agentDir: string,
    signalFile: string,
    session: PiSession,
  ) {
    this.root = root;
    this.workspace = workspace;
    this.agentDir = agentDir;
    this.signalFile = signalFile;
    this.session = session;
  }

  static async start(options: ScenarioOptions): Promise<Scenario> {
    const root = mkdtempSync(join(tmpdir(), "pi-compact-tools-e2e-"));
    const workspace = join(root, "workspace");
    const agentDir = join(root, "agent");
    const signalFile = join(root, "signals.log");
    const scriptFile = join(root, "script.json");

    mkdirSync(workspace, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(scriptFile, JSON.stringify({ responses: options.responses }));
    writeFileSync(signalFile, "");
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        tuiMode: options.tuiMode,
        defaultProvider: MOCK_PROVIDER,
        defaultModel: MOCK_MODEL,
        defaultProjectTrust: "never",
      }),
    );

    for (const [name, content] of Object.entries(options.files ?? {})) {
      writeFileSync(join(workspace, name), content);
    }

    const session = await PiSession.start({
      cwd: workspace,
      args: [
        "--tui-mode",
        options.tuiMode,
        // No version checks, package updates, or telemetry: the run is hermetic.
        "--offline",
        "--provider",
        MOCK_PROVIDER,
        "--model",
        MOCK_MODEL,
        "--no-extensions",
        "-e",
        MOCK_PROVIDER_PATH,
        "-e",
        EXTENSION_UNDER_TEST,
        "-a",
        "--no-session",
        "--tools",
        TOOLS,
      ],
      env: {
        PI_CODING_AGENT_DIR: agentDir,
        PI_MOCK_SCRIPT: scriptFile,
        PI_MOCK_SIGNAL: signalFile,
        TERM: "xterm-256color",
        // Pin terminal capabilities so rendering never varies with the host.
        PI_TRUE_COLOR: "0",
        PI_IMAGE_PROTOCOL: "none",
        PI_HYPERLINKS: "0",
      },
    });

    return new Scenario(root, workspace, agentDir, signalFile, session);
  }

  /** Waits for the interactive UI, sends the prompt, and waits for completion. */
  async runTurn(prompt: string): Promise<void> {
    // The model id is rendered in the footer only once the editor is live, so
    // it doubles as a readiness probe that does not depend on Pi's wording.
    await this.session.waitFor(
      (screen) => screen.text().includes(MOCK_MODEL),
      60_000,
      "the interactive TUI to start",
    );
    this.session.submit(prompt);
    await this.session.waitForSignal(() => this.signals(), "agent_end", 60_000);
    // The fold is applied by the agent_end handler, so let the repaint land.
    await this.session.waitForIdle(800, 15_000);
  }

  signals(): string {
    return readFileSync(this.signalFile, "utf8");
  }

  screenContains(value: string): boolean {
    return this.session.screen.text().includes(value);
  }

  screen(): string {
    return this.session.screen.text();
  }

  press(key: "ctrlShiftO" | "ctrlO" | "ctrlD"): void {
    this.session.press(key);
  }

  async settle(): Promise<void> {
    await this.session.waitForIdle(800, 15_000);
  }

  async finish(): Promise<void> {
    await this.session.stop();
    rmSync(this.root, { recursive: true, force: true });
  }
}
