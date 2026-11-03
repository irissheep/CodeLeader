// Shared by interface rows and their transparent graph anchors.
import tokens from '../shared/ui-tokens';
export const interfaceRowHeight=parseFloat(tokens.layout.rowHeight);
export const inlineRowHeight=tokens.continuity.inlineRowHeight;
export const inlineHeadingHeight=tokens.continuity.inlineHeadingHeight;
export const inlinePanelHeight=(count:number)=>inlineHeadingHeight+count*inlineRowHeight;
