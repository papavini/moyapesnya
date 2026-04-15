/**
 * Получаем P1_ passkey токен от SUNO:
 * 1. React fiber обновляет textarea state → Create кнопка активна
 * 2. Кликаем Create → SUNO делает generate request
 * 3. Перехватываем POST via Fetch.enable → читаем token → отменяем запрос
 * 4. Сохраняем токен → рестартуем suno-api
 *
 * Запускать: node /tmp/get_passkey.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const PASSKEY_FILE = "/home/alexander/projects/suno_passkey.txt";

async function getTabs(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = ""; res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

// Try RDP Chromium first, then bot Chromium
let sourcePort = 9223;
let sourceTabs = await getTabs(9223).catch(() => null);
let sourcePage = sourceTabs?.find(t => t.url?.includes("suno.com") && t.type === "page");

if (!sourcePage) {
  console.log("RDP Chromium not available, trying bot Chromium...");
  sourcePort = 9222;
  sourceTabs = await getTabs(9222);
  sourcePage = sourceTabs?.find(t => t.url?.includes("suno.com/create") && t.type === "page");
}

if (!sourcePage) { console.log("No suno page found!"); process.exit(1); }
console.log(`Using port ${sourcePort}: ${sourcePage.url}`);

const ws = new WebSocket(sourcePage.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1;
const cbs = {};
let capturedToken = null;
let resolved = false;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }

  if (d.method === "Fetch.requestPaused") {
    const req = d.params?.request;
    const url = req?.url || "";
    const method = req?.method || "";
    const body = req?.postData || "";

    if (url.includes("generate/v2-web") || url.includes("studio-api")) {
      console.log(`[FETCH] ${method} ${url.substring(0,80)}`);

      if (method === "OPTIONS") {
        // Let CORS preflight through
        ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
        return;
      }

      if (method === "POST" && body) {
        console.log(`[BODY] ${body.substring(0,400)}`);
        try {
          const p = JSON.parse(body);
          if (p.token && typeof p.token === "string" && p.token.length > 5) {
            capturedToken = p.token;
            console.log(`\n✅ TOKEN CAPTURED! length=${p.token.length}`);
          } else {
            console.log("POST body token:", p.token);
          }
        } catch(e) {}
      }

      // Fail POST to avoid generating (save credits)
      if (method === "POST") {
        ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
        return;
      }
    }
    // Continue all other requests
    ws.send(JSON.stringify({id: nextId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
  }
});

function send(method, params={}) {
  return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); });
}
function ev(expr, ap=false) {
  return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); });
}
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

// Enable interceptors
await send("Network.enable");
await send("Fetch.enable", {patterns: [
  {urlPattern: "*studio-api*", requestStage: "Request"},
  {urlPattern: "*generate/v2-web*", requestStage: "Request"},
]});

// Navigate to /create if needed
const urlR = await ev("window.location.href");
if (!v(urlR)?.includes("/create")) {
  console.log("Navigating to /create...");
  await send("Page.navigate", {url: "https://suno.com/create"});
  await new Promise(r => setTimeout(r, 5000));
}

// Check Turnstile trap on existing turnstile
await ev(`(function(){
  window.__P1_captured = null;
  if (!window.turnstile) { console.log('[get_passkey] no window.turnstile'); return; }
  function cap(tok){ if(tok&&tok.startsWith('P1_')){ window.__P1_captured=tok; console.log('[get_passkey] P1_ captured! len='+tok.length); } }
  var oe=window.turnstile.execute; if(typeof oe==='function') window.turnstile.execute=function(sk,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(t){cap(t);cb(t);};} return oe.call(window.turnstile,sk,p); };
  console.log('[get_passkey] turnstile trap installed');
})()`);

// Update React state via fiber to fill textarea
const fillR = await ev(`(function(){
  // Find the main lyrics textarea
  var ta = Array.from(document.querySelectorAll('textarea')).find(el =>
    el.placeholder && (el.placeholder.includes('lyrics') || el.placeholder.includes('Leave blank'))
  ) || document.querySelector('textarea');
  if (!ta) return 'NO TEXTAREA';

  // Find React fiber and update via onChange
  var fiberKey = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  if (!fiberKey) {
    // Fallback: try nativeInputValueSetter approach
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Happy birthday song for a special friend');
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    ta.dispatchEvent(new Event('change', {bubbles:true}));
    return 'fallback: set value + events';
  }

  var fiber = ta[fiberKey];
  var node = fiber;
  var depth = 0;
  while (node && depth < 100) {
    depth++;
    var props = node.memoizedProps || node.pendingProps;
    if (props && typeof props.onChange === 'function') {
      // Also update native value for display
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Happy birthday song for a special friend');
      props.onChange({
        target: ta,
        currentTarget: ta,
        type: 'change',
        nativeEvent: {data: 'H', inputType: 'insertText'},
        preventDefault: function(){},
        stopPropagation: function(){}
      });
      return 'fiber onChange called at depth=' + depth + ' value='+ta.value.substring(0,20);
    }
    node = node.return;
  }
  return 'onChange not found after '+depth+' nodes';
})()`);
console.log("Fill via fiber:", v(fillR));

await new Promise(r => setTimeout(r, 800));

// Check Create button
const btnR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b => /^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO CREATE BTN found! btns='+Array.from(document.querySelectorAll('button')).slice(0,5).map(b=>b.textContent.trim().substring(0,15)).join('|');
  return 'disabled='+create.disabled+' text='+create.textContent.trim();
})()`);
console.log("Create btn:", v(btnR));

// Click Create!
const clickR = await ev(`(function(){
  var create = Array.from(document.querySelectorAll('button')).find(b => /^create$/i.test(b.textContent.trim()));
  if (!create) return 'NO BTN';
  if (create.disabled) {
    // Force enable
    create.removeAttribute('disabled');
    Object.defineProperty(create, 'disabled', {value: false, writable: true});
  }
  create.click();
  return 'CLICKED! disabled_was='+create.disabled;
})()`);
console.log("Click:", v(clickR));

// Wait for token (up to 30 seconds)
console.log("\nWaiting for generate request + token...\n");
const deadline = Date.now() + 30000;
while (Date.now() < deadline && !capturedToken) {
  await new Promise(r => setTimeout(r, 500));
  // Check if trapped via turnstile
  const tsCheck = await ev("window.__P1_captured||''");
  if (v(tsCheck)?.startsWith("P1_")) {
    capturedToken = v(tsCheck);
    console.log("Captured via turnstile trap:", capturedToken.substring(0,30));
  }
}

ws.close();

if (capturedToken && capturedToken.startsWith("P1_")) {
  console.log(`\n=== SAVING TOKEN (length=${capturedToken.length}) ===`);
  writeFileSync(PASSKEY_FILE, capturedToken);
  console.log("Written to:", PASSKEY_FILE);
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 5000));
  // Verify
  const creds = await new Promise(resolve => {
    http.get("http://localhost:3000/api/get_limit", (res) => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve(data));
    }).on("error", () => resolve("error"));
  });
  console.log("suno-api after restart:", creds);

  // Test generate
  console.log("\n=== TESTING GENERATE ===");
  const genTest = await new Promise(resolve => {
    const postData = JSON.stringify({prompt: "Happy birthday", tags: "pop", title: "Test", make_instrumental: false, wait_audio: false});
    const req = http.request({host: "localhost", port: 3000, path: "/api/custom_generate", method: "POST", headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData)}}, (res) => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve({status: res.statusCode, body: data.substring(0,200)}));
    });
    req.on("error", e => resolve({error: e.message}));
    req.write(postData); req.end();
  });
  console.log("Generate test:", JSON.stringify(genTest));
} else {
  console.log("\n❌ Token not captured after 30 seconds.");
  console.log("The generate request may not have included a passkey in the body.");
  console.log("Current suno_passkey.txt remains unchanged.");
}
