/**
 * Find where P1_ token comes from by intercepting ALL response bodies
 * and hooking crypto.subtle.sign (in case P1_ is generated client-side).
 *
 * Run this fresh after navigate to capture the passkey exchange.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/home/alexander/projects/moyapesnya/node_modules/ws/lib/websocket.js");
import http from "http";

const tabs = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9223/json/list", res => {
    let d=""; res.on("data",x=>d+=x); res.on("end",()=>resolve(JSON.parse(d)));
  }).on("error",reject);
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

  // Track requests
  if(d.method==="Network.requestWillBeSent"){
    const url=d.params?.request?.url||"";
    const method=d.params?.request?.method||"";
    const body=d.params?.request?.postData||"";
    if(url.includes("studio-api-prod")||url.includes("challenges.cloudflare")||url.includes("suno.com/api")){
      pendingReqs[d.params.requestId]={url,method,body};
      if(body&&body.length>2&&body.length<500){
        console.log(`[REQ] ${method} ${url.substring(0,80)}`);
        console.log(`      BODY: ${body.substring(0,200)}`);
      } else {
        console.log(`[REQ] ${method} ${url.substring(0,80)}`);
      }
    }
  }

  // On response, try to read body
  if(d.method==="Network.responseReceived"){
    const url=d.params?.response?.url||"";
    const reqId=d.params?.requestId;
    const status=d.params?.response?.status;
    if(url.includes("studio-api-prod")&&status<400){
      const id=nextId++;
      cbs[id]=(resp)=>{
        const body=resp?.result?.body||"";
        if(body.length>0){
          console.log(`[RESP] ${status} ${url.substring(0,80)} body_len=${body.length}`);
          if(body.includes("P1_")){
            const m=body.match(/P1_[A-Za-z0-9_\-\.]{100,}/);
            if(m){
              console.log(`\n🎯 P1_ FOUND IN RESPONSE! url=${url}`);
              console.log(`   token len=${m[0].length} starts=${m[0].substring(0,30)}`);
              console.log(`   body: ${body.substring(0,300)}\n`);
            }
          } else if(body.length>2&&body.length<2000){
            // Log short responses that don't have P1_ (to see what they contain)
            // Filter to only interesting ones
            if(body.includes("token")||body.includes("passkey")||body.includes("auth")){
              console.log(`   body snippet: ${body.substring(0,200)}`);
            }
          }
        }
      };
      ws.send(JSON.stringify({id,method:"Network.getResponseBody",params:{requestId:reqId}}));
    }
  }

  if(d.method==="Console.messageAdded"){
    const t=d.params?.message?.text||"";
    if(t.includes("[hook]")||t.includes("P1_")||t.includes("[generate]")){
      console.log("[CON]",t.substring(0,200));
    }
  }
});

function send(method,params={}){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method,params}));});}
function ev(expr){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true}}));});}
const v=r=>r?.result?.result?.value??r?.result?.result?.description;

await send("Network.enable");
await send("Console.enable");

// Inject crypto.subtle.sign interceptor + fetch interceptor
await ev(`(function(){
  if(window.__hookInstalled) return;
  window.__hookInstalled = true;
  window.__capturedKeys = [];

  // Hook crypto.subtle.sign to capture HMAC keys
  var _sign = crypto.subtle.sign.bind(crypto.subtle);
  crypto.subtle.sign = function(algorithm, key, data) {
    var promise = _sign.apply(crypto.subtle, arguments);
    var algName = (typeof algorithm === "string") ? algorithm : (algorithm?.name || "?");
    promise.then(function(sig) {
      if(algName === "HMAC" || algName.toUpperCase() === "HMAC") {
        // Try to export key
        crypto.subtle.exportKey("raw", key).then(function(keyBuf) {
          var keyHex = Array.from(new Uint8Array(keyBuf)).map(b=>b.toString(16).padStart(2,"0")).join("");
          var dataArr = new Uint8Array(data);
          var dataHex = Array.from(dataArr.slice(0,50)).map(b=>b.toString(16).padStart(2,"0")).join("");
          window.__capturedKeys.push({keyLen:keyBuf.byteLength, keyHex:keyHex.substring(0,40), dataLen:dataArr.length, dataSample:dataHex});
          console.log("[hook] HMAC sign! key len=" + keyBuf.byteLength + " data len=" + dataArr.length);
        }).catch(function(e) {
          console.log("[hook] HMAC sign key not extractable (expected for non-extractable keys): " + e.message);
        });
      }
    }).catch(function(){});
    return promise;
  };

  // Hook fetch to see responses
  var _fetch = window.fetch;
  window.fetch = function(resource, init) {
    var url = typeof resource === "string" ? resource : (resource?.url || "");
    var promise = _fetch.apply(this, arguments);
    if(url.includes("studio-api-prod")) {
      promise.then(function(res) {
        res.clone().text().then(function(txt) {
          if(txt.includes("P1_")) {
            var m = txt.match(/P1_[A-Za-z0-9_\\-\\.]{50,}/);
            console.log("[hook] P1_ in fetch response! url=" + url.substring(0,60) + " tok=" + (m?m[0].substring(0,30):"?"));
          }
        }).catch(function(){});
      }).catch(function(){});
    }
    return promise;
  };

  console.log("[hook] crypto.subtle.sign + fetch interceptors installed");
})()`.replace(/\n\s*/g, " "));

// Navigate to /create to trigger fresh passkey authentication
console.log("\nNavigating to /create to trigger passkey auth...");
await send("Page.navigate", {url: "https://suno.com/create"});
console.log("Waiting 20s for passkey flow...");
await new Promise(r=>setTimeout(r,20000));

// Check captured keys
const keys = await ev("JSON.stringify(window.__capturedKeys || [])");
console.log("\nCaptured HMAC keys:", v(keys));

// Check if P1_ appeared anywhere
const p1 = await ev('(function(){var f=[];Object.keys(window).forEach(function(k){try{var v=window[k];if(typeof v==="string"&&v.startsWith("P1_")&&v.length>100)f.push(k);}catch(e){}});return f.join(",") || "none";})()');
console.log("P1_ in globals:", v(p1));

ws.close();
