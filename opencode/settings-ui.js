import React from 'react';
import { createRoot } from 'react-dom/client';
import { createComponents } from '../dist/components.js';

const h = React.createElement;
const token = location.hash.slice(1) || sessionStorage.getItem('opencode-cu-token') || '';
if (token) sessionStorage.setItem('opencode-cu-token', token);
history.replaceState(null, '', location.pathname);
let language = localStorage.getItem('opencode-cu-language') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
const t = key => dictionaries[language]?.[key] ?? dictionaries.en[key] ?? key;
document.documentElement.lang = language;
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json(); if (!response.ok) throw Error(body.error); return body;
};
const { SettingsCard, dictionaries, compareVersions } = createComponents(React, {fetch:(url,options={})=>{
  if (new URL(url,location.origin).origin !== location.origin) throw Error('Unsupported settings request');
  return fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});
}});
let snapshot = { status: 'loading', writable: false }, listeners = new Set();
const publish = value => { snapshot = { ...value, runtime: value.status, status: 'ready', writable: true }; for (const listener of listeners) listener(); };
const scope = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
const savePatch = async patch => publish(await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ patch, revision: snapshot.revision }) }));
let initializedLanguage = false;
function App() {
  const state = React.useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const [failure, setFailure] = React.useState('');
  const [update,setUpdate] = React.useState(null), [checking,setChecking] = React.useState(false);
  const decide = async (id,allow) => {try { await request('/api/approval',{method:'POST',body:JSON.stringify({id,allow})}); publish(await request('/api/settings')); } catch(error) { setFailure(error.message); }};
  React.useEffect(() => {
    const refresh = () => request('/api/settings').then(value => {
      if (!initializedLanguage && value.status?.locale) { language = String(value.status.locale).startsWith('zh') ? 'zh' : 'en'; document.documentElement.lang = language; initializedLanguage = true; }
      publish(value);
    }).catch(error => setFailure(error.message));
    refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer);
  }, []);
  return h('main', null,
    h('header', { className: 'host-header' }, h('div', null, h('strong', null, 'OpenCode'), h('span', null, language === 'zh' ? '电脑操控' : 'Computer Use')),
      h('div', null, h('span', { role: 'status', 'data-runtime-status': true }, state.runtime?.active ? (language === 'zh' ? '正在操作' : 'Running') : state.runtime?.reloadPending ? (language === 'zh' ? '等待重载' : 'Reload pending') : (language === 'zh' ? '就绪' : 'Ready')),
        h('button', { onClick: async () => { const next = language === 'zh' ? 'en' : 'zh'; try { await request('/api/locale', { method:'POST', body:JSON.stringify({locale:next}) }); localStorage.setItem('opencode-cu-language', next); location.reload(); } catch (error) { setFailure(error.message); } } }, language === 'zh' ? 'English' : '中文'))),
    failure && h('p', { role: 'alert' }, failure),
    h('div',{className:'host-actions',style:{display:'flex',gap:8,flexWrap:'wrap'}},
      h('button',{disabled:checking,onClick:async()=>{setChecking(true);try{setUpdate(await request('/api/update'));}catch(error){setFailure(error.message);}finally{setChecking(false);}}},language==='zh'?'检查更新':'Check for updates'),
      h('button',{onClick:async()=>{try{const response=await fetch('/api/diagnostics',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error((await response.json()).error);const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='opencode-computer-use-diagnostics.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setFailure(error.message);}}},language==='zh'?'下载诊断':'Download diagnostics')),
    update && h('p',{'data-update-result':true},language==='zh'?`当前 v${update.version}，npm 最新 v${update.latest}。`:`Current v${update.version}; latest on npm v${update.latest}.`,compareVersions(update.latest,update.version)>0&&h('span',null,language==='zh'?' 升级后重启 OpenCode；若配置固定了版本，同时更新包名后的版本号。':' Restart OpenCode after updating; also update any pinned package version in your configuration.')),
    (state.runtime?.approvals??[]).map(item=>h('section',{key:item.id,role:'alertdialog','aria-label':language==='zh'?'操作授权':'Operation approval','data-approval-id':item.id},
      h('h3',null,language==='zh'?'需要你的授权':'Your approval is required'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},item.reason),
      h('button',{onClick:()=>decide(item.id,true)},language==='zh'?'允许这一次':'Allow once'),
      h('button',{onClick:()=>decide(item.id,false)},language==='zh'?'拒绝':'Decline'))),
    state.status === 'loading' ? h('p', null, 'Loading…') : h(SettingsCard, { scope, t, savePatch, as: 'section', idPrefix: 'opencode-cu' }),
    state.runtime?.reloadError && h('p', { role: 'alert' }, state.runtime.reloadError));
}
createRoot(document.getElementById('root')).render(h(App));
