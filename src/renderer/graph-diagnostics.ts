/** Passive, opt-in counters for the repeatable graph verification script. */
export function graphCommit(detail:Record<string,unknown>){
 const probe=(window as Window&{__graphProbe?:{commit:(detail:Record<string,unknown>)=>void}}).__graphProbe;probe?.commit(detail);
}
