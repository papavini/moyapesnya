/**
 * Полный тест: reload страницы, заполнить форму, кликнуть Create, ждать Turnstile
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

function makeWs(url) {
  return new Promise(resolve => {
    const socket = new WebSocket(url);
    socket.on("open", () => resolve(socket));
  });
}

// First reload the page
{
  const s = await makeWs(sunoTab.webSocketDebuggerUrl);
  s.on("message", () => {});
  s.send(JSON.stringify({id: 1, method: "Page.reload", params: {}}));
  await new Promise(r => setTimeout(r, 5000));
  s.close();
  console.log("Page reloaded, waiting for load...");
}

// Wait for page to fully load
await new Promise(r => setTimeout(r, 3000));

// Reconnect (page reload may change wsDebugger URL, fetch new tabs)
const tabs2 = await new Promise((resolve, reject) => {
  http.get("http://localhost:9222/json", (res) => {
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const sunoTab2 = tabs2.find(t => t.url && t.url.includes("suno.com/create"));
if (!sunoTab2) { console.log("No suno tab after reload!"); process.exit(1); }

const socket = await makeWs(sunoTab2.webSocketDebuggerUrl);
const results = {};
socket.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id) results[d.id] = d.result;
});

function send(id, expr) {
  socket.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}}));
}

await new Promise(r => setTimeout(r, 1000));

// Check login state after reload
send(1, "document.cookie.includes('__client_uat')");
await new Promise(r => setTimeout(r, 500));

send(2, "(function(){ var m = document.cookie.match(/__client_uat=([^;]+)/); return m ? 'uat='+m[1] : 'no-uat'; })()");
await new Promise(r => setTimeout(r, 500));

// Check for user indicator
send(3, "document.body.innerHTML.includes('Sign out') || document.body.innerHTML.includes('Log out') || document.body.innerHTML.includes('My Account') || document.body.textContent.includes('sonarliktor') ? 'LOGGED IN' : 'NOT LOGGED IN'");
await new Promise(r => setTimeout(r, 500));

// Find text input / textarea
send(4, "Array.from(document.querySelectorAll('textarea,input[type=text]')).map(el=>el.placeholder||el.name||'no-placeholder').join(' | ')");
await new Promise(r => setTimeout(r, 500));

// Install trap
send(5, `(function(){
  window.__P1_token = null;
  window.__cdpTrap = null;
  function capture(tok){ if(tok&&tok.indexOf('P1_')===0){ window.__P1_token=tok; console.log('[cdp] P1_ captured len='+tok.length); } }
  function patch(t){ if(!t||t.__cdpDone) return; t.__cdpDone=1;
    var oe=t.execute; if(typeof oe==='function') t.execute=function(s,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return oe.call(t,s,p); };
    var or=t.render; if(typeof or==='function') t.render=function(c,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};} return or.call(t,c,p); };
  }
  if(window.turnstile) patch(window.turnstile);
  var desc=Object.getOwnPropertyDescriptor(window,'turnstile');
  if(desc&&desc.set){ var os=desc.set; Object.defineProperty(window,'turnstile',{get:desc.get,set:function(v){os(v);patch(v);},configurable:true}); }
  else { var _t=window.turnstile; Object.defineProperty(window,'turnstile',{get:function(){return _t;},set:function(v){_t=v;patch(v);},configurable:true}); }
  window.__cdpTrap = 1;
  return 'trap installed';
})()`);
await new Promise(r => setTimeout(r, 500));

// Try to fill textarea with test text
send(6, `(function(){
  var ta = document.querySelector('textarea');
  if (!ta) return 'no textarea';
  var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(ta, 'Happy birthday song for test');
  ta.dispatchEvent(new Event('input', {bubbles:true}));
  ta.dispatchEvent(new Event('change', {bubbles:true}));
  return 'filled: '+ta.value.substring(0,30);
})()`);
await new Promise(r => setTimeout(r, 1000));

// Click Create
send(7, `(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent));
  if(b){b.click(); return 'clicked: '+b.textContent.trim();}
  return 'no create btn';
})()`);
await new Promise(r => setTimeout(r, 8000));

// Check results
send(8, "typeof window.turnstile + ' | P1_token=' + (window.__P1_token ? window.__P1_token.substring(0,20) : 'null')");
await new Promise(r => setTimeout(r, 500));

// Check console errors via network events
send(9, "(function(){ var errs = window.__consoleErrors||[]; return errs.length ? errs[0].substring(0,100) : 'no captured errors'; })()");
await new Promise(r => setTimeout(r, 500));

socket.close();

console.log("1. Has __client_uat:", JSON.stringify(results[1]));
console.log("2. UAT value:", JSON.stringify(results[2]));
console.log("3. Login state:", JSON.stringify(results[3]));
console.log("4. Inputs:", JSON.stringify(results[4]));
console.log("5. Trap install:", JSON.stringify(results[5]));
console.log("6. Fill textarea:", JSON.stringify(results[6]));
console.log("7. Click Create:", JSON.stringify(results[7]));
console.log("8. After 8s:", JSON.stringify(results[8]));
console.log("9. Errors:", JSON.stringify(results[9]));
