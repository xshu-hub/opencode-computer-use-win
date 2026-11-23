import { randomUUID } from 'node:crypto';

// Only the authenticated settings page can resolve a pending approval. The
// caller never receives credentials and every decision belongs to one call.
export class ApprovalGate {
  constructor({ timeout = 300000 } = {}) { this.timeout = timeout; this.pending = new Map(); }
  snapshot() { return [...this.pending.values()].map(({ item }) => item); }
  request(details) {
    const item = { ...details, id: randomUUID() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.decide(item.id, false), this.timeout);
      timer.unref();
      this.pending.set(item.id, { item, finish: allow => {
        clearTimeout(timer); this.pending.delete(item.id);
        allow ? resolve() : reject(Error('WCU_APPROVAL_DENIED: the operation was declined, cancelled or timed out; no input was sent.'));
      } });
    });
  }
  decide(id, allow) {
    const entry = this.pending.get(id);
    if (!entry || typeof allow !== 'boolean') throw Object.assign(Error('Approval is no longer pending'), {status:410});
    entry.finish(allow);
  }
  cancel(sessionID) { for (const entry of [...this.pending.values()]) if (!sessionID || entry.item.sessionID === sessionID) entry.finish(false); }
}
