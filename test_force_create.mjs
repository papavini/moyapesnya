/**
 * Force-enable Create button + intercept network request с токеном.
 * Используем document.execCommand для заполнения React inputs.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

async function getTabs(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

const rdpTabs = await getTabs(9223);
const rdpPage = rdpTabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!rdpPage) { console.log("No RDP page!"); process.exit(1); }
console.log("Using RDP:", rdpPage.url);

const ws = new WebSocket(rdpPage.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1;
const cbs = {};
let capturedToken = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    const postData = d.params?.request?.postData;
    if (url.includes("generate") || url.includes("studio-api")) {
      console.log(`[NET] POST ${url.substring(0,80)}`);
      if (postData) {
        console.log(`[BODY] ${postData.substring(0,200)}`);
        try {
          const p = JSON.parse(postData);
          if (p.token) { capturedToken = p.token; console.log(`\n*** TOKEN: ${p.token.substring(0,35)}... ***\n`); }
        } catch(e) {}
      }
    }
  }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    console.log(`[PAUSED] ${url.substring(0,80)}`);
    if (body) {
      try { const p = JSON.parse(body); if (p.token) { capturedToken = p.token; console.log(`\n*** PAUSED TOKEN: ${p.token.substring(0,35)}... ***\n`); } } catch(e) {}
    }
    // Fail to prevent credits usage
    ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr, ap=false) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Fetch.enable", {patterns: [{urlPattern: "*/generate/v2-web/*", requestStage: "Request"}, {urlPattern: "*/api/generate*", requestStage: "Request"}]});

// Install turnstile trap
await ev(`(function(){
  window.__P1_captured = null;
  function cap(tok){ if(tok&&tok.startsWith('P1_')){ window.__P1_captured=tok; console.log('[TRAP] GOT P1_! len='+tok.length); } }
  if(!window.turnstile) { console.log('[TRAP] no turnstile'); return; }
  var oe=window.turnstile.execute; if(typeof oe==='function') window.turnstile.execute=function(sk,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(t){cap(t);cb(t);};} return oe.call(window.turnstile,sk,p); };
  var or=window.turnstile.render; if(typeof or==='function') window.turnstile.render=function(c,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(t){cap(t);cb(t);};} return or.call(window.turnstile,c,p); };
  console.log('[TRAP] installed on window.turnstile');
})()`);

// Try using execCommand to fill textarea (works with React)
const fillR = await ev(`(function(){
  var ta = document.querySelector('textarea');
  if (!ta) return 'NO TEXTAREA';
  ta.focus();
  ta.select();
  // execCommand works with React controlled components
  var result = document.execCommand('insertText', false, 'Happy birthday song test automation');
  ta.dispatchEvent(new Event('input', {bubbles:true}));
  return 'execCommand='+result+' | value='+ta.value.substring(0,30);
})()`);
console.log("Fill (execCommand):", v(fillR));

await new Promise(r => setTimeout(r, 300));

// Check Create button state
const btnR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO CREATE BTN';
  return 'disabled='+create.disabled+' | text='+create.textContent.trim();
})()`);
console.log("Create btn after fill:", v(btnR));

// Force-enable the button (bypass React state check)
const forceR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO BTN';
  // Force enable
  create.disabled = false;
  create.removeAttribute('disabled');
  // Also try to override React's disabled prop via fiber
  var fiber = create[Object.keys(create).find(k=>k.startsWith('__reactFiber'))||''];
  if (fiber) {
    try {
      var node = fiber;
      while (node) {
        if (node.pendingProps && 'disabled' in node.pendingProps) {
          node.pendingProps.disabled = false;
          break;
        }
        node = node.return;
      }
    } catch(e) {}
  }
  return 'disabled after force: '+create.disabled;
})()`);
console.log("Force enable:", v(forceR));

// Click the (now enabled) Create button
const clickR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO BTN';
  console.log('[test] Clicking Create, disabled='+create.disabled);
  create.click();
  return 'CLICKED! disabled='+create.disabled;
})()`);
console.log("Click:", v(clickR));

console.log("\nWaiting 20s for Turnstile + network request...");
await new Promise(r => setTimeout(r, 20000));

// Check results
const tokenR = await ev("window.__P1_captured ? 'HAS:'+window.__P1_captured.substring(0,30) : 'none'");
console.log("Captured from turnstile trap:", v(tokenR));
console.log("Captured from network:", capturedToken ? capturedToken.substring(0,30)+'...' : 'none');

// If we got token, save it!
const token = capturedToken || (v(tokenR)?.startsWith('HAS:') ? await ev("window.__P1_captured").then(r => v(r)) : null);
if (token && token.startsWith('P1_')) {
  console.log("\n=== SAVING TOKEN ===");
  writeFileSync("/home/alexander/projects/suno_passkey.txt", token);
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 5000));
  console.log("suno-api restarted with fresh token!");
}

ws.close();
