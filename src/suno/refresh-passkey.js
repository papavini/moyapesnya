/**
 * Обновляет passkey token:
 * 1. Через CDP блокирует запросы к generate API (Fetch.enable)
 * 2. Кликает Create
 * 3. Turnstile генерирует токен → перехватываем
 * 4. Запрос к SUNO API блокируется на уровне CDP — кредиты НЕ тратятся
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
      const done = (val) => { if (resolved) return; resolved = true; clearTimeout(timeout); resolve(val); };
      const timeout = setTimeout(() => { console.log('[passkey-refresh] timeout'); done(false); }, 20000);

      const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);

      ws.on('open', () => {
        // Step 1: Enable Fetch domain to intercept network requests
        ws.send(JSON.stringify({
          id: 1,
          method: 'Fetch.enable',
          params: {
            patterns: [{ urlPattern: '*studio-api-prod.suno.com/api/generate*', requestStage: 'Request' }]
          }
        }));
      });

      let fetchEnabled = false;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);

        // Fetch.enable response
        if (msg.id === 1 && !msg.error) {
          fetchEnabled = true;
          console.log('[passkey-refresh] network intercept enabled');

          // Step 2: Inject turnstile interceptor
          const inject = `(function(){
            if(window.__pkRefresh) return 'exists';
            window.__pkRefresh = true;
            function p(t){
              if(!t||t.__pkR2) return;
              t.__pkR2 = 1;
              var e = t.execute.bind(t);
              t.execute = function(s, params) {
                if(params && typeof params.callback === 'function') {
                  var cb = params.callback;
                  params.callback = function(tok) {
                    if(tok && tok.indexOf('P1_') === 0) {
                      fetch('http://localhost:3099/token', {method:'POST', body:tok});
                    }
                    cb(tok);
                  };
                }
                return e(s, params);
              };
            }
            if(window.turnstile) p(window.turnstile);
            return 'ok';
          })()`;
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: inject } }));
        }

        // Inject response → click Create
        if (msg.id === 2) {
          const click = `var b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Create'));b?(b.click(),'clicked'):'no btn'`;
          ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: click } }));
        }

        // Click response
        if (msg.id === 3) {
          const val = msg?.result?.result?.value || '';
          console.log('[passkey-refresh] click:', val);
        }

        // Fetch.requestPaused — block the generate request!
        if (msg.method === 'Fetch.requestPaused') {
          const requestId = msg.params.requestId;
          const url = msg.params.request.url;
          console.log('[passkey-refresh] BLOCKED request:', url.substring(0, 80));

          // Fail the request — don't let it through to SUNO
          ws.send(JSON.stringify({
            id: 100,
            method: 'Fetch.failRequest',
            params: { requestId, errorReason: 'BlockedByClient' }
          }));

          // Token should have been captured by now, wait for passkey-server
          setTimeout(() => {
            // Disable fetch interception
            ws.send(JSON.stringify({ id: 101, method: 'Fetch.disable' }));
            setTimeout(() => {
              try { ws.close(); } catch {}
              done(true);
            }, 3000);
          }, 2000);
        }
      });

      ws.on('error', (e) => { console.log('[passkey-refresh] ws error:', e.message); done(false); });
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
