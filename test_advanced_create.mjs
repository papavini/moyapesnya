/**
 * Перезагружаем страницу, переключаем в Advanced, заполняем ВСЕ поля,
 * кликаем Create и перехватываем generate запрос.
 * Все запросы ПРОПУСКАЕМ (не failRequest) чтобы видеть полный flow.
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
let page = tabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!page) { console.log("No RDP suno page!"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let nextId = 1; const cbs = {};
let capturedToken = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }

  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData;
    if (url.includes("studio-api") || url.includes("generate") || url.includes("challenges.cloudflare") || url.includes("turnstile")) {
      console.log(`\n[NET] ${d.params?.request?.method} ${url.substring(0,120)}`);
      if (body) {
        console.log(`[BODY] ${body.substring(0,400)}`);
        try {
          const p = JSON.parse(body);
          if (p.token) {
            capturedToken = p.token;
            console.log(`\n*** TOKEN IN BODY: ${p.token.substring(0,40)}... ***`);
          }
        } catch(e) {}
      }
    }
  }

  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    console.log(`\n[INTERCEPT] ${d.params?.request?.method} ${url.substring(0,100)}`);
    if (body) {
      console.log(`[BODY] ${body.substring(0,500)}`);
      try {
        const p = JSON.parse(body);
        if (p.token) {
          capturedToken = p.token;
          console.log(`\n*** INTERCEPTED TOKEN: ${p.token.substring(0,40)}... ***`);
        }
      } catch(e) {}
    }
    // FAIL POST to save credits, CONTINUE everything else
    if (d.params?.request?.method === "POST" && (url.includes("generate/v2") || url.includes("generate/v2-web"))) {
      console.log(">>> FAILING generate POST to save credits");
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
    } else {
      ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    }
  }

  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m) {
      const txt = m.text || '';
      if (txt.includes('P1_') || txt.includes('trap') || txt.includes('TRAP') || txt.includes('token') ||
          txt.includes('[test]') || txt.includes('create') || txt.includes('generate') || txt.includes('error') || txt.includes('Error')) {
        console.log(`[CON ${m.level}] ${txt.substring(0,200)}`);
      }
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr, ap=false) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// === STEP 1: Navigate to fresh /create ===
console.log("=== Navigating to fresh /create ===");
await send("Page.navigate", {url: "https://suno.com/create"});
await new Promise(r => setTimeout(r, 4000));

// Enable intercept AFTER navigation
await send("Fetch.enable", {patterns: [
  {urlPattern: "*studio-api*", requestStage: "Request"},
  {urlPattern: "*generate/v2*", requestStage: "Request"},
]});

// === STEP 2: Install Turnstile trap ===
const trapR = await ev(`(function(){
  window.__P1_captured = null;
  if (!window.turnstile) return 'no turnstile - will set trap on assign';

  if (!window.turnstile.__myTrap2) {
    window.turnstile.__myTrap2 = true;
    var origRender = window.turnstile.render;
    window.turnstile.render = function(c, p) {
      var sk = p && p.sitekey;
      window.__sitekeyUsed = sk;
      console.log('[trap2] render! sitekey=' + sk + ' action=' + (p&&p.action));
      if (p && typeof p.callback === 'function') {
        var cb = p.callback;
        p.callback = function(tok) {
          console.log('[trap2] render cb! len=' + (tok||'').length + ' starts=' + (tok||'').substring(0,20));
          if (tok && tok.startsWith('P1_')) window.__P1_captured = tok;
          return cb.apply(this, arguments);
        };
      }
      return origRender.call(this, c, p);
    };
    var origEx = window.turnstile.execute;
    window.turnstile.execute = function() {
      console.log('[trap2] execute! args=' + JSON.stringify(Array.from(arguments)).substring(0,80));
      return origEx.apply(this, arguments);
    };
  }
  return 'trap2 installed, turnstile has methods: ' + Object.keys(window.turnstile).join(',');
})()`);
console.log("Turnstile trap:", v(trapR));

// === STEP 3: Check what's on the page ===
const pageStateR = await ev(`(function(){
  var btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b => ({
    text: b.textContent.trim().substring(0,20),
    disabled: b.disabled,
    y: Math.round(b.getBoundingClientRect().y)
  }));
  var tas = Array.from(document.querySelectorAll('textarea')).map(t => ({
    ph: t.placeholder.substring(0,40),
    val: t.value.substring(0,20),
    vis: t.offsetParent !== null
  }));
  return JSON.stringify({btns: btns.slice(0,20), tas, url: window.location.href});
})()`);
const pageState = JSON.parse(v(pageStateR) || '{}');
console.log("\n=== PAGE STATE ===");
console.log("URL:", pageState.url);
console.log("Visible buttons:", JSON.stringify(pageState.btns));
console.log("Textareas:", JSON.stringify(pageState.tas));

// === STEP 4: Switch to Advanced mode ===
console.log("\n=== Switching to Advanced mode ===");
const switchR = await ev(`(function(){
  // Click Advanced tab
  var advanced = Array.from(document.querySelectorAll('button')).find(b => /^advanced$/i.test(b.textContent.trim()));
  if (!advanced) return 'NO ADVANCED BTN - btns: ' + Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim().substring(0,10)).join('|');
  advanced.click();
  return 'Advanced clicked, was active: ' + advanced.className.includes('active');
})()`);
console.log("Switch to Advanced:", v(switchR));
await new Promise(r => setTimeout(r, 500));

// === STEP 5: Fill ALL fields ===
const fillR = await ev(`(function(){
  var results = [];

  // Helper: update a textarea via React fiber
  function fillTA(ta, text) {
    if (!ta) return 'NO TA';
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
    // Try fiber
    var fk = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      var node = ta[fk];
      while (node) {
        var props = node.memoizedProps || node.pendingProps;
        if (props && typeof props.onChange === 'function') {
          props.onChange({target: ta, currentTarget: ta, type: 'change', nativeEvent: {data: 'H', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
          return 'fiber ok, val=' + ta.value.substring(0,20);
        }
        node = node.return;
      }
    }
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    ta.dispatchEvent(new Event('change', {bubbles: true}));
    return 'events dispatched, val=' + ta.value.substring(0,20);
  }

  // Also fill text inputs
  function fillInput(el, text) {
    if (!el) return 'NO INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, text);
    var fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      var node = el[fk];
      while (node) {
        var props = node.memoizedProps || node.pendingProps;
        if (props && typeof props.onChange === 'function') {
          props.onChange({target: el, currentTarget: el, type: 'change', nativeEvent: {data: 'H', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
          return 'fiber ok';
        }
        node = node.return;
      }
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return 'events';
  }

  var allTA = Array.from(document.querySelectorAll('textarea'));
  var allInputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=number]):not([type=range]):not([type=file])'));

  results.push('textareas: ' + allTA.length);
  results.push('inputs: ' + allInputs.length);

  // Fill lyrics textarea (first visible textarea or the one with "lyrics" placeholder)
  var lyrics = allTA.find(t => t.placeholder.includes('lyrics') || t.placeholder.includes('Leave blank'));
  if (lyrics) {
    results.push('lyrics: ' + fillTA(lyrics, 'Happy birthday to you\nMay your day be bright\nFull of joy and laughter\nEverything feels right'));
  }

  // Fill style textarea (the one with music style)
  var style = allTA.find(t => t.placeholder.includes('taiko') || t.placeholder.includes('rock') || t.placeholder.includes('style') || t.placeholder.includes('Describe the sound'));
  if (style) {
    results.push('style: ' + fillTA(style, 'pop, upbeat, happy, celebratory'));
  }

  // Fill title - look for title-like textarea/input
  var title = allTA.find(t => t.placeholder.includes('ballad') || t.placeholder.includes('title') || t.placeholder.includes('Title'));
  if (!title) {
    // Try the "Modern ballad..." placeholder textarea
    title = allTA.find(t => t.placeholder.includes('Modern') || t.placeholder.toLowerCase().includes('song name') || t.placeholder.toLowerCase().includes('name'));
  }
  if (title) {
    results.push('title: ' + fillTA(title, 'Happy Birthday'));
  }

  // Fill text inputs (title might be a text input)
  var titleInput = allInputs.find(i => i.placeholder.toLowerCase().includes('title') || i.placeholder.toLowerCase().includes('song name') || i.placeholder.toLowerCase().includes('name'));
  if (titleInput) {
    results.push('title input: ' + fillInput(titleInput, 'Happy Birthday'));
  }

  // Log what we found
  allTA.forEach((t, i) => {
    console.log('[fill] ta[' + i + '] ph="' + t.placeholder.substring(0,40) + '" val="' + t.value.substring(0,20) + '"');
  });

  return results.join(' | ');
})()`);
console.log("Fill result:", v(fillR));
await new Promise(r => setTimeout(r, 800));

// === STEP 6: Check Create button state ===
const btnR = await ev(`(function(){
  var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
  return JSON.stringify(creates.map(b => ({
    text: b.textContent.trim(),
    disabled: b.disabled,
    visible: b.offsetParent !== null,
    y: Math.round(b.getBoundingClientRect().y),
    x: Math.round(b.getBoundingClientRect().x),
    cls: b.className.substring(0,60)
  })));
})()`);
console.log("Create buttons:", v(btnR));

// === STEP 7: Click Create ===
const clickR = await ev(`(function(){
  var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()) && b.offsetParent !== null);
  console.log('[test] creates: ' + creates.length);

  // Find the one that's more "form-like" (not in sidebar)
  var btn = creates.find(b => b.getBoundingClientRect().x > 100) || creates[creates.length - 1];
  if (!btn) return 'NO CREATE';

  var rect = btn.getBoundingClientRect();
  console.log('[test] clicking Create at (' + Math.round(rect.x) + ',' + Math.round(rect.y) + ') disabled=' + btn.disabled);

  if (btn.disabled) {
    btn.removeAttribute('disabled');
    Object.defineProperty(btn, 'disabled', {value: false, writable: true, configurable: true});
  }
  btn.click();

  // Also dispatch a pointer event
  btn.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true}));
  btn.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, cancelable: true}));
  btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));

  return 'clicked at (' + Math.round(rect.x) + ',' + Math.round(rect.y) + ')';
})()`);
console.log("Click:", v(clickR));

// === STEP 8: Check immediately for any dialog/toast ===
await new Promise(r => setTimeout(r, 500));
const toastR = await ev(`(function(){
  // Look for any new UI elements
  var dialogs = document.querySelectorAll('[role=dialog],[role=alertdialog],[role=alert]');
  var toasts = document.querySelectorAll('[class*="toast"],[class*="Toast"],[class*="notification"],[class*="Notification"],[class*="alert"],[aria-live]');
  var allNew = [];

  // Any element with "error" or "upgrade" in text
  var body = document.body;
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  var el;
  while (el = walker.nextNode()) {
    if (el.offsetParent !== null && el.children.length === 0) {  // leaf visible nodes
      var txt = (el.textContent || '').trim();
      if (txt.length > 0 && txt.length < 200 &&
          (txt.toLowerCase().includes('upgrade') || txt.toLowerCase().includes('subscribe') ||
           txt.toLowerCase().includes('credits') || txt.toLowerCase().includes('limit') ||
           txt.toLowerCase().includes('error') || txt.toLowerCase().includes('failed') ||
           txt.toLowerCase().includes('generating'))) {
        allNew.push(txt.substring(0,80));
      }
    }
  }

  return JSON.stringify({
    dialogs: dialogs.length,
    toasts: toasts.length,
    relevantTexts: allNew.slice(0,5),
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length
  });
})()`);
console.log("Immediate state after click:", v(toastR));

// === STEP 9: Wait and monitor ===
console.log("\nWaiting up to 30s...");
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1000));

  if (capturedToken) break;

  const checkR = await ev(`JSON.stringify({
    p1: window.__P1_captured ? 'YES:' + window.__P1_captured.substring(0,20) : null,
    sk: window.__sitekeyUsed,
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    generating: document.body.textContent.includes('Generating'),
    url: window.location.href,
  })`);
  const s = JSON.parse(v(checkR) || '{}');

  const elapsed = Math.round((Date.now() - (deadline - 30000)) / 1000);

  if (s.p1) { console.log(`\n=== P1_ TOKEN via window! ===\n${s.p1}`); capturedToken = s.p1.replace('YES:', ''); break; }
  if (s.cfIframes > 0) console.log(`[${elapsed}s] CF IFRAME APPEARED! n=${s.cfIframes}`);
  if (s.generating) { console.log(`[${elapsed}s] GENERATING DETECTED`); }
  if (s.sk) { console.log(`[${elapsed}s] SITEKEY USED: ${s.sk}`); }
  if (elapsed % 5 === 0) console.log(`[${elapsed}s] cf=${s.cfIframes} gen=${s.generating} url=${s.url?.split('/').pop()}`);
}

if (capturedToken) {
  const fullR = await ev("window.__P1_captured || ''");
  const full = v(fullR) || capturedToken;
  if (full.startsWith('P1_') && full.length > 20) {
    console.log(`\n=== SAVING TOKEN (len=${full.length}) ===`);
    writeFileSync("/home/alexander/projects/suno_passkey.txt", full);
    execSync("sudo systemctl restart suno-api", {timeout: 30000});
    await new Promise(r => setTimeout(r, 5000));
    const check = await new Promise(resolve => {
      http.get("http://localhost:3000/api/get_limit", (res) => {
        let d = ""; res.on("data", x => d += x); res.on("end", () => resolve(d));
      }).on("error", () => resolve("error"));
    });
    console.log("suno-api limit:", check);
  }
} else {
  console.log("\n❌ Token not captured.");
  // Show what the page shows
  const domR = await ev(`(function(){
    var b = document.body;
    // Find any text that relates to what happened
    var snippets = [];
    var allEls = Array.from(b.querySelectorAll('*')).filter(el => el.offsetParent !== null && !el.children.length);
    for (var el of allEls) {
      var txt = (el.textContent || '').trim();
      if (txt.length > 3 && txt.length < 100 &&
          (txt.includes('Create') || txt.includes('Generat') || txt.includes('credit') ||
           txt.includes('Error') || txt.includes('Upgrade') || txt.includes('Wait') ||
           txt.includes('Processing'))) {
        snippets.push(txt);
      }
    }
    return JSON.stringify([...new Set(snippets)].slice(0, 10));
  })()`);
  console.log("Relevant page texts:", v(domR));
}

ws.close();
