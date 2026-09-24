/** Minimal asynchronous IndexedDB-shaped storage fixture, not a browser IDB.
 * It covers this cache's open/get/put/transaction-completion/error paths only.
 */
export function idbFixture() {
  const databases=new Map(),calls=[];
  const api={calls,databases,failWrites:false,open(name,version){
    const req={};calls.push({method:'open',name,version});
    setTimeout(()=>{
      const fresh=!databases.has(name);if(fresh)databases.set(name,new Map());
      const records=databases.get(name);
      const db={objectStoreNames:{contains:n=>!fresh&&n==='profiles'},createObjectStore:()=>{},close(){calls.push({method:'close'});},
        transaction(store,mode){
          if(store!=='profiles')throw Error('Unexpected store');
          calls.push({method:'transaction',store,mode});
          const tx={error:null,objectStore(){return {
            get(key){const read={};setTimeout(()=>{read.result=structuredClone(records.get(key));read.onsuccess?.();setTimeout(()=>{if(tx.error)tx.onabort?.();else tx.oncomplete?.();},0);},0);return read;},
            put(record){if(api.failWrites){tx.error=new Error('quota fixture');return;}records.set(record.pubkey,structuredClone(record));calls.push({method:'put',kind:record.event.kind});}
          };}};return tx;
        }};
      req.result=db;if(fresh)req.onupgradeneeded?.();req.onsuccess?.();
    },0);return req;
  }};return api;
}
