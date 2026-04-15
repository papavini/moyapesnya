/**
 * v2 — читаем Turnstile токен из page-load рендера (SUNO pre-renders на load),
 * или заполняем форму через Input.insertText + CDP фокус и кликаем Create.
 *
 * Key insights:
 * - CF challenge fires на page load (SUNO pre-renders Turnstile invisibly)
 * - window.turnstile.getResponse() вернёт токен после challenge
 * - Если нет — заполняем форму через Input.insertText и кликаем Create
 * - Fetch interception на CDP уровне перехватит generate запрос
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
let capturedGenToken = null;
let capturedGenBody = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }

  // Network.requestWillBeSent — see generate request body
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    const method = d.params?.request?.method || "";
    if (url.includes("generate/v2")) {
      const body = d.params?.request?.postData || "";
      console.log(`[NET] ${method} ${url}`);
      if (body) {
        console.log(`[NET-BODY] ${body.substring(0, 400)}`);
        if (!capturedGenBody) {
          capturedGenBody = body;
          try {
            const p = JSON.parse(body);
            if (p.token !== undefined) capturedGenToken = String(p.token || "");
            console.log(`[NET] Token extracted: len=${capturedGenToken?.length} starts=${capturedGenToken?.substring(0,20)}`);
          } catch(e) {}
        }
      }
    }
    if (url.includes("challenges.cloudflare")) {
      console.log(`[CF] ${method} ${url.substring(0, 120)}`);
    }
  }

  // Fetch.requestPaused — intercept generate at network level
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    if (url.includes("generate/v2")) {
      const body = d.params?.request?.postData || "";
      console.log(`[FETCH-INT] ${d.params?.request?.method} ${url}`);
      if (body) {
        console.log(`[FETCH-INT-BODY] ${body.substring(0, 400)}`);
        if (!capturedGenBody) {
          capturedGenBody = body;
          try {
            const p = JSON.parse(body);
            if (p.token !== undefined) capturedGenToken = String(p.token || "");
          } catch(e) {}
        }
      }
    }
    // Always continue
    ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
  }

  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    const txt = m?.text || '';
    if (txt.includes('[v2]') || txt.includes('[turn]') || txt.includes('[form]') || txt.includes('error') || txt.includes('Error')) {
      console.log(`[CON ${m?.level}] ${txt.substring(0, 300)}`);
    }
  }
});

function send(method, params={}) {
  return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); });
}
function ev(expr) {
  return new Promise(r => {
    const id = nextId++;
    cbs[id] = r;
    ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, returnByValue: true}}));
  });
}
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");
await send("Fetch.enable", {
  patterns: [
    {urlPattern: "*generate/v2*", requestStage: "Request"},
  ]
});

// === STEP 1: Navigate to /create ===
console.log("\n=== STEP 1: Navigate to /create ===");
await send("Page.navigate", {url: "https://suno.com/create"});
console.log("Waiting 8s for page load + CF challenge...");
await sleep(8000);

// === STEP 2: Try to get page-load Turnstile token via getResponse() ===
console.log("\n=== STEP 2: Check page-load Turnstile token ===");
const tsCheck = await ev(`JSON.stringify({
  tsType: typeof window.turnstile,
  tsMethods: window.turnstile ? Object.keys(window.turnstile).join(',') : null,
  tsResponse0: (function(){
    if (!window.turnstile) return null;
    try { return window.turnstile.getResponse(); } catch(e) { return 'err:'+e.message; }
  })(),
  tsResponse1: (function(){
    if (!window.turnstile) return null;
    try { return window.turnstile.getResponse(undefined); } catch(e) { return 'err:'+e.message; }
  })(),
  cfInput: document.querySelector('[name="cf-turnstile-response"]')?.value || null,
  cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
  cfDivs: document.querySelectorAll('[data-sitekey]').length,
})`);
const tsState = JSON.parse(v(tsCheck) || '{}');
console.log("Turnstile state:", JSON.stringify(tsState, null, 2));

// Try to find widget ID from DOM
const widgetSearch = await ev(`(function(){
  if (!window.turnstile) return {};
  // Check all possible widget states
  var responses = {};
  var iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare"]');
  iframes.forEach((f, i) => {
    var id = f.id || f.getAttribute('data-widget-id') || f.getAttribute('id');
    console.log('[v2] iframe[' + i + '] id=' + id + ' src=' + f.src.substring(0,80));
    try { responses['iframe_' + i] = window.turnstile.getResponse(id); } catch(e) {}
  });
  // Try turnstile._widgets or internal state
  var keys = Object.keys(window.turnstile || {});
  console.log('[v2] turnstile keys: ' + keys.join(', '));
  return JSON.stringify(responses);
})()`);
console.log("Widget search:", v(widgetSearch));

// Check if we can find the widget ID from internal state
const internalSearch = await ev(`(function(){
  if (!window.turnstile) return 'no turnstile';
  // Check __cf_chl_opt or similar global vars
  var globals = ['__cf_chl_opt', '__cfTurnstileWidgets', '__turnstile_widgets', 'cf_turnstile'];
  var found = {};
  globals.forEach(g => {
    if (window[g] !== undefined) found[g] = JSON.stringify(window[g]).substring(0, 100);
  });
  return JSON.stringify(found);
})()`);
console.log("Internal state:", v(internalSearch));

// If we got a token from getResponse, use it
let token = null;
if (tsState.tsResponse0 && typeof tsState.tsResponse0 === 'string' && tsState.tsResponse0.length > 50) {
  token = tsState.tsResponse0;
  console.log("GOT TOKEN from getResponse()! len=" + token.length);
}
if (!token && tsState.tsResponse1 && typeof tsState.tsResponse1 === 'string' && tsState.tsResponse1.length > 50) {
  token = tsState.tsResponse1;
  console.log("GOT TOKEN from getResponse(undefined)! len=" + token.length);
}

// === STEP 3: If no token yet, inject full interceptor and fill form ===
if (!token) {
  console.log("\n=== STEP 3: Inject interceptor + fill form ===");

  // Inject fetch interceptor NOW (after page load)
  await ev(`(function(){
    if (window.__v2trap) return;
    window.__v2trap = true;
    window.__v2token = null;
    window.__v2body = null;

    var _of = window.fetch;
    window.fetch = function(resource, init) {
      var url = typeof resource === 'string' ? resource : (resource?.url || '');
      if (url.includes('generate/v2')) {
        var body = init?.body || '';
        console.log('[v2] fetch generate! url=' + url.substring(0,60));
        window.__v2body = String(body).substring(0, 2000);
        try {
          var p = JSON.parse(body);
          window.__v2token = p.token !== undefined ? String(p.token || '') : 'KEY_MISSING';
          console.log('[v2] token=' + (p.token ? String(p.token).substring(0,20) : 'null') + ' len=' + String(p.token||'').length);
        } catch(e) { console.log('[v2] parse err: ' + e.message); }
      }
      return _of.apply(this, arguments);
    };

    // Also wrap turnstile to capture render params + callback token
    var _ts = window.turnstile;
    if (_ts && !_ts.__v2wrapped) {
      _ts.__v2wrapped = true;
      var _or = _ts.render;
      _ts.render = function(c, p) {
        console.log('[turn] render! action=' + (p&&p.action) + ' cdata=' + JSON.stringify(p&&p.cdata));
        if (p && typeof p.callback === 'function') {
          var _cb = p.callback;
          p.callback = function(tok) {
            console.log('[turn] callback! len=' + tok.length + ' starts=' + tok.substring(0, 20));
            window.__v2turnToken = tok;
            return _cb.apply(this, arguments);
          };
        }
        return _or.apply(this, arguments);
      };
      console.log('[v2] turnstile wrapped!');
    }

    console.log('[v2] fetch interceptor installed');
  })()`);

  console.log("Injected interceptor.");

  // Switch to Advanced mode
  const advR = await ev(`(function(){
    var btns = Array.from(document.querySelectorAll('button'));
    var adv = btns.find(b => /^advanced$/i.test(b.textContent.trim()));
    if (!adv) {
      // Maybe already in Advanced mode
      var simple = btns.find(b => /^simple$/i.test(b.textContent.trim()));
      if (simple) { adv = btns.find(b => /^advanced/i.test(b.textContent.trim())); }
    }
    if (!adv) return 'NO ADV. btns: ' + btns.slice(0,10).map(b=>b.textContent.trim().substring(0,15)).join('|');
    var wasActive = adv.classList.contains('active') || adv.className.includes('active');
    if (!wasActive) { adv.click(); return 'Clicked Advanced'; }
    return 'Already advanced';
  })()`);
  console.log("Advanced mode:", v(advR));
  await sleep(800);

  // Identify textareas
  const taR = await ev(`JSON.stringify(
    Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null).map((t, i) => ({
      i: i,
      ph: t.placeholder.substring(0, 50),
      val: t.value.substring(0, 30),
      rect: {x: Math.round(t.getBoundingClientRect().x), y: Math.round(t.getBoundingClientRect().y)},
    }))
  )`);
  console.log("Textareas:", v(taR));

  // Fill ALL textareas via React fiber
  const fillAllR = await ev(`(function(){
    var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
    var results = [];
    var fills = [
      'Happy birthday pop song for best friend',  // lyrics
      'pop upbeat cheerful birthday',              // style tags
      'Happy Birthday Song',                       // title
      '',                                           // sound description (optional, leave empty)
    ];

    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

    tas.forEach(function(ta, i) {
      var text = fills[i] || '';
      if (!text) { results.push('ta[' + i + ']: skipped'); return; }

      nativeSetter.call(ta, text);

      // Walk React fiber to trigger onChange
      var fk = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      var fiberFound = false;
      if (fk) {
        var node = ta[fk];
        var tries = 0;
        while (node && tries++ < 60) {
          var mp = node.memoizedProps;
          if (mp && typeof mp.onChange === 'function') {
            try {
              mp.onChange({
                target: ta, currentTarget: ta,
                type: 'change',
                nativeEvent: {data: text[0], inputType: 'insertText'},
                preventDefault: function(){}, stopPropagation: function(){}
              });
              fiberFound = true;
            } catch(e) { results.push('ta[' + i + ']: fiber err ' + e.message); }
            break;
          }
          node = node.return;
        }
      }

      // Also dispatch events
      ta.dispatchEvent(new InputEvent('input', {bubbles: true, data: text[0], inputType: 'insertText'}));
      ta.dispatchEvent(new Event('change', {bubbles: true}));

      results.push('ta[' + i + ']: "' + ta.value.substring(0, 25) + '" fiber=' + fiberFound);
    });

    return results.join(' | ');
  })()`);
  console.log("Fill all:", v(fillAllR));
  await sleep(1000);

  // Check Create button
  const btnR = await ev(`JSON.stringify(
    Array.from(document.querySelectorAll('button'))
      .filter(b => /^create$/i.test(b.textContent.trim()))
      .map(b => ({dis:b.disabled, x:Math.round(b.getBoundingClientRect().x), y:Math.round(b.getBoundingClientRect().y)}))
  )`);
  console.log("Create buttons:", v(btnR));

  // === STEP 3b: Try Input.insertText approach on each textarea ===
  console.log("\n=== STEP 3b: Try Input.insertText for textarea[0] ===");

  // Clear and focus textarea[0]
  await ev(`(function(){
    var ta = document.querySelectorAll('textarea')[0];
    if (!ta) return;
    ta.focus();
    ta.click();
    ta.setSelectionRange(0, ta.value.length);
    console.log('[form] focused ta[0], value="' + ta.value.substring(0,20) + '"');
  })()`);
  await sleep(300);

  // Check active element
  const activeR = await ev(`JSON.stringify({
    ae: document.activeElement?.tagName,
    aeName: document.activeElement?.name,
    aePh: document.activeElement?.placeholder?.substring(0,30),
    isTA0: document.activeElement === document.querySelectorAll('textarea')[0]
  })`);
  console.log("Active element:", v(activeR));

  // Try Input.insertText
  try {
    // First clear with keyboard
    await send("Input.dispatchKeyEvent", {type: "keyDown", key: "a", code: "KeyA", modifiers: 2}); // Ctrl+A
    await send("Input.dispatchKeyEvent", {type: "keyUp", key: "a", code: "KeyA", modifiers: 2});
    await sleep(100);
    await send("Input.insertText", {text: "Happy birthday song for best friend"});
    console.log("Input.insertText sent");
  } catch(e) {
    console.log("Input.insertText err:", e.message);
  }
  await sleep(500);

  // Check textarea value and button state after Input.insertText
  const afterInputR = await ev(`JSON.stringify({
    ta0val: document.querySelectorAll('textarea')[0]?.value?.substring(0,30),
    createDis: Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim())).map(b => b.disabled),
  })`);
  console.log("After Input.insertText:", v(afterInputR));

  // === STEP 3c: Click Create (even if disabled) ===
  console.log("\n=== STEP 3c: Click Create ===");
  const clickR = await ev(`(function(){
    // Try to find enabled Create first
    var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
    var enabled = creates.find(b => !b.disabled && b.getBoundingClientRect().x > 100);
    var btn = enabled || creates.find(b => b.getBoundingClientRect().x > 100) || creates[creates.length-1];
    if (!btn) return 'NO CREATE BTN';
    var rect = btn.getBoundingClientRect();
    console.log('[form] clicking Create dis=' + btn.disabled + ' x=' + Math.round(rect.x) + ' y=' + Math.round(rect.y));
    // Click via multiple methods
    btn.removeAttribute('disabled');
    btn.disabled = false;
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return 'clicked: x=' + Math.round(rect.x) + ' was_dis=' + btn.disabled;
  })()`);
  console.log("Click Create:", v(clickR));
  await sleep(1500);

  // Check for dialogs
  for (let dlg = 0; dlg < 5; dlg++) {
    const dlgR = await ev(`(function(){
      var visible = Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],[data-state=open]'))
        .filter(el => el.offsetParent !== null);
      if (!visible.length) return 'no dialogs';
      var dlgBtns = Array.from(document.querySelectorAll('[role=dialog] button, [role=alertdialog] button, [data-state=open] button'))
        .filter(b => b.offsetParent !== null);
      var info = 'dialogs: ' + visible.length + ' btns: ' + dlgBtns.map(b => '"' + b.textContent.trim().substring(0,15) + '"').join(', ');
      // Click the rightmost/last positive button
      var pos = dlgBtns.filter(b => {
        var t = b.textContent.trim().toLowerCase();
        return !/(cancel|close|dismiss|no)/i.test(t);
      });
      if (pos.length > 0) {
        var toClick = pos[pos.length-1];
        console.log('[form] clicking dialog btn: "' + toClick.textContent.trim().substring(0,20) + '"');
        toClick.click();
        info += ' CLICKED "' + toClick.textContent.trim().substring(0,20) + '"';
      }
      return info;
    })()`);
    console.log(`[dialog ${dlg+1}]`, v(dlgR));
    if (v(dlgR) === 'no dialogs') break;
    await sleep(600);
  }

  // === STEP 4: Monitor 45s for generate request ===
  console.log("\n=== STEP 4: Monitor 45s for generate request ===");
  for (let i = 0; i < 45; i++) {
    await sleep(1000);

    const stateR = await ev(`JSON.stringify({
      v2token: window.__v2token,
      v2body: window.__v2body ? window.__v2body.substring(0, 100) : null,
      turnToken: window.__v2turnToken ? window.__v2turnToken.substring(0, 20) : null,
      cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
      dialogs: document.querySelectorAll('[role=dialog]:not([aria-hidden=true])').length,
    })`);
    const st = JSON.parse(v(stateR) || '{}');

    if (st.v2body || capturedGenBody) {
      console.log(`\n[${i+1}s] GENERATE BODY CAPTURED!`);
      console.log("v2token:", st.v2token);
      console.log("bodySnip:", st.v2body || capturedGenBody?.substring(0, 200));
      token = st.v2token || capturedGenToken;
      break;
    }

    if (st.cfIframes > 0) console.log(`[${i+1}s] CF iframes: ${st.cfIframes}`);
    if (st.turnToken) console.log(`[${i+1}s] Turnstile callback token: ${st.turnToken}`);

    if (i % 5 === 4) {
      // Every 5s: dump state
      const dR = await ev(`JSON.stringify({
        btns: Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent).slice(0,12).map(b=>({t:b.textContent.trim().substring(0,12),dis:b.disabled})),
        tas: Array.from(document.querySelectorAll('textarea')).filter(t=>t.offsetParent).map(t=>({v:t.value.substring(0,15),ph:t.placeholder.substring(0,15)})),
      })`);
      console.log(`[${i+1}s] DOM: ${v(dR)}`);

      // Try clicking Create again if still no generate
      if (i < 25) {
        await ev(`(function(){
          var btn = Array.from(document.querySelectorAll('button')).find(b => /^create$/i.test(b.textContent.trim()) && b.getBoundingClientRect().x > 100);
          if (btn) { btn.removeAttribute('disabled'); btn.disabled=false; btn.click(); console.log('[form] re-clicked Create'); }
        })()`);
      }
    }
  }
}

// === STEP 5: Fallback — get token via direct turnstile.render() with possible cdata ===
if (!token && !capturedGenToken) {
  console.log("\n=== STEP 5: Fallback — direct turnstile.render() ===");
  const renderR = await ev(`(function(){
    if (!window.turnstile) return 'no turnstile';
    window.__directToken = null;

    // Remove old container
    var old = document.getElementById('__v2_ts');
    if (old) { try { window.turnstile.remove(old.dataset.wid); } catch(e) {} old.remove(); }

    var c = document.createElement('div');
    c.id = '__v2_ts';
    c.style.cssText = 'position:fixed;top:50px;right:50px;z-index:999999;';
    document.body.appendChild(c);

    try {
      var wid = window.turnstile.render('#__v2_ts', {
        sitekey: '0x4AAAAAAAFV93qQdS0ycilX',
        action: 'generate',
        size: 'normal',
        theme: 'light',
        callback: function(tok) {
          console.log('[v2] direct render callback! len=' + tok.length + ' starts=' + tok.substring(0, 20));
          window.__directToken = tok;
        },
        'error-callback': function(e) { console.log('[v2] direct render error: ' + e); },
      });
      return 'render ok widgetId=' + JSON.stringify(wid);
    } catch(e) { return 'render err: ' + e.message; }
  })()`);
  console.log("Direct render:", v(renderR));

  // Wait up to 20s
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const r = await ev(`window.__directToken || null`);
    if (v(r)) { token = v(r); console.log(`\n[${i+1}s] Direct token: len=${token.length} starts=${token.substring(0,20)}`); break; }
    if (i % 4 === 3) console.log(`[${i+1}s] waiting direct render...`);
  }
}

ws.close();

// === FINAL: Save and test ===
const finalToken = token || capturedGenToken;
console.log("\n=== FINAL ===");
console.log("Token:", finalToken ? finalToken.substring(0, 50) + "... len=" + finalToken.length : "NONE");
console.log("Captured body:", capturedGenBody ? capturedGenBody.substring(0, 200) : "NONE");

if (finalToken && String(finalToken).length > 50) {
  const tokenStr = String(finalToken);
  writeFileSync("/home/alexander/projects/suno_passkey.txt", tokenStr);
  console.log("Saved to suno_passkey.txt");

  execSync("sudo systemctl restart suno-api", {timeout: 20000});
  console.log("suno-api restarted, waiting 5s...");
  await sleep(5000);

  // Test
  const testResult = await new Promise(resolve => {
    const pd = JSON.stringify({prompt:"Happy birthday", tags:"pop", title:"Test", make_instrumental:false, wait_audio:false});
    const req = http.request({host:"localhost",port:3000,path:"/api/custom_generate",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pd)}}, res => {
      let d = ""; res.on("data",x=>d+=x); res.on("end",()=>resolve({status:res.statusCode,body:d.substring(0,400)}));
    });
    req.on("error",e=>resolve({error:e.message}));
    req.write(pd); req.end();
  });
  console.log("\nGenerate test:", JSON.stringify(testResult));
  if (testResult.status === 200) {
    console.log("\n✅ SUCCESS!");
  } else {
    console.log("\n❌ Still failing. Body:", testResult.body);
  }
} else {
  console.log("\n❌ No valid token captured.");
}
