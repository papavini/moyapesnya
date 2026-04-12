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
        // Call turnstile.execute directly — no Create click, no song generation, no credits wasted
        const inject = `(function(){
          return new Promise(function(resolve){
            if(!window.turnstile){resolve('no turnstile');return;}
            var widgets=document.querySelectorAll('[data-sitekey]');
            var sitekey=widgets.length?widgets[0].getAttribute('data-sitekey'):null;
            if(!sitekey){
              // Try to find sitekey from turnstile internals
              try{var k=Object.keys(window.turnstile._widgets||{});if(k.length)sitekey=window.turnstile._widgets[k[0]].sitekey;}catch(e){}
            }
            if(!sitekey){resolve('no sitekey');return;}
            try{
              window.turnstile.execute(sitekey,{callback:function(tok){
                if(tok&&tok.indexOf('P1_')===0){
                  fetch('http://localhost:3099/token',{method:'POST',body:tok});
                  resolve('token_sent:'+tok.length);
                }else{resolve('bad_token');}
              }});
            }catch(e){resolve('exec_error:'+e.message);}
            setTimeout(function(){resolve('timeout');},10000);
          });
        })()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: inject, awaitPromise: true } }));
      });

      let step = 0;
      ws.on('message', (data) => {
        step++;
        if (step === 1) {
          const result = JSON.parse(data);
          const val = result?.result?.result?.value || '';
          console.log('[passkey-refresh] turnstile result:', val);
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
