import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { atomicJson } from '../mcp/takeover.mjs';
import { enabledToolsForSettings, toolSelectionKey } from '../mcp/settings.mjs';
import { overlayStrings, systemLocale } from '../mcp/overlay-strings.mjs';
import { SettingsStore, dataHome, atomicWrite, readJson } from './store.mjs';
import { Activity, shortTool } from './activity.mjs';
import { signCall, CONTEXT_KEY } from '../mcp/request-context.mjs';
import { createSettingsServer } from './settings-server.mjs';

export function openSettings(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/#\w+$/.test(url)) throw Error('Invalid local settings address');
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32' ? spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' }) : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
const unwrap = response => { if (response?.error) throw Error(JSON.stringify(response.error)); return response?.data; };

export async function createPlugin({ client, directory }, options = {}) {
  const home = options.home ?? dataHome(), store = new SettingsStore(home);
  const runtime = await mkdtemp(path.join(os.tmpdir(), `opencode-wcu-${process.pid}-`));
  const files = Object.fromEntries(['settings','state','activity','layout'].map(name => [name, path.join(runtime, name + '.json')]));
  const token = randomBytes(32).toString('hex'), node = options.nodePath ?? 'node';
  const preferencesFile = path.join(home, 'interface.json');
  const preferences = await readJson(preferencesFile, {});
  let snapshot = await store.snapshot(), disposed = false, pending = new Set(), reloadError = '', runningKey, updating;
  const log = error => { reloadError = String(error.message ?? error); void client.app?.log?.({ body: { service: 'computer-use', level: 'error', message: reloadError } }).catch(() => {}); };
  const query = { directory };
  const temporarySessions = new Set();
  const admittedTurns = new Map();
  let catalogVersion = 0;
  const catalogCalls = new Map(), catalogWaiters = new Set();
  const callKey = input => JSON.stringify([input.sessionID,input.callID]);
  let events = Promise.resolve();
  async function requestSummary(_ctx, session, input, signal, locale) {
    if (!session.model) throw Error('No session model for progress summary');
    let id;
    try {
      const created = unwrap(await client.session.create({ query, body: { parentID: session.id, title: 'Computer Use progress (temporary)' }, signal }));
      id = created.id; temporarySessions.add(id);
      const response = unwrap(await client.session.prompt({ query, path: { id }, signal, body: {
        model: session.model, agent: 'computer-use-progress', system: overlayStrings(locale).summarySystem,
        tools: { '*': false }, parts: [{ type: 'text', text: input }]
      } }));
      signal.throwIfAborted();
      if (response.info?.error) throw Error('Progress model returned an error');
      const text = response.parts.filter(part => part.type === 'text').map(part => part.text).join('').trim();
      if (!text) throw Error('Progress model returned no text');
      return text.slice(0, 240);
    } finally {
      if (id) { await client.session.abort({ query, path: { id } }).catch(() => {}); await client.session.delete({ query, path: { id } }).catch(() => {}); temporarySessions.delete(id); }
    }
  }
  const activity = new Activity({ file: files.activity, stateFile: files.state, getSettings: () => snapshot.value, locale: preferences.locale ?? options.locale ?? systemLocale(), requestSummary, onError: log });
  const config = () => ({ type: 'local', enabled: true, timeout: 90000, command: [node, fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], environment: {
    WCU_OPENCODE_TOKEN: token, WCU_HOST_BRAND: 'OpenCode', WCU_IMAGE_MODE: 'inline',
    WCU_CONFIG_FILE: files.settings, WCU_STATE_FILE: files.state, WCU_ACTIVITY_FILE: files.activity, WCU_LAYOUT_FILE: files.layout,
    WCU_SETTINGS_JSON: JSON.stringify(snapshot.value), WCU_TOOL_MODE: snapshot.value.toolPreset === 'lazy' ? 'lazy' : snapshot.value.mode,
    WCU_ENABLED_TOOLS: JSON.stringify(enabledToolsForSettings(snapshot.value)),
    WCU_BROWSER_HEADLESS: snapshot.value.browserVisible ? '0' : '1', WCU_BROWSER_APP: snapshot.value.browserApp,
    WCU_BROWSER_SIGNIN: snapshot.value.browserSignIn ? '1' : '0', WCU_BROWSER_ATTACH_USER: snapshot.value.browserAttachUser ? '1' : '0',
    WCU_BROWSER_PROFILE: path.join(home, 'agent-browser'), WCU_BROWSER_DOWNLOADS: path.join(home, 'downloads'),
    ...(options.environment ?? {})
  } });
  atomicJson(files.settings, snapshot.value);
  async function reload() {
    if (disposed || pending.size || runningKey === toolSelectionKey(snapshot.value)) return;
    if (updating) return updating;
    const key = toolSelectionKey(snapshot.value), desired = config();
    updating = (async () => {
      const result = unwrap(await client.mcp.add({ query, body: { name: 'wincu', config: desired } }));
      if (result?.wincu?.status !== 'connected') throw Error('Computer Use reconnect failed: ' + (result?.wincu?.error ?? 'unknown status'));
      runningKey = key; reloadError = '';
    })().finally(() => { updating = undefined; });
    return updating;
  }
  async function apply(next) {
    snapshot = next; atomicJson(files.settings, snapshot.value); activity.publish();
    // Presentation settings are read live by the worker. Catalog/browser changes
    // reconnect only after all calls (including health/management) have returned.
    void reload().catch(log);
  }
  const settingsServer = await createSettingsServer({ store, onChange: apply,
    onLocale: async locale => { await atomicWrite(preferencesFile, { locale }); activity.locale = locale; activity.publish(); },
    getStatus: () => ({ ...activity.snapshot(), locale: activity.locale, pending: pending.size, reloadPending: runningKey !== toolSelectionKey(snapshot.value), reloadError, directory }) });
  const instanceFile = path.join(home, 'instances', createHash('sha256').update(directory + runtime).digest('hex').slice(0, 24) + '.json');
  await atomicWrite(instanceFile, { pid: process.pid, directory, url: settingsServer.url, startedAt: Date.now() });
  let layoutId;
  const timer = setInterval(async () => {
    if (disposed) return;
    try {
      const next = await store.snapshot(); if (next.revision !== snapshot.revision) await apply(next);
      const layout = await readJson(files.layout, null);
      if (layout && layout.id !== layoutId) {
        const allowed = ['progressOverlayWidth','progressOverlayHeight','progressOverlayPosition','progressOverlayX','progressOverlayY','progressOverlayLocked','progressOverlayEnabled'];
        if (!layout.patch || Object.keys(layout.patch).some(key => !allowed.includes(key))) throw Error('Invalid overlay layout update');
        if (!layout.base || Object.entries(layout.base).every(([key, value]) => allowed.includes(key) && snapshot.value[key] === value)) await apply(await store.patch(layout.patch, snapshot.revision));
        layoutId = layout.id;
      }
      if (!pending.size && !updating && !reloadError) await reload();
    } catch (error) { log(error); }
  }, 500); timer.unref();
  async function ensureTurn(sessionID) {
    const session = activity.session(sessionID); if (session.turn) return;
    const messages = unwrap(await client.session.messages({ query, path: { id: sessionID } }));
    const last = messages?.findLast(message => message.info.role === 'user' && !message.parts?.every(part => part.synthetic));
    if (!last) throw Error('OPENCODE_TURN_REQUIRED: Start a new user message before using computer tools');
    await activity.startTurn(sessionID, last.info.id, last.info.model);
  }
  const hooks = {
    async config(cfg) {
      cfg.mcp ??= {};
      if (cfg.mcp.wincu && cfg.mcp.wincu.environment?.WCU_OPENCODE_TOKEN !== token) throw Error('Remove the manual wincu MCP entry before enabling the Computer Use plugin');
      cfg.mcp.wincu = config(); runningKey = toolSelectionKey(snapshot.value);
      // /computer-use belongs to the TUI extension. Registering it here too
      // creates duplicate completion rows and unnecessarily starts a model turn.
      cfg.agent ??= {};
      cfg.agent['computer-use-progress'] = { description: 'Internal Computer Use progress summary', mode: 'subagent', hidden: true, tools: { '*': false }, permission: { '*': 'deny' } };
      if (cfg.experimental?.codeMode || cfg.experimental?.codemode) throw Error('Computer Use requires native MCP tool execution hooks; turn off experimental Code Mode for this plugin');
    },
    async 'chat.params'(input) {
      await events;
      if (temporarySessions.has(input.sessionID)) return;
      const current = activity.session(input.sessionID);
      // OpenCode can synthesize compaction/continuation messages. They are not
      // user permission to resume a stopped desktop series.
      const turn = !current.turn || admittedTurns.get(input.sessionID)?.has(input.message.id) ? input.message.id : current.turn;
      const session = await activity.startTurn(input.sessionID, turn, { providerID: input.model.providerID ?? input.message.model?.providerID, modelID: input.model.id ?? input.message.model?.modelID });
      session.modelParent = input.message.id;
    },
    async 'chat.message'(input, output) {
      if (temporarySessions.has(input.sessionID) || !output.parts.some(part => !part.synthetic && !part.ignored)) return;
      if (!admittedTurns.has(input.sessionID)) admittedTurns.set(input.sessionID, new Set());
      const turns = admittedTurns.get(input.sessionID); turns.add(output.message.id);
      if (turns.size > 64) turns.delete(turns.values().next().value);
    },
    async 'tool.execute.before'(input, output) {
      if (!shortTool(input.tool)) return;
      await events;
      await ensureTurn(input.sessionID); if (updating) await updating;
      const context = await activity.before(input, output.args);
      if (shortTool(input.tool) === 'tools' && ['enable','disable','reset'].includes(output.args.operation)) catalogCalls.set(callKey(input), catalogVersion);
      output.args = Object.assign(output.args, signCall(token, input.tool.slice('wincu_'.length), output.args, context));
      pending.add(callKey(input));
    },
    async 'tool.execute.after'(input, result) {
      if (!shortTool(input.tool)) return;
      delete input.args?.[CONTEXT_KEY]; pending.delete(callKey(input));
      if (result.isError && /COMPUTER_USE_STOPPED|COMPUTER_USE_CANCELLED/.test(JSON.stringify(result.content ?? []))) activity.session(input.sessionID).stopped = true;
      activity.after(input.sessionID, input.callID, result.isError === true || /COMPUTER_USE_STOPPED/.test(result.output ?? ''));
      if (catalogCalls.has(callKey(input))) {
        const version = catalogCalls.get(callKey(input)); catalogCalls.delete(callKey(input));
        if (version === catalogVersion && !result.isError) await new Promise(resolve => {
          const done = () => { clearTimeout(timer); catalogWaiters.delete(done); resolve(); };
          const timer = setTimeout(done, 1000); catalogWaiters.add(done);
        });
      }
      if (!pending.size) void reload().catch(log);
    },
    async event({ event }) {
      if (disposed) return;
      events = events.then(async () => {
        if (event.type === 'mcp.tools.changed' && event.properties?.server === 'wincu') { catalogVersion++; for (const resolve of [...catalogWaiters]) resolve(); }
        const part = event.properties?.part;
        if (part?.type === 'tool' && ['completed', 'error'].includes(part.state?.status)) { pending.delete(callKey(part)); if (part.state.status === 'error') catalogCalls.delete(callKey(part)); }
        await activity.event(event);
      }).catch(log);
      return events;
    },
    tool: { computer_use_settings: { description: 'Open the Computer Use settings window for the user. It contains tool selection, browser settings, indicators, progress overlay and stop shortcut. Does not change settings.', args: {}, async execute() { await openSettings(settingsServer.url); return '已打开电脑操控设置 / Computer Use settings opened.'; } } },
    async dispose() {
      disposed = true; clearInterval(timer);
      for (const resolve of [...catalogWaiters]) resolve();
      await client.mcp.disconnect({ query, path: { name: 'wincu' } }).catch(() => {});
      await activity.close(); await settingsServer.close();
      await rm(instanceFile, { force: true });
      // The MCP worker polls control files until it exits. Leave its owned temp
      // directory for OS temp cleanup rather than race a live native worker.
    }
  };
  return hooks;
}

export default { id: 'opencode-computer-use-win', server: createPlugin };
