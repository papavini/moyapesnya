/**
 * Обновляет passkey token через CDP — кликает Create на suno.com.
 * Тратит ~30 кредитов за обновление (неизбежно — SW блокирует все другие подходы).
 * Вызывается ТОЛЬКО по таймеру (раз в 25 мин), НЕ перед каждой генерацией.
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
      const timeout = setTimeout(() => done(false), 15000);

      const ws = new WebSocket(sunoTab.webSocketDebuggerUrl);
      ws.on('open', () => {
        const inject = `(function(){
          if(window.__pkTimer) return 'exists';
          window.__pkTimer=1;
          var t=window.turnstile;
          if(!t||!t.execute) return 'no turnstile';
          var orig=t.execute.bind(t);
          t.execute=function(s,p){
            if(p&&typeof p.callback==='function'){
              var cb=p.callback;
              p.callback=function(tok){
                if(tok&&tok.indexOf('P1_')===0)
                  fetch('http://localhost:3099/token',{method:'POST',body:tok});
                cb(tok);
              };
            }
            return orig(s,p);
          };
          return 'patched';
        })()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: inject } }));
      });

      let step = 0;
      ws.on('message', (raw) => {
        step++;
        if (step === 1) {
          const click = `var b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Create'));b?(b.click(),'clicked'):'no btn'`;
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: click } }));
        }
        if (step === 2) {
          console.log('[passkey-refresh] Create clicked, waiting for token...');
          setTimeout(() => { try { ws.close(); } catch {} done(true); }, 8000);
        }
      });

      ws.on('error', () => done(false));
    });
  } catch (e) {
    console.log('[passkey-refresh] error:', e.message);
    return false;
  }
}
