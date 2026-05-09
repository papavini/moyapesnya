// Общие куски разметки и helpers для всех страниц «Подари Песню»

window.PT = {
  // Бренд
  brand: 'Подари Песню',
  tg: 'https://t.me/podaripesniu_bot',
  email: 'arkestrator@yandex.com',
  legalName: 'Тольков Александр Иванович',
  inn: '370142085309',
  status: 'Самозанятый (плательщик НПД)',
  price: 299,

  // Поводы
  occasions: [
    { id: 'bd',   emoji: '🎂', title: 'День рождения',  sub: 'Любой возраст' },
    { id: 'jub',  emoji: '🎈', title: 'Юбилей',         sub: '30, 50, 60, 70…' },
    { id: 'wed',  emoji: '💍', title: 'Свадьба',        sub: 'Молодожёнам' },
    { id: 'ann',  emoji: '💑', title: 'Годовщина',      sub: 'Любви и пары' },
    { id: 'date', emoji: '📅', title: 'Памятная дата',  sub: 'Особый день' },
    { id: 'far',  emoji: '✈️', title: 'На расстоянии',  sub: 'Когда скучаешь' },
    { id: 'fun',  emoji: '😂', title: 'Розыгрыш',       sub: 'С юмором' },
    { id: 'sorry',emoji: '🙏', title: 'Прощение',        sub: 'Сказать важное' },
    { id: 'none', emoji: '🎵', title: 'Без повода',     sub: 'Просто так' },
  ],

  // Жанры
  genres: [
    { id: 'pop',   title: 'Поп',         sub: 'тёплая баллада' },
    { id: 'rock',  title: 'Рок',         sub: 'энергичный гитарный' },
    { id: 'rap',   title: 'Рэп / Хип-хоп', sub: 'ритмично, в строку' },
    { id: 'shanson', title: 'Шансон',    sub: 'душа нараспашку' },
    { id: 'disney', title: 'Disney',     sub: 'праздничный, светлый' },
    { id: 'guitar', title: 'Под гитару', sub: 'акустика, у костра' },
    { id: 'dance',  title: 'Танцевальная', sub: 'для вечеринки' },
    { id: 'electro', title: 'Электронная', sub: 'современный звук' },
  ],

  // Настроения
  moods: ['Лирично','Весело','Иронично','Драматично','Нежно','Эпично'],

  // Голоса
  voices: [
    { id: 'm',   emoji: '👨', title: 'Мужской' },
    { id: 'f',   emoji: '👩', title: 'Женский' },
    { id: 'duo', emoji: '👫', title: 'Дуэт' },
    { id: 'any', emoji: '🎙️', title: 'Без предпочтений' },
  ],

  fmt: (n) => n.toLocaleString('ru-RU') + ' ₽',
};

// SVG waveform — генерирует псевдо-волну
PT.waveform = function(seed = 1, color = 'currentColor', height = 56) {
  const bars = 64;
  let rng = seed;
  const r = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
  let bs = '';
  for (let i = 0; i < bars; i++) {
    const x = (i / bars) * 100;
    const h = 20 + Math.abs(Math.sin(i / 3 + seed)) * 70 + r() * 20;
    const y = (100 - h) / 2;
    bs += `<rect x="${x.toFixed(2)}%" y="${y.toFixed(2)}%" width="${(80/bars).toFixed(2)}%" height="${h.toFixed(2)}%" rx="1.5" fill="${color}" opacity="${0.5 + r()*0.5}"/>`;
  }
  return `<svg class="waveform" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bs}</svg>`;
};

// Иконки (минимальный набор)
PT.icon = function(name, size = 20) {
  const icons = {
    play: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>`,
    arrow: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`,
    arrowL: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>`,
    heart: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 4 0 5.5 4 4 7-2.5 4.5-9.5 9-9.5 9z"/></svg>`,
    download: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>`,
    share: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>`,
    plus: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    note: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg>`,
    tg: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M21.7 3.3 2.3 10.7c-1 .4-1 1.7 0 2l4.6 1.5 1.7 5.4c.2.6 1 .8 1.5.4l2.4-2 4.7 3.5c.7.5 1.6.1 1.8-.7L23 4.6c.2-.9-.6-1.6-1.3-1.3zM10 14.7l-1 4.3-1.3-4 9.6-7.6L10 14.7z"/></svg>`,
    mail: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9 6 9-6M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>`,
    check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`,
    x: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>`,
    edit: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    refresh: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>`,
    more: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>`,
  };
  return icons[name] || '';
};

// HEADER рендер
PT.renderHeader = function(opts = {}) {
  const { signedIn = false, active = '' } = opts;
  const isA = (k) => active === k ? 'style="color:var(--gold);"' : '';
  return `
  <header class="site-header">
    <div class="container site-header-inner">
      <a class="logo" href="landing.html">
        <span class="logo-mark">${PT.icon('note', 18)}</span>
        Подари&nbsp;Песню
      </a>
      <nav class="nav-links">
        <a href="landing.html#why" ${isA('why')}>Почему песня</a>
        <a href="landing.html#examples" ${isA('examples')}>Послушать</a>
        <a href="landing.html#pricing" ${isA('pricing')}>Тарифы</a>
        <a href="landing.html#reviews" ${isA('reviews')}>Отзывы</a>
        <a href="landing.html#faq" ${isA('faq')}>Вопросы</a>
      </nav>
      <div class="nav-actions">
        ${signedIn
          ? `<a class="btn btn-ghost btn-sm nav-cabinet" href="cabinet.html">Кабинет</a>
             <a class="avatar" href="profile.html" title="Профиль">МА</a>`
          : `<a class="btn btn-ghost btn-sm nav-login" href="auth.html">Войти</a>
             <a class="btn btn-gold btn-sm nav-cta" href="wizard.html">Подарить песню</a>`
        }
        <button class="nav-burger" type="button" aria-label="Меню" aria-expanded="false" onclick="PT.toggleMobileNav()">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="mobile-nav" id="pt-mobile-nav" aria-hidden="true">
      <div class="mobile-nav-inner">
        <a href="landing.html#why">Почему песня</a>
        <a href="landing.html#examples">Послушать</a>
        <a href="landing.html#pricing">Тарифы</a>
        <a href="landing.html#reviews">Отзывы</a>
        <a href="landing.html#faq">Вопросы</a>
        <div class="mobile-nav-divider"></div>
        ${signedIn
          ? `<a href="cabinet.html">Кабинет</a>
             <a href="profile.html">Профиль</a>`
          : `<a href="auth.html">Войти</a>
             <a class="btn btn-gold btn-block" href="wizard.html" style="margin-top:12px;">Подарить песню</a>`
        }
      </div>
    </div>
  </header>`;
};

// FOOTER рендер
PT.renderFooter = function() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="logo" href="landing.html">
            <span class="logo-mark">${PT.icon('note', 18)}</span>
            Подари Песню
          </a>
          <p class="muted" style="margin-top:18px;font-size:14px;max-width:360px;font-family:var(--font-display);font-style:italic;font-size:17px;">
            Песня, написанная только для него или неё.
          </p>
          <p class="soft" style="margin-top:18px;font-size:13px;line-height:1.7;">
            ${PT.status}<br>
            ${PT.legalName}<br>
            ИНН ${PT.inn}
          </p>
        </div>
        <div>
          <h4>Сервис</h4>
          <ul>
            <li><a href="wizard.html">Подарить песню</a></li>
            <li><a href="gift.html">Подарить пакет</a></li>
            <li><a href="landing.html#pricing">Тарифы</a></li>
            <li><a href="landing.html#why">Почему песня</a></li>
            <li><a href="landing.html#examples">Послушать примеры</a></li>
            <li><a href="landing.html#faq">Вопросы</a></li>
          </ul>
        </div>
        <div>
          <h4>Документы</h4>
          <ul>
            <li><a href="legal/offer.html">Договор-оферта</a></li>
            <li><a href="legal/privacy.html">Политика конфиденциальности</a></li>
            <li><a href="legal/refund.html">Условия отказа</a></li>
            <li><a href="legal/contacts.html">Реквизиты и контакты</a></li>
          </ul>
        </div>
        <div>
          <h4>Связь</h4>
          <ul>
            <li><a href="mailto:${PT.email}">${PT.email}</a></li>
            <li><a href="${PT.tg}" target="_blank" rel="noopener">Telegram-бот</a></li>
            <li><a href="legal/contacts.html">Все способы</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© 2026 Подари Песню. Все права защищены.</span>
        <span>Безопасная оплата через Robokassa</span>
      </div>
    </div>
  </footer>`;
};

// Тоггл мобильного меню
PT.toggleMobileNav = function() {
  const nav = document.getElementById('pt-mobile-nav');
  const burger = document.querySelector('.nav-burger');
  if (!nav) return;
  const open = nav.classList.toggle('is-open');
  nav.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.style.overflow = open ? 'hidden' : '';
};

// Вставка header/footer по data-атрибутам
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-pt-header]').forEach(el => {
    el.outerHTML = PT.renderHeader({
      signedIn: el.dataset.signedIn === 'true',
      active: el.dataset.active || ''
    });
  });
  document.querySelectorAll('[data-pt-footer]').forEach(el => {
    el.outerHTML = PT.renderFooter();
  });
});

// === Foundation backend integration (subsystem #1) ===
PT.api = 'https://api.xn--e1anecfn9ge.xn--p1ai';

PT.fetchMe = async function() {
  try {
    const r = await fetch(PT.api + '/api/auth/me', { credentials: 'include' });
    if (!r.ok) return { guest: true };
    return await r.json();
  } catch (e) {
    console.warn('[PT] /me failed:', e);
    return { guest: true };
  }
};

PT.logout = async function() {
  try {
    await fetch(PT.api + '/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (e) {
    console.warn('[PT] logout failed:', e);
  }
  location.href = 'landing.html';
};

// Global callback for Telegram Login Widget (referenced in auth.html as data-onauth)
window.onTelegramAuth = async function(user) {
  try {
    const r = await fetch(PT.api + '/api/auth/telegram/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(user),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert('Не удалось войти через Telegram: ' + (err.error || r.status));
      return;
    }
    const data = await r.json();
    if (data.migrated_songs_count > 0) {
      sessionStorage.setItem('pt_migrated', String(data.migrated_songs_count));
    }
    location.href = 'cabinet.html';
  } catch (e) {
    alert('Сбой соединения с сервером: ' + e.message);
  }
};

// Auto-detect signed-in state for any header rendered with [data-pt-header]
// (overrides static data-signed-in attribute by re-rendering after fetch)
document.addEventListener('DOMContentLoaded', async () => {
  const me = await PT.fetchMe();
  document.querySelectorAll('header.site-header').forEach(el => {
    const isSignedIn = !me.guest;
    const active = el.dataset.active || '';
    el.outerHTML = PT.renderHeader({ signedIn: isSignedIn, active });
  });
  // Show "migrated N drafts" toast on cabinet page
  if (location.pathname.endsWith('/cabinet.html')) {
    const n = sessionStorage.getItem('pt_migrated');
    if (n) {
      sessionStorage.removeItem('pt_migrated');
      const toast = document.createElement('div');
      toast.textContent = `✨ Перенесли ${n} черновик(ов) в твой кабинет`;
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#10b981;color:#fff;padding:14px 20px;border-radius:12px;font-family:var(--font-display);z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }
  }
});
