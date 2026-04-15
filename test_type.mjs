/**
 * Симулируем реальный ввод через keyboard events чтобы React обновил state
 * и кнопка Create стала активной
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

// Use RDP Chromium (9223) — real browser with user session
const rdpTabs = await new Promise((resolve, reject) => {
  http.get("http://localhost:9223/json", (res) => {
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
}).catch(() => null);

let usePort = 9222;
let sunoTab = null;

// Try RDP Chromium first
if (rdpTabs) {
  const rdpSuno = rdpTabs.find(t => t.url && t.url.includes("suno.com") && t.type === "page");
  if (rdpSuno) {
    console.log("Using RDP Chromium (9223):", rdpSuno.url);
    sunoTab = rdpSuno;
    usePort = 9223;
  }
}

// Fallback to bot Chromium
if (!sunoTab) {
  sunoTab = tabs.find(t => t.url && t.url.includes("suno.com/create"));
  console.log("Using bot Chromium (9222):", sunoTab?.url);
}

if (!sunoTab) { console.log("No suno tab!"); process.exit(1); }

const socket = new WebSocket(sunoTab.webSocketDebuggerUrl);
await new Promise(r => socket.on("open", r));

const allMsgs = [];
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  allMsgs.push(d);
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("suno") || url.includes("studio") || url.includes("turnstile")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    console.log(`[PAUSED] ${d.params?.request?.method} ${url.substring(0,100)}`);
    const body = d.params?.request?.postData;
    if (body) {
      console.log(`[BODY] ${body.substring(0,300)}`);
      try {
        const parsed = JSON.parse(body);
        if (parsed.token && parsed.token.startsWith('P1_')) {
          console.log(`\n*** TOKEN FOUND: ${parsed.token.substring(0,30)}... ***\n`);
        }
      } catch(e) {}
    }
    // Fail the request to avoid generating
    socket.send(JSON.stringify({
      id: 9900,
      method: "Fetch.failRequest",
      params: { requestId: d.params.requestId, errorReason: "Aborted" }
    }));
  }
});

function send(id, method, params={}) { socket.send(JSON.stringify({id, method, params})); }
function eval_(id, expr) { send(id, "Runtime.evaluate", {expression: expr}); }
function getR(id) {
  const m = allMsgs.find(m => m.id === id);
  return m?.result?.result?.value ?? JSON.stringify(m?.result?.result?.description ?? m?.result?.result);
}

// Navigate to /create if not there
send(100, "Page.navigate", {url: "https://suno.com/create"});
await new Promise(r => setTimeout(r, 5000));

// Enable monitoring
send(1, "Network.enable", {});
send(2, "Fetch.enable", {
  patterns: [{urlPattern: "*/generate/v2-web/*", requestStage: "Request"}]
});
await new Promise(r => setTimeout(r, 300));

// Check what mode we're in and what inputs exist
eval_(3, `(function(){
  var btns = Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim().substring(0,20));
  var inputs = Array.from(document.querySelectorAll('input,textarea')).map(el=>(el.tagName+':'+((el.placeholder||el.name||'?').substring(0,25))));
  return 'btns: '+btns.join('|')+' | inputs: '+inputs.join('|');
})()`);
await new Promise(r => setTimeout(r, 500));

// Click "Custom Mode" button if available, or look for a tab/toggle
eval_(4, `(function(){
  // Look for mode toggle buttons
  var btns = Array.from(document.querySelectorAll('button,div[role=tab],div[role=button]'));
  var custom = btns.find(b => /custom/i.test(b.textContent) && !/create/i.test(b.textContent));
  if (custom) { custom.click(); return 'switched to custom: '+custom.textContent.substring(0,30); }
  return 'no custom mode btn';
})()`);
await new Promise(r => setTimeout(r, 500));

// Use CDP Input.insertText — more reliable than simulating keystrokes
// First click on the main text input
eval_(5, `(function(){
  var ta = document.querySelector('textarea') || document.querySelector('input[type=text]');
  if (!ta) return 'no input';
  ta.focus();
  ta.click();
  return 'focused: '+ta.placeholder;
})()`);
await new Promise(r => setTimeout(r, 300));

// Use Input.insertText to type content (this is like real keyboard input)
send(6, "Input.insertText", {text: "Happy birthday to you test song lyrics"});
await new Promise(r => setTimeout(r, 500));

// Dispatch input event after CDP insert
eval_(7, `(function(){
  var ta = document.querySelector('textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    ta.dispatchEvent(new Event('change', {bubbles:true}));
    return 'dispatched, value='+ta.value.substring(0,30)+'  btn disabled='+document.querySelector('button[type=button]')?.disabled;
  }
  return 'no ta';
})()`);
await new Promise(r => setTimeout(r, 500));

// Check Create button state after typing
eval_(8, `(function(){
  var btns = Array.from(document.querySelectorAll('button'));
  var create = btns.find(b => /^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO CREATE BTN';
  return JSON.stringify({disabled: create.disabled, aria: create.getAttribute('aria-disabled')});
})()`);
await new Promise(r => setTimeout(r, 300));

// Try clicking Create
eval_(9, `(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
  if (!b) b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent));
  if(b){ b.click(); return 'CLICKED (disabled='+b.disabled+')'; }
  return 'NO BTN';
})()`);

console.log("\nWaiting 20s for Turnstile / generate request...\n");
await new Promise(r => setTimeout(r, 20000));

eval_(10, "window.__P1_token ? window.__P1_token.substring(0,30) : 'NO P1_'");
await new Promise(r => setTimeout(r, 500));

socket.close();

console.log("\n=== Results ===");
console.log("Inputs:", getR(3));
console.log("Custom mode:", getR(4));
console.log("Focus:", getR(5));
console.log("After typing:", getR(7));
console.log("Create btn state:", getR(8));
console.log("Click:", getR(9));
console.log("P1_ token:", getR(10));
