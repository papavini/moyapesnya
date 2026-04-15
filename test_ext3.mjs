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

socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  console.log("MSG id=" + d.id + ":", JSON.stringify(d.result || d.error).substring(0, 300));
});

// Try with explicit IPv4
socket.send(JSON.stringify({
  id: 1,
  method: "Runtime.evaluate",
  params: {
    expression: `
      window._r1 = 'pending';
      fetch('http://127.0.0.1:3099/health')
        .then(r => { window._r1 = 'ok:' + r.status; })
        .catch(e => { window._r1 = 'ERR:' + e.message + '|' + e.name; });
      'fired'
    `
  }
}));

await new Promise(r => setTimeout(r, 8000));

socket.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "window._r1" } }));
await new Promise(r => setTimeout(r, 500));

// Also check what extensions are loaded
socket.send(JSON.stringify({
  id: 3,
  method: "Runtime.evaluate",
  params: {
    expression: `typeof chrome !== 'undefined' ? chrome.runtime.id || 'no-id' : 'no-chrome'`
  }
}));
await new Promise(r => setTimeout(r, 500));

// Enable Network and check for blocked requests
socket.send(JSON.stringify({ id: 4, method: "Network.enable", params: {} }));
await new Promise(r => setTimeout(r, 200));

socket.close();
console.log("Done");
