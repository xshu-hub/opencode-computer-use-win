# OpenCode adapter internals

The OpenCode 1.x entrypoint is `plugin.mjs`. It registers `wincu` as a managed stdio MCP server. Do not also configure a manual server with this name.

Version 0.2.0 incorporates upstream 0.6.3. Both global configuration files may use the same npm package name; explicit `./server` and `./tui` exports select separate modules. Local entry-file URLs remain supported.

- `approval.mjs` holds pending sensitive-operation decisions. The authenticated settings page can allow one exact call or decline it. The host then mints the upstream one-use HMAC grant; model-supplied private fields, changed arguments/settings, cancellation and expired/replayed decisions are refused. OpenCode's ordinary tool permissions remain in force.
- The host owns a lazily created background desktop across managed MCP reconnects. The Hyper-V relay verifies OpenCode signatures before forwarding and mirrors a local relay PID for cleanup tracking; guest PIDs must not be interpreted as host PIDs.
- Settings reuse the generated upstream client, with authenticated Hyper-V setup, npm version checks and redacted diagnostic downloads. DSH marketplace/restart and promotion controls are not rendered. Diagnostics omit DSH logs and do not upload reports.

- `../mcp/request-context.mjs`: authenticates the host-added session/turn/call context. Model-visible tool schemas are unchanged. Managed workers fail closed when context is missing, expired, altered or does not match the active desktop series.
- `activity.mjs`: maps OpenCode assistant messages, tool events and session termination to the reference takeover/progress file protocol. `chat.params` selects the executing user turn; queued prompts and synthetic continuation messages do not grant a new stop scope.
- `desktop-lock.mjs`: OS-owned named-pipe lease across OpenCode projects and processes. It is kept through model thinking and input cleanup, and released at turn end or after the reference 30-second idle interval. A process crash releases the OS resource.
- `store.mjs`: user settings, validation, atomic replacement, optimistic revision checking and serialization of concurrent saves.
- `settings-server.mjs`: an ephemeral loopback settings endpoint; bearer authentication, same-origin checks, strict Host checks and bounded JSON bodies. The browser receives its token in the URL fragment and removes it from the address bar.
- `build.mjs` / `settings-ui.js`: bundle the reference React settings component with a small OpenCode settings transport. The reference controls, validation, tool groups, shortcut recorder and previews are reused.
- `tui.mjs`: the sole owner of the native `/computer-use` command-palette / slash entry. It opens settings directly without a model turn. The server supplies `computer_use_settings` for clients without the TUI extension; it does not register a second slash command.

All Windows UIA, native input, OCR, capture, browser CDP/BiDi and indicator code remains in the reference locations. Only `mcp/server.mjs` adds a private host-context verification step; standalone MCP behavior remains available without `WCU_OPENCODE_TOKEN`. Overlay strings support `WCU_HOST_BRAND`, and the native cursor badge reads that brand.

## Settings application

Presentation settings update through the control file. Browser/tool selection changes wait for in-flight calls, then reconnect through OpenCode's public `client.mcp.add` API. Tool management waits for OpenCode's catalog-change event before the next model request. Settings saved in another plugin window are noticed by all instances. Overlay moves/resizes/lock/close are merged back only when their base values are still current.

The optional AI summary uses the current session's provider/model in a temporary, hidden-agent child session with all tools denied. Only bounded action labels and already-public assistant output are supplied. The temporary session is aborted and deleted after each request. It never receives screenshots, tool arguments, user prompts or another conversation's text.

## Host boundary

OpenCode 1.18.0 has server hooks and TUI extensions but no Desktop GUI settings-page API. Its settings extension therefore opens a local browser window with the full reference controls. Native MCP result/image rendering stays in OpenCode. DSH-specific chat-row grouping is not injected into OpenCode's GUI. OpenCode V2 has a different plugin API and is not claimed compatible with this V1 entrypoint.
