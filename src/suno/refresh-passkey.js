/**
 * Обновляет passkey token через CDP → passkey-server → suno-api restart.
 * Вызывается перед каждой генерацией.
 */

const PASSKEY_SERVER = 'http://localhost:3099';
const CDP_URL = 'http://127.0.0.1:9222';

export async function refreshPasskeyToken() {
  try {
    // 1. Get tabs from CDP
    const tabsRes = await fetch(`${CDP_URL}/json/list`);
    const tabs = await tabsRes.json();
    const sunoTab = tabs.find(t => t.url?.includes('suno.com'));
    if (!sunoTab) {
      console.log('[passkey-refresh] no suno.com tab in CDP');
      return false;
    }

    // 2. Connect via WebSocket and inject interceptor + click Create
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; ws.close(); resolve(false); }
      }, 15000);

      ws.on('open', () => {
        // Inject interceptor
        const inject = `(function(){function p(t){if(!t||t.__pkAuto)return;t.__pkAuto=1;var e=t.execute.bind(t);t.execute=function(s,p){if(p&&typeof p.callback==='function'){var c=p.callback;p.callback=function(tok){if(tok&&tok.indexOf('P1_')===0)fetch('http://localhost:3099/token',{method:'POST',body:tok});c(tok);};}return e(s,p);};}if(window.turnstile)p(window.turnstile);var _t=window.turnstile;Object.defineProperty(window,'turnstile',{get:()=>_t,set:v=>{_t=v;p(v);},configurable:true});return'ok';})()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: inject } }));
      });

      let step = 0;
      ws.on('message', (data) => {
        step++;
        if (step === 1) {
          // Click Create
          const click = `var b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Create'));b?(b.click(),'clicked'):'no btn'`;
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: click } }));
        } else if (step === 2) {
          // Wait for passkey-server to receive token
          setTimeout(async () => {
            try {
              const health = await fetch(`${PASSKEY_SERVER}/health`);
              if (health.ok) {
                console.log('[passkey-refresh] token refresh triggered');
                if (!resolved) { resolved = true; clearTimeout(timeout); ws.close(); resolve(true); }
              }
            } catch {}
            if (!resolved) { resolved = true; clearTimeout(timeout); ws.close(); resolve(false); }
          }, 8000);
        }
      });

      ws.on('error', () => {
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
      });
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
