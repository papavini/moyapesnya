/**
 * Diagnostics: check where P1_ token is stored in the browser,
 * and if direct turnstile.render() gives 1.xxx or P1_ token.
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
ws.on("message",msg=>{
  const d=JSON.parse(msg.toString());
  if(d.id&&cbs[d.id]){cbs[d.id](d);delete cbs[d.id];}
  if(d.method==="Console.messageAdded"){
    const t=d.params?.message?.text||'';
    if(t.includes('[check]')) console.log("[CON]",t);
  }
});

function send(method,params={}){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method,params}));});}
function ev(expr){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true}}));});}
const v=r=>r?.result?.result?.value??r?.result?.result?.description;

await send("Console.enable");

// Check turnstile state
const ts = await ev('JSON.stringify({tsType:typeof window.turnstile,tsMethods:window.turnstile?Object.keys(window.turnstile).join(","):null,tsResponse:(function(){try{return window.turnstile&&window.turnstile.getResponse();}catch(e){return "err:"+e.message;}})(),cfIframes:document.querySelectorAll("iframe[src*=challenges]").length})');
console.log("Turnstile:", v(ts));

// Search globals for P1_
const p1 = await ev('(function(){var found=[];Object.keys(window).slice(0,500).forEach(function(k){try{var v=window[k];if(typeof v==="string"&&v.startsWith("P1_")&&v.length>100)found.push(k+"="+v.substring(0,20));}catch(e){}});return found.join(", ")||"none";})()');
console.log("P1_ in globals:", v(p1));

// localStorage
const ls = await ev('(function(){var f=[];try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i),v=localStorage.getItem(k);if(v&&v.includes("P1_"))f.push(k+"="+v.substring(0,40));}}catch(e){}return f.join(", ")||"none";})()');
console.log("localStorage P1_:", v(ls));

// cookies
const cookies = await ev('(document.cookie.includes("P1_")?"P1_ in cookie! "+document.cookie.substring(0,200):"no P1_ in cookie, cookie keys="+document.cookie.split(";").map(c=>c.trim().split("=")[0]).join(","))');
console.log("Cookie P1_:", v(cookies));

// Try direct render
const renderR = await ev('(function(){if(!window.turnstile)return "no turnstile";window.__p1test=null;try{var old=document.getElementById("__p1test");if(old){try{window.turnstile.remove(old.dataset.wid);}catch(e){}old.remove();}var c=document.createElement("div");c.id="__p1test";c.style.cssText="position:fixed;top:10px;right:10px;z-index:99999;";document.body.appendChild(c);var wid=window.turnstile.render("#__p1test",{sitekey:"0x4AAAAAAAFV93qQdS0ycilX",action:"generate",theme:"light",callback:function(tok){console.log("[check] callback! len="+tok.length+" starts="+tok.substring(0,20)+" P1="+tok.startsWith("P1_"));window.__p1test=tok;},"error-callback":function(e){console.log("[check] error: "+e);}});return "render ok wid="+JSON.stringify(wid);}catch(e){return "render err: "+e.message;}})()');
console.log("Direct render:", v(renderR));

console.log("Waiting 25s for turnstile callback...");
for(let i=0;i<25;i++){
  await new Promise(r=>setTimeout(r,1000));
  const tr = await ev("window.__p1test||null");
  const tok = v(tr);
  if(tok){
    console.log(`[${i+1}s] Token! len=${tok.length} starts=${tok.substring(0,25)} isP1=${tok.startsWith("P1_")}`);
    break;
  }
  if(i===9||i===19||i===24) console.log(`[${i+1}s] still waiting...`);
}

ws.close();
