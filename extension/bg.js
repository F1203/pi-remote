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

// Conexión con el servidor del control remoto para recibir órdenes (adelantar video)
let ws = null;
function connect() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket('ws://127.0.0.1:8080/ext');
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
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
