/**
 * Читаем cf-turnstile-response из RDP Chromium напрямую
 * + проверяем правильный SUNO API endpoint
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

async function getTabs(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function cdpEval(wsUrl, exprs) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on("open", r));
  const results = {};
  ws.on("message", (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id) results[d.id] = d.result?.result?.value ?? d.result?.result?.description ?? JSON.stringify(d.result?.result);
  });
  let id = 0;
  for (const [key, expr] of Object.entries(exprs)) {
    id++;
    ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: true}}));
    results[key] = id;
    await new Promise(r => setTimeout(r, 600));
  }
  ws.close();
  const named = {};
  Object.entries(exprs).forEach(([key], i) => {
    named[key] = results[i+1];
  });
  return named;
}

// === RDP Chromium (9223) ===
console.log("=== Reading from RDP Chromium (9223) ===");
const rdpTabs = await getTabs(9223);
const rdpSuno = rdpTabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!rdpSuno) { console.log("No RDP suno page!"); }
else {
  console.log("RDP tab:", rdpSuno.url);
  const r = await cdpEval(rdpSuno.webSocketDebuggerUrl, {
    // Read cf-turnstile-response hidden input
    turnstile_token: `(function(){
      var inp = document.querySelector('input[name="cf-turnstile-response"]');
      if (!inp) return 'NO FIELD';
      return inp.value ? inp.value.substring(0,40)+'...(len='+inp.value.length+')' : 'EMPTY';
    })()`,
    // Check window.turnstile
    has_turnstile: "typeof window.turnstile",
    // Get sitekey from turnstile widget
    sitekey: `(function(){
      var div = document.querySelector('[data-sitekey],.cf-turnstile');
      return div ? div.getAttribute('data-sitekey')||'no-attr' : 'NO WIDGET';
    })()`,
    // Check URL the page uses for generate
    studio_url: `(function(){
      // Check network config from window
      if (window.__ENV) return JSON.stringify(window.__ENV);
      if (window.__NEXT_DATA__) return JSON.stringify(Object.keys(window.__NEXT_DATA__));
      return 'no env';
    })()`,
    // Navigate to /create if not there
    nav: `window.location.href.includes('/create') ? 'already on create' : (window.location.href = 'https://suno.com/create', 'navigating...')`,
  });
  console.log("Turnstile token:", r.turnstile_token);
  console.log("window.turnstile:", r.has_turnstile);
  console.log("Sitekey:", r.sitekey);
  console.log("Studio URL:", r.studio_url?.substring?.(0,100));
  console.log("Nav:", r.nav);
}

// Wait for navigation
await new Promise(r => setTimeout(r, 4000));

// Read again after navigation to /create
if (rdpSuno) {
  const rdpTabs2 = await getTabs(9223);
  const rdpCreate = rdpTabs2.find(t => t.url?.includes("suno.com") && t.type === "page");
  if (rdpCreate && rdpCreate.url !== rdpSuno.url) {
    console.log("\n=== After navigation to create ===");
    const r2 = await cdpEval(rdpCreate.webSocketDebuggerUrl, {
      url: "window.location.href",
      turnstile_token: `(function(){
        var inp = document.querySelector('input[name="cf-turnstile-response"]');
        if (!inp) return 'NO FIELD';
        return inp.value ? inp.value.substring(0,50)+'...(len='+inp.value.length+')' : 'EMPTY';
      })()`,
      sitekey: `(function(){
        var div = document.querySelector('[data-sitekey],.cf-turnstile,[data-cf-turnstile]');
        return div ? (div.getAttribute('data-sitekey') || JSON.stringify(div.dataset)) : 'NO WIDGET';
      })()`,
    });
    console.log("URL:", r2.url);
    console.log("Turnstile token:", r2.turnstile_token);
    console.log("Sitekey:", r2.sitekey);
  }
}

// === Bot Chromium (9222) — check same ===
console.log("\n=== Bot Chromium (9222) ===");
const botTabs = await getTabs(9222);
const botSuno = botTabs.find(t => t.url?.includes("suno.com/create") && t.type === "page");
if (botSuno) {
  const r3 = await cdpEval(botSuno.webSocketDebuggerUrl, {
    turnstile_token: `(function(){
      var inp = document.querySelector('input[name="cf-turnstile-response"]');
      if (!inp) return 'NO FIELD';
      return inp.value ? inp.value.substring(0,40)+'...(len='+inp.value.length+')' : 'EMPTY';
    })()`,
    sitekey: `(function(){
      var div = document.querySelector('[data-sitekey],.cf-turnstile');
      return div ? div.getAttribute('data-sitekey') : 'NO WIDGET';
    })()`,
    has_turnstile: "typeof window.turnstile",
  });
  console.log("Bot turnstile token:", r3.turnstile_token);
  console.log("Bot sitekey:", r3.sitekey);
  console.log("Bot window.turnstile:", r3.has_turnstile);
}

// Check suno-api URL config
console.log("\n=== suno-api config ===");
const envResult = await new Promise(resolve => {
  http.get("http://localhost:3000/api/get_limit", (res) => {
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => resolve(data));
  }).on("error", () => resolve("failed"));
});
console.log("suno-api credits:", envResult);
