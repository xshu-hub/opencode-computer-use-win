import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../opencode/plugin.mjs';
import { SettingsStore } from '../opencode/store.mjs';
import { verifyCall } from '../mcp/request-context.mjs';
import { consumeGrant, browserChildEnv } from '../mcp/policy.mjs';

async function fixture(t) {
  const home=await mkdtemp(path.join(os.tmpdir(),'opencode-upstream-'));
  let url;
  const client={app:{log:async()=>{}},mcp:{add:async()=>({data:{wincu:{status:'connected'}}}),disconnect:async()=>{}}};
  const hooks=await createPlugin({client,directory:home},{home,openSettings:async value=>{url=value;}});
  t.after(async()=>{await hooks.dispose();await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:30});});
  const cfg={};await hooks.config(cfg);
  await hooks['chat.params']({sessionID:'session',message:{id:'turn'},model:{id:'model',providerID:'provider'}});
  async function pending() {
    for(let i=0;i<100&&!url;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(url,'the user approval page opened');
    const parsed=new URL(url),headers={Authorization:'Bearer '+parsed.hash.slice(1),'Content-Type':'application/json'};
    const base=parsed.origin,status=await (await fetch(base+'/api/status',{headers})).json();
    assert.equal(status.approvals.length,1);
    return {base,headers,item:status.approvals[0]};
  }
  return {home,hooks,cfg,pending};
}

test('sensitive calls require page approval; exact arguments receive a one-use backend grant',async t=>{
  const {hooks,cfg,pending}=await fixture(t),input={tool:'wincu_windows_computer_use_launch_app',sessionID:'session',callID:'call'};
  const output={args:{target:'notepad.exe',arguments:'notes.txt'}},plain=structuredClone(output.args);
  const operation=hooks['tool.execute.before'](input,output);
  const {base,headers,item}=await pending();
  assert.match(item.reason,/notepad/);
  assert.equal((await fetch(base+'/api/approval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,allow:true})})).status,401);
  assert.equal(Object.hasOwn(output.args,'_wcuApproval'),false);
  const decide=()=>fetch(base+'/api/approval',{method:'POST',headers,body:JSON.stringify({id:item.id,allow:true})});
  assert.equal((await decide()).status,200);await operation;
  assert.equal((await decide()).status,410);
  const env=cfg.mcp.wincu.environment,{args,context}=verifyCall(env.WCU_OPENCODE_TOKEN,'windows_computer_use_launch_app',output.args);
  const {_wcuApproval:grant,...actual}=args;assert.deepEqual(actual,plain);assert.equal(context.turn,'turn');
  const used=new Map();
  assert.equal(consumeGrant(grant,'windows_computer_use_launch_app',plain,env.WCU_APPROVAL_SECRET,used,Date.now(),env.WCU_APPROVAL_LEDGER),true);
  assert.equal(consumeGrant(grant,'windows_computer_use_launch_app',plain,env.WCU_APPROVAL_SECRET,new Map(),Date.now(),env.WCU_APPROVAL_LEDGER),false);
  await hooks['tool.execute.after']({...input,args:output.args},{content:[]});assert.deepEqual(output.args,plain);
});

test('cancelling a waiting approval prevents a later UI allow from authorizing the call',async t=>{
  const {hooks,pending}=await fixture(t),output={args:{target:'notepad.exe',arguments:'notes.txt'}};
  const operation=hooks['tool.execute.before']({tool:'wincu_windows_computer_use_launch_app',sessionID:'session',callID:'cancel'},output);
  const rejection=assert.rejects(operation,/WCU_APPROVAL_DENIED/);
  const {base,headers,item}=await pending();
  await hooks.event({event:{type:'session.error',properties:{sessionID:'session',error:{name:'MessageAbortedError'}}}});
  await rejection;
  assert.equal((await fetch(base+'/api/approval',{method:'POST',headers,body:JSON.stringify({id:item.id,allow:true})})).status,410);
  assert.deepEqual(output.args,{target:'notepad.exe',arguments:'notes.txt'});
});

test('changed arguments and caller-supplied grants cannot bypass sensitive-call approval',async t=>{
  const {hooks,pending}=await fixture(t),input={tool:'wincu_windows_computer_use_launch_app',sessionID:'session',callID:'change'};
  await assert.rejects(hooks['tool.execute.before'](input,{args:{target:'notepad.exe',_wcuApproval:'forged'}}),/private authorization/);
  const output={args:{target:'notepad.exe',arguments:'notes.txt'}};
  const operation=hooks['tool.execute.before'](input,output),rejection=assert.rejects(operation,/arguments changed/);
  const {base,headers,item}=await pending();output.args.arguments='different.txt';
  await fetch(base+'/api/approval',{method:'POST',headers,body:JSON.stringify({id:item.id,allow:true})});await rejection;
});

test('settings preserve legacy desktop choices and select the Hyper-V relay without a duplicate slash',async t=>{
  const {home,hooks}=await fixture(t),store=new SettingsStore(home);
  let snapshot=await store.snapshot();assert.equal(snapshot.value.desktopTarget,'quiet');
  snapshot=await store.patch({desktopTarget:'background'},snapshot.revision);assert.equal(snapshot.value.desktopTarget,'quiet');
  await store.patch({desktopTarget:'hyperv',hypervVm:'Owned VM'},snapshot.revision);
  // A new service instance reads persisted settings before creating its MCP config.
  const second=await createPlugin({client:{mcp:{disconnect:async()=>{}}},directory:home},{home});t.after(()=>second.dispose());
  const config={};await second.config(config);assert.match(config.mcp.wincu.command[1],/hyperv-relay\.mjs$/);
  assert.equal(config.mcp.wincu.environment.WCU_HYPERV_VM,'Owned VM');assert.equal(config.command?.['computer-use'],undefined);
  assert.equal(browserChildEnv({WCU_OPENCODE_TOKEN:'private',WCU_APPROVAL_SECRET:'private',PUBLIC:'yes'}).WCU_OPENCODE_TOKEN,undefined);
});

test('changing the desktop while approval is pending refuses the original operation',async t=>{
  const {hooks,pending}=await fixture(t),output={args:{target:'notepad.exe',arguments:'notes.txt'}};
  const operation=hooks['tool.execute.before']({tool:'wincu_windows_computer_use_launch_app',sessionID:'session',callID:'switch'},output);
  const rejection=assert.rejects(operation,/WCU_DESKTOP_SWITCHING/),{base,headers,item}=await pending();
  const current=await (await fetch(base+'/api/settings',{headers})).json();
  assert.equal((await fetch(base+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:current.revision,patch:{desktopTarget:'hyperv',hypervVm:'Owned VM'}})})).status,200);
  await fetch(base+'/api/approval',{method:'POST',headers,body:JSON.stringify({id:item.id,allow:true})});await rejection;
  assert.equal(Object.hasOwn(output.args,'_wcuApproval'),false);
});
