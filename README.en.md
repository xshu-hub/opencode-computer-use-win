# OpenCode Computer Use for Windows

A Windows computer-use plugin for OpenCode V1. Source version 0.2.0 incorporates [dsh-computer-use-win](https://github.com/Yu-tao-Li/dsh-computer-use-win) 0.6.3: Low disruption/Foreground/Hyper-V modes, iframe and canvas operations, bounded/delta observations, sensitive-operation approvals and the rebuilt settings controls. It retains signed session/turn context, cross-project desktop ownership and the single native settings command.

Requires Windows, Node.js 22+ and OpenCode V1 (tested with 1.18.0). OpenCode V2 is not supported by this entrypoint.

## Install and configure

Install globally from [npm](https://www.npmjs.com/package/opencode-computer-use-win):

~~~powershell
npm install --global opencode-computer-use-win --registry=https://registry.npmjs.org
npm root --global
~~~

Alternatively, download and extract the tgz from a successful [GitHub Actions artifact](https://github.com/xshu-hub/opencode-computer-use-win/actions), then run:

~~~powershell
npm install --global --omit=dev --ignore-scripts .\opencode-computer-use-win-0.2.0.tgz
npm root --global
~~~

Add the same package name, `opencode-computer-use-win`, to the `plugin` array in both global `opencode.json(c)` and `tui.json` under `~/.config/opencode`. The host selects the server and TUI exports separately. The server entry may be `["opencode-computer-use-win", {"locale":"en"}]`. Preserve other entries, replace this plugin's old file entries and restart OpenCode. Pin the same `@version` in both files when required. npm provides published versions; build and use absolute entry-file URLs for an unpublished source version. Do not register a second manual wincu MCP server.

The TUI owns the only /computer-use slash command and opens settings without a model request. With OpenCode running, opencode-cu settings also opens the settings window. Other clients can use the computer_use_settings tool.

Sensitive launches, local-file navigation/uploads and personal-browser attachment/access require Allow once in the authenticated settings page. Decisions are bound to exact arguments, expire and cannot be replayed; cancellation refuses the waiting operation. OpenCode's own tool permissions still apply. Ordinary MCP reconnects retain the host-owned hidden desktop. Hyper-V requires a configured Windows VM with Node.js 22+; the settings page provides setup and a connection action.

Settings can check npm versions and download redacted diagnostics without uploading them. Updates use npm or the configured package version followed by restarting OpenCode. DSH marketplace installation and DSH restart are host-specific and are not invoked.

## Build and verify

~~~powershell
npm ci --ignore-scripts
npm run build
npm test
npm run test:ui
node test/run-opencode-host.mjs C:/path/to/opencode.exe
npm pack
~~~

CI builds and uploads an installable tarball. npm publication is a separate authenticated step. See [README.md](README.md), [installation details](docs/global-installation.md) and [validation](docs/validation-opencode-2026-11-13.md).

OpenCode V1 has no Desktop GUI settings-page plugin API, so settings open in a local browser window. Conversation tool/image rendering remains in OpenCode. A recording-exclusion regression reproduces in both the adapter and reference backend in the validation environment; the complete upstream suite is not claimed passing.

MIT. Preserve the upstream notices in LICENSE and THIRD_PARTY.md. The settings page omits the upstream promotion/feedback banner; attribution remains in repository documentation.
