/**
 * Перехватываем generate запрос в Service Worker target через CDP.
 * SW добавляет Turnstile токен к запросам — мы его читаем.
 * ТАКЖЕ: пробуем прямой API вызов с Clerk JWT из bot Chromium.
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

// Get the Clerk JWT from the bot Chromium
const botTabs = await getTabs(9222);
const botPage = botTabs.find(t => t.url?.includes("suno.com/create") && t.type === "page");
const swTarget = botTabs.find(t => t.type === "service_worker" && t.url?.includes("suno.com"));

console.log("Bot page:", botPage?.url);
console.log("SW target:", swTarget?.url, swTarget?.webSocketDebuggerUrl);

// Get Clerk JWT from bot Chromium page
let clerkJWT = null;
if (botPage) {
  const pageWs = new WebSocket(botPage.webSocketDebuggerUrl);
  await new Promise(r => pageWs.on("open", r));
  const res = await new Promise(r => {
    pageWs.on("message", (msg) => { const d = JSON.parse(msg.toString()); if (d.id === 1) r(d); });
    pageWs.send(JSON.stringify({id: 1, method: "Runtime.evaluate", params: {
      expression: `(function(){
        // Try to get JWT from Clerk
        var m = document.cookie.match(/__session=([^;]+)/);
        if (m) return m[1].substring(0,20)+'... (session JWT)';
        // Try window.Clerk
        if (window.Clerk?.session?.getToken) return 'has Clerk.session.getToken';
        return 'no jwt found';
      })()`,
      awaitPromise: true
    }}));
  });
  clerkJWT = res?.result?.result?.value;
  console.log("Clerk JWT:", clerkJWT);
  pageWs.close();
}

// Now connect to Service Worker and enable Fetch interception
if (!swTarget) {
  console.log("No SW target found in bot Chromium!");
} else {
  console.log("\n=== Connecting to Service Worker CDP ===");
  const swWs = new WebSocket(swTarget.webSocketDebuggerUrl);
  await new Promise(r => swWs.on("open", r));

  let capturedToken = null;
  const swCbs = {};
  let swId = 1;

  swWs.on("message", (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id && swCbs[d.id]) { swCbs[d.id](d); delete swCbs[d.id]; }
    if (d.method === "Fetch.requestPaused") {
      const url = d.params?.request?.url || "";
      const body = d.params?.request?.postData || "";
      console.log(`[SW INTERCEPT] ${d.params?.request?.method} ${url.substring(0,80)}`);
      if (body) {
        console.log(`[SW BODY] ${body.substring(0,300)}`);
        try {
          const p = JSON.parse(body);
          if (p.token) { capturedToken = p.token; console.log(`\n*** SW PASSKEY TOKEN: ${p.token.substring(0,40)} ***\n`); }
        } catch(e) {}
      }
      // Continue the request (don't fail it in SW)
      swWs.send(JSON.stringify({id: swId++, method: "Fetch.continueRequest", params: {requestId: d.params.requestId}}));
    }
    if (d.method === "Network.requestWillBeSent") {
      const url = d.params?.request?.url || "";
      if (url.includes("generate") || url.includes("studio")) {
        const body = d.params?.request?.postData;
        console.log(`[SW NET] ${d.params?.request?.method} ${url.substring(0,80)}`);
        if (body) {
          console.log(`[SW NET BODY] ${body.substring(0,200)}`);
          try { const p = JSON.parse(body); if (p.token) { capturedToken = p.token; console.log(`\n*** SW NET TOKEN: ${p.token.substring(0,40)} ***\n`); } } catch(e) {}
        }
      }
    }
  });

  function swSend(method, params={}) {
    return new Promise(r => { const id = swId++; swCbs[id] = r; swWs.send(JSON.stringify({id, method, params})); });
  }

  // Enable in SW target
  await swSend("Runtime.enable");
  await swSend("Network.enable");
  await swSend("Fetch.enable", {patterns: [
    {urlPattern: "*studio-api*generate*", requestStage: "Request"},
    {urlPattern: "*generate/v2-web*", requestStage: "Request"},
  ]});

  // Check SW context
  const swCtx = await swSend("Runtime.evaluate", {expression: "typeof self + ' | ' + self.location.href"});
  console.log("SW context:", swCtx?.result?.result?.value);

  // Try to evaluate the SW's internal state
  const swState = await swSend("Runtime.evaluate", {expression: `(function(){
    var result = {};
    // Check if SW has a passkey cached
    if (typeof PASSKEY_TOKEN !== 'undefined') result.passkey = PASSKEY_TOKEN;
    if (typeof token !== 'undefined') result.token = token;
    // Get all global vars (look for P1_ prefixed)
    for (var k in self) {
      try {
        var v = self[k];
        if (typeof v === 'string' && v.startsWith('P1_')) result['global_'+k] = v.substring(0,30);
      } catch(e) {}
    }
    return JSON.stringify(result);
  })()`});
  console.log("SW state:", swCtx?.result?.result?.value);

  // Now trigger a generate from the page side
  console.log("\n=== Triggering generate from page ===");
  const rdpTabs = await getTabs(9223);
  const rdpPage = rdpTabs.find(t => t.url?.includes("suno.com") && t.type === "page");

  if (rdpPage) {
    const pageWs2 = new WebSocket(rdpPage.webSocketDebuggerUrl);
    await new Promise(r => pageWs2.on("open", r));
    const pageCbs = {};
    let pgId = 1;
    pageWs2.on("message", (msg) => {
      const d = JSON.parse(msg.toString());
      if (d.id && pageCbs[d.id]) { pageCbs[d.id](d); delete pageCbs[d.id]; }
      if (d.method === "Fetch.requestPaused") {
        const url = d.params?.request?.url || "";
        const body = d.params?.request?.postData || "";
        console.log(`[PAGE INTERCEPT] ${d.params?.request?.method} ${url.substring(0,80)}`);
        if (body) {
          try { const p = JSON.parse(body); if (p.token) { capturedToken = p.token; console.log(`\n*** PAGE TOKEN: ${p.token.substring(0,35)} ***\n`); } } catch(e) {}
        }
        // Fail on page side (we already let it through on SW side)
        pageWs2.send(JSON.stringify({id: pgId++, method: "Fetch.failRequest", params: {requestId: d.params.requestId, errorReason: "Aborted"}}));
      }
    });
    function pgSend(method, params={}) { return new Promise(r => { const id = pgId++; pageCbs[id] = r; pageWs2.send(JSON.stringify({id, method, params})); }); }
    function pgEv(expr, ap=false) { return new Promise(r => { const id = pgId++; pageCbs[id] = r; pageWs2.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, awaitPromise: ap}})); }); }
    const pgV = r => r?.result?.result?.value;

    await pgSend("Fetch.enable", {patterns: [{urlPattern: "*generate/v2-web*", requestStage: "Request"}]});

    // Try making a direct fetch from RDP page to SUNO generate API using Clerk JWT
    console.log("Making direct generate API call from RDP browser...");
    const directCallR = await pgEv(`(async function(){
      try {
        // Get the Clerk JWT
        var sessionJWT = null;
        if (window.Clerk && window.Clerk.session) {
          try { sessionJWT = await window.Clerk.session.getToken(); } catch(e) {}
        }
        if (!sessionJWT) {
          // Try from cookie
          var m = document.cookie.match(/__session=([^;]+)/);
          sessionJWT = m ? m[1] : null;
        }

        console.log('[direct] JWT len:', sessionJWT ? sessionJWT.length : 0);

        // Make generate request
        var resp = await fetch('https://studio-api-prod.suno.com/api/generate/v2-web/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + sessionJWT,
            'Affiliate-Id': 'undefined'
          },
          body: JSON.stringify({
            prompt: 'Birthday song test CDP',
            make_instrumental: false,
            mv: 'chirp-v3-5',
            prompt_strength: 0.5,
            generation_type: 'TEXT',
            token: null
          })
        });

        var text = await resp.text();
        return 'status='+resp.status+' body='+text.substring(0,200);
      } catch(e) {
        return 'error: '+e.message;
      }
    })()`, true);
    console.log("Direct API call result:", pgV(directCallR));

    // Also try using React fiber to update textarea and click Create
    const reactFillR = await pgEv(`(function(){
      var ta = document.querySelector('textarea');
      if (!ta) return 'no ta';
      // Find React internal
      var fiberKey = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fiberKey) return 'no fiber key';
      var fiber = ta[fiberKey];
      // Walk fiber to find onChange
      var node = fiber;
      var attempts = 0;
      while (node && attempts < 50) {
        attempts++;
        if (node.memoizedProps && node.memoizedProps.onChange) {
          // Call onChange directly
          node.memoizedProps.onChange({
            target: {value: 'Birthday song test', tagName: 'TEXTAREA'},
            currentTarget: ta,
            nativeEvent: {inputType: 'insertText'},
            type: 'change'
          });
          return 'called onChange at depth '+attempts;
        }
        node = node.return;
      }
      return 'no onChange found, walked '+attempts+' nodes';
    })()`);
    console.log("React fiber update:", pgV(reactFillR));

    await new Promise(r => setTimeout(r, 500));
    const btnR = await pgEv("Array.from(document.querySelectorAll('button')).find(b=>/^create$/i.test(b.textContent.trim()))?.disabled");
    console.log("Create disabled after fiber:", pgV(btnR));

    pageWs2.close();
  }

  console.log("\nWaiting 5s...");
  await new Promise(r => setTimeout(r, 5000));

  swWs.close();
  console.log("Captured token:", capturedToken ? capturedToken.substring(0,35)+'...' : 'none');

  if (capturedToken && capturedToken.startsWith('P1_')) {
    writeFileSync("/home/alexander/projects/suno_passkey.txt", capturedToken);
    execSync("sudo systemctl restart suno-api", {timeout: 30000});
    await new Promise(r => setTimeout(r, 5000));
    console.log("TOKEN SAVED + suno-api restarted!");
  }
}
