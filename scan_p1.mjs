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
ws.on("message",msg=>{const d=JSON.parse(msg);if(d.id&&cbs[d.id]){cbs[d.id](d);delete cbs[d.id];}});
function ev(expr){return new Promise(r=>{const id=nextId++;cbs[id]=r;ws.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true}}));});}
const v=r=>r?.result?.result?.value??r?.result?.result?.description;

// Scan React fiber for P1_ — use main-container or body as root
const scanCode = `(function(){
  var found = [];
  var visited = new WeakSet();
  var scanCount = 0;
  function scan(node, depth) {
    if (!node || depth > 35 || visited.has(node)) return;
    visited.add(node);
    scanCount++;
    var s = node.memoizedState;
    while (s) {
      var val = s.memoizedState;
      if (typeof val === "string" && val.startsWith("P1_") && val.length > 100) {
        found.push("len=" + val.length + " " + val.substring(0,50));
      }
      if (val && typeof val === "object" && val !== null) {
        try {
          var vals = Object.values(val);
          for (var i = 0; i < vals.length && i < 20; i++) {
            var v2 = vals[i];
            if (typeof v2 === "string" && v2.startsWith("P1_") && v2.length > 100) {
              found.push("obj-val len=" + v2.length + " " + v2.substring(0,50));
            }
          }
        } catch(e) {}
      }
      s = s.next;
    }
    scan(node.child, depth+1);
    scan(node.sibling, depth+1);
  }
  try {
    // Try multiple root candidates
    var roots = [
      document.getElementById("main-container"),
      document.body,
      document.getElementById("__next"),
    ].filter(Boolean);
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      var keys = Object.keys(root).filter(function(k){return k.startsWith("__reactFiber")||k.startsWith("__reactContainer");});
      if (keys.length) {
        scan(root[keys[0]], 0);
        if (found.length) break;
      }
    }
    return "scanned=" + scanCount + " found: " + (found.length ? found.join(" | ") : "none");
  } catch(e) { return "error: " + e.message + " scanned=" + scanCount; }
})()`;

const r1 = await ev(scanCode);
console.log("Fiber scan:", v(r1));

// sessionStorage
const ssCode = `(function(){
  var f=[];
  try{for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i),v=sessionStorage.getItem(k);if(v&&v.includes("P1_"))f.push(k+"="+v.substring(0,60));}}catch(e){}
  return f.join(", ")||"none";
})()`;
const r4 = await ev(ssCode);
console.log("sessionStorage P1_:", v(r4));

// IndexedDB keys
const idbCode = `(function(){
  return new Promise(function(resolve){
    try {
      var dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
      dbs.then(function(list){resolve("dbs: " + list.map(function(d){return d.name;}).join(", ") || "none");}).catch(function(){resolve("no databases()");});
    } catch(e) { resolve("err: " + e.message); }
  });
})()`;
const r5 = await ev(idbCode);
console.log("IndexedDB:", v(r5));

ws.close();
