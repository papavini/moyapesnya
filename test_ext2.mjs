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

const messages = [];
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  messages.push(d);
  console.log("MSG:", JSON.stringify(d).substring(0, 200));
});

// Simple fire-and-forget fetch with explicit error capture stored in window
socket.send(JSON.stringify({
  id: 1,
  method: "Runtime.evaluate",
  params: {
    expression: `
      window._fetchResult = 'pending';
      fetch('http://localhost:3099/health')
        .then(r => { window._fetchResult = 'ok:' + r.status; })
        .catch(e => { window._fetchResult = 'ERR:' + e.message + '|' + e.name; });
      'fetch fired'
    `
  }
}));

await new Promise(r => setTimeout(r, 3000));

// Now read result
socket.send(JSON.stringify({
  id: 2,
  method: "Runtime.evaluate",
  params: { expression: "window._fetchResult" }
}));

await new Promise(r => setTimeout(r, 1000));

socket.close();
console.log("Done. Messages count:", messages.length);
