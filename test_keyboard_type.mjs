/**
 * Реальный ввод через CDP Input.dispatchKeyEvent (посимвольно).
 * Самый надёжный способ взаимодействия с React inputs.
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

const rdpTabs = await getTabs(9223);
const rdpPage = rdpTabs.find(t => t.url?.includes("suno.com") && t.type === "page");
if (!rdpPage) { console.log("No RDP suno page!"); process.exit(1); }
console.log("RDP:", rdpPage.url);

const ws = new WebSocket(rdpPage.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));

let nextId = 1; const cbs = {}; let capturedToken = null;

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Fetch.requestPaused") {
    const url = d.params?.request?.url || "";
    const body = d.params?.request?.postData || "";
    console.log(`\n[INTERCEPT] ${d.params?.request?.method} ${url.substring(0,80)}`);
    if (body) {
      console.log(`[BODY] ${body.substring(0,400)}`);
      try { const p = JSON.parse(body); if (p.token) { capturedToken = p.token; console.log(`\n*** TOKEN FOUND! length=${p.token.length} ***`); } } catch(e) {}
    }
    // Fail to avoid credits usage
    ws.send(JSON.stringify({id: nextId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
  }
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    if (url.includes("generate/v2") || url.includes("studio-api-prod")) {
      const body = d.params?.request?.postData;
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,80)}`);
      if (body) {
        console.log(`[NET BODY] ${body.substring(0,200)}`);
        try { const p = JSON.parse(body); if (p.token) { capturedToken = p.token; console.log(`\n*** NET TOKEN: ${p.token.substring(0,35)}... ***`); } } catch(e) {}
      }
    }
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Fetch.enable", {patterns: [
  {urlPattern: "*/generate/v2-web/*", requestStage: "Request"},
  {urlPattern: "*/api/generate*", requestStage: "Request"},
]});

// Install trap
await ev(`(function(){
  window.__P1_captured = null;
  if (!window.turnstile) return;
  function cap(tok){ if(tok&&tok.startsWith('P1_')) window.__P1_captured=tok; }
  var oe=window.turnstile.execute; if(typeof oe==='function') window.turnstile.execute=function(sk,p){ if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(t){cap(t);cb(t);};} return oe.call(window.turnstile,sk,p); };
})()`);

// Use CDP mouse events to click on textarea
const taInfo = await ev(`(function(){
  var ta = document.querySelector('textarea');
  if (!ta) return null;
  var rect = ta.getBoundingClientRect();
  return JSON.stringify({x: rect.left+5, y: rect.top+5, ph: ta.placeholder.substring(0,40)});
})()`);
const taCoords = JSON.parse(v(taInfo) || "null");
console.log("Textarea coords:", taCoords);

if (taCoords) {
  // Click on textarea using mouse events
  await send("Input.dispatchMouseEvent", {type: "mousePressed", x: taCoords.x + 10, y: taCoords.y + 10, button: "left", clickCount: 1});
  await send("Input.dispatchMouseEvent", {type: "mouseReleased", x: taCoords.x + 10, y: taCoords.y + 10, button: "left", clickCount: 1});
  await new Promise(r => setTimeout(r, 300));

  // Check focus
  const focusR = await ev("document.activeElement?.tagName + ':' + document.activeElement?.placeholder?.substring(0,30)");
  console.log("Active element:", v(focusR));

  // Type text character by character
  const text = "Birthday song for my friend";
  console.log("Typing:", text);
  for (const char of text) {
    await send("Input.dispatchKeyEvent", {type: "keyDown", key: char, text: char, unmodifiedText: char});
    await send("Input.dispatchKeyEvent", {type: "char", key: char, text: char, unmodifiedText: char});
    await send("Input.dispatchKeyEvent", {type: "keyUp", key: char, text: char});
    await new Promise(r => setTimeout(r, 20));
  }

  await new Promise(r => setTimeout(r, 500));

  // Check textarea value
  const valR = await ev("document.activeElement?.value?.substring(0,50) || document.querySelector('textarea')?.value?.substring(0,50)");
  console.log("Textarea value:", v(valR));

  // Check Create button
  const btnR = await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
    return b ? 'disabled='+b.disabled : 'NO BTN';
  })()`);
  console.log("Create btn:", v(btnR));

  // Click Create if enabled
  const clickR = await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(x=>/^create$/i.test(x.textContent.trim()));
    if (!b) return 'NO BTN';
    if (!b.disabled) { b.click(); return 'CLICKED (enabled)'; }
    // Force enable if still disabled
    b.disabled = false; b.removeAttribute('disabled'); b.click();
    return 'FORCE CLICKED (was disabled)';
  })()`);
  console.log("Click:", v(clickR));
}

console.log("\nWaiting 20s for request...");
await new Promise(r => setTimeout(r, 20000));

const tokenR = await ev("window.__P1_captured ? 'HAS:'+window.__P1_captured.substring(0,30) : 'no'");
console.log("Trap token:", v(tokenR));
console.log("Network token:", capturedToken ? capturedToken.substring(0,30)+'...' : 'none');

// Save token if found
const token = capturedToken || (v(tokenR)?.startsWith('HAS:') ? (await ev("window.__P1_captured").then(r=>v(r))) : null);
if (token && token.startsWith('P1_')) {
  console.log("\n=== SAVING TOKEN ===");
  writeFileSync("/home/alexander/projects/suno_passkey.txt", token);
  execSync("sudo systemctl restart suno-api", {timeout: 30000});
  await new Promise(r => setTimeout(r, 5000));
  // Verify
  const creditCheck = await new Promise(resolve => {
    http.get("http://localhost:3000/api/get_limit", (res) => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve(data));
    }).on("error", () => resolve("failed"));
  });
  console.log("suno-api after restart:", creditCheck);
}

ws.close();
