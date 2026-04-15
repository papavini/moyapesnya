/**
 * Test script: calls refreshPasskeyToken() directly and verifies it works.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Simulate what the bot does
const { refreshPasskeyToken } = await import("/home/alexander/projects/moyapesnya/src/suno/refresh-passkey.js");

console.log("Testing refreshPasskeyToken()...");
const start = Date.now();
const result = await refreshPasskeyToken();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\nResult: ${result} (took ${elapsed}s)`);

if (result) {
  // Verify token was saved and suno-api works
  const http = (await import("http")).default;
  const testResult = await new Promise(resolve => {
    http.get("http://localhost:3000/api/get_limit", (res) => {
      let d = ""; res.on("data", x => d += x); res.on("end", () => resolve({status: res.statusCode, body: d}));
    }).on("error", e => resolve({error: e.message}));
  });
  console.log("suno-api get_limit:", testResult.status, testResult.body?.substring(0, 100));

  const generateResult = await new Promise(resolve => {
    const pd = JSON.stringify({prompt:"test",tags:"pop",title:"test",make_instrumental:false,wait_audio:false});
    const req = http.request({host:"localhost",port:3000,path:"/api/custom_generate",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(pd)}}, res => {
      let d = ""; res.on("data",x=>d+=x); res.on("end",()=>resolve({status:res.statusCode,body:d.substring(0,200)}));
    });
    req.on("error",e=>resolve({error:e.message}));
    req.write(pd); req.end();
  });
  console.log("generate test:", generateResult.status, generateResult.body?.substring(0, 100));
}
