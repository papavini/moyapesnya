/**
 * Напрямую вызываем window.turnstile.render/execute в RDP Chromium.
 * Ищем sitekey, форсируем генерацию P1_ токена без клика Create.
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

const tabs = await getTabs(9223);
const page = tabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!page) { console.log("No RDP suno page!"); process.exit(1); }
console.log("Page:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1; const cbs = {};

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    console.log(`[INTERCEPT] ${d.params?.request?.method} ${url.substring(0,100)}`);
    if (body) {
      console.log(`[BODY] ${body.substring(0,500)}`);
      try {
        const p = JSON.parse(body);
        if (p.token) console.log(`\n*** BODY TOKEN: ${p.token.substring(0,40)} ***\n`);
      } catch(e) {}
    }
    // Fail generate requests to save credits; continue others
    if (url.includes("generate/v2-web") || url.includes("generate/v2")) {
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
    } else {
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    }
  }
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("generate") || url.includes("studio-api") || url.includes("challenges.cloudflare")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m && (m.text?.includes("P1_") || m.text?.includes("TRAP") || m.text?.includes("token") || m.text?.includes("error")))
      console.log(`[CON ${m.level}] ${m.text?.substring(0,150)}`);
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr, awaitPromise=false) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");
await send("Fetch.enable", {patterns: [
  {urlPattern: "*studio-api*", requestStage: "Request"},
  {urlPattern: "*generate/v2*", requestStage: "Request"},
]});

// === STEP 1: Diagnose Turnstile state ===
const diagR = await ev(`(function(){
  var result = {
    turnstileType: typeof window.turnstile,
    turnstileMethods: window.turnstile ? Object.keys(window.turnstile).join(',') : 'N/A',
  };

  // Find sitekey from iframes
  var iframes = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare"]'));
  result.cfIframes = iframes.length;
  if (iframes.length > 0) {
    result.iframeSrc = iframes[0].src.substring(0, 120);
    var m = iframes[0].src.match(/[?&]k=([^&]+)/);
    if (m) result.sitekey = decodeURIComponent(m[1]);
  }

  // Check data-sitekey attributes
  var sitekeyEl = document.querySelector('[data-sitekey]');
  if (sitekeyEl) result.dataSitekey = sitekeyEl.dataset.sitekey;

  // Search in __NEXT_DATA__
  try {
    var nd = window.__NEXT_DATA__;
    if (nd) {
      var str = JSON.stringify(nd);
      var m2 = str.match(/"(?:siteKey|sitekey|site_key)"\s*:\s*"([^"]{5,60})"/i);
      if (m2) result.nextDataSitekey = m2[1];
      // Also check for turnstile
      var m3 = str.match(/"(?:turnstileSiteKey|TURNSTILE)[^"]*"\s*:\s*"([^"]{5,60})"/i);
      if (m3) result.nextDataTurnstile = m3[1];
    }
  } catch(e) { result.nextDataErr = e.message; }

  // Check window vars
  var winKeys = Object.keys(window).filter(k => k.toLowerCase().includes('turnstile') || k.toLowerCase().includes('sitekey') || k.toLowerCase().includes('cloudflare'));
  result.windowTurnstileKeys = winKeys.join(',');

  // Check env vars in Next.js
  try {
    var env = window.__NEXT_DATA__?.props?.pageProps || {};
    var envStr = JSON.stringify(env);
    result.envSnippet = envStr.substring(0, 200);
  } catch(e) {}

  // Check existing rendered widget IDs
  if (window.turnstile && window.turnstile.getResponse) {
    result.widgetCheck = 'has getResponse';
  }

  return JSON.stringify(result, null, 2);
})()`);
console.log("\n=== TURNSTILE DIAGNOSTICS ===");
console.log(v(diagR));

// === STEP 2: Search for sitekey in JS ===
const skSearchR = await ev(`(function(){
  // Look at all script tags for sitekey
  var scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  // Check meta tags
  var metas = Array.from(document.querySelectorAll('meta')).map(m => m.name+'='+m.content).filter(s => s.includes('site') || s.includes('turnstile') || s.includes('key'));

  // Check inline scripts for sitekey pattern
  var inline = Array.from(document.querySelectorAll('script:not([src])')).map(s => s.textContent).join(' ');
  var m = inline.match(/0x4[A-Za-z0-9]{20,50}/g);

  // Search window.ENV or similar
  var envMatches = [];
  ['ENV', 'env', '_env', '__env', 'CONFIG', 'config', '_config'].forEach(k => {
    if (window[k]) {
      var s = JSON.stringify(window[k]);
      if (s.includes('turnstile') || s.includes('0x4')) envMatches.push(k + ':' + s.substring(0,100));
    }
  });

  // Check process.env exposure via Next.js
  var nextEnv = null;
  try {
    // Next.js exposes some env vars as NEXT_PUBLIC_*
    var ndata = window.__NEXT_DATA__;
    var runtimeConfig = ndata?.runtimeConfig || ndata?.publicRuntimeConfig;
    if (runtimeConfig) nextEnv = JSON.stringify(runtimeConfig).substring(0, 300);
  } catch(e) {}

  return JSON.stringify({
    inlineSitekeyMatches: m || [],
    metas,
    envMatches,
    nextEnv,
    scriptCount: scripts.length,
    scripts: scripts.slice(0,5)
  }, null, 2);
})()`);
console.log("\n=== SITEKEY SEARCH ===");
console.log(v(skSearchR));

// === STEP 3: Search network requests for sitekey ===
await send("Network.enable");
const cfR = await ev(`(function(){
  // Try to get sitekey from already-loaded Turnstile via window.turnstile internals
  if (!window.turnstile) return 'no turnstile';
  var ts = window.turnstile;
  // Check for internal state
  var internals = {};
  for (var k in ts) {
    try {
      var v = ts[k];
      if (typeof v !== 'function') internals[k] = JSON.stringify(v).substring(0, 50);
    } catch(e) {}
  }
  // Also check prototype chain
  var proto = Object.getPrototypeOf(ts);
  var protoKeys = proto ? Object.getOwnPropertyNames(proto) : [];

  return JSON.stringify({internals, protoKeys, allKeys: Object.getOwnPropertyNames(ts)});
})()`);
console.log("\n=== TURNSTILE INTERNALS ===");
console.log(v(cfR));

// === STEP 4: Try to force token via render ===
console.log("\n=== TRYING TURNSTILE RENDER ===");

// First, check what sitekey to use
const skResult = await ev(`(function(){
  // Try to get sitekey from challenge iframe
  var frames = document.querySelectorAll('iframe');
  for (var f of frames) {
    if (f.src && f.src.includes('challenges.cloudflare')) {
      var m = f.src.match(/[?&]k=([A-Za-z0-9_-]+)/);
      if (m) return 'iframe:' + m[1];
    }
  }
  // Try from any turnstile container
  var containers = document.querySelectorAll('[data-sitekey],[id*="turnstile"],[class*="turnstile"],[id*="cf-"]');
  if (containers.length > 0) {
    return 'container: ' + containers[0].id + '|' + containers[0].className + '|' + containers[0].dataset.sitekey;
  }
  return 'not found in DOM';
})()`);
console.log("Sitekey from DOM:", v(skResult));

// Try to force render a new invisible widget
const renderR = await ev(`(async function(){
  if (!window.turnstile) return 'no turnstile object';

  window.__P1_force_captured = null;

  // Try the known SUNO sitekey (commonly used)
  var sitekeys = [
    '0x4AAAAAAABKgHDnh8qpbMaA',  // likely SUNO's key
    '0x4AAAAAAAC0m8fU8M3V4G3v',
    '0x4AAAAAAABc6FYf0Px6WaYa',
  ];

  // First try to get from DOM
  var domSitekey = null;
  var frames = document.querySelectorAll('iframe');
  for (var f of frames) {
    if (f.src && f.src.includes('challenges.cloudflare')) {
      var m = f.src.match(/[?&]k=([A-Za-z0-9_-]+)/);
      if (m) { domSitekey = m[1]; break; }
    }
  }
  if (domSitekey) sitekeys.unshift(domSitekey);

  console.log('[force] Found sitekeys to try:', sitekeys.length, 'DOM key:', domSitekey);

  // Create a container
  var container = document.createElement('div');
  container.id = '__cf_turnstile_force';
  container.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(container);

  // Try render with first sitekey
  try {
    var widgetId = window.turnstile.render('#__cf_turnstile_force', {
      sitekey: sitekeys[0],
      action: 'generate',
      appearance: 'never',
      size: 'invisible',
      callback: function(token) {
        window.__P1_force_captured = token;
        console.log('[force] CALLBACK FIRED! token len=' + token.length + ' starts=' + token.substring(0,20));
      },
      'error-callback': function(err) {
        console.log('[force] ERROR CALLBACK: ' + JSON.stringify(err));
      },
      'expired-callback': function() {
        console.log('[force] EXPIRED CALLBACK');
      }
    });
    console.log('[force] render() widgetId=' + widgetId);
    return 'render called, widgetId=' + widgetId + ', sitekey=' + sitekeys[0];
  } catch(e) {
    return 'render error: ' + e.message;
  }
})()`);
console.log("Render attempt:", v(renderR));

// Wait and poll for token
console.log("\nPolling for forced P1_ token (30s)...");
let capturedToken = null;
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1000));
  const checkR = await ev("window.__P1_force_captured || window.__P1_captured || ''");
  const tok = v(checkR);
  if (tok && tok.startsWith("P1_")) {
    capturedToken = tok;
    console.log("\n=== FORCED P1_ TOKEN CAPTURED! length=" + tok.length + " ===");
    break;
  }
  // Check if widget changed state
  const stateR = await ev(`(function(){
    var container = document.getElementById('__cf_turnstile_force');
    if (!container) return 'no container';
    var iframe = container.querySelector('iframe');
    return JSON.stringify({
      hasIframe: !!iframe,
      iframeSrc: iframe?.src?.substring(0, 80),
      containerHtml: container.innerHTML.substring(0, 100),
      p1: window.__P1_force_captured ? 'HAS:'+window.__P1_force_captured.substring(0,20) : 'none',
    });
  })()`);
  const elapsed = Math.round((Date.now() - (deadline - 30000)) / 1000);
  if (elapsed % 5 === 0) console.log(`[${elapsed}s] State:`, v(stateR));
}

ws.close();

if (capturedToken && capturedToken.startsWith("P1_")) {
  console.log("\n=== SAVING TOKEN ===");
  writeFileSync("/home/alexander/projects/suno_passkey.txt", capturedToken);
  console.log("Saved to suno_passkey.txt");
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 5000));
  const check = await new Promise(resolve => {
    http.get("http://localhost:3000/api/get_limit", (res) => {
      let d = ""; res.on("data", x => d += x); res.on("end", () => resolve(d));
    }).on("error", () => resolve("error"));
  });
  console.log("suno-api after restart:", check);
} else {
  console.log("\n❌ No token captured.");
  console.log("Need to investigate why turnstile.render() doesn't fire callback.");
}
