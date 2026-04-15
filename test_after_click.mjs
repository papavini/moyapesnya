/**
 * Проверяем что произошло после клика Create.
 * Ищем модальные окна, диалоги, изменения в DOM.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

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

const ws = new WebSocket(rdpPage.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
const cbs = {};
let nextId = 1;
const allMsgs = [];

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  allMsgs.push(d);
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method) {
    if (d.method === "Network.requestWillBeSent") {
      const url = d.params?.request?.url || "";
      const body = d.params?.request?.postData;
      if (url.includes("studio") || url.includes("generate") || url.includes("suno.com/api")) {
        console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
        if (body) console.log(`[BODY] ${body.substring(0,300)}`);
      }
    }
    if (d.method === "Fetch.requestPaused") {
      const url = d.params?.request?.url || "";
      const body = d.params?.request?.postData || "";
      console.log(`[FETCH PAUSED] ${d.params?.request?.method} ${url.substring(0,100)}`);
      if (body) console.log(`[FETCH BODY] ${body.substring(0,300)}`);
      // Continue all requests, capture token
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    }
    if (d.method === "Console.messageAdded") {
      const m = d.params?.message;
      if (m) console.log(`[CONSOLE ${m.level}] ${m.text?.substring(0,100)}`);
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");
await send("Fetch.enable", {patterns: [
  {urlPattern: "https://studio-api-prod.suno.com/*", requestStage: "Request"},
]});

// Fill via fiber + click Create
const setupR = await ev(`(function(){
  var ta = document.querySelector('textarea');
  if (!ta) return 'no ta';
  var fk = Object.keys(ta).find(k=>k.startsWith('__reactFiber')||k.startsWith('__reactInternalInstance'));
  if (fk) {
    var node = ta[fk];
    while(node) {
      var props = node.memoizedProps || node.pendingProps;
      if (props && typeof props.onChange === 'function') {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta,'Happy birthday test song');
        props.onChange({target:ta,currentTarget:ta,type:'change',nativeEvent:{inputType:'insertText'},preventDefault:function(){},stopPropagation:function(){}});
        break;
      }
      node = node.return;
    }
  }
  return 'setup done, ta value='+ta.value.substring(0,20);
})()`);
console.log("Setup:", v(setupR));

await new Promise(r => setTimeout(r, 500));

// Check DOM before click
const beforeR = await ev(`(function(){
  var dialogs = document.querySelectorAll('[role=dialog],[role=alertdialog],dialog,.modal');
  var overlay = document.querySelectorAll('[class*="overlay"],[class*="modal"],[class*="dialog"]');
  var create = Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()));
  return JSON.stringify({dialogs: dialogs.length, overlay: overlay.length, createDisabled: create?.disabled, url: window.location.href});
})()`);
console.log("Before click DOM:", v(beforeR));

// Click Create
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
  if (!b) { b = Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent) && !x.disabled); }
  if (b) { b.click(); console.log('[test] Create clicked, disabled='+b.disabled); }
  else console.log('[test] NO CREATE BTN');
})()`);

await new Promise(r => setTimeout(r, 3000));

// Check DOM after click
const afterR = await ev(`(function(){
  var dialogs = document.querySelectorAll('[role=dialog],[role=alertdialog],dialog,.modal');
  var overlay = document.querySelectorAll('[class*="overlay"],[class*="Modal"],[class*="dialog"]');
  var url = window.location.href;

  // Look for any visible modal/popup content
  var modalText = '';
  overlay.forEach(el => { if (el.offsetParent !== null) modalText += el.textContent.substring(0,50)+' | '; });

  // Check for loading indicator
  var loading = document.querySelectorAll('[class*="loading"],[class*="spinner"],[aria-busy]');

  // Get all visible buttons
  var btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b=>b.textContent.trim().substring(0,15)).slice(0,10);

  return JSON.stringify({dialogs: dialogs.length, overlay: overlay.length, loading: loading.length, url, modalText: modalText.substring(0,100), visibleBtns: btns});
})()`);
console.log("After 3s DOM:", v(afterR));

// Check network log
await new Promise(r => setTimeout(r, 5000));

// Final DOM check
const finalR = await ev(`(function(){
  var url = window.location.href;
  var generating = document.body.textContent.includes('Generating') || document.body.textContent.includes('generating');
  var error = document.body.textContent.includes('Error') || document.body.textContent.includes('error');
  return JSON.stringify({url, generating, error, bodyText: document.body.textContent.substring(0,200)});
})()`);
console.log("Final DOM:", v(finalR));

ws.close();
console.log("\nTotal CDP messages:", allMsgs.length);
const netReqs = allMsgs.filter(m => m.method === "Network.requestWillBeSent");
console.log("Network requests:", netReqs.length);
