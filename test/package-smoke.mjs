import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpTestClient } from './mcp-test-client.mjs';

const root=path.resolve(process.argv[2]??'.work/package-consumer/node_modules/opencode-computer-use-win');
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const [{default:plugin},{default:tui},{SettingsStore},{createSettingsServer}]=await Promise.all([load('opencode/plugin.mjs'),load('opencode/tui.mjs'),load('opencode/store.mjs'),load('opencode/settings-server.mjs')]);
assert.equal(typeof plugin.server,'function'); assert.equal(typeof tui.tui,'function');
const temp=await mkdtemp(path.join(os.tmpdir(),'opencode-package-smoke-'));
const server=await createSettingsServer({store:new SettingsStore(temp),onChange:()=>{},getStatus:()=>({active:false})});
const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')]);
try{
  const base=new URL(server.url).origin;
  assert.equal((await fetch(base)).status,200);
  assert.ok((await (await fetch(base+'/settings.js')).text()).length>100000);
  assert.ok((await readFile(path.join(root,'dist/THIRD_PARTY_LICENSES.txt'),'utf8')).includes('Permission is hereby granted'));
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const info=await client.init();assert.equal(info.serverInfo.version,manifest.version);
  const catalog=await client.request('tools/list');assert.equal(catalog.tools.length,26);
  const result=await client.call('windows_computer_use_tools',{operation:'list'});assert.notEqual(result.isError,true);
  console.log('Installed tarball: plugin/TUI imports, bundled settings assets, licenses and 26-tool MCP catalog passed');
}finally{client.close();await server.close();await rm(temp,{recursive:true,force:true});}
