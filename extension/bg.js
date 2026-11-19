chrome.runtime.onMessage.addListener((m, sender) => {
  if (m && 'watch' in m) { // tv.js: si en la página hay un video
    if (sender.tab && sender.frameId === 0) { watchByTab.set(sender.tab.id, !!m.watch); reportState(); }
    return;
  }
  fetch('http://127.0.0.1:8080/focus?editable=' + (m.editable ? 1 : 0)).catch(() => {});
});

// Se ejecuta dentro de cada frame de la pestaña: adelanta el video que se está reproduciendo
function seekVideo(seconds) {
  const videos = [];
  const collect = (root) => {
    root.querySelectorAll('video').forEach((v) => videos.push(v));
    root.querySelectorAll('*').forEach((el) => el.shadowRoot && collect(el.shadowRoot));
  };
  collect(document);
  const v = videos.find((x) => !x.paused && x.readyState > 0)
    || videos.filter((x) => x.readyState > 0).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return false;
  const end = Number.isFinite(v.duration) ? v.duration - 0.5 : Infinity;
  v.currentTime = Math.min(v.currentTime + seconds, end);
  return true;
}

// Se ejecuta en cada frame: pausa / reproduce, adelanta o cambia subtítulos del video del frame.
// Sirve para reproductores en iframes de otro dominio (animeav1 y similares).
function mediaCmd(cmd, s) {
  const videos = [];
  const collect = (root) => {
    root.querySelectorAll('video').forEach((v) => videos.push(v));
    root.querySelectorAll('*').forEach((el) => el.shadowRoot && collect(el.shadowRoot));
  };
  collect(document);
  const size = (x) => x.clientWidth * x.clientHeight;
  const ready = videos.filter((x) => x.readyState > 0);
  const v = ready.find((x) => !x.paused) || ready.sort((a, b) => size(b) - size(a))[0];
  const shown = (el) => el && el.getClientRects().length > 0;
  if (cmd === 'seek') {
    if (!v) return false;
    const end = Number.isFinite(v.duration) ? v.duration - 0.5 : Infinity;
    v.currentTime = Math.max(0, Math.min(v.currentTime + s, end));
    return 'seek';
  }
  if (cmd === 'play') {
    if (v) {
      if (v.paused) { v.play().catch(() => {}); return 'play'; }
      v.pause(); return 'pause';
    }
    // Todavía no arrancó: tocar el botón grande de play del reproductor
    const big = [...document.querySelectorAll('.jw-display-icon-display, .jw-icon-display, .vjs-big-play-button, '
      + '.plyr__control--overlaid, .play-button, .playbutton, [aria-label="Play"], [aria-label="Reproducir"]')].find(shown);
    if (big) { big.click(); return 'play'; }
    const any = videos.sort((a, b) => size(b) - size(a))[0];
    if (any && size(any) > 0) { any.play().catch(() => {}); return 'play'; }
    return false;
  }
  if (cmd === 'cc') {
    const btn = [...document.querySelectorAll('.jw-icon-cc, .vjs-subs-caps-button button, .vjs-subs-caps-button, '
      + '.vjs-captions-button, [data-plyr="captions"], .ytp-subtitles-button')].find(shown);
    if (btn) { btn.click(); return 'cc'; }
    if (v && v.textTracks && v.textTracks.length) {
      const tracks = [...v.textTracks];
      const on = tracks.some((t) => t.mode === 'showing');
      tracks.forEach((t, i) => { t.mode = !on && i === 0 ? 'showing' : 'hidden'; });
      return on ? 'cc-off' : 'cc-on';
    }
    return false;
  }
  return false;
}

async function runMedia(tabId, cmd, s) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, func: mediaCmd, args: [cmd, s || 0],
  });
  const r = (results.find((x) => x.result) || {}).result;
  const text = {
    seek: (s > 0 ? '+' : '−') + Math.abs(s) + ' s', play: '▶', pause: '❚❚',
    cc: 'Subtítulos', 'cc-on': 'Subtítulos: sí', 'cc-off': 'Subtítulos: no',
  }[r] || (cmd === 'cc' ? 'Sin subtítulos' : cmd === 'seek' ? 'No encontré el video' : '');
  if (text) chrome.tabs.sendMessage(tabId, { toast: text }, { frameId: 0 }).catch(() => {});
  // Sin video para pausar: que el servidor pruebe con la barra espaciadora
  return { ok: cmd !== 'play' || !!r };
}

// Pantalla completa de la ventana (para el reproductor agrandado por tv.js)
const prevState = {};
async function setWindowFull(windowId, on) {
  const w = await chrome.windows.get(windowId);
  if (on) {
    if (w.state !== 'fullscreen') prevState[windowId] = w.state;
    await chrome.windows.update(windowId, { state: 'fullscreen' });
  } else if (prevState[windowId]) {
    await chrome.windows.update(windowId, { state: prevState[windowId] });
    delete prevState[windowId];
  }
}

async function seekActiveTab(seconds) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return false;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true }, func: seekVideo, args: [seconds],
  });
  return results.some((r) => r.result === true);
}

// Modo tele: pasa la flecha / OK / atrás / inicio / buscar a la página de la pestaña activa (tv.js)
function waitLoaded(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, 10000);
    chrome.tabs.onUpdated.addListener(fn);
  });
}
async function tellTab(tabId, nav) {
  try {
    return await chrome.tabs.sendMessage(tabId, { nav }, { frameId: 0 });
  } catch {
    // Pestaña abierta antes de instalar/recargar la extensión: inyectar tv.js y reintentar
    await chrome.scripting.executeScript({ target: { tabId }, files: ['tv.js'] });
    return await chrome.tabs.sendMessage(tabId, { nav }, { frameId: 0 });
  }
}
async function navActiveTab(nav) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { ok: false };
  let res = null;
  try { res = await tellTab(tab.id, nav); } catch {}
  if (!res) {
    // Página donde la extensión no corre (pestaña nueva, brave://): Inicio y Buscar van a YouTube
    if (nav !== 'home' && nav !== 'search') return { ok: false };
    res = { gotoYouTube: true };
  }
  if (res.gotoYouTube) {
    await chrome.tabs.update(tab.id, { url: 'https://www.youtube.com/' });
    await waitLoaded(tab.id);
    if (nav === 'home') return { ok: true };
    await new Promise((r) => setTimeout(r, 800));
    return (await tellTab(tab.id, nav)) || { ok: false };
  }
  if (res.media) return await runMedia(tab.id, res.media, res.s);
  if ('winFull' in res) await setWindowFull(tab.windowId, res.winFull).catch(() => {});
  return res;
}

// Avisa al celular si la pestaña activa tiene un video (Pi Tele muestra los controles del video).
// tv.js informa cada página; para YouTube alcanza con la dirección.
const watchByTab = new Map();
let lastWatch = null;
async function reportState() {
  if (!ws || ws.readyState !== 1) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const watch = !!tab && (watchByTab.get(tab.id)
    ?? /^https:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/)/.test(tab.url || ''));
  if (watch === lastWatch) return;
  lastWatch = watch;
  ws.send(JSON.stringify({ t: 'tvstate', watch }));
}
chrome.tabs.onActivated.addListener(() => reportState());
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url) { watchByTab.delete(id); reportState(); } });
chrome.tabs.onRemoved.addListener((id) => watchByTab.delete(id));
chrome.windows.onFocusChanged.addListener(() => reportState());

// Conexión con el servidor del control remoto para recibir órdenes (adelantar video, modo tele)
let ws = null;
function connect() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket('ws://127.0.0.1:8080/ext');
  ws.onopen = () => { lastWatch = null; reportState(); };
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'nav') {
      let res = { ok: false };
      try { res = await navActiveTab(m.a); } catch {}
      ws.send(JSON.stringify({ t: 'navres', id: m.id, ok: !!res.ok, editable: !!res.editable, key: res.key }));
      return;
    }
    if (m.t !== 'seek') return;
    let ok = false;
    try { ok = await seekActiveTab(m.s); } catch {}
    ws.send(JSON.stringify({ t: 'seekres', id: m.id, ok }));
  };
  ws.onclose = () => { ws = null; setTimeout(connect, 3000); };
}
// Si Brave suspende el service worker, la alarma lo despierta y reconecta
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
connect();
