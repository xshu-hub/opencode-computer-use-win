import { readFileSync } from 'node:fs';
import { atomicJson } from '../mcp/takeover.mjs';
import { actionLabel } from '../mcp/activity.mjs';
import { isQuietCall } from '../mcp/catalog.mjs';
import { createProgressSummarizer } from '../mcp/progress-summary.mjs';
import { DesktopLock } from './desktop-lock.mjs';

const trim = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(-1200);
export const shortTool = name => /^wincu_windows_computer_use_([a-z_]+)$/.exec(name)?.[1];
const callKey = (sessionID, callID) => JSON.stringify([sessionID, callID]);
const fresh = () => ({ status: 'waiting', step: 1, steps: [], reasoning: '', reply: '', startedAt: Date.now() });

export class Activity {
  constructor({ file, stateFile, getSettings, locale = 'zh', lock = new DesktopLock(), requestSummary, onError = () => {} }) {
    Object.assign(this, { file, stateFile, getSettings, locale, lock, onError });
    this.sessions = new Map(); this.messages = new Map(); this.parts = new Map(); this.calls = new Map();
    this.summary = createProgressSummarizer({}, { getSettings, getLocale: () => this.locale, request: requestSummary, onChange: () => this.publish() });
    this.timer = setInterval(() => this.tick().catch(onError), 1000); this.timer.unref();
    this.publish();
  }
  session(id) { if (!this.sessions.has(id)) this.sessions.set(id, { id, turn: null, progress: fresh(), seenMessages: new Set(), model: undefined }); return this.sessions.get(id); }
  async startTurn(id, turn, model) {
    if (!turn) throw Error('OPENCODE_TURN_REQUIRED: Cannot determine the current user message');
    const session = this.session(id);
    if (session.turn !== turn) {
      const deadline = Date.now() + 30000;
      while (this.owner?.id === id && (this.calls.size || this.workerActive())) {
        if (Date.now() > deadline) throw Error('COMPUTER_USE_BUSY: The previous turn is still cleaning up native input');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (this.owner?.id === id) await this.finish(id, 'done');
      Object.assign(session, { turn, progress: fresh(), seenMessages: new Set(), stopped: false, desktop: false, finishing: undefined, summaryOwner: undefined });
    }
    if (model) session.model = model;
    this.publish(); return session;
  }
  stopped() {
    if (!this.owner) return false;
    try {
      const state = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      const key = JSON.stringify([this.owner.id, this.owner.turn]);
      if (state.pauseMessage && !state.pauseMessage.startsWith('COMPUTER_USE_STOPPED_BY_USER')) return false;
      return state.paused && (state.stoppedSeriesKey === key || state.blockedSeries?.[key]);
    } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  }
  workerActive() {
    try {
      const state = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      if (!(state.active > 0)) return false;
      if (state.workerPid) { try { process.kill(state.workerPid, 0); } catch (error) { if (error.code === 'ESRCH') return false; } }
      return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  }
  async before({ tool, sessionID, callID }, args) {
    const name = shortTool(tool); if (!name) return;
    const session = this.session(sessionID);
    if (!session.turn) throw Error('OPENCODE_TURN_REQUIRED: Start a new user turn before using computer tools');
    if (!['health','tools'].includes(name) && (session.stopped || (this.owner?.id === sessionID && this.stopped()))) throw Error('COMPUTER_USE_STOPPED_BY_USER: Do not retry in this user turn. A new user message may resume.');
    if (!['health', 'tools'].includes(name)) {
      // Lock acquisition is serialized even for simultaneous calls in the same process.
      this.acquiring = (this.acquiring ?? Promise.resolve()).catch(() => {}).then(() => this.lock.acquire(sessionID));
      await this.acquiring;
      if (this.owner && this.owner.id !== sessionID) throw Error('COMPUTER_USE_BUSY: Another conversation is using the desktop');
      this.owner = session; this.lingering = undefined;
      session.lastActive = Date.now();
      if (!isQuietCall(name, args)) session.desktop = true;
      const progress = session.progress;
      let step = progress.steps.at(-1);
      if (!step || step.step !== progress.step) { step = { step: progress.step, actions: [], reasoning: progress.reasoning, reply: progress.reply }; progress.steps.push(step); }
      const action = { label: actionLabel('windows_computer_use_' + name, args, this.locale) || name, state: 'running' };
      step.actions.push(action); if (step.actions.length > 6) step.actions.shift();
      if (progress.steps.length > 24) progress.steps.shift();
      Object.assign(progress, { status: 'acting', action: action.label, tool: name });
      this.calls.set(callKey(sessionID,callID), { sessionID, action });
      this.publish();
    }
    return { sessionId: sessionID, turn: session.turn, callId: callID };
  }
  after(sessionID, callID, failed = false) {
    const key = callKey(sessionID,callID), call = this.calls.get(key); if (!call) return;
    call.action.state = failed ? 'error' : 'done'; this.calls.delete(key);
    const session = this.sessions.get(call.sessionID);
    if (session) { session.lastActive = Date.now(); Object.assign(session.progress, { status: session.stopped ? 'stopped' : 'waiting', action: '', tool: '' }); }
    this.publish();
  }
  async finish(id, status = 'done') {
    const session = this.sessions.get(id); if (!session) return;
    if (status === 'done' && session.stopped) status = 'stopped';
    if (status === 'stopped' || status === 'failed') session.stopped = true;
    if (this.owner?.id !== id) return;
    // Keep the lease while an input call is unwinding; idle/error can arrive first.
    if ([...this.calls.values()].some(call => call.sessionID === id) || this.workerActive()) { session.finishing = status; return; }
    Object.assign(session.progress, { status, endedAt: Date.now(), tool: '', action: '' });
    this.lingering = { session, until: Date.now() + 20000 };
    this.owner = undefined; session.desktop = false; session.finishing = undefined;
    this.publish(); await this.lock.release(id);
  }
  async event(event) {
    const p = event.properties ?? {};
    if (event.type === 'message.updated') {
      const info = p.info; if (!info || info.role !== 'assistant') return;
      this.messages.set(info.id, info);
      if (this.messages.size > 512) this.messages.delete(this.messages.keys().next().value);
      const session = this.session(info.sessionID);
      // Assistant parentID is authoritative; a queued user prompt must not change ownership.
      if (!session.turn && info.parentID) await this.startTurn(info.sessionID, info.parentID, { providerID: info.providerID, modelID: info.modelID });
      if (info.parentID !== (session.modelParent ?? session.turn)) return;
      if (!session.seenMessages.has(info.id)) {
        session.seenMessages.add(info.id);
        if (session.seenMessages.size > 1) session.progress.step++;
        session.progress.reasoning = ''; session.progress.reply = '';
      }
      if (info.error) await this.finish(info.sessionID, /abort/i.test(info.error.name ?? '') ? 'stopped' : 'failed');
    }
    if (event.type === 'message.part.updated') {
      const part = p.part; if (!part) return;
      if (part.type === 'tool' && ['completed', 'error'].includes(part.state?.status)) this.after(part.sessionID, part.callID, part.state.status === 'error');
      if (['reasoning', 'text'].includes(part.type) && this.messages.get(part.messageID)?.role === 'assistant') {
        this.parts.set(part.id, part); this.updateText(part);
        if (this.parts.size > 512) this.parts.delete(this.parts.keys().next().value);
      }
    }
    if (event.type === 'message.part.delta' && p.field === 'text') {
      const part = this.parts.get(p.partID);
      if (part && part.sessionID === p.sessionID && part.messageID === p.messageID) { part.text = trim(part.text + p.delta); this.updateText(part); }
    }
    if ((event.type === 'session.status' && p.status?.type === 'idle') || event.type === 'session.idle') await this.finish(p.sessionID, this.session(p.sessionID).stopped ? 'stopped' : 'done');
    if (event.type === 'session.error') await this.finish(p.sessionID, /abort/i.test(p.error?.name ?? '') ? 'stopped' : 'failed');
  }
  updateText(part) {
    const session = this.sessions.get(part.sessionID); if (!session || this.messages.get(part.messageID)?.parentID !== (session.modelParent ?? session.turn)) return;
    const field = part.type === 'reasoning' ? 'reasoning' : 'reply';
    session.progress[field] = trim(part.text);
    if (field === 'reasoning' && !session.progress.intent) session.progress.intent = trim(part.text).slice(0, 300);
    let entry = session.progress.steps.at(-1);
    if (!entry || entry.step !== session.progress.step) { entry = { step: session.progress.step, actions: [], reasoning: '', reply: '' }; session.progress.steps.push(entry); }
    entry[field] = session.progress[field];
    if (!this.calls.size) session.progress.status = field === 'reasoning' ? 'thinking' : 'replying';
    if (this.owner === session) session.lastActive = Date.now();
    this.publish();
  }
  publish() {
    const active = this.owner, shown = active ?? (this.lingering?.until > Date.now() ? this.lingering.session : undefined);
    if (shown && !shown.summaryOwner) shown.summaryOwner = { id: shown.id, turn: shown.turn, session: shown, progress: shown.progress };
    this.summary.update(shown?.summaryOwner);
    atomicJson(this.file, { active: !!active, sessionId: active?.id ?? null, turn: active?.turn ?? null,
      indicator: active?.desktop === true, expiresAt: active ? Date.now() + 5000 : 0, locale: this.locale,
      ...(shown && this.getSettings().progressOverlayEnabled ? { progress: shown.progress } : {}),
      ...(!active && shown ? { lingerUntil: this.lingering.until } : {}) });
  }
  async tick() {
    if (this.owner && this.stopped()) this.owner.stopped = true;
    if (this.owner?.finishing && !this.calls.size) await this.finish(this.owner.id, this.owner.finishing);
    else if (this.owner && !this.calls.size && Date.now() - this.owner.lastActive > 30000) await this.finish(this.owner.id);
    if (this.owner || this.lingering) this.publish();
    if (this.lingering?.until <= Date.now()) this.lingering = undefined;
  }
  snapshot() { return { active: !!this.owner, pending: this.calls.size, stopped: this.owner?.stopped ?? false, progress: (this.owner ?? this.lingering?.session)?.progress }; }
  async close() { clearInterval(this.timer); this.summary.close(); this.owner = undefined; this.lingering = undefined; this.publish(); await this.lock.release(); }
}
