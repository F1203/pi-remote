chrome.runtime.onMessage.addListener((m) => {
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

async function seekActiveTab(seconds) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return false;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true }, func: seekVideo, args: [seconds],
  });
  return results.some((r) => r.result === true);
}

// Modo tele: pasa la flecha / OK / atrás / inicio / buscar a la página de la pestaña activa (tv.js)
const isYouTube = (url) => /^https:\/\/(www\.|m\.)?youtube\.com\//.test(url || '');
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
  // Inicio y Buscar llevan a YouTube aunque se esté en otra página
  if ((nav === 'home' || nav === 'search') && !isYouTube(tab.url)) {
    await chrome.tabs.update(tab.id, { url: 'https://www.youtube.com/' });
    await waitLoaded(tab.id);
    if (nav === 'home') return { ok: true };
    await new Promise((r) => setTimeout(r, 800));
  }
  return (await tellTab(tab.id, nav)) || { ok: false };
}

// Conexión con el servidor del control remoto para recibir órdenes (adelantar video, modo tele)
let ws = null;
function connect() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket('ws://127.0.0.1:8080/ext');
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'nav') {
      let res = { ok: false };
      try { res = await navActiveTab(m.a); } catch {}
      ws.send(JSON.stringify({ t: 'navres', id: m.id, ok: !!res.ok, editable: !!res.editable }));
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
