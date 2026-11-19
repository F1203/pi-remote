// Modo tele: navegación con la cruceta del celular, como en un Smart TV.
// El servidor manda {nav: 'up'|'down'|'left'|'right'|'ok'|'back'|'home'|'search'|'play'|'rw5'|'ff5'|'cc'|'full'}
// vía bg.js. En YouTube se mueve entre videos, chips, menú lateral y botones (no por cada link como Tab).
// En otros sitios (p. ej. animeav1.com) cada tarjeta con imagen es un solo lugar y el reproductor
// (un <video> o un iframe grande) también; lo que está dentro de un iframe de otro dominio lo
// controla bg.js en todos los frames (la respuesta {media} se lo pide).
(() => {
  if (window.__piTv) return; // bg.js puede inyectarlo de nuevo en pestañas viejas
  window.__piTv = true;

  const YT = /(^|\.)youtube\.com$/.test(location.hostname);
  // Una "tarjeta" se elige entera: miniatura, título, canal y menú son un solo lugar
  const CARDS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
    'ytd-playlist-renderer', 'ytd-channel-renderer', 'ytd-radio-renderer', 'ytd-compact-radio-renderer',
    'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytd-reel-item-renderer',
    'ytd-grid-playlist-renderer', 'ytd-movie-renderer', 'ytd-compact-playlist-renderer',
    'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
  ].join(',');
  const YT_OTHERS = [
    'input[name="search_query"]', '#guide-button', 'ytd-topbar-logo-renderer a',
    'yt-chip-cloud-chip-renderer', 'ytd-guide-entry-renderer', 'ytd-mini-guide-entry-renderer',
    'yt-tab-shape', 'tp-yt-paper-tab', '#page-header button', 'ytd-watch-metadata button',
    'ytd-watch-metadata #owner a', 'ytd-subscribe-button-renderer button',
    'ytd-rich-shelf-renderer #button button', 'ytd-continuation-item-renderer button',
  ].join(',');
  const GENERIC = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [tabindex]:not([tabindex="-1"])';
  const TEXT_IN = /^(text|search|email|url|tel|password|number)$/i;

  let cur = null;        // elemento enfocado
  let shown = false;     // si el recuadro está visible
  let pseudo = null;     // reproductor agrandado a toda la ventana (pantalla completa "a mano")
  let cards = new WeakSet(); // tarjetas encontradas fuera de YouTube
  // Último video elegido en cada página, para volver al mismo al ir atrás (sobrevive a recargas)
  const memoGet = () => { try { return sessionStorage.getItem('pitv:' + location.href); } catch { return null; } };
  const memoSet = (k) => { try { sessionStorage.setItem('pitv:' + location.href, k); } catch {} };
  // Si se estaba usando la cruceta, al abrir otra página el recuadro aparece solo
  const markActive = (on) => { try { if (on) sessionStorage.setItem('pitv_on', Date.now()); else sessionStorage.removeItem('pitv_on'); } catch {} };
  const wasActive = () => { try { return Date.now() - +(sessionStorage.getItem('pitv_on') || 0) < 300000; } catch { return false; } };

  // ---------- Recuadro de foco ----------
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:4px solid #fff;'
    + 'border-radius:14px;box-shadow:0 0 0 3px #3d7cff,0 0 28px 6px rgba(61,124,255,.65);'
    + 'transition:left .12s,top .12s,width .12s,height .12s;display:none;box-sizing:border-box';
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:50%;top:12%;'
    + 'transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;font:600 34px system-ui,sans-serif;'
    + 'padding:14px 30px;border-radius:999px;display:none';
  let toastT = 0;
  function say(text) {
    (document.fullscreenElement || document.documentElement).appendChild(toast);
    toast.textContent = text; toast.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { toast.style.display = 'none'; }, 900);
  }

  function place() {
    if (!shown) return;
    if (!cur || !cur.isConnected || document.fullscreenElement || pseudo) { ring.style.display = 'none'; }
    else {
      const r = cur.getBoundingClientRect(), pad = 4;
      Object.assign(ring.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px',
        width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    }
    requestAnimationFrame(place);
  }
  function show() {
    if (!ring.isConnected) document.documentElement.appendChild(ring);
    if (!shown) { shown = true; requestAnimationFrame(place); }
  }
  function hide() { shown = false; ring.style.display = 'none'; }
  // Si se usa el trackpad (mouse de verdad), el recuadro se esconde hasta la próxima flecha
  window.addEventListener('mousemove', (ev) => {
    if (shown && ev.isTrusted && Math.abs(ev.movementX) + Math.abs(ev.movementY) > 3) { hide(); markActive(false); }
  }, true);

  // ---------- Candidatos ----------
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) return false;
    return true;
  };
  // Fuera de YouTube el reproductor es el <video> o iframe con pantalla completa más grande
  function findPlayer() {
    let best = null, area = 0;
    for (const el of document.querySelectorAll('video, iframe')) {
      if (el.tagName === 'IFRAME' && !(el.allowFullscreen || /fullscreen/.test(el.allow || ''))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 400 || r.height < 200 || !visible(el)) continue;
      if (r.width * r.height > area) { area = r.width * r.height; best = el; }
    }
    return best;
  }
  const player = () => (YT ? location.pathname === '/watch' && document.querySelector('#movie_player') : pseudo || findPlayer());
  const isShorts = () => YT && location.pathname.startsWith('/shorts');
  const isCard = (el) => !!el && (YT ? el.matches(CARDS) : cards.has(el));

  // Tarjeta = article/li/"card" con imagen y un solo destino: se elige entera, no link por link
  function cardOf(el) {
    const c = el.closest('article, li, [class*="card" i]');
    if (!c || c === el || !c.querySelector('img, picture, [style*="background-image"]')) return el;
    const hrefs = new Set([...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    if (hrefs.size > 2 || c.querySelectorAll('button, input, select').length > 2) return el;
    const r = c.getBoundingClientRect();
    if (r.width > innerWidth * 0.8 || r.height > innerHeight * 0.8) return el;
    cards.add(c);
    return c;
  }

  function candidates() {
    let list;
    const p = player();
    if (YT) {
      list = [...document.querySelectorAll(CARDS)].filter((el) => !el.parentElement.closest(CARDS));
      list.push(...[...document.querySelectorAll(YT_OTHERS)].filter((el) => !el.closest(CARDS)));
    } else {
      const all = [...document.querySelectorAll(GENERIC)];
      const set = new Set(all);
      list = [...new Set(all
        .filter((el) => { for (let a = el.parentElement; a; a = a.parentElement) if (set.has(a)) return false; return true; })
        .map(cardOf))];
    }
    if (p) list.push(p);
    // Lo que está dentro del reproductor no cuenta (el reproductor es un solo lugar). Fuera de
    // YouTube tampoco lo que está corrido a los costados (carruseles), que no se puede ver.
    return list.filter((el) => (!p || el === p || !p.contains(el)) && visible(el) && (YT || floating(el) || (() => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.left < innerWidth;
    })()));
  }

  // Lo que flota (barra de arriba, menú lateral: position fixed/sticky) se trata aparte del contenido:
  // si no, un video scrolleado y tapado por la barra parecería estar "arriba" del buscador.
  let floatCache = new WeakMap();
  function floating(el) {
    if (!el || el === document.body || el === document.documentElement || el.nodeType !== 1) return false;
    if (floatCache.has(el)) return floatCache.get(el);
    const pos = getComputedStyle(el).position;
    const v = pos === 'fixed' || pos === 'sticky' || floating(el.parentElement || el.getRootNode().host);
    floatCache.set(el, v);
    return v;
  }
  // Que se vea de verdad en pantalla (no tapado por la barra ni fuera de la vista)
  function uncovered(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 40);
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  }

  // Elige el más cercano en esa dirección, prefiriendo el que está "en la misma fila/columna"
  function pick(from, dir, list) {
    const a = from.getBoundingClientRect();
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === from || el.contains(from) || from.contains(el)) continue;
      const b = el.getBoundingClientRect();
      const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      let gap, ortho, center;
      const tolY = Math.min(a.height, b.height) * 0.3, tolX = Math.min(a.width, b.width) * 0.3;
      if (dir === 'down') { if (b.top < a.bottom - tolY || bcy <= acy) continue; gap = b.top - a.bottom; }
      else if (dir === 'up') { if (b.bottom > a.top + tolY || bcy >= acy) continue; gap = a.top - b.bottom; }
      else if (dir === 'right') { if (b.left < a.right - tolX || bcx <= acx) continue; gap = b.left - a.right; }
      else { if (b.right > a.left + tolX || bcx >= acx) continue; gap = a.left - b.right; }
      if (dir === 'up' || dir === 'down') {
        ortho = Math.max(0, b.left - a.right, a.left - b.right); center = Math.abs(bcx - acx);
      } else {
        ortho = Math.max(0, b.top - a.bottom, a.top - b.bottom); center = Math.abs(bcy - acy);
      }
      const score = Math.max(0, gap) + ortho * 4 + center * 0.15;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  function nearest(from, dir, list) {
    if (floating(from)) {
      // Desde la barra o el menú: a otro lugar fijo o a algo del contenido que se vea en pantalla
      return pick(from, dir, list.filter((el) => floating(el) || uncovered(el)));
    }
    // En una grilla de tarjetas, ↑/↓ pasan a la fila de al lado aunque esté corrida (última fila incompleta)
    if (isCard(from) && (dir === 'up' || dir === 'down')) {
      const a = from.getBoundingClientRect();
      const row = list.filter((el) => {
        if (!isCard(el) || floating(el)) return false;
        const b = el.getBoundingClientRect();
        const gap = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        return gap > -a.height * 0.3 && gap < a.height * 0.75;
      });
      const best = pick(from, dir, row);
      if (best) return best;
    }
    // Desde el contenido: primero el contenido (aunque esté fuera de la vista, así se scrollea)
    return pick(from, dir, list.filter((el) => !floating(el)))
      || pick(from, dir, list.filter((el) => floating(el)));
  }

  const linkOf = (el) => {
    const a = el.matches('a[href]') ? el : el.querySelector(
      'a#thumbnail[href], a[href*="/watch"], a[href^="/shorts/"], a[href*="/playlist"], a#main-link[href], a[href]');
    return a ? a.getAttribute('href') : null;
  };

  // Lugar de partida: lo que recordamos de esta página, el reproductor o el primer video a la vista
  function start() {
    const list = candidates();
    const key = memoGet();
    if (key) {
      const hit = list.find((el) => isCard(el) && linkOf(el) === key);
      if (hit) return hit;
    }
    const p = player();
    if (p) return p;
    // Página de una serie: empezar por el primer episodio = primera tarjeta cuyo link cuelga de esta
    // dirección (/media/one-piece -> /media/one-piece/1), aunque haya "relacionados" más arriba
    if (!YT) {
      const base = location.pathname.replace(/\/$/, '') + '/';
      const eps = list.filter((el) => {
        if (!isCard(el)) return false;
        const k = linkOf(el);
        try { return !!k && new URL(k, location.href).pathname.startsWith(base); } catch { return false; }
      });
      if (eps.length) return eps.sort(byPos)[0];
    }
    const top = YT ? 60 : 0;
    const inView = list.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= top - 4 && r.bottom <= innerHeight + r.height * 0.5 && r.left >= 0;
    });
    // Primero las tarjetas a la vista; si no hay, la primera tarjeta de la página aunque esté más
    // abajo (en una serie de animeav1, el primer episodio), y recién después cualquier cosa
    const main = inView.filter(isCard);
    const cardsAll = list.filter((el) => isCard(el) && !floating(el));
    const pool = main.length ? main : cardsAll.length ? cardsAll : inView.length ? inView : list;
    pool.sort(byPos);
    return pool[0] || null;
  }
  // Orden de lectura: de arriba a abajo y de izquierda a derecha
  function byPos(x, y) {
    const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
    return Math.abs(a.top - b.top) > 20 ? a.top - b.top : a.left - b.left;
  }

  function focusEl(el, center) {
    cur = el;
    show();
    if (!el) return;
    if (isCard(el)) { const k = linkOf(el); if (k) memoSet(k); }
    const r = el.getBoundingClientRect();
    const top = YT ? 64 : 0;
    // También si lo tapa una barra fija del sitio
    if (center && !floating(el) && el !== player()) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } else if (r.top < top || r.bottom > innerHeight - 8 || (!floating(el) && !uncovered(el))) {
      const big = r.height > innerHeight * 0.7;
      el.scrollIntoView({ block: big ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function move(dir) {
    if (!cur || !cur.isConnected || !visible(cur)) { focusEl(start(), !YT); return true; }
    if (!shown) { show(); return true; } // primera flecha después de usar el trackpad: solo mostrar dónde está
    const next = nearest(cur, dir, candidates());
    if (next) focusEl(next);
    else if (dir === 'down' || dir === 'up') scrollBy({ top: (dir === 'down' ? 1 : -1) * innerHeight * 0.6, behavior: 'smooth' });
    return true;
  }

  // ---------- Reproductor ----------
  const video = () => document.querySelector('#movie_player video, video');
  function seek(s) {
    const v = video();
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration - 0.5 : Infinity;
    v.currentTime = Math.max(0, Math.min(v.currentTime + s, end));
    say((s > 0 ? '+' : '−') + Math.abs(s) + ' s');
  }
  function togglePlay() {
    const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button');
    if (skip && visible(skip)) { skip.click(); say('Saltar anuncio'); return; }
    const v = video();
    if (!v) return;
    if (v.paused) { v.play(); say('▶'); } else { v.pause(); say('❚❚'); }
  }

  // Fuera de YouTube el video suele estar en un iframe de otro dominio: bg.js lo maneja en todos los frames
  function media(cmd, s) {
    if (!YT) return { media: cmd, s };
    if (cmd === 'seek') seek(s); else if (cmd === 'play') togglePlay(); else if (cmd === 'cc') subtitles();
    return {};
  }

  // Pantalla completa fuera de YouTube: el reproductor ocupa toda la ventana y bg.js pone la
  // ventana en pantalla completa (un iframe no se puede poner en pantalla completa sin un clic real)
  function setPseudo(el) {
    if (!document.getElementById('__pitv_css')) {
      const st = document.createElement('style');
      st.id = '__pitv_css';
      st.textContent = '.__pitv_full{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;'
        + 'max-width:none!important;max-height:none!important;margin:0!important;border:0!important;transform:none!important;'
        + 'z-index:2147483646!important;background:#000!important}html.__pitv_lock,html.__pitv_lock body{overflow:hidden!important}';
      document.documentElement.appendChild(st);
    }
    if (pseudo) pseudo.classList.remove('__pitv_full');
    document.documentElement.classList.toggle('__pitv_lock', !!el);
    if (el) el.classList.add('__pitv_full');
    pseudo = el;
  }
  function exitFull() {
    if (pseudo) { const p = pseudo; setPseudo(null); cur = p; return { winFull: false }; }
    if (document.fullscreenElement) document.exitFullscreen();
    return {};
  }
  function full() {
    if (YT) return { key: 'f' }; // la tecla f real de YouTube (necesita un gesto de verdad)
    if (pseudo || document.fullscreenElement) return exitFull();
    const p = player();
    if (!p) { say('No hay video'); return {}; }
    setPseudo(p); cur = p;
    return { winFull: true };
  }

  // ---------- Acciones ----------
  const editable = (el) => el && (el.isContentEditable || el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && TEXT_IN.test(el.type || 'text')));

  function activate() {
    if (!cur || !cur.isConnected || !shown) { move('down'); return {}; }
    if (cur === player()) return media('play');
    if (editable(cur)) { cur.focus(); if (cur.select) cur.select(); return { editable: true }; }
    let target = cur;
    if (isCard(cur)) {
      target = cur.querySelector('a#thumbnail[href], a[href*="/watch"], a[href^="/shorts/"], a[href*="/playlist"], a#main-link[href], a[href]') || cur;
    } else if (!cur.matches('a, button, input, select, [role=button], [role=tab]')) {
      target = cur.querySelector('a[href], button, [role=button], [role=tab]') || cur;
    }
    target.click();
    return {};
  }

  const SEARCH = 'input[type=search], input[name=q], input[name=s], input[name=search], input[name=query], '
    + 'input[placeholder*="usca" i], input[placeholder*="earch" i], input[aria-label*="usca" i], input[aria-label*="earch" i]';
  function search() {
    const input = document.querySelector(YT ? 'input[name="search_query"]' : SEARCH);
    if (!input) return YT ? { ok: false } : { gotoYouTube: true }; // el sitio no tiene buscador: buscar en YouTube
    if (!visible(input)) {
      // buscador escondido detrás de un botón (lupa)
      const t = document.querySelector('button[aria-label*="usca" i], button[title*="usca" i], button[aria-label*="earch" i]'
        + (input.id ? `, label[for="${CSS.escape(input.id)}"]` : ''));
      if (t) t.click();
    }
    focusEl(input);
    input.focus(); input.select();
    return { editable: true };
  }

  function back() {
    if (pseudo || document.fullscreenElement) return exitFull();
    const a = document.activeElement;
    if (editable(a)) { a.blur(); return {}; }
    history.back();
    return {};
  }

  function home() {
    if (!YT) {
      // Inicio del sitio; si ya se está ahí, a YouTube
      if (location.pathname !== '/' || location.search) { location.href = location.origin + '/'; return {}; }
      return { gotoYouTube: true };
    }
    const logo = document.querySelector('ytd-topbar-logo-renderer a, a#logo');
    if (logo && location.pathname !== '/') logo.click();
    else if (location.pathname === '/') { scrollTo({ top: 0, behavior: 'smooth' }); focusEl(null); setTimeout(() => focusEl(start()), 400); }
    else location.href = 'https://www.youtube.com/';
    return {};
  }

  function shorts(dir) {
    const btn = document.querySelector(`#navigation-button-${dir} button`);
    if (btn) btn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: dir === 'down' ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
  }

  // Botones del panel de video del celular
  function subtitles() {
    const b = document.querySelector('.ytp-subtitles-button');
    if (!b || b.style.display === 'none') { say('Sin subtítulos'); return; }
    b.click();
    setTimeout(() => say(b.getAttribute('aria-pressed') === 'true' ? 'Subtítulos: sí' : 'Subtítulos: no'), 150);
  }

  function nav(a) {
    markActive(true);
    if (a === 'play') return media('play');
    if (a === 'rw5' || a === 'ff5') return media('seek', a === 'rw5' ? -5 : 5);
    if (a === 'cc') return media('cc');
    if (a === 'full') return full();
    if (a === 'search') return search();
    if (a === 'home') return home();
    if (a === 'back') return back();
    const p = player();
    if (isShorts() && ['up', 'down', 'ok'].includes(a)) {
      if (a === 'ok') togglePlay(); else shorts(a);
      hide(); return {};
    }
    if ((document.fullscreenElement || pseudo) && p) {
      // Viendo en pantalla completa: ←/→ adelantan, OK pausa, ↑/↓ salen para elegir otra cosa
      if (a === 'left' || a === 'right') return media('seek', a === 'left' ? -10 : 10);
      if (a === 'ok') return media('play');
      const res = exitFull(); cur = p; show(); return res;
    }
    const onPlayer = shown && cur && cur === p;
    if (onPlayer && (a === 'left' || a === 'right')) return media('seek', a === 'left' ? -10 : 10);
    if (a === 'ok') return activate();
    move(a);
    return {};
  }

  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m && m.toast) { say(m.toast); return; }
    if (!m || !m.nav) return;
    let res = {};
    try { res = nav(m.nav) || {}; } catch (ex) { res = { ok: false, err: String(ex) }; }
    reply({ ...res, ok: res.ok !== false, editable: !!res.editable });
  });

  // Elegir dónde empezar cuando la página termina de dibujarse (reintenta un rato)
  function resume() {
    let tries = 0;
    const t = setInterval(() => {
      const el = start();
      // Al entrar a una página, la tarjeta elegida queda centrada en la pantalla
      if ((el && (el === player() || isCard(el))) || ++tries > 20) { clearInterval(t); if (el) focusEl(el, !YT); }
    }, 150);
  }
  if (wasActive()) setTimeout(resume, 300);

  // Avisar si en esta página hay un video (el celular muestra los controles del video)
  let lastWatch = null;
  function report() {
    const w = YT ? (location.pathname === '/watch' || location.pathname.startsWith('/shorts')) : !!player();
    if (w === lastWatch) return;
    lastWatch = w;
    try { chrome.runtime.sendMessage({ watch: w }); } catch {}
  }
  report();
  setInterval(() => { if (!document.hidden) report(); }, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastWatch = null; report(); } });

  // YouTube cambia de página sin recargar: al terminar, elegir de nuevo dónde empezar
  if (YT) {
    window.addEventListener('yt-navigate-finish', () => {
      const a = document.activeElement;
      if (a && a.matches && a.matches('input[name="search_query"]')) a.blur(); // que espacio vuelva a pausar
      const was = shown;
      cur = null;
      floatCache = new WeakMap();
      if (!was) return;
      hide();
      resume(); // esperar a que se dibujen los videos
    });
  }
})();
