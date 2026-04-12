/**
 * Обновляет passkey token через CDP:
 * 1. Инжектит скрипт через Page.addScriptToEvaluateOnNewDocument (ДО загрузки)
 * 2. Перезагружает страницу
 * 3. Скрипт перехватывает turnstile.render → получает sitekey → execute → token
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
      const done = (val) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve(val);
      };
      const timeout = setTimeout(() => done(false), 25000);

      const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);

      ws.on('open', async () => {
        // Step 1: Add script that runs BEFORE page loads
        const interceptScript = `
          (function() {
            var _origDefProp = Object.defineProperty;
            var _turnstile;
            Object.defineProperty(window, 'turnstile', {
              get: function() { return _turnstile; },
              set: function(val) {
                _turnstile = val;
                if (val && typeof val.render === 'function') {
                  var origRender = val.render;
                  val.render = function(container, params) {
                    if (params && params.sitekey && typeof params.callback === 'function') {
                      var origCb = params.callback;
                      params.callback = function(token) {
                        if (token && token.indexOf('P1_') === 0) {
                          fetch('http://localhost:3099/token', {method: 'POST', body: token}).catch(function(){});
                          console.log('PASSKEY_CAPTURED:' + token.length);
                        }
                        origCb(token);
                      };
                    }
                    return origRender.call(this, container, params);
                  };
                }
              },
              configurable: true
            });
          })();
        `;

        // Add script to run on page load
        ws.send(JSON.stringify({
          id: 1,
          method: 'Page.addScriptToEvaluateOnNewDocument',
          params: { source: interceptScript }
        }));
      });

      let step = 0;
      ws.on('message', (raw) => {
        step++;
        if (step === 1) {
          // Script registered, now reload
          console.log('[passkey-refresh] interceptor registered, reloading page...');
          ws.send(JSON.stringify({ id: 2, method: 'Page.reload' }));
        }
        if (step === 2) {
          // Page reloading, enable console monitoring
          ws.send(JSON.stringify({ id: 3, method: 'Runtime.enable' }));
        }
      });

      // Listen for console messages from the page
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.method === 'Runtime.consoleAPICalled') {
            const text = msg.params?.args?.[0]?.value || '';
            if (text.startsWith('PASSKEY_CAPTURED:')) {
              console.log('[passkey-refresh] token captured!', text);
              // Wait for passkey-server to process
              setTimeout(() => {
                try { ws.close(); } catch {}
                done(true);
              }, 3000);
            }
          }
        } catch {}
      });

      ws.on('error', () => done(false));
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
