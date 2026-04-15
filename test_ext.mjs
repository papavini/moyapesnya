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
console.log("Tab:", sunoTab.url);

const socket = new WebSocket(sunoTab.webSocketDebuggerUrl);
await new Promise(r => socket.on("open", r));

const results = {};
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id) results[d.id] = d.result || d.error;
});

function send(id, expr, awaitPromise) {
  socket.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: !!awaitPromise}}));
}

// Test fetch to /token endpoint (correct path)
const fetchExpr = `fetch('http://localhost:3099/token', {method:'POST',body:'P1_test_only_ignore',headers:{'Content-Type':'text/plain'}}).then(r=>r.status+':'+r.ok).catch(e=>'ERR:'+e.message)`;
send(1, fetchExpr, true);
await new Promise(r => setTimeout(r, 5000));

// Check if Object.defineProperty trap is active
const descExpr = `(function(){ var desc = Object.getOwnPropertyDescriptor(window, 'turnstile'); return desc ? (desc.set ? 'has-setter' : 'no-setter') + '/' + (desc.get ? 'has-getter' : 'no-getter') : 'no-descriptor'; })()`;
send(2, descExpr);
await new Promise(r => setTimeout(r, 500));

// Check pkTimer from refresh-passkey.js
send(3, `window.__pkTimer ? 'pkTimer:'+window.__pkTimer : 'no-pkTimer'`);
await new Promise(r => setTimeout(r, 500));

socket.close();

console.log("Fetch to /token:", JSON.stringify(results[1]));
console.log("turnstile descriptor:", JSON.stringify(results[2]));
console.log("__pkTimer:", JSON.stringify(results[3]));
