import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The OS releases this per-user lock after a crash, including across projects/processes.
// A timer-based lock cannot safely revoke ownership while native input is still running.
export class DesktopLock {
  constructor(key = os.userInfo().username) {
    const id = createHash('sha256').update(key).digest('hex').slice(0, 20);
    this.address = process.platform === 'win32' ? `\\\\.\\pipe\\opencode-wcu-${id}` : path.join(os.tmpdir(), `opencode-wcu-${id}.sock`);
  }
  async acquire(owner) {
    if (this.closing) await this.closing;
    if (this.server) { if (this.owner !== owner) throw Error('COMPUTER_USE_BUSY: Another conversation is using the desktop'); return; }
    const server = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once('error', error => reject(error.code === 'EADDRINUSE' ? Error('COMPUTER_USE_BUSY: Another OpenCode project or process is using the desktop') : error));
      server.listen(this.address, resolve);
    });
    this.server = server; this.owner = owner; server.unref();
  }
  async release(owner) {
    if (!this.server || (owner !== undefined && owner !== this.owner)) return;
    const server = this.server; this.server = undefined; this.owner = undefined;
    this.closing = new Promise(resolve => server.close(resolve));
    try { await this.closing; } finally { this.closing = undefined; }
  }
}
