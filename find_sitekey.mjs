/**
 * Ищем Cloudflare Turnstile sitekey в JS бандлах SUNO.
 * Также мониторим ВСЕ сетевые запросы при клике Create — включая challenges.cloudflare.com.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import https from "https";

async function getTabs(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

const tabs = await getTabs(9223);
const page = tabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!page) { console.log("No RDP suno page!"); process.exit(1); }
console.log("Page:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1; const cbs = {};
const netLog = [];

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }

  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData;
    netLog.push({method: d.params?.request?.method, url, body});
    if (url.includes("generate") || url.includes("studio-api") || url.includes("challenges.cloudflare") || url.includes("turnstile")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,120)}`);
      if (body) console.log(`[BODY] ${body.substring(0,300)}`);
    }
  }

  if (d.method === "Network.responseReceived") {
    const url = d.params?.response?.url || "";
    if (url.includes("challenges.cloudflare") || url.includes("turnstile") || url.includes("studio-api")) {
      console.log(`[RESP] ${d.params?.response?.status} ${url.substring(0,100)}`);
    }
  }

  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m) {
      const txt = m.text || '';
      // Log ALL console messages to catch any errors or token-related logs
      if (txt.includes('P1_') || txt.includes('TRAP') || txt.includes('token') ||
          txt.includes('error') || txt.includes('Error') || txt.includes('create') ||
          txt.includes('generate') || txt.includes('turnstile') || txt.includes('disabled')) {
        console.log(`[CON ${m.level}] ${txt.substring(0, 200)}`);
      }
    }
  }

  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    console.log(`\n!!! FETCH PAUSED: ${d.params?.request?.method} ${url.substring(0,100)}`);
    if (body) console.log(`[PAUSED BODY] ${body.substring(0,500)}`);
    // Continue ALL (don't fail - we want to see what happens)
    ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr, ap=false) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");
// Intercept ALL studio-api requests to read their body WITHOUT failing them
await send("Fetch.enable", {patterns: [
  {urlPattern: "*studio-api*", requestStage: "Request"},
  {urlPattern: "*generate/v2*", requestStage: "Request"},
]});

// === STEP 1: Find sitekey in loaded JS bundles ===
console.log("\n=== SEARCHING FOR SITEKEY IN JS BUNDLES ===");
const bundlesR = await ev(`(function(){
  var scripts = Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(s => s.includes('/_next/static/') || s.includes('suno.com'));
  return JSON.stringify(scripts.slice(0, 30));
})()`);
const bundles = JSON.parse(v(bundlesR) || '[]');
console.log(`Found ${bundles.length} SUNO/Next.js scripts`);

// Fetch and search each bundle for sitekey pattern
let foundSitekey = null;
for (const scriptUrl of bundles.slice(0, 20)) {
  try {
    const content = await new Promise((resolve, reject) => {
      const mod = scriptUrl.startsWith('https') ? https : http;
      let data = '';
      const req = mod.get(scriptUrl, {timeout: 5000}, (res) => {
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy());
    });

    // Search for Cloudflare Turnstile sitekey pattern (0x4...)
    const sitekeyMatches = content.match(/0x4[A-Za-z0-9_-]{10,60}/g);
    if (sitekeyMatches) {
      console.log(`\n*** SITEKEY FOUND in ${scriptUrl.split('/').pop()}:`);
      sitekeyMatches.forEach(k => console.log('  ', k));
      foundSitekey = sitekeyMatches[0];
      break;
    }

    // Also search for turnstile-related strings
    if (content.includes('turnstile') || content.includes('P1_')) {
      const idx = content.indexOf('turnstile');
      console.log(`Found 'turnstile' in ${scriptUrl.split('/').pop()}: ...${content.substring(Math.max(0,idx-20), idx+100)}...`);
    }
  } catch(e) {
    // ignore fetch errors
  }
}

if (!foundSitekey) {
  // Try to get from window env/config
  const envR = await ev(`(function(){
    // Search all script contents in memory
    var result = [];
    for (var k in window) {
      try {
        if (typeof window[k] === 'string' && window[k].startsWith('0x4') && window[k].length > 15) {
          result.push(k + '=' + window[k]);
        }
      } catch(e) {}
    }
    // Check next.js public env
    try {
      var nextData = window.__NEXT_DATA__;
      if (nextData) {
        var s = JSON.stringify(nextData);
        // Find any 0x4... pattern
        var m = s.match(/0x4[A-Za-z0-9_-]{10,60}/g);
        if (m) result.push('__NEXT_DATA__: ' + m.join(', '));
      }
    } catch(e) {}
    // Check process.env (sometimes exposed by webpack)
    try {
      var pe = typeof process !== 'undefined' ? process.env : {};
      var pes = JSON.stringify(pe);
      if (pes.includes('0x4')) {
        var m2 = pes.match(/0x4[A-Za-z0-9_-]{10,60}/g);
        if (m2) result.push('process.env: ' + m2.join(', '));
      }
    } catch(e) {}
    return result.join('\n') || 'none found';
  })()`);
  console.log("Window sitekey search:", v(envR));
}

// === STEP 2: Check what happens when we click Create ===
console.log("\n=== FILLING FORM AND CLICKING CREATE (monitoring ALL requests) ===");

// Fill textarea via fiber
const fillR = await ev(`(function(){
  var ta = Array.from(document.querySelectorAll('textarea')).find(el =>
    !el.placeholder || el.placeholder.includes('Leave blank') || el.placeholder.includes('lyrics') || el.placeholder.includes('Describe')
  ) || document.querySelector('textarea');
  if (!ta) return 'NO TEXTAREA';

  var fiberKey = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  if (!fiberKey) return 'NO FIBER';
  var fiber = ta[fiberKey];
  var node = fiber;
  while (node) {
    var props = node.memoizedProps || node.pendingProps;
    if (props && typeof props.onChange === 'function') {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Birthday song for my best friend');
      props.onChange({target: ta, currentTarget: ta, type: 'change', nativeEvent: {data: 'B', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
      return 'fiber OK depth=? value=' + ta.value.substring(0,30);
    }
    node = node.return;
  }
  return 'no onChange found';
})()`);
console.log("Fill:", v(fillR));

await new Promise(r => setTimeout(r, 1000));

// Install trap to capture sitekey from turnstile.render/execute calls
const trapR = await ev(`(function(){
  window.__sunoSitekeyUsed = null;
  window.__P1_captured = null;

  if (!window.turnstile) return 'no turnstile';

  function wrapCallback(p) {
    if (!p) return p;
    var orig = p.callback;
    if (typeof orig === 'function') {
      p.callback = function(tok) {
        console.log('[TRAP] callback fired! tok=' + (tok ? tok.substring(0,30) : 'null'));
        if (tok && tok.startsWith('P1_')) {
          window.__P1_captured = tok;
          console.log('[TRAP] P1_ CAPTURED len=' + tok.length);
        }
        return orig.apply(this, arguments);
      };
    }
    return p;
  }

  // Patch render
  var origRender = window.turnstile.render;
  window.turnstile.render = function(container, params) {
    var sk = params && params.sitekey;
    window.__sunoSitekeyUsed = sk;
    console.log('[TRAP] render() called! sitekey=' + sk + ' container=' + (typeof container === 'string' ? container : container?.id || container?.className || 'element'));
    if (params) wrapCallback(params);
    return origRender.call(window.turnstile, container, params);
  };

  // Patch execute
  var origExecute = window.turnstile.execute;
  window.turnstile.execute = function(container, params) {
    console.log('[TRAP] execute() called! container=' + JSON.stringify(container)?.substring(0,50));
    if (params) wrapCallback(params);
    return origExecute.call(window.turnstile, container, params);
  };

  return 'traps installed';
})()`);
console.log("Trap:", v(trapR));

// Check all buttons on the page
const btnsR = await ev(`(function(){
  var btns = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.textContent.trim().substring(0,20),
    disabled: b.disabled,
    type: b.type,
    cls: b.className.substring(0,40)
  }));
  return JSON.stringify(btns.slice(0,15));
})()`);
console.log("Buttons:", v(btnsR));

// Find and click Create button
const clickR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b => /^create$/i.test(b.textContent.trim()));
  if (!create) {
    // Try other possible Create button selectors
    var btns = Array.from(document.querySelectorAll('button'));
    create = btns.find(b => b.textContent.toLowerCase().includes('create') && !b.textContent.toLowerCase().includes('account'));
  }
  if (!create) return 'NO CREATE BTN';
  console.log('[test] clicking Create, disabled=' + create.disabled + ' text=' + create.textContent.trim());
  create.click();
  return 'clicked: ' + create.textContent.trim() + ' disabled=' + create.disabled;
})()`);
console.log("Click:", v(clickR));

// Wait and monitor
console.log("\nMonitoring for 20 seconds...");
let captured = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const checkR = await ev(`JSON.stringify({
    p1: window.__P1_captured ? window.__P1_captured.substring(0,30) : null,
    sitekey: window.__sunoSitekeyUsed,
    url: window.location.href,
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    allIframes: document.querySelectorAll('iframe').length,
  })`);
  const state = JSON.parse(v(checkR) || '{}');

  if (state.p1) {
    console.log(`\n=== P1_ TOKEN CAPTURED! ===`);
    captured = state.p1; // just first 30 chars
    break;
  }
  if (state.sitekey) {
    console.log(`\n*** SITEKEY USED: ${state.sitekey} ***`);
    foundSitekey = state.sitekey;
  }
  if (i % 3 === 0 || state.cfIframes > 0) {
    console.log(`[${i+1}s] cfIframes=${state.cfIframes} allIframes=${state.allIframes} sitekey=${state.sitekey || 'none'} url=${state.url.substring(40)}`);
  }
}

// Get full token if captured
if (captured) {
  const fullR = await ev("window.__P1_captured || ''");
  const fullToken = v(fullR);
  console.log("Full token length:", fullToken?.length);
  if (fullToken?.startsWith("P1_")) {
    const { writeFileSync } = await import("fs");
    const { execSync } = await import("child_process");
    writeFileSync("/home/alexander/projects/suno_passkey.txt", fullToken);
    execSync("sudo systemctl restart suno-api", {timeout: 30000});
    await new Promise(r => setTimeout(r, 5000));
    const check = await new Promise(resolve => {
      http.get("http://localhost:3000/api/get_limit", (res) => {
        let d = ""; res.on("data", x => d += x); res.on("end", () => resolve(d));
      }).on("error", () => resolve("error"));
    });
    console.log("suno-api after restart:", check);
  }
}

// Print network log summary
console.log("\n=== NETWORK LOG SUMMARY ===");
console.log("Total requests:", netLog.length);
const relevant = netLog.filter(r => r.url.includes("studio") || r.url.includes("generate") || r.url.includes("cloudflare") || r.url.includes("turnstile"));
console.log("Relevant requests:", relevant.length);
relevant.forEach(r => console.log(`  ${r.method} ${r.url.substring(0,100)}`));

if (foundSitekey) {
  console.log("\n\nFOUND SITEKEY:", foundSitekey);
} else {
  console.log("\n\nSITEKEY NOT FOUND. Possible approaches:");
  console.log("1. Navigate to suno.com/create fresh (page reload) then try again");
  console.log("2. Check if Turnstile is handled server-side");
  console.log("3. Look at Next.js bundle files manually");
}

ws.close();
