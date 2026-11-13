import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const executable = process.env.OPENCODE_TEST_EXE;
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn, timeout=60000) { const start=Date.now(); let error; while(Date.now()-start<timeout){ try{const value=await fn();if(value)return value;}catch(e){error=e;} await pause(100); } throw error??Error('Timed out waiting'); }
const freePort = async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};

test('real OpenCode V1 loads plugin, calls managed MCP, refreshes lazy tools and cancels work', {skip:!executable,timeout:180000}, async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'opencode-host-test-'));
  const project=path.join(home,'project'), data=path.join(home,'cu');await mkdir(project);
  const captured=[];
  const model=http.createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html><title>Owned OpenCode fixture</title><body><h1>Computer Use image fixture</h1><p>This page belongs to the isolated test.</p></body></html>');return;}
    if(!req.url.endsWith('/chat/completions')){res.writeHead(404);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);captured.push(body);
    const last=body.messages.at(-1), content=typeof last.content==='string'?last.content:JSON.stringify(last.content);
    const already=last.role==='tool';
    const browserTask=body.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('__BROWSER__'));
    const screenshotCalled=body.messages.some(m=>m.role==='assistant'&&m.tool_calls?.some(c=>c.function?.name==='wincu_windows_computer_use_screenshot'));
    let action='wait',args={milliseconds:1};
    if(content.includes('__LONG__'))args={milliseconds:10000};
    if(content.includes('__ENABLE__')){action='tools';args={operation:'enable',names:['wait']};}
    let answer=!body.tools?.length?'Summary':already?'Completed':undefined;
    if(browserTask&&body.tools?.length){
      if(screenshotCalled)answer='Completed';
      else if(already){
        let tab;const text=typeof last.content==='string'?last.content:(last.content??[]).map(p=>p.text??'').join('\n');
        for(const line of text.split('\n'))try{tab=JSON.parse(line).opened?.id??tab;}catch{}
        if(tab){action='screenshot';args={browserTab:tab,maxWidth:640};answer=undefined;}
      }else{action='set_value';args={elementId:'new-tab',value:`http://127.0.0.1:${model.address().port}/fixture`};answer=undefined;}
    }
    const tool='wincu_windows_computer_use_'+action;
    if(body.stream){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'chat-test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
      send({role:'assistant'});
      if(answer){send({content:answer});send({},'stop');}
      else{send({tool_calls:[{index:0,id:'call_'+captured.length,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]});send({},'tool_calls');}
      res.end('data: [DONE]\n\n');
    }else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'chat-test',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'Summary'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const root=fileURLToPath(new URL('../',import.meta.url));
  const cfg = {
    plugin: [[pathToFileURL(path.join(root,'opencode/plugin.mjs')).href, {home:data,locale:'zh',environment:{NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_BROWSER_HEADLESS:'1',WCU_BROWSER_APP:'edge'}}]],
    model:'mock/test', small_model:'mock/test', permission:{'*':'allow'},
    provider: { mock: {
      npm:'@ai-sdk/openai-compatible', name:'Mock',
      options:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'local-test'},
      models:{test:{name:'test',limit:{context:32000,output:2000},modalities:{input:['text','image'],output:['text']}}}
    } }
  };
  await writeFile(path.join(project,'opencode.json'),JSON.stringify(cfg));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const host=spawn(executable,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:project,windowsHide:true,env:{...process.env,XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),XDG_CACHE_HOME:path.join(home,'cache'),XDG_STATE_HOME:path.join(home,'state'),OPENCODE_CONFIG_DIR:path.join(home,'config-dir'),OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_SERVER_PASSWORD:'',OPENCODE_SERVER_USERNAME:'',OPENCODE_CONFIG: path.join(project,'opencode.json')}});
  let output='';host.stdout.on('data',b=>output+=b);host.stderr.on('data',b=>output+=b);
  t.after(async()=>{
    if(process.platform==='win32'&&host.exitCode===null)await new Promise(r=>execFile('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true},()=>r()));
    else host.kill();
    model.closeAllConnections();await new Promise(r=>model.close(r));
    await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  });
  const api=async(url,body)=>{const response=await fetch(base+url+(url.includes('?')?'&':'?')+'directory='+encodeURIComponent(project),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const text=await response.text();if(!response.ok)throw Error(response.status+': '+text.slice(0,1500));return JSON.parse(text);};
  try{
    await until(()=>fetch(base+'/global/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.ok),60000);
    console.log('Host health ready');
    const mcp=await api('/mcp');assert.equal(mcp.wincu?.status,'connected',JSON.stringify(mcp));
    console.log('Managed MCP connected');
    const session=await api('/session',{});
    const first=await api('/session/'+session.id+'/message',{parts:[{type:'text',text:'__WAIT__'}],model:{providerID:'mock',modelID:'test'}});
    assert.ok(first.parts.some(p=>p.type==='text'&&p.text.includes('Completed')),JSON.stringify(first));
    const messages=await api('/session/'+session.id+'/message');
    const tool=messages.flatMap(m=>m.parts).find(p=>p.type==='tool');assert.equal(tool.state.status,'completed',JSON.stringify(tool));
    assert.match(tool.state.output,/milliseconds/);assert.doesNotMatch(tool.state.output,/CONTEXT_REQUIRED|SERIES_MISMATCH/);
    assert.equal(tool.state.input.__opencodeComputerUse,undefined,'Private transport context must not reach conversation history');
    const instances=await readdir(path.join(data,'instances'));const instance=JSON.parse(await readFile(path.join(data,'instances',instances[0])));
    const settingsURL=new URL(instance.url),headers={Authorization:'Bearer '+settingsURL.hash.slice(1),'Content-Type':'application/json'};
    const settings=async()=>fetch(settingsURL.origin+'/api/settings',{headers}).then(r=>r.json());
    const saved=await settings();
    const changed=await fetch(settingsURL.origin+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:saved.revision,patch:{toolPreset:'lazy'}})});assert.equal(changed.status,200);
    await until(async()=>{const s=await settings();if(s.status.reloadError)throw Error(s.status.reloadError);return !s.status.reloadPending;});
    const lazy=await api('/session',{});const offset=captured.length;
    await api('/session/'+lazy.id+'/message',{parts:[{type:'text',text:'__ENABLE__'}],model:{providerID:'mock',modelID:'test'}});
    assert.ok(captured.slice(offset).some(r=>r.tools?.some(t=>t.function.name==='wincu_windows_computer_use_wait')),'Enabled tool must reach the next model request: '+JSON.stringify(captured.slice(offset).map(r=>({tools:r.tools?.map(t=>t.function.name),last:r.messages.at(-1)}))));
    const long=await api('/session',{});
    const pending=api('/session/'+long.id+'/message',{parts:[{type:'text',text:'__LONG__'}],model:{providerID:'mock',modelID:'test'}});
    await until(async()=>{const s=await settings();return s.status.pending>0;});
    const competitor=await api('/session',{});
    await api('/session/'+competitor.id+'/message',{parts:[{type:'text',text:'__WAIT__'}],model:{providerID:'mock',modelID:'test'}});
    const competingMessages=await api('/session/'+competitor.id+'/message');
    assert.ok(competingMessages.flatMap(m=>m.parts).some(p=>p.type==='tool'&&JSON.stringify(p.state).includes('COMPUTER_USE_BUSY')),'Another conversation must not acquire the active desktop');
    await api('/session/'+long.id+'/abort',{});await pending;
    await until(async()=>{const s=await settings();return s.status.pending===0&&!s.status.active;});
    const continued=await api('/session/'+long.id+'/message',{parts:[{type:'text',text:'__WAIT__'}],model:{providerID:'mock',modelID:'test'}});
    assert.ok(continued.parts.some(p=>p.type==='text'&&p.text.includes('Completed')));
    const latest=await settings();
    await fetch(settingsURL.origin+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:latest.revision,patch:{toolPreset:'full'}})});
    await until(async()=>!(await settings()).status.reloadPending);
    const browserSession=await api('/session',{}),imageOffset=captured.length;
    await api('/session/'+browserSession.id+'/message',{parts:[{type:'text',text:'__BROWSER__'}],model:{providerID:'mock',modelID:'test'}});
    assert.ok(captured.slice(imageOffset).some(r=>JSON.stringify(r.messages).includes('data:image/png;base64,')),'A fixture screenshot must reach the model as an image');
    const summarySettings=await settings();
    await fetch(settingsURL.origin+'/api/settings',{method:'PATCH',headers,body:JSON.stringify({revision:summarySettings.revision,patch:{progressOverlayMode:'summary'}})});
    const summarySession=await api('/session',{}),summaryOffset=captured.length;
    await api('/session/'+summarySession.id+'/message',{parts:[{type:'text',text:'__WAIT__'}],model:{providerID:'mock',modelID:'test'}});
    await until(async()=>{const state=await settings();return state.status.progress?.summaryStatus==='ready';},30000);
    const summaryRequest=captured.slice(summaryOffset).find(r=>JSON.stringify(r.messages).includes('你为屏幕角落的小浮窗'));
    assert.ok(summaryRequest,'The optional progress summary uses the active model');
    assert.equal(summaryRequest.tools?.length??0,0,'The progress model must have no callable tools');
    assert.ok(!JSON.stringify(summaryRequest.messages).includes('__WAIT__'),'The summary must not include the original user prompt');
    console.log('Real OpenCode: managed MCP, signed calls, lazy refresh, cross-session exclusion, cancellation, recovery, browser images and isolated AI summaries passed');
  }catch(error){throw Error(error.message+'\nHost diagnostics:\n'+output.slice(-14000));}
});
