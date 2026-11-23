# Upstream 0.6.3 synchronization validation

Source version: opencode-computer-use-win 0.2.0. Upstream tag: v0.6.3, commit acfb689b077eca9744f464ad4658037bc85a24e4. The merge retains the OpenCode adapter and incorporates the upstream Windows/browser/settings refactor and its history.

## Validation

| Check | Result |
| --- | --- |
| Build and generated assets | Settings build passed. Deterministic upstream client check and all four packaged .NET Framework helper source/hash/version checks passed. Native helpers were rebuilt from the merged sources at version 0.2.0. |
| Adapter tests | 16 contracts passed; the UI and real-host opt-in cases are run separately. Includes sensitive approval, replay rejection, parameter tampering, cancellation, desktop changes while awaiting approval, legacy settings migration and Hyper-V entry selection. |
| Settings interaction | Passed in headless Edge: 26 controls, three work modes, persisted VM name, authenticated connection callback, update result, diagnostic download, allow-once action, tool presets, browser preferences, shortcut recording, overlay sizing, locale switch and narrow layout. The reference promotion bar is absent. |
| Real OpenCode 1.18.0 | Passed from both the source entry file and the installed tarball's package-directory entry using an isolated project and local mock provider: managed MCP, signed identity, sensitive local-file allow/deny, cleanup of private fields in saved history, redacted diagnostics, lazy tools, cross-session exclusion, cancellation/recovery, browser images and tool-disabled AI summaries. |
| Shared upstream contracts | 32 suites passed across the two selected runs listed below. |
| Direct fixtures | screenshot-output and all batch-actions scenarios passed. |
| Installed package | Installed with development dependencies omitted; explicit server/TUI exports, bundled settings assets/licenses and the standalone 26-tool MCP catalog passed. |

The host test uses a local mock provider and owned HTML pages in temporary directories. Browser operations use isolated headless Edge. It does not send personal provider keys or personal-account browser content to a model. The test selects the public registry and disables external model-directory fetching and auto-update to avoid dependence on local npm registry settings or unrelated network initialization.

## Shared suites that passed

The first run passed: policy, security-regressions, observation-budget, settings-schema, catalog-contract, rpc-protocol, protocol-validation, browser-private-transport, browser-frames, browser-observation, browser-policy, work-mode-contract, precompiled-native, source-encoding, lazy-tools, overlay-strings, atomic-json, batch-browser, progress-overlay, browser-namespace and browser-transport.

The additional native run passed: background-desktop, work-modes-live, input-mutex, shared-stop, activity-unicode, backend-ready, native-host-guard, cancellation-event-mcp, presentation-failure, helper-assembly-load and helper-assembly-concurrency. The background/work-mode fixtures use their own applications and do not send physical input.

## Known failures and unverified paths

- `capture-isolation` fails `Visible overlay must differ from backdrop` in this environment. The same unmodified test fails at the same assertion in a separate checkout of upstream v0.6.3.
- `takeover-native` fails `Opt-out must exclude both layers live` under the isolated runner. The same runner and assertion fail in unmodified upstream v0.6.3. A direct reference run also encountered its foreground-stability assertion. Recording/remote visibility is not claimed fully validated or fixed.
- Hyper-V configuration, relay selection, signature boundary and PID mapping are implemented, but a real configured Windows guest was not available for end-to-end VM validation.
- The complete upstream suite, including its DSH host matrix and all physical input/clipboard cases, was not run. The selected passing suites do not substitute for it.
- OpenCode V2 and embedded GUI settings extensions remain unsupported. Settings updates use npm/configuration plus restarting OpenCode; no DSH marketplace installation or DSH process restart is invoked.

## Reproduction

```powershell
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run build
npm run build:native
node scripts/check-build.mjs
npm test
npm run test:ui
node test/run-opencode-host.mjs C:/path/to/opencode.exe
node test/screenshot-output.mjs
node test/batch-actions.mjs
node test/run-upstream-selected.mjs --powershell=pwsh.exe policy security-regressions observation-budget settings-schema catalog-contract rpc-protocol protocol-validation browser-private-transport browser-frames browser-observation browser-policy work-mode-contract precompiled-native source-encoding lazy-tools overlay-strings atomic-json batch-browser progress-overlay browser-namespace browser-transport
node test/run-upstream-selected.mjs --powershell=pwsh.exe background-desktop work-modes-live input-mutex shared-stop activity-unicode backend-ready native-host-guard cancellation-event-mcp presentation-failure helper-assembly-load helper-assembly-concurrency
npm pack
```

For packaged-host verification, install the tarball in an isolated consumer and set `OPENCODE_TEST_PLUGIN_SPEC` to the installed package directory's absolute file URI before running the host test. This exercises package metadata selection of the server entry instead of a source entry-file URL.
