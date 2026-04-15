/**
 * Чистим все предыдущие addScriptToEvaluateOnNewDocument,
 * ставим чистый fetch/XHR перехватчик,
 * переходим в Advanced, заполняем поля, кликаем Create,
 * ловим токен из generate запроса.
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
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("generate/v2") || url.includes("studio-api-prod") || url.includes("challenges.cloudflare")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
      if (d.params?.request?.postData) console.log(`[BODY] ${d.params?.request?.postData?.substring(0,300)}`);
    }
  }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    const txt = m?.text || '';
    if (txt.includes('[cap]') || txt.includes('P1_') || txt.includes('[test]') || txt.includes('error') || txt.includes('Error')) {
      console.log(`[CON ${m.level}] ${txt.substring(0,250)}`);
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

// Install intercepts
await send("Network.enable");
await send("Console.enable");

// === STEP 1: Clean intercept script ===
const cleanScript = `
(function() {
  window.__generToken = null;
  window.__generBody = null;

  // Intercept fetch
  var origFetch = window.fetch;
  window.fetch = function(resource, init) {
    var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
    if (url.includes('generate/v2') || (url.includes('studio-api') && (init && init.method === 'POST'))) {
      var body = init && init.body;
      try {
        if (typeof body === 'string') {
          var parsed = JSON.parse(body);
          window.__generBody = body.substring(0, 1000);
          if (parsed.token !== undefined && parsed.token !== null) {
            window.__generToken = parsed.token;
            console.log('[cap] fetch generate! token=' + String(parsed.token).substring(0,30) + ' len=' + String(parsed.token).length);
          } else {
            console.log('[cap] fetch generate! token=null/undefined body=' + body.substring(0,100));
          }
        }
      } catch(e) { console.log('[cap] fetch generate body parse err: ' + e.message); }
    }
    return origFetch.apply(this, arguments);
  };

  // Intercept XHR
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._m = method; this._u = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._u && this._u.includes('generate/v2')) {
      console.log('[cap] XHR generate! url=' + this._u + ' body=' + String(body||'').substring(0,200));
      try {
        var p = JSON.parse(body);
        if (p.token) { window.__generToken = p.token; console.log('[cap] XHR token=' + p.token.substring(0,30)); }
      } catch(e) {}
    }
    return origSend.apply(this, arguments);
  };

  // Intercept turnstile
  function trapTurnstile(t) {
    if (!t || t.__trapped) return;
    t.__trapped = true;
    var or = t.render;
    t.render = function(c, p) {
      var sk = p && p.sitekey;
      var cd = p && p.cdata;
      var ac = p && p.action;
      console.log('[cap] turnstile.render! sk=' + sk + ' action=' + ac + ' cdata=' + JSON.stringify(cd));
      if (p && typeof p.callback === 'function') {
        var cb = p.callback;
        p.callback = function(tok) {
          console.log('[cap] render cb! tok=' + tok.substring(0,20) + ' len=' + tok.length);
          window.__turnToken = tok;
          return cb.apply(this, arguments);
        };
      }
      return or.apply(this, arguments);
    };
    var oe = t.execute;
    t.execute = function() {
      console.log('[cap] turnstile.execute! args=' + JSON.stringify(Array.from(arguments)).substring(0,100));
      return oe.apply(this, arguments);
    };
    console.log('[cap] turnstile trapped!');
  }

  if (window.turnstile) {
    trapTurnstile(window.turnstile);
  }
  // Watch for future assignment
  try {
    var cur = window.turnstile;
    Object.defineProperty(window, 'turnstile', {
      get: function() { return cur; },
      set: function(v) { cur = v; trapTurnstile(v); return v; },
      configurable: true, enumerable: true
    });
  } catch(e) { console.log('[cap] defineProperty err: ' + e.message); }

  console.log('[cap] clean interceptors installed');
})();
`;

const scriptR = await send("Page.addScriptToEvaluateOnNewDocument", {source: cleanScript});
console.log("Script added, id:", scriptR?.result?.identifier);

// === STEP 2: Navigate fresh ===
console.log("\nNavigating to /create...");
await send("Page.navigate", {url: "https://suno.com/create"});
await new Promise(r => setTimeout(r, 5000));

// Check interceptors are installed
const checkR = await ev("typeof window.__generToken + ' | fetch trapped: ' + (window.fetch.toString().includes('__generToken'))");
console.log("Interceptor state:", v(checkR));

// Check turnstile trap
const tsR = await ev("window.turnstile ? (window.turnstile.__trapped ? 'trapped' : 'NOT trapped') : 'no turnstile'");
console.log("Turnstile trap:", v(tsR));

// === STEP 3: Switch to Advanced mode ===
const advR = await ev(`(function(){
  var advanced = Array.from(document.querySelectorAll('button')).find(b => /^advanced$/i.test(b.textContent.trim()));
  if (!advanced) return 'NO ADVANCED BTN btns=' + Array.from(document.querySelectorAll('button')).slice(0,8).map(b=>b.textContent.trim().substring(0,10)).join('|');
  var wasActive = advanced.className.includes('active');
  advanced.click();
  return 'Advanced clicked, wasActive=' + wasActive;
})()`);
console.log("Advanced mode:", v(advR));
await new Promise(r => setTimeout(r, 500));

// === STEP 4: Fill lyrics textarea ===
const fillR = await ev(`(function(){
  var textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
  var lyricTA = textareas.find(t => t.placeholder.includes('lyrics') || t.placeholder.includes('Leave blank')) || textareas[0];
  if (!lyricTA) return 'NO TEXTAREA';

  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(lyricTA, 'Happy birthday to you, may your day shine bright');

  var fk = Object.keys(lyricTA).find(k => k.startsWith('__reactFiber'));
  if (fk) {
    var node = lyricTA[fk];
    while (node) {
      var p = node.memoizedProps;
      if (p && typeof p.onChange === 'function') {
        p.onChange({target: lyricTA, currentTarget: lyricTA, type: 'change', nativeEvent: {data: 'H', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
        console.log('[test] lyrics filled via fiber, val=' + lyricTA.value.substring(0,30));
        break;
      }
      node = node.return;
    }
  }
  lyricTA.dispatchEvent(new Event('input', {bubbles: true}));
  lyricTA.dispatchEvent(new Event('change', {bubbles: true}));
  return 'filled: ph=' + lyricTA.placeholder.substring(0,30) + ' val=' + lyricTA.value.substring(0,30);
})()`);
console.log("Fill lyrics:", v(fillR));
await new Promise(r => setTimeout(r, 500));

// Check Create button
const btn1R = await ev(`JSON.stringify(Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim())).map(b => ({y:Math.round(b.getBoundingClientRect().y), dis:b.disabled, vis:b.offsetParent!==null})))`);
console.log("Create buttons after lyrics fill:", v(btn1R));

// === STEP 5: Click Create ===
const clickR = await ev(`(function(){
  var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
  var btn = creates.find(b => b.getBoundingClientRect().x > 100) || creates[creates.length-1];
  if (!btn) return 'NO CREATE BTN';
  var rect = btn.getBoundingClientRect();
  console.log('[test] clicking Create, dis=' + btn.disabled + ' x=' + Math.round(rect.x) + ' y=' + Math.round(rect.y));
  btn.click();
  btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
  return 'clicked: dis=' + btn.disabled;
})()`);
console.log("Click Create:", v(clickR));

// === STEP 6: Check for any dialog/modal immediately ===
await new Promise(r => setTimeout(r, 300));
const immediateR = await ev(`(function(){
  // Find any new visible text
  var allVisible = Array.from(document.querySelectorAll('button,span,p,div'))
    .filter(el => el.offsetParent && !el.children.length && el.textContent.trim().length > 2 && el.textContent.trim().length < 100)
    .map(el => el.textContent.trim())
    .filter((t,i,arr) => arr.indexOf(t)===i); // unique
  var relevant = allVisible.filter(t => /confirm|credits|upgrade|error|generate|turnsile|captcha|verify|limit|sorry/i.test(t));
  return JSON.stringify({relevant: relevant.slice(0,5), cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length});
})()`);
console.log("Immediate DOM:", v(immediateR));

// === STEP 7: Monitor 30 seconds ===
console.log("\nMonitoring 30s for generate request...");
let captured = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const stR = await ev(`JSON.stringify({
    genToken: window.__generToken ? String(window.__generToken).substring(0,30) : null,
    turnToken: window.__turnToken ? String(window.__turnToken).substring(0,30) : null,
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    bodyStr: window.__generBody ? window.__generBody.substring(0,150) : null,
  })`);
  const st = JSON.parse(v(stR) || '{}');

  if (st.genToken !== null) {
    console.log(`\n[${i+1}s] GENERATE TOKEN: ${st.genToken}`);
    captured = st.genToken;
    break;
  }
  if (st.cfIframes > 0) console.log(`[${i+1}s] CF iframes: ${st.cfIframes}`);
  if (st.turnToken) console.log(`[${i+1}s] Turnstile token: ${st.turnToken}`);
  if (i % 5 === 4) console.log(`[${i+1}s] cf=${st.cfIframes} body=${st.bodyStr}`);
}

// Get full details
if (captured) {
  const fullGenR = await ev("String(window.__generToken||'')");
  const fullBodyR = await ev("String(window.__generBody||'')");
  const fullToken = v(fullGenR);
  const fullBody = v(fullBodyR);
  console.log("\n=== TOKEN FOUND ===");
  console.log("Token:", fullToken?.substring(0, 50), "len:", fullToken?.length);
  console.log("Body snippet:", fullBody?.substring(0, 200));
}

// Get the actual turnstile token from body
const bodyR = await ev("String(window.__generBody||'')");
const body = v(bodyR);
let token = null;
if (body) {
  try {
    const parsed = JSON.parse(body);
    token = parsed.token;
    console.log("\nToken from body:", token ? (String(token).substring(0,50) + "... len=" + String(token).length) : "null/missing");
  } catch(e) {}
}
if (!token && captured) token = captured;

ws.close();

if (token && String(token).length > 50) {
  const tokenStr = String(token);
  console.log(`\n=== SAVING TOKEN (len=${tokenStr.length}) ===`);
  writeFileSync("/home/alexander/projects/suno_passkey.txt", tokenStr);
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 4000));
  const result = await new Promise(resolve => {
    const pd = JSON.stringify({prompt:"Happy birthday",tags:"pop",title:"Test",make_instrumental:false,wait_audio:false});
    const req = http.request({host:"localhost",port:3000,path:"/api/custom_generate",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pd)}}, res => {
      let d = ""; res.on("data",x=>d+=x); res.on("end",()=>resolve({status:res.statusCode,body:d.substring(0,300)}));
    });
    req.on("error", e=>resolve({error:e.message}));
    req.write(pd); req.end();
  });
  console.log("Generate test:", JSON.stringify(result));
} else {
  console.log("\n❌ No token captured.");
  const tsR2 = await ev("JSON.stringify({turnstile: window.turnstile ? Object.keys(window.turnstile) : null, trapped: window.turnstile && window.turnstile.__trapped})");
  // Already closed ws, can't call ev()
}
