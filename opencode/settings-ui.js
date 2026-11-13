import React from 'react';
import { createRoot } from 'react-dom/client';
import { createComponents } from '../dist/components.js';

const h = React.createElement;
const { SettingsCard, dictionaries } = createComponents(React);
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
let snapshot = { status: 'loading', writable: false }, listeners = new Set();
const publish = value => { snapshot = { ...value, runtime: value.status, status: 'ready', writable: true }; for (const listener of listeners) listener(); };
const scope = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
const savePatch = async patch => publish(await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ patch, revision: snapshot.revision }) }));
let initializedLanguage = false;
function App() {
  const state = React.useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const [failure, setFailure] = React.useState('');
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
    state.status === 'loading' ? h('p', null, 'Loading…') : h(SettingsCard, { scope, t, savePatch, as: 'section', idPrefix: 'opencode-cu' }),
    state.runtime?.reloadError && h('p', { role: 'alert' }, state.runtime.reloadError));
}
createRoot(document.getElementById('root')).render(h(App));
