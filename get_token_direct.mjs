/**
 * Напрямую рендерим Turnstile с реальным sitekey SUNO (0x4AAAAAAAFV93qQdS0ycilX).
 * Это самый прямой способ получить P1_ токен без UI.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SUNO_SITEKEY = "0x4AAAAAAAFV93qQdS0ycilX";

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
    if (url.includes("challenges.cloudflare") || url.includes("turnstile") || url.includes("studio-api")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m) {
      const txt = m.text || '';
      if (txt.includes('[direct]') || txt.includes('P1_') || txt.includes('error') || txt.includes('Error')) {
        console.log(`[CON ${m.level}] ${txt.substring(0,200)}`);
      }
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
function evAp(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: true}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// Navigate to fresh /create to ensure Turnstile JS is loaded
console.log("Navigating to /create...");
await send("Page.navigate", {url: "https://suno.com/create"});
await new Promise(r => setTimeout(r, 5000)); // Wait for Turnstile JS to load

// Check Turnstile is loaded
const checkR = await ev("typeof window.turnstile + ' | methods: ' + (window.turnstile ? Object.keys(window.turnstile).join(',') : 'N/A')");
console.log("Turnstile state:", v(checkR));

if (!v(checkR)?.includes("object")) {
  // Wait more
  console.log("Waiting for Turnstile to load...");
  await new Promise(r => setTimeout(r, 3000));
  const check2R = await ev("typeof window.turnstile");
  console.log("Turnstile after wait:", v(check2R));
}

// === DIRECT TURNSTILE RENDER with correct sitekey ===
console.log("\n=== Rendering Turnstile directly ===");
const renderR = await ev(`(function(){
  if (!window.turnstile) return 'ERROR: no turnstile';

  // Remove any previous test containers
  var old = document.getElementById('__suno_direct_ts');
  if (old) old.remove();

  // Create container
  var container = document.createElement('div');
  container.id = '__suno_direct_ts';
  container.style.cssText = 'position:fixed;top:0;left:0;width:300px;height:65px;z-index:99999;opacity:1;';
  document.body.appendChild(container);

  window.__directToken = null;
  window.__directError = null;

  var widgetId = window.turnstile.render('#__suno_direct_ts', {
    sitekey: '${SUNO_SITEKEY}',
    action: 'generate',
    theme: 'light',
    size: 'normal',
    callback: function(token) {
      console.log('[direct] CALLBACK! len=' + token.length + ' starts=' + token.substring(0,15));
      window.__directToken = token;
    },
    'error-callback': function(errCode) {
      console.log('[direct] ERROR: ' + errCode);
      window.__directError = errCode;
    },
    'expired-callback': function() {
      console.log('[direct] EXPIRED');
    },
    'before-interactive-callback': function() {
      console.log('[direct] BEFORE INTERACTIVE');
    },
    'after-interactive-callback': function() {
      console.log('[direct] AFTER INTERACTIVE');
    },
    'unsupported-callback': function() {
      console.log('[direct] UNSUPPORTED');
    }
  });

  console.log('[direct] render() widgetId=' + widgetId);
  return 'render called, widgetId=' + JSON.stringify(widgetId);
})()`);
console.log("Render result:", v(renderR));

// Monitor for 40 seconds
console.log("\nWaiting for Turnstile callback (40s)...");
let capturedToken = null;
const deadline = Date.now() + 40000;
let lastCheck = 0;

while (Date.now() < deadline && !capturedToken) {
  await new Promise(r => setTimeout(r, 1000));
  const elapsed = Math.round((Date.now() - (deadline - 40000)) / 1000);

  const stateR = await ev(`JSON.stringify({
    token: window.__directToken ? window.__directToken.substring(0,30) : null,
    error: window.__directError,
    hasIframe: !!document.querySelector('#__suno_direct_ts iframe'),
    iframeSrc: document.querySelector('#__suno_direct_ts iframe')?.src?.substring(0,80),
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
  })`);
  const state = JSON.parse(v(stateR) || '{}');

  if (state.token) {
    capturedToken = state.token;
    console.log(`\n=== TOKEN CAPTURED (partial)! ===`);
    break;
  }
  if (state.error) {
    console.log(`[${elapsed}s] ERROR from Turnstile: ${state.error}`);
    break;
  }
  if (elapsed % 5 === 1 || state.hasIframe !== lastCheck) {
    console.log(`[${elapsed}s] hasIframe=${state.hasIframe} cfIframes=${state.cfIframes} src=${state.iframeSrc?.substring(0,60)}`);
    lastCheck = state.hasIframe;
  }
}

// Get full token
if (capturedToken) {
  const fullR = await ev("window.__directToken || ''");
  const fullToken = v(fullR);
  console.log("Full token length:", fullToken?.length);
  console.log("Starts with:", fullToken?.substring(0, 40));

  if (fullToken?.startsWith("P1_") && fullToken.length > 20) {
    console.log("\n=== SAVING TOKEN ===");
    writeFileSync("/home/alexander/projects/suno_passkey.txt", fullToken);
    console.log("Written to suno_passkey.txt");

    execSync("sudo systemctl restart suno-api", {timeout: 30000});
    console.log("suno-api restarted, waiting 5s...");
    await new Promise(r => setTimeout(r, 5000));

    const limitCheck = await new Promise(resolve => {
      http.get("http://localhost:3000/api/get_limit", (res) => {
        let d = ""; res.on("data", x => d += x); res.on("end", () => resolve(d));
      }).on("error", () => resolve("error"));
    });
    console.log("suno-api limit:", limitCheck);

    // Quick generate test (just check it doesn't 422)
    console.log("\n=== Testing generate (no wait_audio) ===");
    const testResult = await new Promise(resolve => {
      const postData = JSON.stringify({
        prompt: "Happy birthday to you",
        tags: "pop",
        title: "Birthday Test",
        make_instrumental: false,
        wait_audio: false
      });
      const req = http.request({
        host: "localhost", port: 3000, path: "/api/custom_generate", method: "POST",
        headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData)}
      }, (res) => {
        let d = ""; res.on("data", x => d += x); res.on("end", () => resolve({status: res.statusCode, body: d.substring(0,300)}));
      });
      req.on("error", e => resolve({error: e.message}));
      req.write(postData); req.end();
    });
    console.log("Generate test:", JSON.stringify(testResult));
  }
} else {
  console.log("\n❌ Token not captured.");
  // Show current state of Turnstile widget
  const finalStateR = await ev(`JSON.stringify({
    containerHTML: document.getElementById('__suno_direct_ts')?.innerHTML?.substring(0,200),
    error: window.__directError,
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
  })`);
  console.log("Final widget state:", v(finalStateR));
}

ws.close();
