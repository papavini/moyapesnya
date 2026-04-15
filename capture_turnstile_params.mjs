/**
 * Устанавливаем trap через addScriptToEvaluateOnNewDocument (запускается ДО SUNO скриптов),
 * перезагружаем страницу, ловим ВСЕ параметры turnstile.render() вкл. cdata/action,
 * затем повторяем render с теми же параметрами → получаем валидный токен.
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
let capturedToken = null;
let capturedRenderParams = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("challenges.cloudflare") || url.includes("studio-api")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m) {
      const txt = m.text || '';
      if (txt.includes('[capture]') || txt.includes('[trap]') || txt.includes('P1_') || txt.includes('[test]')) {
        console.log(`[CON ${m.level}] ${txt.substring(0,300)}`);
      }
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr, ap=false) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// === STEP 1: Install trap BEFORE page loads ===
// addScriptToEvaluateOnNewDocument runs before ANY page script
console.log("Installing pre-load trap...");
const trapScript = `
(function() {
  window.__allTurnstileRenders = [];
  window.__capturedToken = null;

  function installTurnstileTrap() {
    if (!window.turnstile || window.turnstile.__captureTrap) return;
    window.turnstile.__captureTrap = true;

    var origRender = window.turnstile.render;
    window.turnstile.render = function(container, params) {
      var paramsCopy = {};
      try { paramsCopy = JSON.parse(JSON.stringify(params || {})); } catch(e) {}
      // Remove callback from copy (not serializable)
      delete paramsCopy.callback;
      delete paramsCopy['error-callback'];
      delete paramsCopy['expired-callback'];
      delete paramsCopy['before-interactive-callback'];
      delete paramsCopy['after-interactive-callback'];
      delete paramsCopy['unsupported-callback'];

      console.log('[capture] turnstile.render() sitekey=' + paramsCopy.sitekey + ' action=' + paramsCopy.action + ' cdata=' + JSON.stringify(paramsCopy.cdata) + ' all=' + JSON.stringify(paramsCopy).substring(0,200));

      // Wrap callback to capture token
      if (params && typeof params.callback === 'function') {
        var origCb = params.callback;
        params.callback = function(token) {
          console.log('[capture] render callback! len=' + (token||'').length + ' starts=' + (token||'').substring(0,20));
          window.__capturedToken = token;
          window.__allTurnstileRenders.push({params: paramsCopy, token: token});
          return origCb.apply(this, arguments);
        };
      }

      var result = origRender.apply(this, arguments);
      console.log('[capture] render returned widgetId=' + result);
      window.__allTurnstileRenders.push({params: paramsCopy, widgetId: result, token: null});
      return result;
    };

    var origExecute = window.turnstile.execute;
    window.turnstile.execute = function() {
      console.log('[capture] turnstile.execute() args=' + JSON.stringify(Array.from(arguments)).substring(0,100));
      return origExecute.apply(this, arguments);
    };

    var origImplicit = window.turnstile.implicitRender;
    if (typeof origImplicit === 'function') {
      window.turnstile.implicitRender = function() {
        console.log('[capture] turnstile.implicitRender()');
        return origImplicit.apply(this, arguments);
      };
    }

    console.log('[capture] Turnstile trap installed!');
  }

  // Trap when turnstile becomes available
  if (window.turnstile) {
    installTurnstileTrap();
  } else {
    var origDesc = Object.getOwnPropertyDescriptor(window, 'turnstile');
    var _val = undefined;
    Object.defineProperty(window, 'turnstile', {
      get: function() { return _val; },
      set: function(v) {
        _val = v;
        console.log('[capture] window.turnstile assigned! type=' + typeof v);
        installTurnstileTrap();
      },
      configurable: true
    });
  }

  // Also trap fetch to see generate requests
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var u = (typeof url === 'string' ? url : url.url || '');
    if (u.includes('generate/v2') || u.includes('studio-api')) {
      var body = opts && opts.body;
      console.log('[capture] fetch ' + (opts&&opts.method||'GET') + ' ' + u.substring(0,80));
      if (body) {
        try { var p = JSON.parse(body); console.log('[capture] fetch body token=' + (p.token||'').substring(0,30)); } catch(e) {}
      }
    }
    return origFetch.apply(this, arguments);
  };

  console.log('[capture] Pre-load trap installed');
})();
`;

await send("Page.addScriptToEvaluateOnNewDocument", {source: trapScript});
console.log("Pre-load trap installed.");

// === STEP 2: Navigate to fresh /create ===
console.log("\nNavigating to fresh /create...");
await send("Page.navigate", {url: "https://suno.com/create"});

// Wait for page to fully load
let loadDone = false;
const loadTimeout = setTimeout(() => { loadDone = true; }, 8000);
ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.method === "Page.loadEventFired" || d.method === "Page.domContentEventFired") {
    // Small additional wait for dynamic content
    setTimeout(() => { loadDone = true; clearTimeout(loadTimeout); }, 2000);
  }
});

// Also check via polling
let waited = 0;
while (!loadDone && waited < 10000) {
  await new Promise(r => setTimeout(r, 500));
  waited += 500;
}
console.log("Page loaded (waited ~" + waited + "ms)");

// === STEP 3: Check what was captured ===
const capturedR = await ev(`JSON.stringify({
  renders: window.__allTurnstileRenders ? window.__allTurnstileRenders.length : 0,
  token: window.__capturedToken ? window.__capturedToken.substring(0,30) : null,
  renderDetails: window.__allTurnstileRenders ? window.__allTurnstileRenders.map(r => ({
    sitekey: r.params && r.params.sitekey,
    action: r.params && r.params.action,
    cdata: r.params && r.params.cdata,
    widgetId: r.widgetId,
    hasToken: !!r.token
  })) : []
})`);
const captured = JSON.parse(v(capturedR) || '{}');
console.log("\n=== CAPTURED TURNSTILE DATA ===");
console.log("Renders:", captured.renders);
console.log("Token:", captured.token);
console.log("Details:", JSON.stringify(captured.renderDetails, null, 2));

// If token was captured during page load, use it
if (captured.token) {
  const fullR = await ev("window.__capturedToken || ''");
  capturedToken = v(fullR);
  console.log("Using token from page-load render!");
}

// === STEP 4: If no token yet, fill form and click Create ===
if (!capturedToken) {
  console.log("\n=== No token from page load, filling form and clicking Create ===");

  // Install form fill
  const fillR = await ev(`(function(){
    var results = [];
    var textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
    results.push('visible textareas: ' + textareas.length);
    textareas.forEach((t, i) => {
      console.log('[test] ta[' + i + '] ph="' + t.placeholder.substring(0,50) + '" val="' + t.value.substring(0,20) + '"');
    });

    // Fill first visible textarea
    var ta = textareas[0];
    if (ta) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Happy birthday song for a best friend pop upbeat');
      var fk = Object.keys(ta).find(k => k.startsWith('__reactFiber'));
      if (fk) {
        var node = ta[fk];
        while (node) {
          var p = node.memoizedProps;
          if (p && typeof p.onChange === 'function') {
            p.onChange({target: ta, currentTarget: ta, type: 'change', nativeEvent: {data: 'H', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
            results.push('fiber onChange called for ta[0], val=' + ta.value.substring(0,20));
            break;
          }
          node = node.return;
        }
      }
      ta.dispatchEvent(new Event('input', {bubbles: true}));
    }

    return results.join(' | ');
  })()`);
  console.log("Fill:", v(fillR));
  await new Promise(r => setTimeout(r, 500));

  const clickR = await ev(`(function(){
    var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
    console.log('[test] create buttons: ' + creates.length);
    creates.forEach((b, i) => {
      var r = b.getBoundingClientRect();
      console.log('[test] btn[' + i + '] x=' + Math.round(r.x) + ' y=' + Math.round(r.y) + ' dis=' + b.disabled);
    });
    var btn = creates.find(b => !b.disabled && b.getBoundingClientRect().x > 100) || creates[creates.length-1];
    if (!btn) return 'NO BTN';
    btn.click();
    return 'clicked: x=' + Math.round(btn.getBoundingClientRect().x) + ' y=' + Math.round(btn.getBoundingClientRect().y);
  })()`);
  console.log("Click:", v(clickR));

  // Wait and monitor for token
  console.log("Monitoring 30s...");
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const checkR = await ev(`JSON.stringify({
      token: window.__capturedToken ? window.__capturedToken.substring(0,30) : null,
      renders: window.__allTurnstileRenders ? window.__allTurnstileRenders.length : 0,
      cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    })`);
    const s = JSON.parse(v(checkR) || '{}');
    if (s.token) {
      const fullR = await ev("window.__capturedToken || ''");
      capturedToken = v(fullR);
      console.log(`\n[${i+1}s] TOKEN CAPTURED! len=${capturedToken.length}`);
      break;
    }
    if (s.cfIframes > 0) console.log(`[${i+1}s] CF iframes: ${s.cfIframes}`);
    if (s.renders > 0) console.log(`[${i+1}s] renders: ${s.renders}`);
    if (i % 5 === 4) {
      const lastR = await ev("JSON.stringify(window.__allTurnstileRenders ? window.__allTurnstileRenders.map(r => ({sk: r.params&&r.params.sitekey, cd: r.params&&r.params.cdata, tok: r.token&&r.token.substring(0,20)})) : [])");
      console.log(`[${i+1}s] renders detail: ${v(lastR)}`);
    }
  }
}

ws.close();

if (capturedToken && capturedToken.length > 50) {
  console.log(`\n=== SAVING TOKEN len=${capturedToken.length} starts=${capturedToken.substring(0,30)} ===`);
  writeFileSync("/home/alexander/projects/suno_passkey.txt", capturedToken);
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 4000));

  // Test immediately
  const testResult = await new Promise(resolve => {
    const pd = JSON.stringify({prompt: "Happy birthday", tags: "pop", title: "Test", make_instrumental: false, wait_audio: false});
    const req = http.request({host:"localhost",port:3000,path:"/api/custom_generate",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pd)}}, res => {
      let d = ""; res.on("data",x=>d+=x); res.on("end",()=>resolve({status:res.statusCode,body:d.substring(0,200)}));
    });
    req.on("error", e=>resolve({error:e.message}));
    req.write(pd); req.end();
  });
  console.log("Generate test:", JSON.stringify(testResult));
} else {
  console.log("\n❌ No token captured.");
}
