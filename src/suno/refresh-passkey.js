/**
 * Обновляет passkey token через CDP (RDP Chromium port 9223).
 *
 * Алгоритм:
 * 1. Подключаемся к RDP Chromium (порт 9223, реальная сессия sonarliktor)
 * 2. Включаем Fetch.enable для перехвата generate/v2-web/ запросов
 * 3. Навигируем на /create, заполняем форму, кликаем Create
 * 4. Когда браузер собирается отправить POST generate/v2-web/:
 *    - Читаем тело → P1_ токен
 *    - Вызываем Fetch.failRequest → запрос отменяется (кредиты НЕ тратятся!)
 * 5. Отправляем токен на passkey-server (localhost:3099/token)
 * 6. passkey-server пишет файл + рестартует suno-api
 *
 * Токен: P1_eyJ... (JWT, ~1880 chars, живёт ~30 мин)
 */

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223; // RDP Chromium (реальная сессия)
const PASSKEY_SERVER = 'http://127.0.0.1:3099/token';
const TIMEOUT_MS = 60000;

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
      let fetchInterceptEnabled = false;

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

        // Intercept generate POST request — this is where P1_ token lives
        if (msg.method === 'Fetch.requestPaused') {
          const url = msg.params?.request?.url || '';
          const method = msg.params?.request?.method || '';
          const reqId = msg.params?.requestId;

          if (url.includes('generate/v2') && method === 'POST') {
            const body = msg.params?.request?.postData || '';
            console.log('[passkey] generate POST intercepted, body len:', body.length);

            let token = null;
            try {
              const parsed = JSON.parse(body);
              token = parsed.token || null;
            } catch (e) {
              // If body is too large and truncated, try regex
              const m = body.match(/"token"\s*:\s*"(P1_[^"]+)"/);
              if (m) token = m[1];
            }

            // Cancel the request — token captured, no credits wasted
            ws.send(JSON.stringify({
              id: nextId++,
              method: 'Fetch.failRequest',
              params: { requestId: reqId, errorReason: 'Aborted' },
            }));

            if (token && token.startsWith('P1_') && token.length > 100) {
              console.log('[passkey] P1_ token captured! len=' + token.length);
              sendToken(token);
            } else {
              console.log('[passkey] P1_ not found in body:', body.substring(0, 100));
              finish(false);
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
        try {
          const resp = await fetch(PASSKEY_SERVER, {
            method: 'POST',
            body: token,
            headers: { 'Content-Type': 'text/plain' },
          });
          console.log('[passkey] passkey-server response:', resp.status);
          if (resp.ok) {
            // suno-api is being restarted — wait for it
            await new Promise(r => setTimeout(r, 6000));
            finish(true);
          } else {
            finish(false);
          }
        } catch (e) {
          console.log('[passkey] failed to send to passkey-server:', e.message);
          finish(false);
        }
      }

      ws.on('open', async () => {
        try {
          // Enable Fetch interception BEFORE navigating
          await cdpSend('Fetch.enable', {
            patterns: [
              { urlPattern: '*generate/v2*', requestStage: 'Request' },
              { urlPattern: '*generate/v2-web*', requestStage: 'Request' },
            ],
          });
          fetchInterceptEnabled = true;
          console.log('[passkey] Fetch interception enabled');

          // Navigate to /create (fresh page = fresh P1_ token)
          console.log('[passkey] navigating to /create...');
          await cdpSend('Page.navigate', { url: 'https://suno.com/create' });
          await new Promise(r => setTimeout(r, 6000)); // wait for page load

          // Switch to Advanced mode
          await cdpEval(`(function(){
            var btns = Array.from(document.querySelectorAll('button'));
            var adv = btns.find(b => /^advanced$/i.test(b.textContent.trim()));
            if (adv) { adv.click(); return 'advanced clicked'; }
            return 'no advanced btn';
          })()`);
          await new Promise(r => setTimeout(r, 600));

          // Fill ALL textareas via React fiber to enable Create button
          const fillResult = await cdpEval(`(function(){
            var results = [];
            var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
            var fills = [
              'Happy birthday song pop upbeat',
              'pop upbeat happy cheerful',
              'Birthday Song',
            ];
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
                    try {
                      mp.onChange({
                        target: ta, currentTarget: ta, type: 'change',
                        nativeEvent: {data: text[0], inputType: 'insertText'},
                        preventDefault: function(){}, stopPropagation: function(){}
                      });
                    } catch(e) {}
                    break;
                  }
                  node = node.return;
                }
              }
              ta.dispatchEvent(new InputEvent('input', {bubbles:true}));
              results.push('ta[' + i + ']=' + ta.value.substring(0,15));
            });
            return results.join(', ');
          })()`);
          console.log('[passkey] fill:', v(fillResult));
          await new Promise(r => setTimeout(r, 800));

          // Check Create button
          const btnCheck = await cdpEval(`JSON.stringify(
            Array.from(document.querySelectorAll('button'))
              .filter(b => /^create$/i.test(b.textContent.trim()))
              .map(b => ({dis:b.disabled, x:Math.round(b.getBoundingClientRect().x)}))
          )`);
          console.log('[passkey] Create btns:', v(btnCheck));

          // Click Create
          const clickResult = await cdpEval(`(function(){
            var creates = Array.from(document.querySelectorAll('button')).filter(b => /^create$/i.test(b.textContent.trim()));
            var btn = creates.find(b => !b.disabled && b.getBoundingClientRect().x > 100)
                   || creates.find(b => b.getBoundingClientRect().x > 100)
                   || creates[creates.length - 1];
            if (!btn) return 'NO BTN';
            btn.removeAttribute('disabled');
            btn.disabled = false;
            btn.click();
            btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
            return 'clicked: x=' + Math.round(btn.getBoundingClientRect().x) + ' dis=' + btn.disabled;
          })()`);
          console.log('[passkey] Click Create:', v(clickResult));

          // Handle any confirmation dialogs (e.g. "10 credits" confirm)
          for (let d = 0; d < 5 && !done; d++) {
            await new Promise(r => setTimeout(r, 700));
            await cdpEval(`(function(){
              var dlgBtns = Array.from(document.querySelectorAll('[role=dialog] button, [role=alertdialog] button'))
                .filter(b => b.offsetParent && !/(cancel|close|dismiss)/i.test(b.textContent));
              if (dlgBtns.length > 0) {
                var last = dlgBtns[dlgBtns.length - 1];
                console.log('[passkey] dialog btn: ' + last.textContent.trim().substring(0,20));
                last.click();
              }
            })()`);
          }

          // Now we just wait for Fetch.requestPaused to fire for generate/v2
          // (handled in message handler above)

        } catch (e) {
          console.log('[passkey] ws.open error:', e.message);
          finish(false);
        }
      });
    });

  } catch (e) {
    console.log('[passkey] error:', e.message);
    return false;
  }
}
