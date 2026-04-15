/**
 * Глубокая диагностика Create кнопки:
 * 1. Проверяем состояние кнопки (disabled? clickable?)
 * 2. Включаем CDP Fetch interception для поимки generate запроса
 * 3. Заполняем все поля и кликаем Create
 * 4. Мониторим ALL network events
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

const allMsgs = [];
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  allMsgs.push(d);
  // Log network events in real time
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("suno") || url.includes("studio") || url.includes("turnstile") || url.includes("challenge") || url.includes("clerk")) {
      console.log(`[NET REQ] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    console.log(`[FETCH PAUSED] ${d.params?.request?.method} ${url.substring(0,100)}`);
    // Get body and continue
    const body = d.params?.request?.postData;
    if (body) {
      console.log(`[FETCH BODY] ${body.substring(0,200)}`);
      // Save the token if present
      try {
        const parsed = JSON.parse(body);
        if (parsed.token && parsed.token.startsWith('P1_')) {
          console.log(`[TOKEN CAPTURED!] ${parsed.token.substring(0,30)}...`);
        }
      } catch(e) {}
    }
    // Fail the request to not waste credits
    socket.send(JSON.stringify({
      id: 9000 + Math.floor(Math.random()*1000),
      method: "Fetch.failRequest",
      params: { requestId: d.params.requestId, errorReason: "Aborted" }
    }));
  }
});

function send(id, method, params={}) {
  socket.send(JSON.stringify({id, method, params}));
}
function eval_(id, expr) {
  send(id, "Runtime.evaluate", {expression: expr});
}
function getResult(id) {
  const msg = allMsgs.find(m => m.id === id);
  return msg?.result?.result?.value ?? JSON.stringify(msg?.result?.result);
}

// Enable Network monitoring
send(1, "Network.enable", {maxResourceBufferSize: 100000, maxTotalBufferSize: 300000});
// Enable Fetch interception for generate requests
send(2, "Fetch.enable", {
  patterns: [
    {urlPattern: "*/generate/v2-web/*", requestStage: "Request"},
    {urlPattern: "*/api/c/*", requestStage: "Request"},
    {urlPattern: "*turnstile*", requestStage: "Request"},
  ]
});
await new Promise(r => setTimeout(r, 500));

// Check Create button state
eval_(3, `(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
  if (!b) return 'NOT FOUND';
  return JSON.stringify({
    disabled: b.disabled,
    ariaDisabled: b.getAttribute('aria-disabled'),
    text: b.textContent.trim(),
    type: b.type,
    className: b.className.substring(0,50)
  });
})()`);
await new Promise(r => setTimeout(r, 400));

// Fill ALL visible inputs properly
eval_(4, `(function(){
  var results = [];

  // Try to switch to custom mode first (look for "Custom Mode" button or similar)
  var customBtn = Array.from(document.querySelectorAll('button')).find(b => /custom/i.test(b.textContent));
  if (customBtn) { customBtn.click(); results.push('clicked custom mode'); }

  // Fill textarea (lyrics)
  var ta = document.querySelector('textarea');
  if (ta) {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Happy birthday to you, happy birthday dear friend, may your day be bright');
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    results.push('lyrics filled');
  }

  // Fill style input
  var inputs = Array.from(document.querySelectorAll('input'));
  inputs.forEach(inp => {
    var ph = inp.placeholder || '';
    if (/style|sound|genre|tag/i.test(ph)) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, 'pop upbeat');
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      results.push('style filled: '+ph.substring(0,20));
    }
    if (/title/i.test(ph)) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, 'Birthday Song');
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      results.push('title filled: '+ph.substring(0,20));
    }
  });

  return results.join(' | ');
})()`);
await new Promise(r => setTimeout(r, 1000));

// Install token trap
eval_(5, `(function(){
  window.__P1_token = null;
  function capture(tok){ if(tok&&tok.startsWith('P1_')){ window.__P1_token=tok; console.log('[trap] CAPTURED! len='+tok.length); } }
  function patch(t){ if(!t||t.__cdpDone) return; t.__cdpDone=1;
    var oe=t.execute; if(typeof oe==='function') t.execute=function(s,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return oe.call(t,s,p); };
    var or=t.render; if(typeof or==='function') t.render=function(c,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return or.call(t,c,p); };
  }
  if(window.turnstile) patch(window.turnstile);
  var desc=Object.getOwnPropertyDescriptor(window,'turnstile');
  if(desc&&desc.set){ var os=desc.set; Object.defineProperty(window,'turnstile',{get:desc.get,set:function(v){os(v);patch(v);},configurable:true}); }
  else { var _t=window.turnstile; Object.defineProperty(window,'turnstile',{get:function(){return _t;},set:function(v){_t=v;patch(v);},configurable:true}); }
  return 'trap OK';
})()`);
await new Promise(r => setTimeout(r, 300));

// Click Create
eval_(6, `(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent));
  if(b){
    console.log('[test] clicking create, disabled='+b.disabled);
    b.click();
    return 'CLICKED: disabled='+b.disabled;
  }
  return 'NO BTN: '+Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim().substring(0,15)).join('|');
})()`);

console.log("\nWaiting 15 seconds for network activity...\n");
await new Promise(r => setTimeout(r, 15000));

eval_(7, "window.__P1_token ? 'P1_: '+window.__P1_token.substring(0,25) : 'none'");
await new Promise(r => setTimeout(r, 500));

socket.close();

console.log("\n=== Results ===");
console.log("Create button:", getResult(3));
console.log("Fill inputs:", getResult(4));
console.log("Trap:", getResult(5));
console.log("Click:", getResult(6));
console.log("P1_ token:", getResult(7));

const networkReqs = allMsgs.filter(m => m.method === "Network.requestWillBeSent");
console.log("\nTotal network requests captured:", networkReqs.length);
networkReqs.filter(m => {
  const url = m.params?.request?.url || "";
  return url.includes("suno") || url.includes("studio") || url.includes("turnstile");
}).forEach(m => console.log("NET:", m.params?.request?.method, m.params?.request?.url?.substring(0,100)));
