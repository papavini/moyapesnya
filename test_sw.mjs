/**
 * Проверяем: Service Worker, Network requests, что происходит при кнопке Create
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
if (!sunoTab) { console.log("No suno/create tab!"); process.exit(1); }

const socket = new WebSocket(sunoTab.webSocketDebuggerUrl);
await new Promise(r => socket.on("open", r));

const allMessages = [];
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  allMessages.push(d);
});

function send(id, method, params={}) {
  socket.send(JSON.stringify({id, method, params}));
}

function eval_(id, expr) {
  send(id, "Runtime.evaluate", {expression: expr});
}

// Enable Network monitoring
send(1, "Network.enable", {});
send(2, "ServiceWorker.enable", {});
await new Promise(r => setTimeout(r, 500));

// Check for service workers
eval_(3, "(function(){ return navigator.serviceWorker.getRegistrations().then(r => r.map(reg=>reg.scope+' active='+!!reg.active)).join(', ') || 'none'; })()");
await new Promise(r => setTimeout(r, 1000));

// Install network request interceptor via CDP
eval_(4, `(function(){
  window.__networkLog = [];
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var u = typeof url === 'string' ? url : (url && url.url) || String(url);
    if (u.includes('suno') || u.includes('turnstile') || u.includes('challenge') || u.includes('generate')) {
      window.__networkLog.push({url: u.substring(0,100), time: Date.now()});
    }
    return origFetch.apply(this, arguments);
  };
  return 'fetch interceptor installed';
})()`);
await new Promise(r => setTimeout(r, 300));

// Reset trap and fill form
eval_(5, `(function(){
  window.__P1_token = null;
  window.__cdpTrap = null;
  function capture(tok){ if(tok&&tok.indexOf('P1_')===0){ window.__P1_token=tok; console.log('[cdp] CAPTURED P1_! len='+tok.length); } }
  function patch(t){ if(!t||t.__cdpDone) return; t.__cdpDone=1;
    var oe=t.execute; if(typeof oe==='function') t.execute=function(s,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return oe.call(t,s,p); };
    var or=t.render; if(typeof or==='function') t.render=function(c,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return or.call(t,c,p); };
  }
  if(window.turnstile) patch(window.turnstile);
  var desc=Object.getOwnPropertyDescriptor(window,'turnstile');
  if(desc&&desc.set){ var os=desc.set; Object.defineProperty(window,'turnstile',{get:desc.get,set:function(v){os(v);patch(v);},configurable:true}); }
  else { var _t=window.turnstile; Object.defineProperty(window,'turnstile',{get:function(){return _t;},set:function(v){_t=v;patch(v);},configurable:true}); }
  window.__cdpTrap=1;
  return 'trap OK';
})()`);
await new Promise(r => setTimeout(r, 300));

// Fill in lyrics textarea
eval_(6, `(function(){
  var ta = Array.from(document.querySelectorAll('textarea')).find(t => t.placeholder && t.placeholder.includes('lyrics'));
  if (!ta) ta = document.querySelector('textarea');
  if (!ta) return 'no textarea';
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Happy birthday happy day test song');
  ta.dispatchEvent(new Event('input', {bubbles:true}));
  return 'filled: ' + ta.value;
})()`);
await new Promise(r => setTimeout(r, 500));

// Also check if there's a "Style" field and fill it
eval_(7, `(function(){
  var inputs = Array.from(document.querySelectorAll('input[placeholder]'));
  var style = inputs.find(i => i.placeholder.toLowerCase().includes('style') || i.placeholder.toLowerCase().includes('sound'));
  if (style) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(style, 'pop upbeat');
    style.dispatchEvent(new Event('input', {bubbles:true}));
    return 'style filled';
  }
  return 'no style input: ' + inputs.map(i=>i.placeholder).join(' | ');
})()`);
await new Promise(r => setTimeout(r, 500));

// Click Create
eval_(8, `(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
  if (!b) b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent));
  if(b){ b.click(); return 'CLICKED: '+b.textContent.trim(); }
  return 'NO CREATE BTN: '+Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim()).join('|');
})()`);
await new Promise(r => setTimeout(r, 12000)); // Wait 12 seconds for Turnstile

// Read results
eval_(9, "window.__P1_token ? 'GOT P1_: '+window.__P1_token.substring(0,25) : 'no P1_ token'");
await new Promise(r => setTimeout(r, 300));
eval_(10, "JSON.stringify(window.__networkLog)");
await new Promise(r => setTimeout(r, 300));
eval_(11, "typeof window.turnstile");
await new Promise(r => setTimeout(r, 300));

socket.close();
await new Promise(r => setTimeout(r, 200));

const getResult = (id) => {
  const msg = allMessages.find(m => m.id === id);
  return msg?.result?.result?.value ?? msg?.result?.result ?? msg?.error ?? 'no-data';
};

console.log("Network enabled:", getResult(1));
console.log("SW registrations:", getResult(3));
console.log("Fetch interceptor:", getResult(4));
console.log("Trap:", getResult(5));
console.log("Fill lyrics:", getResult(6));
console.log("Fill style:", getResult(7));
console.log("Click Create:", getResult(8));
console.log("P1_ token:", getResult(9));
console.log("Network log:", getResult(10));
console.log("Turnstile type:", getResult(11));

// Also show network events from CDP
const networkEvents = allMessages.filter(m => m.method && m.method.startsWith('Network.'));
console.log("\n=== CDP Network events ===");
networkEvents.slice(0, 20).forEach(e => {
  if (e.method === 'Network.requestWillBeSent') {
    const url = e.params?.request?.url || '';
    if (url.includes('suno') || url.includes('turnstile') || url.includes('challenge')) {
      console.log(`REQUEST: ${url.substring(0,120)}`);
    }
  } else if (e.method === 'Network.responseReceived') {
    const url = e.params?.response?.url || '';
    if (url.includes('suno') || url.includes('turnstile')) {
      console.log(`RESPONSE: ${e.params?.response?.status} ${url.substring(0,100)}`);
    }
  }
});

const swEvents = allMessages.filter(m => m.method && m.method.startsWith('ServiceWorker.'));
console.log("\n=== SW Events ===");
swEvents.slice(0, 10).forEach(e => console.log(JSON.stringify(e).substring(0,200)));
