import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import {guard,root} from './common.mjs';
guard();
for(const file of ['chrome.css','execution.css','canvas.css']){
 const target=path.join(root,'src/renderer',file),sheet=postcss.parse(await fs.readFile(target,'utf8'));
 sheet.walkRules(rule=>{
  if(file==='chrome.css'){
   const kept=rule.selectors.filter(selector=>selector.trim()&&(!/(?:\.dock-|\.replay-dock)/.test(selector)||selector.includes('menu')));
   if(!kept.length){rule.remove();return;}
   rule.selectors=kept;
  }
  if(file==='canvas.css'&&rule.selector.includes('.capability>button:last-child')){rule.remove();return;}
  if(file==='execution.css'&&/^\.(runtime-method-chain|runtime-method-row|runtime-step-bubble)(?:[\s.:>]|$)/.test(rule.selector))rule.walkDecls(decl=>{if(['background','border','border-color','border-radius','box-shadow','animation','padding'].includes(decl.prop))decl.remove();});
 });
 await fs.writeFile(target,sheet.toString());
}
