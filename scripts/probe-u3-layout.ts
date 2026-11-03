import fs from 'node:fs';
import {presentGraph} from '../src/renderer/adaptive-look';
import {dependencyPositions} from '../src/renderer/dependency-layout';
import {routeSnapshot} from '../src/renderer/graph-geometry';
import {dependencyMetrics} from '../corpus/dependency-metrics';
const base='.tmp/verification-u3-adaptive-look/corpus-before';
const all=fs.readdirSync(base).filter(p=>fs.existsSync(`${base}/${p}/graphs.json`));
for(const id of all){
 const index=JSON.parse(fs.readFileSync(`${base}/${id}/model.json`,'utf8')),graphs=JSON.parse(fs.readFileSync(`${base}/${id}/graphs.json`,'utf8')),graph=presentGraph(graphs.defaultDependencies,index);
 for(const ordering of ['original','barycenter']){
  const initialX=Object.fromEntries(graphs.defaultDependencyLayout.snapshot.nodes.map((n:any)=>[n.id,n.x]));
  const positions=ordering==='original'?dependencyPositions(graph.cards,graph.links,{},initialX):dependencyPositions(graph.cards,graph.links);
  const snapshot=routeSnapshot(1,graph.cards,graph.links,positions),metrics=dependencyMetrics(index,graph,snapshot);
  console.log(id,ordering,JSON.stringify({crossings:metrics.crossings}));
 }
}
