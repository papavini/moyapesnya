/**
 * Инспектируем Service Worker через CDP — ищем кэшированный passkey токен
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

async function getAllTargets(port) {
  const res = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json/list`, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
  return res;
}

async function connectAndEval(wsUrl, expressions) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on("open", r));
  const results = {};
  ws.on("message", (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id) results[d.id] = d;
  });
  let id = 0;
  for (const [key, expr] of Object.entries(expressions)) {
    id++;
    ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: true}}));
    await new Promise(r => setTimeout(r, 800));
    results[key] = results[id];
  }
  ws.close();
  return results;
}

// Find SW target in bot Chromium
const targets = await getAllTargets(9222);
console.log("All targets:");
targets.forEach(t => console.log(`  [${t.type}] ${t.url?.substring(0,70)}`));

const swTarget = targets.find(t => t.type === "service_worker" && t.url?.includes("suno.com"));
if (!swTarget) {
  console.log("No suno SW target found!");
  process.exit(1);
}

console.log("\nSW target:", swTarget.url);
console.log("SW webSocketDebuggerUrl:", swTarget.webSocketDebuggerUrl);

// Connect to service worker via CDP
const swResults = await connectAndEval(swTarget.webSocketDebuggerUrl, {
  self_type: "typeof self",
  location: "self.location.href",
  passkey_in_global: "typeof self.__passkey || typeof self.passkey || typeof self.PASSKEY_TOKEN || 'undefined'",
  // Check IndexedDB / caches
  cache_keys: "caches.keys().then(k => JSON.stringify(k))",
  // Look for any global vars with P1_
  globals: "(function(){ var found=[]; for(var k in self){ var v=self[k]; if(typeof v==='string'&&v.indexOf('P1_')===0) found.push(k+'='+v.substring(0,20)); } return found.join(', ')||'none'; })()",
  // Check if there's a passkey stored somewhere
  idb_check: "(async function(){ try { return 'idb available: '+typeof indexedDB; } catch(e){ return 'no idb: '+e.message; } })()",
});

console.log("\n=== Service Worker State ===");
Object.entries(swResults).forEach(([k, v]) => {
  if (v && v.result) {
    const val = v.result?.result?.value || v.result?.result?.description || JSON.stringify(v.result?.result);
    console.log(`${k}: ${val}`);
  }
});

// Also try with page CDP — check localStorage/sessionStorage for passkey
const pageTarget = targets.find(t => t.type === "page" && t.url?.includes("suno.com/create"));
if (pageTarget) {
  console.log("\n=== Page Storage ===");
  const pageResults = await connectAndEval(pageTarget.webSocketDebuggerUrl, {
    localStorage: "(function(){ var found=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); var v=localStorage.getItem(k); if(v&&v.indexOf('P1_')===0) found.push(k); } return JSON.stringify(found)||'none'; })()",
    sessionStorage: "(function(){ var found=[]; for(var i=0;i<sessionStorage.length;i++){ var k=sessionStorage.key(i); var v=sessionStorage.getItem(k); if(v&&v.indexOf('P1_')===0) found.push(k); } return JSON.stringify(found)||'none'; })()",
    // Check indexedDB for passkey
    idb_passkey: "(async function(){ try { const dbs = await indexedDB.databases(); return JSON.stringify(dbs.map(d=>d.name)); } catch(e){ return 'err:'+e.message; } })()",
  });
  Object.entries(pageResults).forEach(([k, v]) => {
    if (v && v.result) {
      const val = v.result?.result?.value || JSON.stringify(v.result?.result);
      console.log(`${k}: ${val}`);
    }
  });
}

// Try RDP Chromium (9223) — might have fresh passkey
console.log("\n=== RDP Chromium (9223) ===");
try {
  const rdpTargets = await getAllTargets(9223);
  const rdpSunoTab = rdpTargets.find(t => t.url?.includes("suno.com") && t.type === "page");
  if (rdpSunoTab) {
    console.log("RDP suno tab:", rdpSunoTab.url);
    const rdpResults = await connectAndEval(rdpSunoTab.webSocketDebuggerUrl, {
      p1_token: "window.__P1_token ? 'HAS:'+window.__P1_token.substring(0,20) : 'none'",
      uat: "document.cookie.match(/__client_uat=([^;]+)/)?.[1] || 'no-uat'",
    });
    Object.entries(rdpResults).forEach(([k, v]) => {
      if (v && v.result) {
        console.log(`RDP ${k}: ${v.result?.result?.value}`);
      }
    });
  }
} catch(e) {
  console.log("RDP not accessible:", e.message);
}
