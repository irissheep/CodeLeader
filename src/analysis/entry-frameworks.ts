import type {StructureResult} from './structure';
import {extractPythonEntries} from './python-http';
import {extractSpringEntries} from './spring-mappings';
export function extractEntries(result:StructureResult){
 result.index.entries=[...[...result.syntax.values()].flatMap(facts=>facts.mains),...extractSpringEntries(result)];
 extractPythonEntries(result);
}
