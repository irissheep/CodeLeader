import path from 'node:path';
import {guard,root,run} from './common.mjs';
guard();
await run('pwsh.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/show-u3-window.ps1')]);
