/**
 * Перехватываем реальный generate запрос из браузера.
 * KEY INSIGHT: После клика Create появляется диалог "10 credits" — нужен второй клик.
 *
 * Алгоритм:
 * 1. addScriptToEvaluateOnNewDocument: wrap fetch + XHR + turnstile
 * 2. navigate /create → Advanced → fill lyrics → click Create
 * 3. Ждём диалог подтверждения → кликаем confirm
 * 4. Перехватываем generate запрос → извлекаем token
 * 5. Сохраняем token, рестартуем suno-api, тестируем
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import { writeFileSync } from "fs";
import { execFileSync } from "child_process";

async function getTabs(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const tabs = await getTabs(9223);
const page = tabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!page) { console.log("No RDP suno page!"); process.exit(1); }
console.log("Page:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let nextId = 1; const cbs = {};
let capturedGenerateBody = null;
let capturedGenerateToken = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }

  // Network level: see raw requests
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    const method = d.params?.request?.method || "GET";
    if (url.includes("generate/v2") || url.includes("studio-api-prod") || url.includes("studio-api.prod")) {
      const body = d.params?.request?.postData || "";
      console.log(`[NET] ${method} ${url.substring(0, 100)}`);
      if (body) {
        console.log(`[NET-BODY] ${body.substring(0, 300)}`);
        if (!capturedGenerateBody) {
          capturedGenerateBody = body;
          try {
            const parsed = JSON.parse(body);
            if (parsed.token !== undefined) capturedGenerateToken = String(parsed.token || "");
          } catch(e) {}
        }
      }
    }
    if (url.includes("challenges.cloudflare")) {
      console.log(`[CF] ${method} ${url.substring(0, 120)}`);
    }
  }

  // Fetch interception level
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    if (url.includes("generate/v2") || url.includes("studio-api")) {
      console.log(`[FETCH-PAUSED] ${d.params?.request?.method} ${url.substring(0, 100)}`);
      const body = d.params?.request?.postData || "";
      if (body) {
        console.log(`[FETCH-BODY] ${body.substring(0, 300)}`);
        if (!capturedGenerateBody) {
          capturedGenerateBody = body;
          try {
            const parsed = JSON.parse(body);
            if (parsed.token !== undefined) capturedGenerateToken = String(parsed.token || "");
          } catch(e) {}
        }
      }
      // Continue the request (don't block it)
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    } else {
      // Continue everything else
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    }
  }

  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    const txt = m?.text || '';
    if (txt.includes('[gen]') || txt.includes('[turn]') || txt.includes('[dial]') || txt.includes('error') || txt.includes('Error')) {
      console.log(`[CON ${m.level}] ${txt.substring(0, 300)}`);
    }
  }
});

function send(method, params={}) {
  return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); });
}
function ev(expr) {
  return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, returnByValue: false}})); });
}
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

// Enable all intercepts
await send("Network.enable");
await send("Console.enable");

// Fetch.enable to intercept generate requests (non-blocking — just log body)
await send("Fetch.enable", {
  patterns: [
    {urlPattern: "*generate/v2*", requestStage: "Request"},
    {urlPattern: "*studio-api*generate*", requestStage: "Request"},
  ]
});

// === STEP 1: Install JS-level interceptor ===
const trapScript = `
(function() {
  if (window.__genTrapInstalled) { console.log('[gen] trap already installed'); return; }
  window.__genTrapInstalled = true;
  window.__capturedGenBody = null;
  window.__capturedToken = null;

  // Wrap fetch
  var _origFetch = window.fetch;
  window.fetch = function(resource, init) {
    var url = (typeof resource === 'string') ? resource : (resource && resource.url) || '';
    if (url.includes('generate/v2') || (url.includes('studio-api') && init && init.method === 'POST')) {
      var body = (init && init.body) || '';
      console.log('[gen] fetch POST ' + url.substring(0, 80));
      if (body) {
        window.__capturedGenBody = String(body).substring(0, 2000);
        try {
          var p = JSON.parse(body);
          if (p.token !== undefined) {
            window.__capturedToken = p.token;
            console.log('[gen] token captured len=' + String(p.token || '').length + ' starts=' + String(p.token || '').substring(0, 20));
          } else {
            console.log('[gen] token field missing, keys=' + Object.keys(p).join(','));
          }
        } catch(e) { console.log('[gen] body parse err: ' + e.message); }
      }
    }
    return _origFetch.apply(this, arguments);
  };

  // Wrap turnstile
  function wrapTurnstile(ts) {
    if (!ts || ts.__wrapped2) return;
    ts.__wrapped2 = true;
    var _or = ts.render;
    ts.render = function(container, params) {
      var pCopy = {};
      try { pCopy = JSON.parse(JSON.stringify(params || {})); delete pCopy.callback; } catch(e){}
      console.log('[turn] render! sk=' + pCopy.sitekey + ' action=' + pCopy.action + ' cdata=' + JSON.stringify(pCopy.cdata));
      if (params && typeof params.callback === 'function') {
        var _cb = params.callback;
        params.callback = function(tok) {
          console.log('[turn] callback! len=' + (tok||'').length + ' starts=' + (tok||'').substring(0, 20));
          window.__turnToken = tok;
          return _cb.apply(this, arguments);
        };
      }
      return _or.apply(this, arguments);
    };
    console.log('[turn] turnstile wrapped!');
  }

  if (window.turnstile) { wrapTurnstile(window.turnstile); }
  try {
    var _tsVal = window.turnstile;
    Object.defineProperty(window, 'turnstile', {
      get: function() { return _tsVal; },
      set: function(v) { _tsVal = v; wrapTurnstile(v); },
      configurable: true, enumerable: true
    });
  } catch(e) { console.log('[turn] defineProperty err: ' + e.message); }

  console.log('[gen] interceptors installed');
})();
`;

await send("Page.addScriptToEvaluateOnNewDocument", {source: trapScript});
console.log("Trap script installed.");

// === STEP 2: Navigate fresh ===
console.log("\nNavigating to /create...");
await send("Page.navigate", {url: "https://suno.com/create"});
await sleep(6000);

// Check state
const stateR = await ev(`JSON.stringify({
  turnstile: typeof window.turnstile,
  trapped: window.turnstile && window.turnstile.__wrapped2,
  trapInstalled: !!window.__genTrapInstalled,
})`);
console.log("Page state:", v(stateR));

// === STEP 3: Switch to Advanced ===
const advR = await ev(`(function(){
  var btns = Array.from(document.querySelectorAll('button'));
  var adv = btns.find(b => /^advanced$/i.test(b.textContent.trim()));
  if (!adv) return 'NO ADV. Buttons: ' + btns.slice(0,10).map(b=>b.textContent.trim().substring(0,15)).join('|');
  adv.click();
  return 'Clicked Advanced. wasActive=' + adv.className.includes('active');
})()`);
console.log("Advanced:", v(advR));
await sleep(600);

// === STEP 4: Fill lyrics textarea via React fiber ===
const fillR = await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
  if (!tas.length) return 'NO TEXTAREA';
  var lyricTA = tas.find(t => t.placeholder && (t.placeholder.includes('lyrics') || t.placeholder.includes('blank'))) || tas[0];

  // Set value via React internal setter
  var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(lyricTA, 'Happy birthday to you, make it pop upbeat');

  // Trigger React via fiber
  var fk = Object.keys(lyricTA).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  var fiberFound = false;
  if (fk) {
    var node = lyricTA[fk];
    var tries = 0;
    while (node && tries++ < 50) {
      var p = node.memoizedProps;
      if (p && typeof p.onChange === 'function') {
        try {
          p.onChange({target: lyricTA, currentTarget: lyricTA, type: 'change', nativeEvent: {data:'H',inputType:'insertText'}, preventDefault:function(){}, stopPropagation:function(){}});
          fiberFound = true;
        } catch(e) { return 'fiber onChange err: ' + e.message; }
        break;
      }
      node = node.return;
    }
  }
  lyricTA.dispatchEvent(new Event('input', {bubbles:true}));
  lyricTA.dispatchEvent(new Event('change', {bubbles:true}));
  return 'filled: val="' + lyricTA.value.substring(0,30) + '" fiber=' + fiberFound + ' ph="' + lyricTA.placeholder.substring(0,30) + '"';
})()`);
console.log("Fill lyrics:", v(fillR));
await sleep(800);

// === STEP 5: Check Create button state ===
const btnR = await ev(`JSON.stringify(
  Array.from(document.querySelectorAll('button'))
    .filter(b => /^create$/i.test(b.textContent.trim()))
    .map(b => ({dis:b.disabled, x:Math.round(b.getBoundingClientRect().x), y:Math.round(b.getBoundingClientRect().y), cls:b.className.substring(0,40)}))
)`);
console.log("Create buttons:", v(btnR));

// === STEP 6: Click Create ===
const clickR = await ev(`(function(){
  var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
  // Prefer the form button (not nav link)
  var btn = creates.find(b => !b.disabled && b.getBoundingClientRect().x > 100);
  if (!btn) btn = creates.find(b => b.getBoundingClientRect().x > 100);
  if (!btn) btn = creates[creates.length - 1];
  if (!btn) return 'NO CREATE BTN';
  var rect = btn.getBoundingClientRect();
  console.log('[gen] clicking Create x=' + Math.round(rect.x) + ' y=' + Math.round(rect.y) + ' disabled=' + btn.disabled);
  btn.click();
  btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  return 'clicked: dis=' + btn.disabled + ' x=' + Math.round(rect.x);
})()`);
console.log("Click Create:", v(clickR));

// === STEP 7: Wait for dialog and click confirm ===
console.log("\nWaiting for confirmation dialog...");
await sleep(1500);

for (let attempt = 0; attempt < 5; attempt++) {
  const dialogR = await ev(`(function(){
    // Look for dialog / modal / confirm buttons
    var results = [];

    // All visible buttons
    var allBtns = Array.from(document.querySelectorAll('button, [role=button]'))
      .filter(b => b.offsetParent !== null);

    results.push('total visible btns: ' + allBtns.length);

    // Look for confirm-like buttons
    var confirmBtns = allBtns.filter(b => {
      var t = b.textContent.trim().toLowerCase();
      return /confirm|continue|ok|yes|create|generate|proceed/i.test(t) && b.getBoundingClientRect().x > 100;
    });
    results.push('confirm-like btns: ' + confirmBtns.map(b => '"' + b.textContent.trim().substring(0,20) + '"').join(', '));

    // Dialog/modal containers
    var dialogs = document.querySelectorAll('[role=dialog],[role=alertdialog],.modal,.dialog,[data-radix-dialog-content]');
    results.push('dialog elements: ' + dialogs.length);

    // Relevant visible text
    var visTexts = Array.from(document.querySelectorAll('p,span,h2,h3,div'))
      .filter(el => el.offsetParent && !el.children.length && el.textContent.trim().length > 2 && el.textContent.trim().length < 80)
      .map(el => el.textContent.trim())
      .filter((t,i,arr) => arr.indexOf(t) === i)
      .filter(t => /credit|confirm|create|generate|ok|continue|cost|₽|\$/i.test(t));
    results.push('relevant texts: ' + JSON.stringify(visTexts.slice(0,8)));

    // Click confirm if found
    var toClick = confirmBtns.find(b => {
      var t = b.textContent.trim().toLowerCase();
      return /confirm|continue|ok|yes|proceed/i.test(t);
    }) || (confirmBtns.length > 0 ? confirmBtns[confirmBtns.length-1] : null);

    if (toClick && dialogs.length > 0) {
      var r = toClick.getBoundingClientRect();
      console.log('[dial] clicking confirm: "' + toClick.textContent.trim().substring(0,20) + '" x=' + Math.round(r.x));
      toClick.click();
      results.push('CLICKED: "' + toClick.textContent.trim().substring(0,20) + '"');
    }

    return results.join(' | ');
  })()`);
  console.log(`[dialog attempt ${attempt+1}]`, v(dialogR));

  if (v(dialogR)?.includes('CLICKED')) {
    console.log("Confirmation clicked! Waiting for generate request...");
    break;
  }
  await sleep(600);
}

// === STEP 8: Monitor 45 seconds for generate request ===
console.log("\nMonitoring 45s for generate request...");

for (let i = 0; i < 45; i++) {
  await sleep(1000);

  // Check JS-level capture
  const stR = await ev(`JSON.stringify({
    token: window.__capturedToken != null ? String(window.__capturedToken).substring(0,30) : null,
    tokenLen: window.__capturedToken ? String(window.__capturedToken).length : 0,
    turnToken: window.__turnToken ? String(window.__turnToken).substring(0,20) : null,
    bodySnip: window.__capturedGenBody ? window.__capturedGenBody.substring(0,100) : null,
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    dialogs: document.querySelectorAll('[role=dialog],[role=alertdialog]').length,
  })`);
  const st = JSON.parse(v(stR) || '{}');

  if (st.bodySnip !== null || capturedGenerateBody) {
    const body = capturedGenerateBody || st.bodySnip;
    console.log(`\n[${i+1}s] GENERATE BODY CAPTURED!`);
    console.log("Token:", st.token || capturedGenerateToken);
    console.log("Token len:", st.tokenLen);
    console.log("Body snippet:", body?.substring(0, 200));
    break;
  }

  if (st.cfIframes > 0) console.log(`[${i+1}s] CF iframes: ${st.cfIframes}`);
  if (st.turnToken) console.log(`[${i+1}s] Turnstile token: ${st.turnToken}`);
  if (st.dialogs > 0 && i < 5) {
    // Still have dialog — try clicking again
    await ev(`(function(){
      var dBtns = Array.from(document.querySelectorAll('[role=dialog] button, [role=alertdialog] button, [data-radix-dialog-content] button'))
        .filter(b => b.offsetParent !== null);
      console.log('[dial] dialog btns: ' + dBtns.map(b=>b.textContent.trim().substring(0,15)).join(', '));
      if (dBtns.length > 0) {
        var last = dBtns[dBtns.length - 1];
        console.log('[dial] clicking last btn: "' + last.textContent.trim().substring(0,20) + '"');
        last.click();
      }
    })()`);
  }

  if (i % 5 === 4) {
    // Every 5 seconds: dump all visible buttons and text
    const dumpR = await ev(`(function(){
      var btns = Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent).map(b=>({t:b.textContent.trim().substring(0,15),dis:b.disabled,x:Math.round(b.getBoundingClientRect().x)}));
      return JSON.stringify({btns:btns.slice(0,15), cfIframes:document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length});
    })()`);
    console.log(`[${i+1}s] DOM: ${v(dumpR)}`);
  }
}

// === STEP 9: Get full token ===
const fullBodyR = await ev("String(window.__capturedGenBody || '')");
const fullBody = v(fullBodyR);
const finalTokenR = await ev("String(window.__capturedToken || window.__turnToken || '')");
const finalToken = v(finalTokenR);

let token = capturedGenerateToken || finalToken;

if (!token && fullBody) {
  try { token = JSON.parse(fullBody).token; } catch(e) {}
}

ws.close();

console.log("\n=== RESULTS ===");
console.log("JS captured token:", finalToken ? finalToken.substring(0, 40) + "... len=" + finalToken.length : "NONE");
console.log("Network captured token:", capturedGenerateToken ? capturedGenerateToken.substring(0, 40) + "..." : "NONE");
console.log("Full body snippet:", fullBody ? fullBody.substring(0, 200) : capturedGenerateBody?.substring(0, 200) || "NONE");

if (token && String(token).length > 50) {
  const tokenStr = String(token);
  console.log(`\n=== SAVING TOKEN (len=${tokenStr.length}, starts=${tokenStr.substring(0,30)}) ===`);
  writeFileSync("/home/alexander/projects/suno_passkey.txt", tokenStr);

  // Restart suno-api
  try {
    execFileSync("sudo", ["systemctl", "restart", "suno-api"], {timeout: 20000});
    console.log("suno-api restarted");
  } catch(e) { console.log("restart err:", e.message); }

  await sleep(5000);

  // Test generate
  const testResult = await new Promise(resolve => {
    const pd = JSON.stringify({prompt:"Happy birthday", tags:"pop", title:"Birthday Test", make_instrumental:false, wait_audio:false});
    const req = http.request({host:"localhost",port:3000,path:"/api/custom_generate",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pd)}}, res => {
      let d = ""; res.on("data",x=>d+=x); res.on("end",()=>resolve({status:res.statusCode,body:d.substring(0,400)}));
    });
    req.on("error", e=>resolve({error:e.message}));
    req.write(pd); req.end();
  });
  console.log("\nGenerate test:", JSON.stringify(testResult));
  if (testResult.status === 200) {
    console.log("\n✅ SUCCESS! Generate works!");
  } else {
    console.log("\n❌ Generate failed:", testResult.body);
  }
} else {
  console.log("\n❌ No valid token captured.");
  if (capturedGenerateBody || fullBody) {
    console.log("But we DID capture a generate request body — check above.");
  }
}
