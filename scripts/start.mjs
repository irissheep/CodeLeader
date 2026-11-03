import { guard, run } from './common.mjs';
import electron from 'electron';
guard();
await import('./build.mjs');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
await run(electron, ['.', '--user-data-dir=' + process.env.CODELEADER_ROOT + '/.appdata/session'], { env, windowsHide: false });
