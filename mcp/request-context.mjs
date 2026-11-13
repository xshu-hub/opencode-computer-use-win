// Shared by the managed MCP worker and its OpenCode host adapter.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CONTEXT_KEY = '__opencodeComputerUse';
export const CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const digest = (token, name, args, context) => createHmac('sha256', token)
  .update(JSON.stringify([name, args, context])).digest('hex');

export function signCall(token, name, args, context) {
  const { [CONTEXT_KEY]: ignored, ...plain } = args;
  const value = { ...context, issuedAt: Date.now() };
  return { ...plain, [CONTEXT_KEY]: { value, signature: digest(token, name, plain, value) } };
}

// Private transport metadata is added by the host after model argument validation.
// It is never advertised as an argument the model may choose.
export function verifyCall(token, name, input = {}, now = Date.now()) {
  if (!token) return { args: input };
  const { [CONTEXT_KEY]: envelope, ...args } = input;
  const context = envelope?.value;
  if (!context || typeof context.sessionId !== 'string' || !context.sessionId ||
      typeof context.turn !== 'string' || !context.turn || typeof context.callId !== 'string' ||
      !Number.isSafeInteger(context.issuedAt) || context.issuedAt > now + 30000 || now - context.issuedAt > CONTEXT_MAX_AGE_MS ||
      !/^[a-f0-9]{64}$/.test(envelope.signature ?? '')) throw Error('OPENCODE_CONTEXT_REQUIRED: Missing or expired host context');
  const expected = Buffer.from(digest(token, name, args, context), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw Error('OPENCODE_CONTEXT_INVALID: Host context signature does not match');
  return { args, context };
}
