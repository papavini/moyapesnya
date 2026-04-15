/**
 * Monitor ALL network responses across ALL domains to find P1_ token source.
 * Navigate to /create fresh and capture the full passkey exchange.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

const tabs = await new Promise((res, rej) => {
  http.get("http://127.0.0.1:9223/json/list", r => {
    let d=""; r.on("data",x=>d+=x); r.on("end",()=>res(JSON.parse(d)));
  }).on("error",rej);
});
const tab = tabs.find(t=>t.url?.includes("suno.com")&&t.type==="page");
if(!tab){console.log("no suno tab");process.exit(1);}
console.log("Tab:", tab.url);

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r=>ws.on("open",r));
let nextId=1; const cbs={};
const pendingReqs = {};

ws.on("message",msg=>{
  const d=JSON.parse(msg.toString());
  if(d.id&&cbs[d.id]){cbs[d.id](d);delete cbs[d.id];}

  if(d.method==="Network.requestWillBeSent"){
    const url=d.params?.request?.url||"";
    const method=d.params?.request?.method||"";
    const body=d.params?.request?.postData||"";
    // Only log non-static requests
    if(!url.match(/\.(js|css|png|jpg|ico|woff|svg|map)(\?|$)/)){
      pendingReqs[d.params.requestId]={url,method};
      if(body&&body.length>2&&body.length<1000){
        console.log(`[REQ] ${method} ${url.substring(0,100)}`);
        if(body.includes("turnstile")||body.includes("token")||body.includes("passkey")){
          console.log(`      BODY: ${body.substring(0,300)}`);
        }
      } else {
        console.log(`[REQ] ${method} ${url.substring(0,100)}`);
      }
    }
  }

  if(d.method==="Network.responseReceived"){
    const url=d.params?.response?.url||"";
    const reqId=d.params?.requestId;
    const status=d.params?.response?.status;
    const ct=d.params?.response?.headers?.["content-type"]||"";
    // Read ALL non-static JSON/text responses
    if(!url.match(/\.(js|css|png|jpg|ico|woff|svg|map)(\?|$)/)&&(ct.includes("json")||ct.includes("text"))&&status&&status<500){
      const id=nextId++;
      cbs[id]=(resp)=>{
        const body=resp?.result?.body||"";
        if(body.includes("P1_")){
          const m=body.match(/P1_[A-Za-z0-9_\-\.]{50,}/);
          console.log(`\n🎯 P1_ FOUND!!! url=${url}`);
          console.log(`   token: ${m?m[0].substring(0,60):"??"}`);
          console.log(`   full body: ${body.substring(0,400)}\n`);
        } else if(body.length>2&&body.length<2000){
          if(body.includes("pass")||body.includes("token")||body.includes("auth")||body.includes("challenge")){
            console.log(`[RESP] ${status} ${url.substring(0,80)}: ${body.substring(0,200)}`);
          }
        }
      };
      ws.send(JSON.stringify({id,method:"Network.getResponseBody",params:{requestId:reqId}}));
    }
  }

  if(d.method==="Console.messageAdded"){
    const t=d.params?.message?.text||"";
    if(t.includes("P1_")||t.includes("turnstile")||t.includes("passkey")||t.includes("[hook]")){
      console.log("[CON]",t.substring(0,200));
    }
  }
});

function send(method,params={}){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method,params}));});}
function ev(expr){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true}}));});}
const v=r=>r?.result?.result?.value??r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// Install hooks FIRST
await ev(`(function(){
  if(window.__allHooksInstalled) return "already";
  window.__allHooksInstalled = true;
  window.__capturedP1 = null;

  // Hook fetch to intercept ALL responses
  var _fetch = window.fetch;
  window.fetch = function(resource, init) {
    var url = typeof resource === "string" ? resource : (resource?.url || "");
    var bodyStr = init?.body ? (typeof init.body === "string" ? init.body : "[non-string body]") : null;
    // Log any fetch with a body
    if(bodyStr && bodyStr.length > 2 && !url.match(/\\.js|\\.css/)) {
      if(bodyStr.includes("turnstile")||bodyStr.includes("token")||bodyStr.includes("passkey")||bodyStr.length < 500) {
        console.log("[hook-fetch] POST " + url.substring(0,80) + " body=" + bodyStr.substring(0,200));
      }
    }
    var promise = _fetch.apply(this, arguments);
    promise.then(function(res) {
      res.clone().text().then(function(txt) {
        if(txt.includes("P1_")) {
          var m = txt.match(/P1_[A-Za-z0-9_\\-\\.]{50,}/);
          window.__capturedP1 = m ? m[0] : null;
          console.log("[hook-fetch] 🎯 P1_ in response! url=" + url.substring(0,80) + " len=" + (m?m[0].length:"?"));
        }
      }).catch(function(){});
    }).catch(function(){});
    return promise;
  };

  // Hook XHR too
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__hookedUrl = url;
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var url = this.__hookedUrl || "";
    this.addEventListener("load", function() {
      var txt = self.responseText || "";
      if(txt.includes("P1_")) {
        var m = txt.match(/P1_[A-Za-z0-9_\\-\\.]{50,}/);
        console.log("[hook-xhr] 🎯 P1_ in XHR! url=" + url.substring(0,80) + " len=" + (m?m[0].length:"?"));
        window.__capturedP1 = m ? m[0] : null;
      }
    });
    return _send.apply(this, arguments);
  };

  console.log("[hook] all hooks installed (fetch + XHR)");
  return "ok";
})()`.replace(/\n\s*/g, " "));

// Navigate fresh to /create
console.log("\n=== Navigating fresh to /create ===\n");
await send("Page.navigate", {url: "https://suno.com/create"});
console.log("Waiting 30s for CF challenge + passkey exchange...");

for(let i=0; i<30; i++){
  await new Promise(r=>setTimeout(r,1000));
  if(i===9||i===19||i===24) console.log(`[${i+1}s] still watching...`);
  // Check if captured
  const chk = await ev("window.__capturedP1 || null");
  const val = v(chk);
  if(val && val.startsWith("P1_")){
    console.log(`\n🎯 P1_ CAPTURED via hook! len=${val.length}`);
    console.log(`Token: ${val.substring(0,80)}...`);
    break;
  }
}

// Final check
const final = await ev("window.__capturedP1 || 'none'");
console.log("\nFinal captured:", v(final)?.substring(0,80));

// Check fiber again after fresh load
const fiberScan = await ev(`(function(){
  var found=[];
  var visited=new WeakSet();
  function scan(node,d){
    if(!node||d>35||visited.has(node))return;
    visited.add(node);
    var s=node.memoizedState;
    while(s){
      var val=s.memoizedState;
      if(typeof val==="string"&&val.startsWith("P1_")&&val.length>100)found.push("len="+val.length+" "+val.substring(0,40));
      if(val&&typeof val==="object"){try{Object.values(val).forEach(function(v2){if(typeof v2==="string"&&v2.startsWith("P1_")&&v2.length>100)found.push("obj len="+v2.length+" "+v2.substring(0,40));});}catch(e){}}
      s=s.next;
    }
    scan(node.child,d+1);scan(node.sibling,d+1);
  }
  var roots=[document.getElementById("main-container"),document.body].filter(Boolean);
  var scanned=0;
  for(var i=0;i<roots.length;i++){
    var root=roots[i];
    var keys=Object.keys(root).filter(function(k){return k.startsWith("__reactFiber")||k.startsWith("__reactContainer");});
    if(keys.length){scan(root[keys[0]],0);scanned++;}
  }
  return "roots="+scanned+" found: "+(found.length?found.join("|"):"none");
})()`);
console.log("Post-nav fiber scan:", v(fiberScan));

ws.close();
