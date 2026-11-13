import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { normalizeSettings, DEFAULT_SETTINGS, repairStaleSettings } from '../mcp/settings.mjs';
import { DesktopLock } from './desktop-lock.mjs';

export const dataHome = () => process.env.OPENCODE_CU_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'opencode-computer-use-win');
export const defaults = () => normalizeSettings({ ...DEFAULT_SETTINGS, toolPreset: 'full', indicatorText: 'OpenCode 正在控制电脑' });
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, file); break; }
      catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error; await new Promise(r => setTimeout(r, 15 * (attempt + 1))); }
    }
  } finally { await rm(temp, { force: true }); }
}
export class SettingsStore {
  constructor(home = dataHome()) { this.home = home; this.file = path.join(home, 'settings.json'); }
  async snapshot() {
    const saved = await readJson(this.file, null);
    const repaired = repairStaleSettings(saved?.value ?? {});
    return { revision: saved?.revision ?? 'initial', value: normalizeSettings({ ...defaults(), ...repaired.value }), notices: repaired.repaired };
  }
  async patch(patch, revision) {
    if (!patch || Array.isArray(patch) || typeof patch !== 'object' || Object.keys(patch).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw Error('Unknown settings field');
    await mkdir(this.home, { recursive: true });
    const lock = new DesktopLock('settings:' + path.resolve(this.home).toLowerCase());
    for (let attempt = 0; ; attempt++) {
      try { await lock.acquire('save'); break; }
      catch (error) {
        if (!error.message.startsWith('COMPUTER_USE_BUSY') || attempt > 100) throw error;
        await new Promise(r => setTimeout(r, 20));
      }
    }
    try {
      const current = await this.snapshot();
      if (revision !== undefined && revision !== current.revision) { const e = Error('Settings changed in another window; reload before saving'); e.status = 409; throw e; }
      const value = normalizeSettings({ ...current.value, ...patch });
      const next = { revision: randomUUID(), value };
      await atomicWrite(this.file, next);
      return next;
    } finally { await lock.release(); }
  }
}
