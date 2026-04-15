/**
 * Читаем IndexedDB (localforage) — ищем passkey/P1_ токен
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

const tabs = await new Promise((resolve, reject) => {
  http.get("http://localhost:9222/json", (res) => {
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const sunoTab = tabs.find(t => t.url && t.url.includes("suno.com/create"));
if (!sunoTab) { console.log("No suno tab!"); process.exit(1); }

const socket = new WebSocket(sunoTab.webSocketDebuggerUrl);
await new Promise(r => socket.on("open", r));
const results = {};
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id) results[d.id] = d;
});

function evalAwait(id, expr) {
  socket.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: true}}));
}

// Read all localforage keys and values
evalAwait(1, `(async function(){
  const dbs = await indexedDB.databases();
  const result = {};
  for (const dbInfo of dbs) {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open(dbInfo.name, dbInfo.version);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const stores = Array.from(db.objectStoreNames);
    result[dbInfo.name] = {};
    for (const store of stores) {
      const tx = db.transaction(store, 'readonly');
      const st = tx.objectStore(store);
      const keys = await new Promise((res) => {
        const req = st.getAllKeys();
        req.onsuccess = () => res(req.result);
        req.onerror = () => res([]);
      });
      const vals = {};
      for (const key of keys) {
        const val = await new Promise((res) => {
          const req = st.get(key);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        // Only include if potentially relevant
        const strVal = typeof val === 'string' ? val : JSON.stringify(val);
        if (strVal && (strVal.includes('P1_') || strVal.includes('passkey') || strVal.includes('turnstile') || key.toString().includes('passkey') || key.toString().includes('token'))) {
          vals[String(key)] = strVal.substring(0, 100);
        }
      }
      if (Object.keys(vals).length > 0) {
        result[dbInfo.name][store] = vals;
      }
    }
    db.close();
  }
  return JSON.stringify(result);
})()`);
await new Promise(r => setTimeout(r, 5000));

// Also try reading all keys to see what's stored
evalAwait(2, `(async function(){
  const dbs = await indexedDB.databases();
  const result = {};
  for (const dbInfo of dbs) {
    try {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(dbInfo.name);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const stores = Array.from(db.objectStoreNames);
      result[dbInfo.name] = { stores, version: db.version };
      db.close();
    } catch(e) { result[dbInfo.name] = { error: e.message }; }
  }
  return JSON.stringify(result);
})()`);
await new Promise(r => setTimeout(r, 3000));

socket.close();

const getVal = (id) => {
  const r = results[id];
  return r?.result?.result?.value || r?.result?.result?.description || JSON.stringify(r?.result?.result);
};

console.log("IDB passkey search:", getVal(1));
console.log("IDB structure:", getVal(2));
