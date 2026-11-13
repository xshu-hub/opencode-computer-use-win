# OpenCode adapter validation — 2026-11-13

Target: Windows 10.0.20348, Node.js 22.23.2, OpenCode 1.18.0. Reference: dsh-computer-use-win 0.5.7 at e136fcb87b2eb88d7192531b7ab941b475482ec6. Adapter: 0.1.0.

## 0.1.3 review before repository publication

- Fixed progress-summary language selection after an interface language change and added behavioral coverage.
- All 11 adapter contracts passed; the opt-in host and UI tests were also run separately and passed.
- The real OpenCode 1.18.0 test passed managed MCP startup, signed session context, tool refresh, cross-session exclusion, cancellation/recovery, browser image delivery and isolated AI summaries.
- All eight selected shared suites passed: source-encoding, lazy-tools, overlay-strings, atomic-json, batch-browser, progress-overlay, browser-namespace and browser-transport.
- Direct screenshot-output and all 18 batch-actions scenarios passed.
- The 0.1.3 tarball was built and installed into an independent consumer with development dependencies omitted; package imports, settings assets, dependency licenses and the 26-tool MCP catalog passed.
- Public documentation uses portable paths. Local configuration/installation backups and credentials are excluded from Git and package artifacts.

The baseline results and native limitations below remain applicable. GitHub build results are reported by the repository's Actions runs.

## Passed

| Check | Result |
| --- | --- |
| `npm test` | 10 adapter contracts passed. The opt-in host and UI cases are skipped by this command and were run separately below. |
| Real OpenCode process | Passed with an isolated local mock provider: managed MCP registration, signed session/turn context, removal of private metadata from saved tool inputs, lazy catalog refresh, another conversation refused while the desktop is occupied, host cancellation, next-user-turn recovery, and browser screenshots forwarded to the model as actual images. |
| Optional AI progress summary | Passed through the real OpenCode provider route. The summary request had no callable tools and did not contain the original user prompt. |
| Settings browser test | Passed in headless Edge: all 26 tool controls, lazy preset save, Firefox visibility behavior, shortcut recording, overlay dimensions, persistence across reload, Chinese/English switch and narrow-window layout. No browser runtime errors. |
| Shared backend contracts | source-encoding, lazy-tools, overlay-strings, atomic-json, batch-browser, progress-overlay, browser-namespace and browser-transport passed. |
| Direct screenshot transport fixture | Passed for file, inline and default image modes, including failed observations and timeout fallback. The fixture only shortens the intentionally timed-out find call, preserving startup time for normal/fallback calls. |
| Direct batch fixture | All 18 scenarios passed: completion, changes to navigation/windows/dialogs, errors, unconfirmed input, changes caused by the last step, validation, disabled actions, cancellation and concurrency. |
| Installed tarball smoke | Installed in an isolated consumer with development dependencies omitted. Plugin/TUI entrypoints import, settings HTML/JS and dependency licenses are present, and standalone MCP exposes its 26-tool catalog and management entry. |

The real-host test uses its own temporary project, OpenCode data/config directories and local model endpoint. Browser screenshots contain only a locally served test page in an isolated headless Edge profile. No personal provider keys, website sign-ins or desktop contents are sent to a model. Keyboard and mouse input are not sent to the user's applications by these tests.

## Native limitation reproduced in the reference

The native takeover test reaches its assertion that turning off recording visibility excludes both overlay layers and fails (`Opt-out must exclude both layers live`) in this environment. The same assertion fails in a separate checkout of the reference commit with its original Windows backend and native helper. Only the test probe's cold-start timeout was extended from 10 to 30 seconds for that comparison; the reference backend/helper were unchanged. This behavior is not claimed fixed by the adapter.

The native test's preceding simulated Esc/injected-key distinction, stop shortcut updates and takeover behavior execute before that assertion. The separate progress-overlay regression passed. This does not substitute for a manual real-keyboard Esc test or complete validation of screen-sharing software.

The reference all-suite runner also causes timeouts in the temporary PowerShell fixtures for screenshot-output and batch-actions when it overrides TEMP/TMP. Both fixtures pass when run directly with their own temporary fixture directories; batch-actions also passes directly in the reference checkout. The full upstream suite is therefore **not** reported as passing. CI keeps those two self-isolating fixtures as direct commands.

## Host boundaries

- OpenCode V1 has no Desktop GUI settings-page extension API. This adapter supplies a native TUI command entry and opens the full reference settings controls in a local browser window. As of 0.1.1, `/computer-use` belongs exclusively to the TUI; other clients use the settings tool or CLI.
- Tool details and images use OpenCode's own conversation UI. DSH-specific conversation-row grouping is not injected into V1's desktop GUI.
- OpenCode V2 requires a different plugin/GUI entrypoint and is not claimed supported by this V1 package.
- Actual task success still depends on the chosen model, vision support, application responsiveness and the inherited Windows automation limits. No real-model business task or personal-account browser workflow was used for acceptance.

## Reproduction

```powershell
npm ci --ignore-scripts
npm run build
npm test
node test/run-opencode-ui.mjs
node test/run-opencode-host.mjs C:/path/to/opencode.exe
node test/screenshot-output.mjs
node test/batch-actions.mjs
node test/run-upstream-selected.mjs source-encoding lazy-tools overlay-strings atomic-json batch-browser progress-overlay browser-namespace browser-transport
```

The host-test executable argument must be adjusted for another installation. Settings screenshots from the UI test are under `.work/validation/`. The original reference documentation is preserved under `docs/reference/`.
