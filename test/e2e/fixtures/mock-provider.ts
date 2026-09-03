/**
 * Mock LLM provider for end-to-end tests.
 *
 * Registered through pi's `registerProvider` extension API, so the agent loop,
 * tool execution, and TUI all run for real — only the model is replaced. This
 * keeps the tests deterministic and offline while still exercising the code
 * paths that break when Pi changes its internals.
 *
 * Script format (path passed via PI_MOCK_SCRIPT):
 *   { "responses": [ { "toolCalls": [{ "id", "name", "arguments" }] }, { "text": "..." } ] }
 *
 * One response is consumed per LLM call. Lifecycle events are appended to
 * PI_MOCK_SIGNAL so the test can wait for a deterministic sync point instead of
 * sleeping for a fixed duration.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ScriptedResponse {
  toolCalls?: ScriptedToolCall[];
  text?: string;
}

const script: { responses: ScriptedResponse[] } = JSON.parse(
  readFileSync(process.env.PI_MOCK_SCRIPT!, "utf8"),
);
const signalFile = process.env.PI_MOCK_SIGNAL;

let cursor = 0;

function signal(event: string): void {
  if (signalFile) appendFileSync(signalFile, `${event} ${cursor}\n`);
}

function emptyMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function streamSimple(
  model: Model<any>,
  _context: unknown,
  _options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);

  void (async () => {
    try {
      stream.push({ type: "start", partial: output });

      const response = script.responses[cursor] ?? { text: "" };
      cursor += 1;

      for (const call of response.toolCalls ?? []) {
        const contentIndex = output.content.length;
        const block: ToolCall = { type: "toolCall", id: call.id, name: call.name, arguments: call.arguments };
        output.content.push(block);
        stream.push({ type: "toolcall_start", contentIndex, partial: output });
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta: JSON.stringify(call.arguments),
          partial: output,
        });
        stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
      }

      if (response.text !== undefined) {
        const contentIndex = output.content.length;
        output.content.push({ type: "text", text: "" });
        stream.push({ type: "text_start", contentIndex, partial: output });
        (output.content[contentIndex] as { text: string }).text = response.text;
        stream.push({ type: "text_delta", contentIndex, delta: response.text, partial: output });
        stream.push({ type: "text_end", contentIndex, content: response.text, partial: output });
      }

      output.stopReason = (response.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop";
      stream.push({ type: "done", reason: output.stopReason as "toolUse" | "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: "error", error: output });
      stream.end();
    }
  })();

  return stream;
}

export default function (pi: ExtensionAPI): void {
  pi.on("agent_end", () => signal("agent_end"));

  pi.registerProvider("pi-compact-tools-mock", {
    name: "E2E Mock",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "e2e-mock-key",
    api: "openai-completions",
    streamSimple,
    models: [
      {
        id: "e2e-mock-model",
        name: "E2E Mock Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}
