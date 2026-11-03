import test from 'node:test';import assert from 'node:assert/strict';import {fitRuntime,visibleCanvas,intersects,runtimeMinZoom} from '../src/renderer/runtime-viewport';
import {runtimeColumnPositions} from '../src/renderer/runtime-column-layout';import {cardSize} from '../src/renderer/graph-geometry';import type {GraphCard,GraphLink} from '../src/renderer/graph-model';
import {runtimeLayout} from '../src/renderer/runtime-layout';
test('visible area subtracts a right drawer and bottom controls, including an overlay',()=>{
 const canvas={x:560,y:42,width:1004,height:912},drawer={x:1120,y:52,width:434,height:882},dock={x:560,y:850,width:1004,height:104},page={x:0,y:42,width:560,height:912};
 const area=visibleCanvas(canvas,[drawer,dock,page]);assert.deepEqual(area,{x:560,y:42,width:560,height:808});for(const obstacle of[drawer,dock,page])assert.equal(intersects(area,obstacle),false);
});
test('the whole expanded service and resources fit with 24px margins',()=>{
 const rects=[{x:100,y:0,width:210,height:134},{x:0,y:160,width:460,height:620},{x:0,y:852,width:210,height:134},{x:240,y:852,width:210,height:134}],area={x:0,y:0,width:560,height:1000},fit=fitRuntime(rects,[],area);assert.equal(fit.limited,false);assert.ok(fit.viewport.zoom>=runtimeMinZoom);
 for(const rect of rects){assert.ok(rect.x*fit.viewport.zoom+fit.viewport.x>=24-1e-6);assert.ok((rect.x+rect.width)*fit.viewport.zoom+fit.viewport.x<=area.width-24+1e-6);assert.ok(rect.y*fit.viewport.zoom+fit.viewport.y>=24-1e-6);assert.ok((rect.y+rect.height)*fit.viewport.zoom+fit.viewport.y<=area.height-24+1e-6);}
});
test('minimum scale preserves 12px titles and centers a readable current area',()=>{
 const all=[{x:0,y:0,width:1000,height:2200}],focus=[{x:40,y:300,width:280,height:48},{x:40,y:370,width:280,height:48}],fit=fitRuntime(all,focus,{x:0,y:0,width:360,height:600});assert.equal(fit.limited,true);assert.equal(fit.focusFits,true);assert.equal(fit.viewport.zoom,runtimeMinZoom);assert.ok(fit.viewport.zoom*14>=12);assert.ok(focus.every(rect=>rect.x*fit.viewport.zoom+fit.viewport.x>=24-1e-6));
});
test('the narrow layout retains every real node, without overlaps, inside the minimum zoom budget',()=>{
 const cards=[{id:'b',kind:'browser',canvasSize:{width:210,height:94}},{id:'s1',kind:'service',canvasSize:{width:460,height:594}},{id:'s2',kind:'service',canvasSize:{width:460,height:134}},...['r1','r2','r3','r4'].map(id=>({id,name:id,kind:'resource'}))] as GraphCard[];
 const links=[{source:'s1',target:'s2',type:'HTTP'},...['r1','r2'].map(target=>({source:'s1',target})),...['r3','r4'].map(target=>({source:'s2',target}))] as GraphLink[];
 const positions=runtimeColumnPositions(cards,links),rects=cards.map(card=>({...positions[card.id],...cardSize(card)}));assert.equal(Object.keys(positions).length,cards.length);for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)assert.equal(intersects(rects[i],rects[j]),false);assert.equal(fitRuntime(rects,[],{x:0,y:0,width:540,height:792}).limited,true);
});
test('expanding, collapsing and switching method contents keep shared backbone positions and valid paths',()=>{
 const cards=[{id:'browser',kind:'browser',canvasSize:{width:210,height:94}},{id:'alpha',kind:'service',canvasSize:{width:460,height:190}},{id:'beta',kind:'service',canvasSize:{width:460,height:134}},{id:'store',name:'store',kind:'resource'}] as GraphCard[];
 const links=[{id:'request',source:'browser',target:'alpha',type:'HTTP',label:'HTTP'},{id:'remote',source:'alpha',target:'beta',type:'HTTP',label:'HTTP'},{id:'data',source:'alpha',target:'store',type:'DATA',label:'写入'}] as GraphLink[],reserved={alpha:{width:460,height:600},beta:{width:460,height:300}};
 for(const column of[false,true]){const closed=runtimeLayout(1,cards,links,reserved,column),expanded=runtimeLayout(2,cards.map(c=>c.id==='alpha'?{...c,canvasSize:{width:460,height:520}}:c),links,reserved,column),switched=runtimeLayout(3,cards.map(c=>c.id==='alpha'?{...c,canvasSize:{width:460,height:460}}:c),links,reserved,column);
  for(const next of[expanded,switched]){assert.deepEqual(next.nodes.map(n=>[n.id,n.x,n.y]),closed.nodes.map(n=>[n.id,n.x,n.y]));assert.ok(next.edges.every(e=>e.points.length>=2&&e.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));}
 }
});
