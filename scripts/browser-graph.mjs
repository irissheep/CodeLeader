export async function clickGraphEdge(page,edge){
 const point=await edge.locator('.react-flow__edge-path').evaluate(path=>{
  const matrix=path.getScreenCTM(),length=path.getTotalLength(),id=path.closest('.react-flow__edge').dataset.id;
  for(const ratio of [.5,.3,.7,.15,.85,.4,.6,.1,.9]){const world=path.getPointAtLength(length*ratio),point=new DOMPoint(world.x,world.y).matrixTransform(matrix),hit=document.elementFromPoint(point.x,point.y);if(hit?.closest('.react-flow__edge')?.dataset.id===id)return{x:point.x,y:point.y};}
 });
 if(!point)throw new Error('目标箭头没有可点击的可见片段，请先聚焦或展开当前范围。');
 await page.mouse.click(point.x,point.y);
}
