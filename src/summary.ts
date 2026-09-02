export type ToolArguments = Record<string, unknown>;

type ToolResultContent = Array<Record<string, unknown>>;

const PREVIEW_LENGTH = 72;

export function summarizeToolCall(toolName: string, args: ToolArguments): string {
  switch (toolName) {
    case "bash":
    case "powershell":
      return `${toolName} · ${shorten(singleLine(stringArgument(args, "command")), PREVIEW_LENGTH)}`;
    case "read":
      return `read · ${shorten(stringArgument(args, "path"), PREVIEW_LENGTH)}`;
    case "write":
      return `write · ${shorten(stringArgument(args, "path"), PREVIEW_LENGTH)}`;
    case "edit":
      return `edit · ${shorten(stringArgument(args, "path"), PREVIEW_LENGTH)} · ${arrayLength(args.edits)} 处`;
    case "grep":
      return `grep · ${shorten(singleLine(stringArgument(args, "pattern")), PREVIEW_LENGTH)}${optionalPath(args)}`;
    case "find":
      return `find · ${shorten(singleLine(stringArgument(args, "pattern")), PREVIEW_LENGTH)}${optionalPath(args)}`;
    case "ls":
      return `ls · ${shorten(stringArgument(args, "path") || ".", PREVIEW_LENGTH)}`;
    default:
      return toolName;
  }
}

export function stringifyArguments(args: ToolArguments): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return "[Unable to render tool arguments]";
  }
}

export function textOutput(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return (content as ToolResultContent)
    .map((block) => {
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "image") return "[image output]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function optionalPath(args: ToolArguments): string {
  const path = stringArgument(args, "path");
  return path ? ` · ${shorten(path, PREVIEW_LENGTH)}` : "";
}

function stringArgument(args: ToolArguments, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maximumLength: number): string {
  if (!value) return "(no details)";
  if (value.length <= maximumLength) return value;
  return `${value.slice(0, maximumLength - 1)}…`;
}
