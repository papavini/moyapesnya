/**
 * Находим правильную кнопку Create (форма, не nav).
 * Показываем позицию, родителей всех кнопок с текстом Create.
 * Нажимаем форменный Create и смотрим что происходит.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

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

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let nextId = 1; const cbs = {};
const netLog = [];

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id && cbs[d.id]) { cbs[d.id](d); delete cbs[d.id]; }
  if (d.method === "Network.requestWillBeSent") {
    const url = d.params?.request?.url || "";
    netLog.push({method: d.params?.request?.method, url, body: d.params?.request?.postData});
    // Print ALL requests after we click Create
    if (url.includes("suno.com") && !url.includes("analytics") && !url.includes("clarity") && !url.includes("bat.bing") && !url.includes("tiktok") && !url.includes("static")) {
      console.log(`[NET] ${d.params?.request?.method} ${url.substring(0,100)}`);
      if (d.params?.request?.postData) console.log(`[BODY] ${d.params?.request?.postData?.substring(0,200)}`);
    }
    if (url.includes("challenges.cloudflare") || url.includes("studio-api")) {
      console.log(`[IMPORTANT] ${d.params?.request?.method} ${url.substring(0,100)}`);
    }
  }
  if (d.method === "Console.messageAdded") {
    const m = d.params?.message;
    if (m) console.log(`[CON ${m.level}] ${(m.text||'').substring(0,200)}`);
  }
});

function send(method, params={}) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method, params})); }); }
function ev(expr) { return new Promise(r => { const id = nextId++; cbs[id] = r; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr}})); }); }
const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// === STEP 1: Identify all "Create" buttons with context ===
const allCreateR = await ev(`(function(){
  var btns = Array.from(document.querySelectorAll('button, a[href="/create"]'));
  var creates = btns.filter(b => /create/i.test(b.textContent.trim()));
  return JSON.stringify(creates.map((b, i) => {
    var rect = b.getBoundingClientRect();
    var parents = [];
    var el = b.parentElement;
    for (var j = 0; j < 4 && el; j++, el = el.parentElement) {
      parents.push((el.tagName || '') + '.' + (el.className || '').substring(0,30));
    }
    return {
      idx: i,
      text: b.textContent.trim().substring(0,30),
      tagName: b.tagName,
      type: b.type,
      disabled: b.disabled,
      visible: b.offsetParent !== null,
      rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
      href: b.href,
      parents: parents.slice(0,2).join(' > ')
    };
  }));
})()`);
console.log("=== ALL CREATE BUTTONS ===");
const creates = JSON.parse(v(allCreateR) || '[]');
creates.forEach(b => console.log(`[${b.idx}] ${b.tagName} type=${b.type} visible=${b.visible} pos=(${b.rect.x},${b.rect.y}) size=${b.rect.w}x${b.rect.h} disabled=${b.disabled}`));
console.log(`    text: "${creates.map(b=>b.text).join('" / "')}"`);
creates.forEach(b => console.log(`    parents: ${b.parents}`));

// === STEP 2: Show all textareas ===
const taR = await ev(`(function(){
  return JSON.stringify(Array.from(document.querySelectorAll('textarea')).map((t, i) => ({
    idx: i,
    placeholder: t.placeholder.substring(0,60),
    value: t.value.substring(0,30),
    visible: t.offsetParent !== null,
    rect: JSON.stringify(t.getBoundingClientRect())
  })));
})()`);
console.log("\n=== TEXTAREAS ===");
console.log(v(taR));

// === STEP 3: Show ALL form state ===
const formR = await ev(`(function(){
  var forms = document.querySelectorAll('form');
  var inputs = document.querySelectorAll('input:not([type=hidden]), textarea, select');
  return JSON.stringify({
    forms: forms.length,
    inputs: Array.from(inputs).map(i => ({type: i.type||i.tagName, placeholder: (i.placeholder||'').substring(0,30), value: (i.value||'').substring(0,20), name: i.name})),
    // Current page state
    url: window.location.href,
  });
})()`);
console.log("\n=== FORM STATE ===");
console.log(v(formR));

// === STEP 4: Fill textarea and click the RIGHT create button ===
console.log("\n=== FILLING FORM ===");

// First, make sure we're in Simple mode (click Simple tab if needed)
await ev(`(function(){
  var simple = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Simple');
  if (simple && !simple.className.includes('active')) {
    simple.click();
    console.log('[test] Clicked Simple tab');
  } else {
    console.log('[test] Already in Simple or not found:', simple?.className?.substring(0,30));
  }
})()`);
await new Promise(r => setTimeout(r, 500));

// Find the description textarea (in Simple mode) and fill it
const fillR = await ev(`(function(){
  // In Simple mode, there might be a different textarea
  var allTa = Array.from(document.querySelectorAll('textarea'));
  console.log('[test] Found ' + allTa.length + ' textareas');
  allTa.forEach((ta, i) => {
    console.log('[test] ta[' + i + '] placeholder=' + ta.placeholder.substring(0,50) + ' visible=' + (ta.offsetParent!==null));
  });

  // Pick the visible one
  var ta = allTa.find(el => el.offsetParent !== null) || allTa[0];
  if (!ta) return 'NO TEXTAREA';

  // Update via native setter
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A happy birthday song for my best friend');

  // Update via React fiber
  var fiberKey = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  if (fiberKey) {
    var node = ta[fiberKey];
    while (node) {
      var props = node.memoizedProps || node.pendingProps;
      if (props && typeof props.onChange === 'function') {
        props.onChange({target: ta, currentTarget: ta, type: 'change', nativeEvent: {data: 'A', inputType: 'insertText'}, preventDefault: function(){}, stopPropagation: function(){}});
        console.log('[test] fiber onChange called, value=' + ta.value.substring(0,30));
        break;
      }
      node = node.return;
    }
  }

  // Also try dispatchEvent
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  ta.dispatchEvent(new Event('change', {bubbles: true}));

  return 'filled: ' + ta.value.substring(0,30) + ' placeholder=' + ta.placeholder.substring(0,40);
})()`);
console.log("Fill:", v(fillR));
await new Promise(r => setTimeout(r, 1000));

// === STEP 5: Install turnstile trap before clicking ===
await ev(`(function(){
  window.__P1_captured = null;
  if (!window.turnstile) { console.log('[trap] no turnstile'); return; }
  if (window.turnstile.__myTrap) return;
  window.turnstile.__myTrap = true;

  var origRender = window.turnstile.render;
  window.turnstile.render = function(c, p) {
    console.log('[trap] render() sitekey=' + (p&&p.sitekey) + ' action=' + (p&&p.action));
    if (p && typeof p.callback === 'function') {
      var cb = p.callback;
      p.callback = function(tok) {
        console.log('[trap] render callback! tok=' + (tok||'').substring(0,30));
        if (tok && tok.startsWith('P1_')) window.__P1_captured = tok;
        return cb(tok);
      };
    }
    return origRender.call(this, c, p);
  };
  var origEx = window.turnstile.execute;
  window.turnstile.execute = function(c, p) {
    console.log('[trap] execute() c=' + JSON.stringify(c).substring(0,30));
    return origEx.call(this, c, p);
  };
  console.log('[trap] traps installed');
})()`);

// === STEP 6: Find the REAL form Create button (not nav) and click it ===
const btnClickR = await ev(`(function(){
  var allBtns = Array.from(document.querySelectorAll('button'));
  var creates = allBtns.filter(b => /^create$/i.test(b.textContent.trim()));

  console.log('[test] Found ' + creates.length + ' Create buttons');
  creates.forEach((b, i) => {
    var rect = b.getBoundingClientRect();
    console.log('[test] Create[' + i + '] visible=' + (b.offsetParent!==null) + ' pos=(' + Math.round(rect.x) + ',' + Math.round(rect.y) + ') disabled=' + b.disabled + ' cls=' + b.className.substring(0,50));
  });

  // Find the one that looks like a form button (not in the nav sidebar)
  // Nav create button is typically at x=0-100, y near top
  // Form create button is somewhere in the middle/right of the page
  var formCreate = creates.find(b => {
    var rect = b.getBoundingClientRect();
    return rect.x > 100 && rect.y > 100 && b.offsetParent !== null;
  });

  if (!formCreate) {
    // Try to find by looking at the button with more context
    formCreate = creates.find(b => b.offsetParent !== null) || creates[creates.length - 1];
  }

  if (!formCreate) return 'NO FORM CREATE BTN';

  var rect = formCreate.getBoundingClientRect();
  console.log('[test] Clicking form Create at (' + Math.round(rect.x) + ',' + Math.round(rect.y) + ') disabled=' + formCreate.disabled);
  formCreate.click();
  return 'clicked at (' + Math.round(rect.x) + ',' + Math.round(rect.y) + ') disabled=' + formCreate.disabled;
})()`);
console.log("Form Create click:", v(btnClickR));

// Wait 15 seconds and monitor
console.log("\nWaiting 15s...");
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const checkR = await ev(`JSON.stringify({
    p1: window.__P1_captured ? 'YES:'+window.__P1_captured.substring(0,20) : 'no',
    cfIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
    allIframes: document.querySelectorAll('iframe').length,
    generating: document.body.textContent.includes('Generating') || document.body.textContent.includes('generating'),
  })`);
  const s = JSON.parse(v(checkR) || '{}');
  if (s.p1 !== 'no') { console.log(`\n*** P1_ CAPTURED: ${s.p1} ***`); break; }
  if (s.cfIframes > 0) console.log(`[${i+1}s] CF iframes appeared: ${s.cfIframes}`);
  if (s.generating) { console.log(`[${i+1}s] GENERATING!`); break; }
  if (i % 5 === 4) console.log(`[${i+1}s] all iframes: ${s.allIframes}, cf: ${s.cfIframes}`);
}

// Try using CDP Input.dispatchMouseEvent to click by coordinates
const taCoords = await ev(`(function(){
  var ta = Array.from(document.querySelectorAll('textarea')).find(el => el.offsetParent !== null);
  if (!ta) return null;
  var r = ta.getBoundingClientRect();
  return JSON.stringify({x: r.x+10, y: r.y+10});
})()`);
const coords = JSON.parse(v(taCoords) || 'null');
if (coords) {
  console.log("\n=== TRYING CDP MOUSE CLICK ===");
  console.log("Textarea at:", coords);
  await send("Input.dispatchMouseEvent", {type: "mousePressed", x: coords.x+20, y: coords.y+20, button: "left", clickCount: 1});
  await send("Input.dispatchMouseEvent", {type: "mouseReleased", x: coords.x+20, y: coords.y+20, button: "left", clickCount: 1});
  await new Promise(r => setTimeout(r, 200));
  const focusR = await ev("document.activeElement?.tagName + ':' + (document.activeElement?.placeholder||'').substring(0,30)");
  console.log("After mouse click - active element:", v(focusR));
}

console.log("\n=== NET LOG ===");
netLog.forEach(r => {
  if (!r.url.includes('analytics') && !r.url.includes('clarity') && !r.url.includes('bat.bing') && !r.url.includes('tiktok') && !r.url.includes('static'))
    console.log(`${r.method} ${r.url.substring(0,100)}`);
});

ws.close();
