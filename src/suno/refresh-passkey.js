/**
 * Обновляет passkey token через CDP polling.
 * Инжектирует trap на window.turnstile, кликает Create, поллит window.__P1_token.
 * Токен читается через CDP (не браузерный fetch) → отправляется на passkey-server
 * через Node.js fetch (не браузер, нет PNA блокировки).
 */

const CDP_URL = 'http://127.0.0.1:9222';
const PASSKEY_SERVER = 'http://127.0.0.1:3099/token';

export async function refreshPasskeyToken() {
  try {
    const tabsRes = await fetch(`${CDP_URL}/json/list`);
    const tabs = await tabsRes.json();
    const sunoTab = tabs.find(t => t.url?.includes('suno.com'));
    if (!sunoTab) {
      console.log('[passkey-refresh] no suno.com tab');
      return false;
    }

    const { default: WebSocket } = await import('ws');

    return await new Promise((resolve) => {
      let resolved = false;
      let pollTimer = null;

      const done = (val) => {
        if (resolved) return;
        resolved = true;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        clearTimeout(hardTimeout);
        try { ws.close(); } catch {}
        resolve(val);
      };

      const hardTimeout = setTimeout(() => {
        console.log('[passkey-refresh] timeout (35s)');
        done(false);
      }, 35000);

      const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);
      let nextId = 1;
      const callbacks = {};

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && callbacks[msg.id]) {
          callbacks[msg.id](msg.result);
          delete callbacks[msg.id];
        }
      });

      function cdpEval(expr) {
        return new Promise(r => {
          const id = nextId++;
          callbacks[id] = r;
          ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr } }));
        });
      }

      ws.on('open', async () => {
        // Clear any previous token
        await cdpEval('window.__P1_token = null; "ok"');

        // Install turnstile trap — stores token in window.__P1_token
        // Chains with extension's existing Object.defineProperty if present
        const trap = `(function(){
          if(window.__cdpTrap) return 'exists';
          window.__cdpTrap=1;
          function capture(tok){
            if(tok&&tok.indexOf('P1_')===0) window.__P1_token=tok;
          }
          function patch(t){
            if(!t||t.__cdpDone) return;
            t.__cdpDone=1;
            var oe=t.execute;
            if(typeof oe==='function') t.execute=function(s,p){
              if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};}
              return oe.call(t,s,p);
            };
            var or=t.render;
            if(typeof or==='function') t.render=function(c,p){
              if(p&&typeof p.callback==='function'){var cb=p.callback;p.callback=function(tok){capture(tok);cb(tok);};}
              return or.call(t,c,p);
            };
          }
          if(window.turnstile) patch(window.turnstile);
          var desc=Object.getOwnPropertyDescriptor(window,'turnstile');
          if(desc&&desc.set){
            var os=desc.set;
            Object.defineProperty(window,'turnstile',{get:desc.get,set:function(v){os(v);patch(v);},configurable:true});
          } else {
            var _t=window.turnstile;
            Object.defineProperty(window,'turnstile',{get:function(){return _t;},set:function(v){_t=v;patch(v);},configurable:true});
          }
          return 'installed';
        })()`;
        const trapRes = await cdpEval(trap);
        console.log('[passkey-refresh] trap:', trapRes?.result?.value);

        // Click Create button
        const clickRes = await cdpEval(`(function(){
          var b=Array.from(document.querySelectorAll('button')).find(x=>/create/i.test(x.textContent));
          if(b){b.click();return 'clicked';}return 'no-btn';
        })()`);
        console.log('[passkey-refresh] Create clicked, polling for token...');

        // Poll window.__P1_token via CDP (no browser fetch needed)
        let attempts = 0;
        pollTimer = setInterval(async () => {
          attempts++;
          const r = await cdpEval('window.__P1_token||""');
          const token = r?.result?.value;
          if (token && token.startsWith('P1_')) {
            clearInterval(pollTimer);
            pollTimer = null;
            console.log('[passkey-refresh] token captured! length=' + token.length);
            // Send to passkey-server via Node.js fetch (NOT browser — no PNA restriction)
            try {
              const resp = await fetch(PASSKEY_SERVER, {
                method: 'POST',
                body: token,
                headers: { 'Content-Type': 'text/plain' },
              });
              console.log('[passkey-refresh] passkey-server:', resp.status);
              // Give suno-api time to restart
              await new Promise(r => setTimeout(r, 5000));
            } catch (e) {
              console.log('[passkey-refresh] send error:', e.message);
            }
            done(true);
          } else if (attempts >= 30) {
            console.log('[passkey-refresh] gave up after 30 polls');
            done(false);
          }
        }, 1000);
      });

      ws.on('error', (e) => {
        console.log('[passkey-refresh] error:', e.message);
        done(false);
      });
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
