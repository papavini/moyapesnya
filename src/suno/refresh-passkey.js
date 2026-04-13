/**
 * Обновляет passkey token через CDP (RDP Chromium port 9223).
 *
 * Алгоритм:
 * 1. Подключаемся к RDP Chromium (порт 9223, реальная сессия sonarliktor)
 * 2. Навигируем на /create, ждём 15с (CF challenge должен завершиться)
 * 3. Перехватываем ВСЕ ответы studio-api-prod.suno.com с P1_ токеном (любой эндпоинт)
 * 4. Альтернативно — кликаем Create и перехватываем generate POST через Fetch.failRequest
 * 5. Отправляем токен на passkey-server (localhost:3099/token)
 *
 * Токен: P1_eyJ... (JWT, ~1880 chars, живёт ~30 мин)
 * Источник: CF Turnstile challenge → SUNO server → P1_ JWT → stored in React state
 */

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223; // RDP Chromium (реальная сессия)
const PASSKEY_SERVER = 'http://127.0.0.1:3099/token';
const TIMEOUT_MS = 90000;

export async function refreshPasskeyToken() {
  try {
    const { default: WebSocket } = await import('ws');
    const { default: http } = await import('http');

    // Get tabs from RDP Chromium
    const tabs = await new Promise((resolve, reject) => {
      http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    const sunoTab = tabs.find(t => t.url?.includes('suno.com') && t.type === 'page');
    if (!sunoTab) {
      console.log('[passkey] no suno.com tab in RDP Chromium');
      return false;
    }

    return await new Promise((resolve) => {
      let done = false;
      let ws;
      let nextId = 1;
      const cbs = {};
      // Map requestId → url for Network.getResponseBody lookup
      const pendingRequests = {};
      let clickedCreate = false;
      let createClickCount = 0;

      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(hardTimeout);
        try { ws?.close(); } catch {}
        resolve(result);
      };

      const hardTimeout = setTimeout(() => {
        console.log('[passkey] timeout after', TIMEOUT_MS / 1000, 's');
        finish(false);
      }, TIMEOUT_MS);

      ws = new WebSocket(sunoTab.webSocketDebuggerUrl);

      ws.on('error', (e) => {
        console.log('[passkey] WebSocket error:', e.message);
        finish(false);
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());

        // Handle request callbacks
        if (msg.id && cbs[msg.id]) {
          cbs[msg.id](msg);
          delete cbs[msg.id];
        }

        // Track network requests to read responses
        if (msg.method === 'Network.requestWillBeSent') {
          const url = msg.params?.request?.url || '';
          if (url.includes('studio-api-prod.suno.com')) {
            pendingRequests[msg.params.requestId] = url;
          }
        }

        // On response, try to read body for P1_ token
        if (msg.method === 'Network.responseReceived') {
          const url = msg.params?.response?.url || '';
          const reqId = msg.params?.requestId;
          if (url.includes('studio-api-prod.suno.com') && reqId && !done) {
            // Async: read response body
            const id = nextId++;
            cbs[id] = (resp) => {
              const body = resp?.result?.body || '';
              if (body.includes('P1_')) {
                const m = body.match(/P1_[A-Za-z0-9_\-\.]{100,}/);
                if (m) {
                  console.log('[passkey] P1_ token found in API response! url=' + url.substring(0, 80));
                  console.log('[passkey] token len=' + m[0].length);
                  sendToken(m[0]);
                }
              }
            };
            ws.send(JSON.stringify({
              id,
              method: 'Network.getResponseBody',
              params: { requestId: reqId },
            }));
          }
        }

        // Intercept generate POST — this is the fallback if token isn't in other responses
        if (msg.method === 'Fetch.requestPaused') {
          const url = msg.params?.request?.url || '';
          const method = msg.params?.request?.method || '';
          const reqId = msg.params?.requestId;

          if (url.includes('generate/v2') && method === 'POST') {
            const body = msg.params?.request?.postData || '';
            console.log('[passkey] generate POST intercepted, body len:', body.length);
            console.log('[passkey] body prefix:', body.substring(0, 150));

            let token = null;
            try {
              const parsed = JSON.parse(body);
              if (parsed.token && String(parsed.token).startsWith('P1_')) {
                token = parsed.token;
              }
            } catch (e) {
              // Truncated body — try regex
              const m = body.match(/"token"\s*:\s*"(P1_[^"]+)"/);
              if (m) token = m[1];
            }

            if (token && token.length > 100) {
              // Cancel request to avoid spending credits, we have the token
              ws.send(JSON.stringify({
                id: nextId++,
                method: 'Fetch.failRequest',
                params: { requestId: reqId, errorReason: 'Aborted' },
              }));
              console.log('[passkey] token from generate body! len=' + token.length);
              sendToken(token);
            } else {
              // Token is null — continue request (let it go through) and try again later
              ws.send(JSON.stringify({
                id: nextId++,
                method: 'Fetch.continueRequest',
                params: { requestId: reqId },
              }));
              console.log('[passkey] token is null in generate body, continuing...');
              // Schedule another Create click after delay (passkey might load soon)
              if (createClickCount < 3) {
                setTimeout(() => clickCreate(), 5000);
              }
            }
          } else {
            // Continue all other requests
            ws.send(JSON.stringify({
              id: nextId++,
              method: 'Fetch.continueRequest',
              params: { requestId: reqId },
            }));
          }
        }
      });

      function cdpSend(method, params = {}) {
        return new Promise(r => {
          const id = nextId++;
          cbs[id] = r;
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      function cdpEval(expr) {
        return new Promise(r => {
          const id = nextId++;
          cbs[id] = r;
          ws.send(JSON.stringify({
            id, method: 'Runtime.evaluate',
            params: { expression: expr, returnByValue: true },
          }));
        });
      }

      const v = r => r?.result?.result?.value ?? r?.result?.result?.description;

      async function sendToken(token) {
        if (done) return;
        try {
          const resp = await fetch(PASSKEY_SERVER, {
            method: 'POST',
            body: token,
            headers: { 'Content-Type': 'text/plain' },
          });
          console.log('[passkey] passkey-server:', resp.status);
          if (resp.ok) {
            // Wait for suno-api restart
            await new Promise(r => setTimeout(r, 6000));
            finish(true);
          } else {
            finish(false);
          }
        } catch (e) {
          console.log('[passkey] send to passkey-server failed:', e.message);
          finish(false);
        }
      }

      async function clickCreate() {
        if (done) return;
        createClickCount++;
        console.log('[passkey] clicking Create (attempt', createClickCount, ')...');

        // Fill form if not done yet (needed every time after navigation)
        await cdpEval(`(function(){
          var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
          var fills = ['Happy birthday song pop upbeat', 'pop upbeat cheerful', 'Birthday'];
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          tas.slice(0, 3).forEach(function(ta, i) {
            if (ta.value.trim()) return; // already filled
            var text = fills[i] || 'song';
            nativeSetter.call(ta, text);
            var fk = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (fk) {
              var node = ta[fk];
              for (var j = 0; j < 60 && node; j++) {
                var mp = node.memoizedProps;
                if (mp && typeof mp.onChange === 'function') {
                  try { mp.onChange({target:ta,currentTarget:ta,type:'change',nativeEvent:{data:text[0],inputType:'insertText'},preventDefault:function(){},stopPropagation:function(){}}); } catch(e) {}
                  break;
                }
                node = node.return;
              }
            }
            ta.dispatchEvent(new InputEvent('input', {bubbles:true}));
          });
        })()`);
        await new Promise(r => setTimeout(r, 300));

        const result = await cdpEval(`(function(){
          var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
          var btn = creates.find(b => !b.disabled && b.getBoundingClientRect().x > 100)
                 || creates.find(b => b.getBoundingClientRect().x > 100)
                 || creates[creates.length - 1];
          if (!btn) return 'NO BTN';
          btn.removeAttribute('disabled');
          btn.disabled = false;
          btn.click();
          btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
          return 'clicked: dis=' + btn.disabled;
        })()`);
        console.log('[passkey] Create click result:', v(result));

        // Handle dialogs
        for (let d = 0; d < 4 && !done; d++) {
          await new Promise(r => setTimeout(r, 700));
          await cdpEval(`(function(){
            var dlgBtns = Array.from(document.querySelectorAll('[role=dialog] button, [role=alertdialog] button'))
              .filter(b => b.offsetParent && !/(cancel|close|dismiss)/i.test(b.textContent));
            if (dlgBtns.length > 0) dlgBtns[dlgBtns.length - 1].click();
          })()`);
        }
      }

      ws.on('open', async () => {
        try {
          // Enable Network monitoring (to read API responses for P1_ tokens)
          await cdpSend('Network.enable');

          // Enable Fetch interception for generate requests
          await cdpSend('Fetch.enable', {
            patterns: [
              { urlPattern: '*generate/v2*', requestStage: 'Request' },
            ],
          });
          console.log('[passkey] Network + Fetch interception enabled');

          // Navigate to /create
          console.log('[passkey] navigating to /create...');
          await cdpSend('Page.navigate', { url: 'https://suno.com/create' });

          // Wait for page load + CF challenge to complete (15s)
          // CF challenge completes invisibly, SUNO server returns P1_ JWT, React updates
          console.log('[passkey] waiting 15s for CF challenge + passkey auth...');
          await new Promise(r => setTimeout(r, 15000));

          // Check if we already got the token from Network responses
          if (done) return;

          // Inject JS interceptor to watch for fetch responses containing P1_
          await cdpEval(`(function(){
            if (window.__passkeyWatch) return;
            window.__passkeyWatch = true;
            window.__foundP1 = null;

            var _of = window.fetch;
            window.fetch = function(resource, init) {
              var promise = _of.apply(this, arguments);
              var url = typeof resource === 'string' ? resource : (resource?.url || '');
              if (url.includes('studio-api-prod.suno.com')) {
                promise.then(function(res) {
                  res.clone().text().then(function(txt) {
                    if (txt.includes('P1_')) {
                      var m = txt.match(/P1_[A-Za-z0-9_\\-\\.]{100,}/);
                      if (m && m[0]) {
                        window.__foundP1 = m[0];
                        console.log('[passkey-js] P1_ in response! url=' + url.substring(0,60) + ' len=' + m[0].length);
                      }
                    }
                  }).catch(function(){});
                }).catch(function(){});
              }
              return promise;
            };
            console.log('[passkey-js] fetch response watcher installed');
          })()`);

          // Poll for P1_ token in JS state for 10s
          for (let poll = 0; poll < 10 && !done; poll++) {
            await new Promise(r => setTimeout(r, 1000));
            const p1Check = await cdpEval(`window.__foundP1 || null`);
            const p1Val = v(p1Check);
            if (p1Val && p1Val.startsWith('P1_') && p1Val.length > 100) {
              console.log('[passkey] P1_ found via JS response watcher! len=' + p1Val.length);
              await sendToken(p1Val);
              return;
            }
          }

          if (done) return;

          // Switch to Advanced mode
          await cdpEval(`(function(){
            var btns = Array.from(document.querySelectorAll('button'));
            var adv = btns.find(b => /^advanced$/i.test(b.textContent.trim()));
            if (adv && !adv.classList.contains('active')) { adv.click(); }
          })()`);
          await new Promise(r => setTimeout(r, 500));

          // Fill all textareas
          const fillResult = await cdpEval(`(function(){
            var results = [];
            var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
            var fills = ['Happy birthday song pop upbeat', 'pop upbeat cheerful', 'Birthday'];
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            tas.slice(0, 3).forEach(function(ta, i) {
              var text = fills[i] || 'song';
              nativeSetter.call(ta, text);
              var fk = Object.keys(ta).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
              if (fk) {
                var node = ta[fk];
                for (var j = 0; j < 60 && node; j++) {
                  var mp = node.memoizedProps;
                  if (mp && typeof mp.onChange === 'function') {
                    try { mp.onChange({target:ta,currentTarget:ta,type:'change',nativeEvent:{data:text[0],inputType:'insertText'},preventDefault:function(){},stopPropagation:function(){}}); } catch(e) {}
                    break;
                  }
                  node = node.return;
                }
              }
              ta.dispatchEvent(new InputEvent('input', {bubbles:true}));
              results.push('ta[' + i + ']=' + ta.value.substring(0, 15));
            });
            return results.join(', ');
          })()`);
          console.log('[passkey] form filled:', v(fillResult));
          await new Promise(r => setTimeout(r, 500));

          // Click Create
          await clickCreate();

          // Now monitor — the generate request is intercepted via Fetch.requestPaused
          // and token-null case re-tries via clickCreate() after 5s

        } catch (e) {
          console.log('[passkey] ws.on open error:', e.message, e.stack?.substring(0, 200));
          finish(false);
        }
      });
    });

  } catch (e) {
    console.log('[passkey] outer error:', e.message);
    return false;
  }
}
