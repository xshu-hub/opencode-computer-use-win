const args = process.argv.slice(2);
const shell = args.find(arg => arg.startsWith('--powershell='));
if (shell) process.env.WINDOWS_CU_POWERSHELL = shell.slice('--powershell='.length);
process.env.WCU_TEST_SUITES = args.filter(arg => !arg.startsWith('--powershell=')).join(',');
if (!process.env.WCU_TEST_SUITES) throw Error('Pass one or more reference suite names');
await import('./run-tests.mjs');
