import { findSettings } from './cli.mjs';
import { openSettings } from './plugin.mjs';

export default { id: 'opencode-computer-use-win', async tui(api, options) {
  const run = async dialog => {
    dialog?.clear();
    try { await openSettings(await findSettings(process.cwd(), options?.home)); }
    catch (error) { api.ui.toast({ title: 'Computer Use', message: error.message, variant: 'error' }); }
  };
  // OpenCode 1.18 retains this public command adapter, including slash commands.
  const dispose = api.command?.register(() => [{ title: '电脑操控设置 / Computer Use settings', value: 'computer-use.settings', category: 'Computer Use', slash: { name: 'computer-use', aliases: ['wincu'] }, onSelect: run }]);
  if (dispose) api.lifecycle.onDispose(dispose);
} };
