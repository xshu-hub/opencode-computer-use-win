// Pass the actual OpenCode executable, not the npm PowerShell shim.
if (!process.argv[2]) throw Error('Usage: node test/run-opencode-host.mjs <path-to-opencode.exe>');
process.env.OPENCODE_TEST_EXE = process.argv[2];
await import('./opencode-host.test.mjs');
