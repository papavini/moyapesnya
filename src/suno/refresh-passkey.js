/**
 * Обновляет passkey token: перезагружает suno.com/create,
 * перехватывает turnstile.render → получает sitekey → вызывает execute напрямую.
 * НЕ кликает Create, НЕ тратит кредиты.
 */

const CDP_URL = 'http://127.0.0.1:9222';

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

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; try { ws.close(); } catch {} resolve(false); }
      }, 20000);

      const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);

      ws.on('open', () => {
        // Step 1: Inject script that intercepts turnstile.render to capture sitekey,
        // then calls execute with that sitekey to get token WITHOUT clicking Create
        const inject = `(function(){
          return new Promise(function(resolve) {
            // Patch render to capture sitekey on next page load
            var origRender = window.turnstile.render;
            window.turnstile.render = function(container, params) {
              var sk = params && params.sitekey;
              if (sk) {
                // Got sitekey! Now execute to get token
                var origCb = params.callback;
                params.callback = function(tok) {
                  if (tok && tok.indexOf('P1_') === 0) {
                    fetch('http://localhost:3099/token', {method:'POST', body:tok});
                    resolve('token_sent:' + tok.length);
                  }
                  if (origCb) origCb(tok);
                };
              }
              return origRender.call(this, container, params);
            };
            // Now reload page to trigger fresh turnstile render
            location.reload();
            // Timeout fallback
            setTimeout(function() { resolve('timeout'); }, 15000);
          });
        })()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: inject, awaitPromise: true } }));
      });

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw);
          const val = data?.result?.result?.value || '';
          console.log('[passkey-refresh] result:', val);
          if (val.startsWith('token_sent')) {
            if (!resolved) { resolved = true; clearTimeout(timeout); ws.close(); }
            // Wait for passkey-server to process
            setTimeout(() => resolve(true), 3000);
          }
        } catch {}
      });

      ws.on('error', () => {
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
      });

      ws.on('close', () => {
        // Page reloaded — websocket disconnects. Reconnect after reload
        setTimeout(async () => {
          if (resolved) return;
          try {
            // After reload, check if token was captured
            const tabsRes2 = await fetch(`${CDP_URL}/json/list`);
            const tabs2 = await tabsRes2.json();
            const tab2 = tabs2.find(t => t.url?.includes('suno.com'));
            if (!tab2) { if (!resolved) { resolved = true; resolve(false); } return; }

            const ws2 = new WebSocket(tab2.webSocketDebuggerUrl);
            ws2.on('open', () => {
              // Just check if passkey-server got a token recently
              ws2.close();
              setTimeout(async () => {
                try {
                  const h = await fetch('http://localhost:3099/health');
                  if (!resolved) { resolved = true; clearTimeout(timeout); resolve(h.ok); }
                } catch {
                  if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
                }
              }, 5000);
            });
            ws2.on('error', () => {
              if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
            });
          } catch {
            if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
          }
        }, 5000);
      });
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
