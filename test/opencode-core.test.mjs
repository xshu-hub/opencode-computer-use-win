import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SettingsStore, atomicWrite, defaults } from '../opencode/store.mjs';
import { Activity } from '../opencode/activity.mjs';
import { DesktopLock } from '../opencode/desktop-lock.mjs';
import { signCall, verifyCall, CONTEXT_MAX_AGE_MS } from '../mcp/request-context.mjs';
import { createSettingsServer } from '../opencode/settings-server.mjs';
import { createPlugin } from '../opencode/plugin.mjs';
import tuiPlugin from '../opencode/tui.mjs';

const temporary = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cu-test-')); t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })); return dir; };
const fixture = async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cu-test-')), file = path.join(dir, 'activity.json'), stateFile = path.join(dir, 'state.json');
  const activity = new Activity({ file, stateFile, getSettings: defaults, lock: new DesktopLock(randomUUID()) });
  t.after(async () => { await activity.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }); return { activity, file, stateFile };
};
const before = (activity, sessionID, callID = randomUUID(), action = 'wait', args = {}) => activity.before({ tool: 'wincu_windows_computer_use_' + action, sessionID, callID }, args);

test('signed metadata binds tool, args, session and turn; standalone mode remains compatible', () => {
  const args = { milliseconds: 1 }, context = { sessionId: 's1', turn: 'u1', callId: 'c1' };
  const signed = signCall('secret', 'wait', args, context);
  assert.deepEqual(verifyCall('secret', 'wait', signed).args, args);
  assert.equal(verifyCall('secret', 'wait', signed).context.turn, 'u1');
  assert.throws(() => verifyCall('secret', 'click', signed), /signature/);
  assert.throws(() => verifyCall('secret', 'wait', { ...signed, milliseconds: 2 }), /signature/);
  assert.throws(() => verifyCall('secret', 'wait', args), /CONTEXT_REQUIRED/);
  assert.throws(() => verifyCall('secret', 'wait', signed, Date.now() + CONTEXT_MAX_AGE_MS + 1000), /expired/);
  assert.doesNotThrow(() => verifyCall('secret','wait',signed,Date.now()+300000),'Waiting for user permission must not invalidate the call');
  assert.deepEqual(verifyCall('', 'wait', args), { args });
});

test('settings persist, reject invalid fields and prevent concurrent lost updates', async t => {
  const store = new SettingsStore(await temporary(t));
  const initial = await store.snapshot(); assert.equal(initial.value.toolPreset, 'full');
  const first = await store.patch({ toolPreset: 'lazy', stopShortcut: 'Ctrl+Alt+K' }, initial.revision);
  assert.equal((await new SettingsStore(store.home).snapshot()).value.toolPreset, 'lazy');
  await assert.rejects(store.patch({ toolPreset: 'full' }, initial.revision), /another window/);
  await assert.rejects(store.patch({ stopShortcut: 'Escape' }, first.revision), /stopShortcut/);
  await assert.rejects(store.patch({ injected: true }, first.revision), /Unknown/);
  const results = await Promise.allSettled([store.patch({ indicatorEnabled: false }, first.revision), new SettingsStore(store.home).patch({ indicatorEnabled: true }, first.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('desktop lock excludes other instances and releases on close', async t => {
  const key = randomUUID(), first = new DesktopLock(key), second = new DesktopLock(key);
  t.after(() => first.release()); t.after(() => second.release());
  await first.acquire('a'); await assert.rejects(second.acquire('b'), /BUSY/);
  await first.release('wrong'); await assert.rejects(second.acquire('b'), /BUSY/);
  await first.release('a'); await second.acquire('b');
});

test('same-turn stop is sticky and a new user turn resumes with a distinct identity', async t => {
  const { activity, file, stateFile } = await fixture(t);
  await assert.rejects(before(activity, 'a'), /TURN_REQUIRED/);
  await activity.startTurn('a', 'user-1');
  const context = await before(activity, 'a', 'c1'); assert.equal(context.turn, 'user-1');
  assert.equal(JSON.parse(await readFile(file)).sessionId, 'a');
  await atomicWrite(stateFile, { paused: true, stoppedSeriesKey: JSON.stringify(['a','user-1']) });
  await assert.rejects(before(activity, 'a'), /STOPPED/);
  activity.after('a','c1', true); await activity.tick();
  await activity.startTurn('a', 'user-2');
  assert.equal((await before(activity, 'a', 'c2')).turn, 'user-2'); activity.after('a','c2');
});

test('concurrent calls in one session share ownership; another session is refused', async t => {
  const { activity } = await fixture(t);
  await activity.startTurn('a','u1'); await activity.startTurn('b','u2');
  await Promise.all([before(activity,'a','c1'),before(activity,'a','c2')]);
  await assert.rejects(before(activity,'b','c3'),/BUSY/);
  await activity.finish('a','stopped'); assert.equal(activity.snapshot().active,true);
  activity.after('a','c1'); activity.after('a','c2'); await activity.tick();
  assert.equal(activity.snapshot().active,false);
  await before(activity,'b','c4'); activity.after('b','c4');
});

test('assistant parent selects the active turn; user message events do not steal it', async t => {
  const { activity } = await fixture(t);
  await activity.startTurn('a','u1');
  await activity.event({ type:'message.updated',properties:{info:{id:'queued',sessionID:'a',role:'user'}} });
  assert.equal(activity.session('a').turn,'u1');
  await activity.event({ type:'message.updated',properties:{info:{id:'m1',sessionID:'a',role:'assistant',parentID:'u1'}} });
  await before(activity,'a','c1');
  await activity.event({type:'message.part.updated',properties:{part:{id:'p1',messageID:'m1',sessionID:'a',type:'text',text:'Visible reply'}}});
  assert.equal(activity.snapshot().progress.reply,'Visible reply');
  await activity.event({type:'message.part.updated',properties:{part:{id:'p2',messageID:'queued',sessionID:'a',type:'text',text:'Private user prompt'}}});
  assert.equal(activity.snapshot().progress.reply,'Visible reply');
  await activity.event({type:'message.part.updated',properties:{part:{type:'tool',sessionID:'a',callID:'c1',state:{status:'error'}}}});
  await activity.event({type:'session.status',properties:{sessionID:'a',status:{type:'idle'}}});
  assert.equal(activity.snapshot().active,false);
});

test('host completion keeps desktop ownership until the native worker finishes cleanup', async t => {
  const {activity,stateFile}=await fixture(t);
  await activity.startTurn('a','u1'); await before(activity,'a','c1');
  await atomicWrite(stateFile,{workerPid:process.pid,active:1});
  activity.after('a','c1',true); await activity.finish('a','stopped');
  assert.equal(activity.snapshot().active,true,'Early host cancellation must not release native input ownership');
  await activity.startTurn('b','u2'); await assert.rejects(before(activity,'b','c2'),/BUSY/);
  await atomicWrite(stateFile,{workerPid:process.pid,active:0}); await activity.tick();
  assert.equal(activity.snapshot().active,false);
  await before(activity,'b','c3'); activity.after('b','c3');
});

test('progress summaries follow an interface language change during the same turn', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'opencode-cu-locale-'));
  const requested=[];
  const activity=new Activity({file:path.join(dir,'activity.json'),stateFile:path.join(dir,'state.json'),
    locale:'zh',lock:new DesktopLock(randomUUID()),getSettings:()=>({...defaults(),progressOverlayMode:'summary'}),
    requestSummary:async(_ctx,_session,_input,_signal,locale)=>{requested.push(locale);return 'Finished';}});
  t.after(async()=>{await activity.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:20});});
  await activity.startTurn('locale-session','user-turn');await before(activity,'locale-session','call');
  activity.locale='en';activity.after('locale-session','call');await activity.finish('locale-session');
  const deadline=Date.now()+2000;
  while(!requested.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(requested,['en']);
});

test('settings HTTP API requires token, same origin, validated fields and revision', async t => {
  const store = new SettingsStore(await temporary(t)); let applied;
  const server = await createSettingsServer({store,onChange:next=>{applied=next;},getStatus:()=>({active:false})});
  t.after(()=>server.close());
  const url = new URL(server.url), base = url.origin, headers = {Authorization:'Bearer '+url.hash.slice(1),'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/settings')).status,401);
  assert.equal((await fetch(base+'/api/settings',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  const initial = await (await fetch(base+'/api/settings',{headers})).json();
  const response = await fetch(base+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:initial.revision,patch:{toolPreset:'lite',previewToken:1}})});
  assert.equal(response.status,200); assert.equal(applied.value.toolPreset,'lite');
  assert.equal((await fetch(base+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:initial.revision,patch:{indicatorEnabled:false}})})).status,409);
  assert.equal((await fetch(base+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({patch:{stopShortcut:'bad'}})})).status,400);
});

test('OpenCode hooks register managed MCP and carry host identity without changing public schemas', async t => {
  const home = await temporary(t), calls = [];
  const client = {app:{log:async()=>{}},mcp:{add:async p=>{calls.push(p);return {data:{wincu:{status:'connected'}}};},disconnect:async()=>{}},session:{messages:async()=>({data:[]})}};
  const hooks = await createPlugin({client,directory:home},{home,locale:'zh'}); t.after(()=>hooks.dispose());
  const cfg = {}; await hooks.config(cfg);
  assert.equal(cfg.mcp.wincu.type,'local'); assert.equal(cfg.agent['computer-use-progress'].tools['*'],false);
  await hooks['chat.params']({sessionID:'a',message:{id:'u1'},model:{id:'model',providerID:'provider'}});
  const output = {args:{operation:'list'}};
  await hooks['tool.execute.before']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c1'},output);
  const result = verifyCall(cfg.mcp.wincu.environment.WCU_OPENCODE_TOKEN,'windows_computer_use_tools',output.args);
  assert.equal(result.context.sessionId,'a'); assert.equal(result.context.turn,'u1'); assert.deepEqual(result.args,{operation:'list'});
  await hooks['tool.execute.after']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c1',args:output.args},{content:[]});
  assert.deepEqual(output.args,{operation:'list'});
  await hooks['chat.params']({sessionID:'a',message:{id:'synthetic-continuation'},model:{id:'model',providerID:'provider'}});
  const repeated={args:{operation:'list'}};
  await hooks['tool.execute.before']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c2'},repeated);
  assert.equal(verifyCall(cfg.mcp.wincu.environment.WCU_OPENCODE_TOKEN,'windows_computer_use_tools',repeated.args).context.turn,'u1');
  await hooks['tool.execute.after']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c2',args:repeated.args},{content:[]});
  await hooks['chat.message']({sessionID:'a'},{message:{id:'real-user-2'},parts:[{type:'text',text:'Continue'}]});
  await hooks['chat.params']({sessionID:'a',message:{id:'real-user-2'},model:{id:'model',providerID:'provider'}});
  const next={args:{operation:'list'}};
  await hooks['tool.execute.before']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c3'},next);
  assert.equal(verifyCall(cfg.mcp.wincu.environment.WCU_OPENCODE_TOKEN,'windows_computer_use_tools',next.args).context.turn,'real-user-2');
  await hooks['tool.execute.after']({tool:'wincu_windows_computer_use_tools',sessionID:'a',callID:'c3',args:next.args},{content:[]});
});

test('server and TUI together expose exactly one computer-use slash command', async t => {
  const home=await temporary(t);
  const hooks=await createPlugin({client:{app:{log:async()=>{}},mcp:{disconnect:async()=>{}}},directory:home},{home});
  t.after(()=>hooks.dispose());
  const cfg={command:{review:{template:'Review the code'}}};await hooks.config(cfg);
  let commands, cleanup, disposed=false;
  await tuiPlugin.tui({command:{register:factory=>{commands=factory();return()=>{disposed=true;};}},lifecycle:{onDispose:fn=>{cleanup=fn;}}});
  assert.equal(commands[0].slash.name,'computer-use');
  assert.ok(commands[0].slash.aliases.includes('wincu'));
  assert.equal(typeof commands[0].onSelect,'function');
  const slashNames=[...Object.keys(cfg.command??{}),...commands.map(command=>command.slash?.name)];
  assert.equal(slashNames.filter(name=>name==='computer-use').length,1);
  assert.equal(cfg.command['computer-use'],undefined);
  assert.equal(cfg.command.review.template,'Review the code');
  assert.equal(hooks['command.execute.before'],undefined,'Opening native settings must not submit a server prompt');
  cleanup(); assert.equal(disposed,true);
});
