# Pi Compact Tools

Compact, collapsible built-in tool-call rendering for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

中文说明见下方。[Pi Coding Agent](https://github.com/badlogic/pi-mono) 的内置工具调用紧凑显示与 turn 过程折叠扩展。

## Features

- Renders `bash`, `powershell`, `read`, `write`, `edit`, `grep`, `find`, and `ls` as concise one-line progress and completion rows.
- Press `Ctrl+O` to expand an individual tool call's full arguments and output.
- In fullscreen TUI mode, folds completed turn process rows while preserving the user prompt and final assistant response.
- Adds a marker before the final response with the total Tool Call count; press `Ctrl+Shift+O` to expand or re-fold completed processes.
- Does not change tool execution, tool validation, session files, or model context.

## Install

Pi packages execute arbitrary code. Review this repository before installing it.

```bash
pi install git:github.com/hxy91819/pi-compact-tools@v0.1.1
```

Turn folding requires fullscreen mode. Add this setting if it is not already configured:

```json
{
  "tuiMode": "fullscreen"
}
```

Restart Pi or run `/reload`. To update a pinned installation, install a newer tag explicitly; `pi update --extensions` preserves pinned Git refs.

## Usage

- `Ctrl+O`: expand or collapse the detailed output of each tool call.
- `Ctrl+Shift+O`: expand or collapse the process rows of all completed turns.

During a turn, tool calls remain visible as single-line summaries. Once the agent loop ends, the extension hides its tool calls, tool results, and intermediate assistant messages that invoked tools. The final response is preceded by a marker such as:

```text
[过程已折叠：3 次 Tool Call · Ctrl+Shift+O 展开]
```

Third-party tools retain their own compact rendering, but their process rows are folded with the rest of the completed turn.

## Compatibility

Pi does not currently expose a public transcript-grouping API. Turn folding therefore uses a fullscreen display-component adapter. It is intentionally display-only, but may need an update after Pi changes its interactive TUI internals.

## Development

Requires Node.js 22.6 or newer.

```bash
npm ci
npm test
npm run typecheck
npm pack --dry-run
```

## Security

Do not commit credentials, session exports, transcripts, or private logs. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
