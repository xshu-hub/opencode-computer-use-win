# OpenCode Computer Use for Windows

A Windows computer-use plugin for OpenCode V1, adapted from [dsh-computer-use-win](https://github.com/Yu-tao-Li/dsh-computer-use-win) 0.5.7. It retains the Windows/browser backends, full settings controls and native progress overlay, and adds signed session/turn context, cross-project desktop ownership, cancellation and live settings.

Requires Windows, Node.js 22+ and OpenCode V1 (tested with 1.18.0). OpenCode V2 is not supported by this entrypoint.

## Install and configure

Install globally from [npm](https://www.npmjs.com/package/opencode-computer-use-win):

~~~powershell
npm install --global opencode-computer-use-win@0.1.3 --registry=https://registry.npmjs.org
npm root --global
~~~

Alternatively, download and extract the tgz from a successful [GitHub Actions artifact](https://github.com/xshu-hub/opencode-computer-use-win/actions), then run:

~~~powershell
npm install --global --omit=dev --ignore-scripts .\opencode-computer-use-win-0.1.3.tgz
npm root --global
~~~

Merge the installed opencode/plugin.mjs file URL into the plugin array in the global OpenCode opencode.json(c), and opencode/tui.mjs into the global tui.json plugin array. Both files normally reside in ~/.config/opencode. Use absolute file URLs and preserve existing entries. Restart OpenCode. Do not also register a manual wincu MCP server or a second source checkout.

The TUI owns the only /computer-use slash command and opens settings without a model request. With OpenCode running, opencode-cu settings also opens the settings window. Other clients can use the computer_use_settings tool.

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
