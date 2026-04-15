/**
 * В RDP Chromium window.turnstile уже загружен.
 * Вызываем turnstile.execute() напрямую для получения P1_ токена.
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
const rdpCreate = rdpTabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!rdpCreate) { console.log("No RDP suno page!"); process.exit(1); }
console.log("Using:", rdpCreate.url);

const ws = new WebSocket(rdpCreate.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1;
const callbacks = {};
const allEvents = [];

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  allEvents.push(d);
  if (d.id && callbacks[d.id]) { callbacks[d.id](d); delete callbacks[d.id]; }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    if (url.includes("generate") || url.includes("turnstile")) {
      console.log(`\n[INTERCEPTED] ${url.substring(0,80)}`);
      if (body) {
        console.log(`[BODY] ${body.substring(0,300)}`);
        try {
          const p = JSON.parse(body);
          if (p.token) console.log(`\n*** PASSKEY TOKEN: ${p.token.substring(0,35)}... ***\n`);
        } catch(e) {}
      }
      // Fail to avoid spending credits
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
    }
  }
});

function cdpSend(method, params={}) {
  return new Promise(r => {
    const id = nextId++;
    callbacks[id] = r;
    ws.send(JSON.stringify({id, method, params}));
  });
}

function cdpEval(expr, awaitPromise=false) {
  return new Promise(r => {
    const id = nextId++;
    callbacks[id] = r;
    ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise}}));
  });
}

const val = (r) => r?.result?.result?.value;

// Enable network monitoring + fetch interception
await cdpSend("Network.enable");
await cdpSend("Fetch.enable", {patterns: [
  {urlPattern: "*/generate/v2-web/*", requestStage: "Request"},
]});

// Check window.turnstile
const tsType = await cdpEval("typeof window.turnstile");
console.log("window.turnstile:", val(tsType));

// Find sitekey from any container
const sitekeyR = await cdpEval(`(function(){
  // Check all elements with data-sitekey
  var els = document.querySelectorAll('[data-sitekey]');
  if (els.length) return els[0].getAttribute('data-sitekey');
  // Check all cf-turnstile classes
  var cf = document.querySelectorAll('.cf-turnstile,[data-cf-turnstile]');
  if (cf.length) return JSON.stringify(cf[0].dataset);
  // Check Turnstile iframes for sitekey in src
  var iframes = Array.from(document.querySelectorAll('iframe')).filter(f => f.src.includes('turnstile') || f.src.includes('challenge'));
  if (iframes.length) return iframes[0].src.substring(0,100);
  return 'no sitekey found';
})()`);
console.log("Sitekey search:", val(sitekeyR));

// Try to find hidden input with cf-turnstile-response
const cfInput = await cdpEval(`(function(){
  // Search all inputs including hidden
  var all = document.querySelectorAll('input');
  var found = [];
  all.forEach(i => { if (i.name && i.name.includes('turnstile') || i.id && i.id.includes('turnstile')) found.push({name:i.name, id:i.id, value:i.value.substring(0,20)}); });
  return JSON.stringify(found);
})()`);
console.log("CF inputs:", val(cfInput));

// Find sitekey by looking at turnstile object internals
const sitekeyFromTS = await cdpEval(`(function(){
  if (!window.turnstile) return 'no turnstile';
  // Try to get stored sitekey from internal state
  var sk = window.turnstile._sitekey || window.turnstile.sitekey;
  if (sk) return 'from ts._sitekey: '+sk;
  // Try to find from widgets
  if (window.turnstile.getResponse) {
    try { return 'getResponse: '+window.turnstile.getResponse(); } catch(e) {}
  }
  if (window.turnstile.isExpired) {
    return 'has isExpired method';
  }
  // List all turnstile methods
  return 'methods: '+Object.keys(window.turnstile).join(', ');
})()`);
console.log("Turnstile internals:", val(sitekeyFromTS));

// Monitor for turnstile widget IDs
const widgetIds = await cdpEval(`(function(){
  if (!window.turnstile) return 'no ts';
  // Turnstile widgets are tracked internally
  var ids = [];
  try {
    // Try various internal structures
    if (window.__cf_chl_widget_ids) ids = window.__cf_chl_widget_ids;
  } catch(e) {}
  return JSON.stringify(ids);
})()`);
console.log("Widget IDs:", val(widgetIds));

// Try calling turnstile.getResponse() directly
const getResponse = await cdpEval(`(function(){
  if (!window.turnstile) return 'no ts';
  try { return window.turnstile.getResponse() || 'empty response'; } catch(e) { return 'err: '+e.message; }
})()`);
console.log("getResponse():", val(getResponse));

// Try calling turnstile.execute with SUNO's sitekey (common suno sitekey patterns)
// SUNO uses 0x4AAAAAAAc6aCF3_9iBrpGg or similar
const executeR = await cdpEval(`(function(){
  if (!window.turnstile) return 'no turnstile available';
  window.__P1_result = null;

  // Try to call execute without sitekey (will error but shows the API)
  try {
    window.turnstile.execute(undefined, {
      callback: function(tok) {
        console.log('[execute-cb] token:', tok ? tok.substring(0,30) : 'null');
        window.__P1_result = tok;
      }
    });
    return 'execute called';
  } catch(e) { return 'execute error: '+e.message; }
})()`);
console.log("Execute attempt:", val(executeR));
await new Promise(r => setTimeout(r, 3000));

// Check if token appeared
const tokenCheck = await cdpEval("window.__P1_result ? window.__P1_result.substring(0,30)+'...' : 'no token yet'");
console.log("Token after execute:", val(tokenCheck));

// Now try to install proper trap and simulate clicking Create with real content
console.log("\nInstalling trap on RDP Chromium window.turnstile...");
const trapR = await cdpEval(`(function(){
  window.__P1_captured = null;
  function capture(tok) {
    if (tok && tok.startsWith('P1_')) {
      window.__P1_captured = tok;
      console.log('[RDP TRAP] Captured P1_! len='+tok.length);
    }
  }
  if (!window.turnstile) return 'no turnstile to trap';
  var oe = window.turnstile.execute;
  if (typeof oe === 'function') {
    window.turnstile.execute = function(sk, params) {
      console.log('[RDP TRAP] execute called with sitekey:', sk ? sk.substring(0,20) : 'none');
      if (params && typeof params.callback === 'function') {
        var cb = params.callback;
        params.callback = function(tok) { capture(tok); cb(tok); };
      }
      return oe.call(window.turnstile, sk, params);
    };
  }
  var or = window.turnstile.render;
  if (typeof or === 'function') {
    window.turnstile.render = function(container, params) {
      if (params && typeof params.callback === 'function') {
        var cb = params.callback;
        params.callback = function(tok) { capture(tok); cb(tok); };
      }
      return or.call(window.turnstile, container, params);
    };
  }
  return 'trap installed on existing turnstile';
})()`);
console.log("Trap on RDP:", val(trapR));

// Now fill the form and click Create (use Input.insertText for proper React update)
// First focus the textarea
const focusR = await cdpEval(`(function(){
  var ta = document.querySelector('textarea[placeholder*="lyrics"]') || document.querySelector('textarea');
  if (!ta) return 'no textarea';
  ta.focus();
  // Select all existing content
  ta.select();
  return 'focused: ' + ta.placeholder?.substring(0,30);
})()`);
console.log("Focus:", val(focusR));

// Use CDP Input.insertText (most reliable for React)
await cdpSend("Input.insertText", {text: "Happy birthday to you, birthday song test for automation"});
await new Promise(r => setTimeout(r, 500));

// Check value
const valueCheck = await cdpEval(`(function(){
  var ta = document.querySelector('textarea');
  return ta ? 'value: '+ta.value.substring(0,40)+' | createBtn: '+(Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()))?.disabled) : 'no ta';
})()`);
console.log("After typing:", val(valueCheck));

// Click Create
const clickR = await cdpEval(`(function(){
  var btns = Array.from(document.querySelectorAll('button'));
  var create = btns.find(b => /^create$/i.test(b.textContent.trim()));
  if (!create) create = btns.find(b => /create/i.test(b.textContent) && !b.disabled);
  if (create && !create.disabled) {
    create.click();
    return 'CLICKED (enabled)';
  }
  // Show all buttons
  return 'disabled create, btns: ' + btns.filter(b=>/create|submit|generate/i.test(b.textContent)).map(b=>b.textContent.trim().substring(0,15)+'(dis='+b.disabled+')').join(' | ');
})()`);
console.log("Click Create:", val(clickR));

console.log("\nWaiting 15s for token...");
await new Promise(r => setTimeout(r, 15000));

// Check for captured token
const finalToken = await cdpEval("window.__P1_captured ? window.__P1_captured.substring(0,30)+'...' : 'no P1_ captured'");
console.log("Final token:", val(finalToken));

// If captured, save it!
const capturedToken = val(finalToken);
if (capturedToken && capturedToken.startsWith('P1_')) {
  console.log("Got token! Saving to passkey file...");
  // Get full token
  const fullToken = await cdpEval("window.__P1_captured");
  const token = val(fullToken);
  writeFileSync("/home/alexander/projects/suno_passkey.txt", token);
  console.log("Saved! Restarting suno-api...");
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  console.log("suno-api restarted!");
}

ws.close();
