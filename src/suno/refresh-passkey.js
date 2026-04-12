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
        // Intercept fetch to block actual song creation, only capture token
        const inject = `(function(){
          if(window.__tokenBlocker) return 'already_installed';
          window.__tokenBlocker = true;
          var origFetch = window.fetch;
          window.__capturedToken = null;
          window.fetch = function(url, opts) {
            if(opts && opts.body && typeof opts.body === 'string') {
              try {
                var d = JSON.parse(opts.body);
                if(d.token && d.token.indexOf('P1_') === 0) {
                  window.__capturedToken = d.token;
                  fetch('http://localhost:3099/token', {method:'POST',body:d.token});
                  // Block the actual generate request
                  return Promise.resolve(new Response('{"blocked":true}', {status:200}));
                }
              } catch(e) {}
            }
            return origFetch.apply(this, arguments);
          };
          return 'blocker_installed';
        })()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: inject } }));
      });

      let step = 0;
      ws.on('message', (data) => {
        step++;
        if (step === 1) {
          // Blocker installed, now click Create to trigger turnstile
          const click = `var b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Create'));b?(b.click(),'clicked'):'no btn'`;
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: click } }));
        } else if (step === 2) {
          const result = JSON.parse(data);
          const val = result?.result?.result?.value || '';
          console.log('[passkey-refresh] click result:', val);
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
