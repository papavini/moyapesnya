/**
 * Получаем свежий Turnstile токен и НЕМЕДЛЕННО тестируем generate.
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

async function testGenerate(host) {
  return new Promise(resolve => {
    const postData = JSON.stringify({
      prompt: "Happy birthday pop song",
      tags: "pop upbeat",
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
}

const tabs = await getTabs(9223);
const page = tabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!page) { console.log("No RDP suno page!"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let nextId = 1; const cbs = {};

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m && (m.text?.includes('[fresh]') || m.text?.includes('error'))) {
      console.log(`[CON ${m.level}] ${(m.text||'').substring(0,150)}`);
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Console.enable");

// Get fresh token via direct render
console.log("Getting fresh Turnstile token...");
const renderR = await ev(`(function(){
  if (!window.turnstile) return 'no turnstile';
  window.__freshToken = null;

  // Remove old widget
  var old = document.getElementById('__fresh_ts');
  if (old) { try { window.turnstile.remove(old.dataset.widgetId); } catch(e) {} old.remove(); }

  var c = document.createElement('div');
  c.id = '__fresh_ts';
  c.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;';
  document.body.appendChild(c);

  try {
    var wid = window.turnstile.render('#__fresh_ts', {
      sitekey: '${SUNO_SITEKEY}',
      action: 'generate',
      theme: 'light',
      size: 'normal',
      callback: function(tok) {
        console.log('[fresh] CALLBACK len=' + tok.length + ' starts=' + tok.substring(0,15));
        window.__freshToken = tok;
      },
      'error-callback': function(e) { console.log('[fresh] ERROR: ' + e); },
    });
    return 'render ok, wid=' + wid;
  } catch(e) { return 'render error: ' + e.message; }
})()`);
console.log("Render:", v(renderR));

// Wait up to 15s for token
let token = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await ev("window.__freshToken || null");
  if (v(r)) { token = v(r); break; }
  if (i % 3 === 2) console.log(`[${i+1}s] waiting...`);
}
ws.close();

if (!token) {
  console.log("❌ No token.");
  process.exit(1);
}
console.log(`\nGot token: len=${token.length} starts=${token.substring(0,30)}`);

// Save and restart suno-api
writeFileSync("/home/alexander/projects/suno_passkey.txt", token);
console.log("Saved to suno_passkey.txt");
execSync("sudo systemctl restart suno-api", {timeout: 30000});
console.log("suno-api restarted, waiting 4s...");
await new Promise(r => setTimeout(r, 4000));

// IMMEDIATELY test generate
console.log("\nTesting generate...");
const result = await testGenerate();
console.log("Generate result:", JSON.stringify(result));

if (result.status === 200 || (result.body && !result.body.includes("Token validation"))) {
  console.log("\n✅ GENERATE WORKS!");
  console.log("Body:", result.body.substring(0,200));
} else {
  console.log("\n❌ Generate failed. Trying with studio-api-prod.suno.com URL...");
  // The BASE_URL might be wrong. Let me check what suno-api is using
  const urlCheck = await new Promise(resolve => {
    http.get("http://localhost:3000/api/get_limit", (res) => {
      let d = ""; res.on("data", x => d += x); res.on("end", () => resolve({status: res.statusCode, body: d}));
    }).on("error", () => resolve({error: "failed"}));
  });
  console.log("get_limit:", JSON.stringify(urlCheck));
}
