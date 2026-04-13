/**
 * Обновляет passkey token через CDP (RDP Chromium port 9223).
 *
 * Алгоритм:
 * 1. Подключаемся к RDP Chromium (порт 9223, реальная сессия sonarliktor)
 * 2. Навигируем на /create, ждём 20с (CF challenge должен завершиться → P1_ в React state)
 * 3. Заполняем форму через React fiber, кликаем Create
 * 4. Перехватываем generate POST через Fetch.failRequest → читаем P1_ из тела
 * 5. Если token: null → навигируем прочь и обратно на /create (форс новый CF challenge)
 * 6. Отправляем токен на passkey-server (localhost:3099/token)
 *
 * Токен: P1_eyJ... (JWT, ~1880 chars, живёт ~30-60 мин)
 * Источник: CF Turnstile challenge → P1_ JWT → stored in React state
 */

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223; // RDP Chromium (реальная сессия)
const PASSKEY_SERVER = 'http://127.0.0.1:3099/token';
const TIMEOUT_MS = 300000; // 5 min (60s wait per attempt × up to 3 attempts)

const DEFAULT_FILLS = [
  'Happy birthday song pop upbeat cheerful',  // lyrics
  'pop upbeat cheerful birthday',              // style tags
  'Happy Birthday Song',                       // title
];

// fills: [lyrics, tags, title] — передай реальные данные пользователя чтобы не создавать мусор
export async function refreshPasskeyToken(fills) {
  fills = fills || DEFAULT_FILLS;
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
    console.log('[passkey] tab:', sunoTab.url);

    return await new Promise((resolve) => {
      let done = false;
      let ws;
      let nextId = 1;
      const cbs = {};
      let createClickCount = 0;
      let nullTokenCount = 0;

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

        // Intercept generate POST — main token capture path
        if (msg.method === 'Fetch.requestPaused') {
          const url = msg.params?.request?.url || '';
          const method = msg.params?.request?.method || '';
          const reqId = msg.params?.requestId;

          if (url.includes('generate/v2') && method === 'POST') {
            const body = msg.params?.request?.postData || '';
            console.log('[passkey] generate POST intercepted, body len:', body.length);
            console.log('[passkey] body prefix:', body.substring(0, 100));

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
              // Cancel request to avoid spending credits — we have the token
              ws.send(JSON.stringify({
                id: nextId++,
                method: 'Fetch.failRequest',
                params: { requestId: reqId, errorReason: 'Aborted' },
              }));
              console.log('[passkey] token captured from generate body! len=' + token.length);
              sendToken(token);
            } else {
              // Token is null/missing — let the request through (will 422 on SUNO, no credits)
              ws.send(JSON.stringify({
                id: nextId++,
                method: 'Fetch.continueRequest',
                params: { requestId: reqId },
              }));
              nullTokenCount++;
              console.log('[passkey] token is null in generate body (attempt ' + nullTokenCount + ')');

              // Force fresh CF challenge by navigating away and back
              if (nullTokenCount <= 2 && !done) {
                setTimeout(() => forceRefreshAndRetry(), 2000);
              } else {
                console.log('[passkey] too many null tokens, giving up');
                finish(false);
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
            const errBody = await resp.text().catch(() => '');
            console.log('[passkey] passkey-server error:', errBody);
            finish(false);
          }
        } catch (e) {
          console.log('[passkey] send to passkey-server failed:', e.message);
          finish(false);
        }
      }

      async function fillFormAndClickCreate() {
        if (done) return;
        createClickCount++;
        console.log('[passkey] filling form + clicking Create (attempt', createClickCount, ')...');

        // Switch to Advanced mode
        await cdpEval(`(function(){
          var btns = Array.from(document.querySelectorAll('button'));
          var adv = btns.find(b => /^advanced$/i.test(b.textContent.trim()));
          if (adv) adv.click();
        })()`);
        await new Promise(r => setTimeout(r, 500));

        // Fill all textareas via React fiber
        const fillResult = await cdpEval(`(function(){
          var results = [];
          var tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
          var fills = ${JSON.stringify(fills)};
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

        // Click Create button
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
          return 'clicked: dis=' + btn.disabled;
        })()`);
        console.log('[passkey] Create click result:', v(clickResult));

        // Handle confirmation dialogs (10 credits confirm)
        for (let d = 0; d < 5 && !done; d++) {
          await new Promise(r => setTimeout(r, 700));
          await cdpEval(`(function(){
            var dlgBtns = Array.from(document.querySelectorAll('[role=dialog] button, [role=alertdialog] button, [data-state=open] button'))
              .filter(b => b.offsetParent && !/(cancel|close|dismiss|no)/i.test(b.textContent));
            if (dlgBtns.length > 0) {
              dlgBtns[dlgBtns.length - 1].click();
              console.log('[passkey] dialog confirmed: ' + dlgBtns[dlgBtns.length-1].textContent.trim().substring(0,20));
            }
          })()`);
        }
        console.log('[passkey] Create clicked, waiting for token...');
      }

      async function navigateToCreate() {
        console.log('[passkey] navigating to /create...');
        await cdpSend('Page.navigate', { url: 'https://suno.com/create' });
        // Wait for page load + CF challenge to complete (60s — Turnstile takes 30-60s silently)
        console.log('[passkey] waiting 60s for CF challenge + P1_ refresh...');
        await new Promise(r => setTimeout(r, 60000));
      }

      async function forceRefreshAndRetry() {
        if (done) return;
        console.log('[passkey] forcing fresh CF challenge (navigate away and back)...');
        // Navigate away to force full page unload
        await cdpSend('Page.navigate', { url: 'https://suno.com' });
        await new Promise(r => setTimeout(r, 4000));
        if (done) return;
        // Navigate back to /create (fresh CF challenge fires)
        await cdpSend('Page.navigate', { url: 'https://suno.com/create' });
        console.log('[passkey] waiting 60s for fresh CF challenge + P1_ refresh...');
        await new Promise(r => setTimeout(r, 60000));
        if (done) return;
        await fillFormAndClickCreate();
      }

      ws.on('open', async () => {
        try {
          // Enable Network monitoring
          await cdpSend('Network.enable');

          // Enable Fetch interception for generate requests
          await cdpSend('Fetch.enable', {
            patterns: [
              { urlPattern: '*generate/v2*', requestStage: 'Request' },
            ],
          });
          console.log('[passkey] Network + Fetch interception enabled');

          // Navigate to /create (fresh page load → fresh CF challenge → fresh P1_)
          await navigateToCreate();

          if (done) return;

          // Fill form and click Create to trigger generate with P1_ in body
          await fillFormAndClickCreate();

          // Token capture is handled in Fetch.requestPaused event handler above
          // If token is null, forceRefreshAndRetry() will be called automatically

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
