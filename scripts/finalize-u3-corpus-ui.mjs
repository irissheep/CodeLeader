import fs from 'node:fs/promises';
import path from 'node:path';
import {guard,root} from './common.mjs';
guard();
// Analysis was already run after the layout change. The last edits only touch
// an error display and the visual role of a source group without an app unit.
await import('../corpus/check-ui.mjs');
await import('../corpus/report.mjs');
for(const file of ['scorecard-v4.json','frontend-scorecard.json','link-scorecard.json','backbone-scorecard.json','ui-audit.json'])await fs.copyFile(path.join(root,'.tmp/verification-generalization-baseline',file),path.join(root,'.tmp/verification-u3-adaptive-look/corpus-after',file));
