#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { dataHome, readJson } from './store.mjs';
import { openSettings } from './plugin.mjs';

export async function findSettings(directory = process.cwd(), home = dataHome()) {
  let names; try { names = await readdir(path.join(home, 'instances')); } catch (e) { if (e.code === 'ENOENT') names = []; else throw e; }
  const instances = (await Promise.all(names.filter(n => /^[a-f0-9]{24}\.json$/.test(n)).map(n => readJson(path.join(home, 'instances', n), null))))
    .filter(value => { try { process.kill(value.pid, 0); return true; } catch { return false; } })
    .sort((a,b) => Number(b.directory === directory) - Number(a.directory === directory) || b.startedAt - a.startedAt);
  if (!instances.length) throw Error('Start OpenCode with the Computer Use plugin before opening settings');
  return instances[0].url;
}
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] ?? '').href) {
  const command = process.argv[2] ?? 'settings';
  if (command !== 'settings') { console.error('Usage: opencode-cu settings'); process.exitCode = 1; }
  else try { await openSettings(await findSettings()); console.log('Computer Use settings opened'); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
