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
console.log("Tab URL:", sunoTab.url);

const socket = new WebSocket(sunoTab.webSocketDebuggerUrl);
await new Promise(r => socket.on("open", r));

const results = {};
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id) results[d.id] = d.result;
});

function send(id, expr) {
  socket.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}}));
}

// Check login state
send(1, "document.cookie.includes('__client_uat')");
await new Promise(r => setTimeout(r, 400));

// Check page state / user logged in
send(2, "document.querySelector('[data-testid=\"user-avatar\"]') ? 'has-avatar' : document.querySelector('.cl-userButtonTrigger') ? 'has-clerk-btn' : 'no-user-ui'");
await new Promise(r => setTimeout(r, 400));

// Check if Create button exists and its text
send(3, "Array.from(document.querySelectorAll('button')).filter(b => /create/i.test(b.textContent)).map(b => b.textContent.trim().substring(0,40)).join(' | ')");
await new Promise(r => setTimeout(r, 400));

// Check turnstile state
send(4, "(function(){ var desc = Object.getOwnPropertyDescriptor(window,'turnstile'); return desc ? (desc.set?'setter':'no-setter') : 'no-prop'; })()");
await new Promise(r => setTimeout(r, 400));

// Check __P1_token
send(5, "window.__P1_token ? 'HAS TOKEN: '+window.__P1_token.substring(0,20) : 'no token'");
await new Promise(r => setTimeout(r, 400));

// Check __cdpTrap
send(6, "window.__cdpTrap ? 'cdpTrap='+window.__cdpTrap : 'no cdpTrap'");
await new Promise(r => setTimeout(r, 400));

// Check session validity by reading __client_uat value
send(7, "(function(){ var m = document.cookie.match(/__client_uat=([^;]+)/); return m ? 'uat='+m[1] : 'no uat'; })()");
await new Promise(r => setTimeout(r, 400));

// Check console errors / page errors by checking document readyState
send(8, "document.readyState");
await new Promise(r => setTimeout(r, 400));

// Try clicking Create and see what happens after 5s
send(9, "(function(){ var b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent)); if(b){b.click(); return 'clicked: '+b.textContent.trim().substring(0,30);} return 'no btn'; })()");
await new Promise(r => setTimeout(r, 5000));

// Check if turnstile loaded after click
send(10, "typeof window.turnstile + ' | __P1_token=' + (window.__P1_token ? window.__P1_token.substring(0,15) : 'null')");
await new Promise(r => setTimeout(r, 500));

socket.close();

console.log("1. Has __client_uat cookie:", JSON.stringify(results[1]));
console.log("2. User UI:", JSON.stringify(results[2]));
console.log("3. Create buttons:", JSON.stringify(results[3]));
console.log("4. Turnstile descriptor:", JSON.stringify(results[4]));
console.log("5. __P1_token:", JSON.stringify(results[5]));
console.log("6. __cdpTrap:", JSON.stringify(results[6]));
console.log("7. Client UAT:", JSON.stringify(results[7]));
console.log("8. readyState:", JSON.stringify(results[8]));
console.log("9. Click result:", JSON.stringify(results[9]));
console.log("10. After 5s:", JSON.stringify(results[10]));
