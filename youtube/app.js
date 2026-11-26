// Modo YouTube: tu YouTube (con la sesión de Brave) como una app de Smart TV.
// La extensión baja las páginas de YouTube con la sesión y le pasa a esta página su ytInitialData
// (si no está, el servidor las baja sin sesión: alcanza para buscar y ver canales). Los videos se
// ven en un reproductor propio (un iframe de youtube.com/embed). «Seguir viendo» y los canales
// favoritos los guarda el servidor (youtube.py). La cruceta llega igual que en el modo anime:
// tv.js le pasa cada acción con postMessage y esta página contesta qué hacer ({media}, {winFull}…).
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reloj2 = (t) => {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const MINI = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const MINI2 = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

async function api(ruta, q = {}) {
  const r = await fetch('api/' + ruta + '?' + new URLSearchParams(q));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}

let estado = { viendo: {}, canales: {} };
async function guardar(q) {
  try { const r = await api('guardar', q); if (r.estado) estado = r.estado; } catch (e) { console.warn(e); }
}

// ---------- Páginas de YouTube (ytInitialData) ----------
let conExtension = false;
let sinSesion = false; // la extensión respondió, pero YouTube no ve la sesión
const esperando = new Map();
let pedidoId = 0;
const cacheYt = new Map(); // ruta -> {vence, promesa}
function pedirExt(ruta) {
  return new Promise((ok, no) => {
    const id = ++pedidoId;
    const t = setTimeout(() => { esperando.delete(id); no(new Error('YouTube no respondió')); }, 20000);
    esperando.set(id, (r) => { clearTimeout(t); if (r.ok) ok(r); else no(new Error(r.error || 'No se pudo abrir YouTube')); });
    aExt({ ytFetch: ruta, id });
  });
}
let avisoSesion = false;
function yt(ruta, dura = 300000) {
  const c = cacheYt.get(ruta);
  if (c && c.vence > Date.now()) return c.promesa;
  const promesa = (conExtension ? pedirExt(ruta) : api('pagina', { p: ruta })).then((r) => {
    if (conExtension) {
      sinSesion = !r.logueado;
      if (sinSesion && !avisoSesion) { avisoSesion = true; api('log', { m: 'la extensión no ve la sesión de YouTube' }).catch(() => {}); }
    }
    return r.data;
  });
  cacheYt.set(ruta, { vence: Date.now() + dura, promesa });
  promesa.catch(() => cacheYt.delete(ruta));
  return promesa;
}

// Recorre todo el árbol de datos: cada video o canal que aparece, en orden y sin repetir.
// Los Shorts quedan afuera (y los videos que todavía no se estrenaron).
const texto = (x) => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (x.simpleText != null) return x.simpleText;
  if (x.runs) return x.runs.map((r) => r.text).join('');
  if (x.content != null) return x.content;
  return '';
};
function buscar(o, fn, prof = 0) { // el primer valor que devuelve fn en el árbol (o undefined)
  if (!o || typeof o !== 'object' || prof > 25) return undefined;
  const r = fn(o);
  if (r !== undefined) return r;
  for (const k in o) {
    const x = buscar(o[k], fn, prof + 1);
    if (x !== undefined) return x;
  }
  return undefined;
}
const idCanal = (o) => buscar(o, (x) => (x.browseEndpoint && /^UC/.test(x.browseEndpoint.browseId || '') ? x.browseEndpoint.browseId : undefined));
const urlImg = (u) => (u && u.startsWith('//') ? 'https:' + u : u || '');
const NO = new Set(['reelShelfRenderer', 'reelItemRenderer', 'shortsLockupViewModel', 'richShelfRenderer']);

function deVideoRenderer(vr) {
  if (!vr.videoId || vr.upcomingEventData) return null;
  const autor = vr.ownerText || vr.longBylineText || vr.shortBylineText;
  const sobre = (vr.thumbnailOverlays || []);
  const st = sobre.find((x) => x.thumbnailOverlayTimeStatusRenderer);
  const estilo = st && st.thumbnailOverlayTimeStatusRenderer.style;
  if (estilo === 'SHORTS') return null;
  const vivo = estilo === 'LIVE' || (vr.badges || []).some((b) => /LIVE/.test(JSON.stringify(b)));
  const resume = sobre.find((x) => x.thumbnailOverlayResumePlaybackRenderer);
  const avatar = buscar(vr.channelThumbnailSupportedRenderers || vr.channelThumbnail, (x) => (x.thumbnails ? x.thumbnails[0].url : undefined));
  return {
    id: vr.videoId, title: texto(vr.title), canal: texto(autor), canalId: idCanal(autor) || '',
    dur: vivo ? 'EN VIVO' : texto(vr.lengthText) || (st ? texto(st.thumbnailOverlayTimeStatusRenderer.text) : ''),
    vivo, meta: [texto(vr.shortViewCountText || vr.viewCountText), texto(vr.publishedTimeText)].filter(Boolean).join(' · '),
    avatar: urlImg(avatar), visto: resume ? resume.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched / 100 : 0,
  };
}
function deLockup(lv) {
  if (lv.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !lv.contentId) return null;
  const md = (lv.metadata && lv.metadata.lockupMetadataViewModel) || {};
  const filas = buscar(md.metadata, (x) => x.metadataRows) || [];
  const partes = filas.map((f) => (f.metadataParts || []).map((p) => texto(p.text)).filter(Boolean));
  const insignias = [];
  buscar(lv.contentImage, (x) => { if (x.thumbnailBadgeViewModel) insignias.push(x.thumbnailBadgeViewModel); return undefined; });
  const dur = (insignias.find((b) => /^\d+(:\d\d)+$/.test(b.text || '')) || {}).text || '';
  const vivo = insignias.some((b) => /LIVE/.test(b.badgeStyle || '') || /^(EN VIVO|LIVE|EN DIRECTO)$/i.test(b.text || ''));
  if (insignias.some((b) => /PRÓXIMAMENTE|UPCOMING|ESTRENO/i.test(b.text || ''))) return null;
  const pct = buscar(lv.contentImage, (x) => (x.thumbnailOverlayProgressBarViewModel ? x.thumbnailOverlayProgressBarViewModel.startPercent : undefined));
  const avatar = buscar(md.image, (x) => (x.avatarViewModel ? buscar(x.avatarViewModel, (y) => (y.sources ? y.sources[0].url : undefined)) : undefined));
  return {
    id: lv.contentId, title: texto(md.title), canal: (partes[0] || [])[0] || '', canalId: idCanal(md) || '',
    dur: vivo ? 'EN VIVO' : dur, vivo, meta: partes.slice(1).flat().join(' · '),
    avatar: urlImg(avatar), visto: pct ? pct / 100 : 0,
  };
}
function deCanal(cr) {
  const imgs = (cr.thumbnail && cr.thumbnail.thumbnails) || [];
  return {
    canalId: cr.channelId, nombre: texto(cr.title), avatar: urlImg((imgs[imgs.length - 1] || {}).url),
    meta: texto(cr.videoCountText) || texto(cr.subscriberCountText),
  };
}
function contenido(o) {
  const videos = [], canales = [];
  const vistos = new Set();
  const recorrer = (x, prof) => {
    if (!x || typeof x !== 'object' || prof > 40) return;
    if (Array.isArray(x)) { for (const y of x) recorrer(y, prof + 1); return; }
    for (const k in x) {
      if (NO.has(k)) continue;
      const val = x[k];
      let v = null;
      if (k === 'videoRenderer' || k === 'gridVideoRenderer' || k === 'compactVideoRenderer' || k === 'playlistVideoRenderer') v = deVideoRenderer(val);
      else if (k === 'lockupViewModel') v = deLockup(val);
      else if ((k === 'channelRenderer' || k === 'gridChannelRenderer') && val.channelId) {
        if (!vistos.has(val.channelId)) { vistos.add(val.channelId); canales.push(deCanal(val)); }
        continue;
      } else { recorrer(val, prof + 1); continue; }
      if (v && v.title && !vistos.has(v.id)) { vistos.add(v.id); videos.push(v); infoVideo.set(v.id, v); }
    }
  };
  recorrer(o, 0);
  return { videos, canales };
}
const infoVideo = new Map(); // id -> datos del video (para el reproductor y «seguir viendo»)

// ---------- Mensajes ----------
let toastT = 0;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = 'none'; }, 1800);
}
function reloj() { $('#reloj').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }
setInterval(reloj, 10000); reloj();
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (img.tagName !== 'IMG') return;
  const alt = (img.dataset.alt || '').split('|').filter(Boolean);
  if (alt.length) { img.src = alt.shift(); img.dataset.alt = alt.join('|'); } else img.classList.add('sin-img');
}, true);

// ---------- Extensión (tv.js) ----------
const aExt = (req) => window.postMessage({ pitvReq: req }, '*');
let hola = null; // se resuelve cuando la extensión saluda
const saludo = new Promise((r) => { hola = r; });
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data) return;
  const d = ev.data;
  if (d.pitvNav) {
    conExtension = true; hola();
    let res = {};
    try { res = accion(d.pitvNav) || {}; } catch (e) { console.error(e); res = { ok: false }; }
    window.postMessage({ pitvRes: d.id, res }, '*');
  } else if (d.pitvEv) {
    conExtension = true; hola();
    if (d.pitvEv.vprog) progresoVideo(d.pitvEv.vprog);
    if (d.pitvEv.ytres) { const f = esperando.get(d.pitvEv.ytres.id); if (f) { esperando.delete(d.pitvEv.ytres.id); f(d.pitvEv.ytres); } }
  }
});

// ---------- Foco y cruceta (igual que el modo anime) ----------
let foco = null;
const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
function capa() {
  if (menuAbierto()) return $('#menu');
  if ($('#aviso').classList.contains('abierto')) return $('#aviso');
  if (viendo) return $('#controles').classList.contains('abierto') ? $('#controles') : null;
  return $('#app');
}
const focables = () => { const c = capa(); return c ? [...c.querySelectorAll('[data-f]')].filter(visible) : []; };
const filaDe = (el) => el.closest('[data-fila]');

function enfocar(el, { suave = true } = {}) {
  if (foco) foco.classList.remove('foco');
  foco = el || null;
  if (!foco) return;
  foco.classList.add('foco');
  const fila = filaDe(foco);
  const cont = foco.closest('.fila-items, .chips');
  if (cont) {
    const pad = cont.clientWidth * 0.06;
    const cr = cont.getBoundingClientRect(), fr = foco.getBoundingClientRect();
    const izq = fr.left - cr.left + cont.scrollLeft, der = izq + fr.width;
    if (izq - pad < cont.scrollLeft) cont.scrollTo({ left: Math.max(0, izq - pad * 2), behavior: suave ? 'smooth' : 'auto' });
    else if (der + pad > cont.scrollLeft + cont.clientWidth) cont.scrollTo({ left: der + pad - cont.clientWidth, behavior: suave ? 'smooth' : 'auto' });
  }
  if (viendo || (fila && fila.id === 'barra')) return;
  const bloque = fila && !fila.hasAttribute('data-grilla') && fila.getBoundingClientRect().height < innerHeight * 0.7
    ? (fila.closest('.fila') || fila) : foco;
  const r = bloque.getBoundingClientRect();
  const arriba = $('#barra').offsetHeight + 10;
  if (r.top < arriba) scrollBy({ top: r.top - arriba - 20, behavior: suave ? 'smooth' : 'auto' });
  else if (r.bottom > innerHeight - 20) scrollBy({ top: r.bottom - innerHeight + 40, behavior: suave ? 'smooth' : 'auto' });
}
function linea(el) {
  const f = filaDe(el);
  if (!f) return 'suelto';
  if (f.hasAttribute('data-grilla')) return f.dataset.fila + ':' + Math.round(el.offsetTop / 8);
  return f.dataset.fila;
}
const memoFila = new Map();
function mover(dir) {
  const items = focables();
  if (!items.length) return false;
  if (!foco || !items.includes(foco)) { enfocar(inicial() || items[0]); return true; }
  const barra = $('#barra');
  const enBarra = barra.contains(foco);
  if (enBarra && dir === 'down') {
    const m = memoFila.get('menu-abajo');
    const el = m && m.isConnected && visible(m) ? m
      : items.find((x) => !barra.contains(x) && x.getBoundingClientRect().top >= barra.offsetHeight - 10) || items.find((x) => !barra.contains(x));
    if (el) enfocar(el);
    return !!el;
  }
  if (enBarra && dir === 'up') return false;
  const l = linea(foco);
  if (dir === 'left' || dir === 'right') {
    const misma = items.filter((el) => linea(el) === l);
    const i = misma.indexOf(foco) + (dir === 'right' ? 1 : -1);
    if (misma[i]) enfocar(misma[i]);
    return !!misma[i];
  }
  const top = (el) => el.getBoundingClientRect().top;
  const grupos = new Map();
  for (const el of items.filter((x) => enBarra || !barra.contains(x))) {
    const k = linea(el);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(el);
  }
  const lineas = [...grupos.entries()].map(([k, els]) => ({ k, els, y: Math.min(...els.map(top)) })).sort((a, b) => a.y - b.y);
  const i = lineas.findIndex((x) => x.k === l) + (dir === 'down' ? 1 : -1);
  const dest = lineas[i];
  if (!dest) return false;
  const a = foco.getBoundingClientRect();
  const cx = a.width > innerWidth * 0.5 ? 0 : a.left + a.width / 2;
  const enVista = dest.els.filter((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; });
  const recordado = memoFila.get(dest.k);
  let el;
  if (recordado && enVista.includes(recordado) && filaDe(recordado) && !filaDe(recordado).hasAttribute('data-grilla')) el = recordado;
  else el = (enVista.length ? enVista : dest.els).reduce((best, x) => {
    const r = x.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx);
    return !best || d < best.d ? { x, d } : best;
  }, null).x;
  memoFila.set(l, foco);
  enfocar(el);
  return true;
}

function activar(el) {
  if (!el) return {};
  if (el.tagName === 'INPUT') { el.focus(); el.select(); return { editable: true }; }
  if (el.dataset.vid) ponerCola(el);
  if (el.dataset.ir) { irA(el.dataset.ir); return {}; }
  if (el.dataset.accion) return hacer(el.dataset.accion, el) || {};
  return {};
}

function accion(a) {
  const enInput = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (['play', 'rw5', 'ff5', 'cc', 'full'].includes(a)) {
    if (!viendo) return { ok: false };
    if (a === 'full') return { winFull: (winFull = !winFull) };
    if (a === 'play') return { media: 'play' };
    if (a === 'cc') return { media: 'cc' };
    return { media: 'seek', s: a === 'rw5' ? -5 : 5 };
  }
  if (menuAbierto()) {
    if (a === 'menu' || a === 'back') { cerrarMenu(); return {}; }
    if (a === 'ok') return activar(foco);
    if (['up', 'down', 'left', 'right'].includes(a)) { mover(a); return {}; }
    cerrarMenu();
  }
  if (a === 'menu') return abrirMenu();
  if (a === 'home' || a === 'youtube') {
    if (ruta().nombre === 'inicio' && !viendo) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); } else irA('#/');
    return {};
  }
  if (a === 'search') { irA('#/buscar'); return { editable: true }; }
  if (a === 'subs' || a === 'canales' || a === 'historial') { irA('#/' + a); return {}; }
  if (a === 'back') return atras();
  if ($('#aviso').classList.contains('abierto')) {
    if (a === 'ok') return activar(foco);
    mover(a); return {};
  }
  if (viendo) return accionVideo(a);
  if (enInput) {
    const inp = document.activeElement;
    if (a === 'ok') { buscarYa(); inp.blur(); mover('down'); return {}; }
    if (a === 'up' || a === 'down') { inp.blur(); mover(a); return {}; }
    return {};
  }
  if (a === 'ok') return activar(foco && foco.isConnected ? foco : null) || {};
  if (!mover(a) && a === 'up' && foco && !$('#barra').contains(foco)) {
    memoFila.set('menu-abajo', foco);
    scrollTo({ top: 0, behavior: 'smooth' });
    enfocar($('#barra .menu.activo') || $('#barra [data-f]'));
  }
  return {};
}

function atras() {
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT') { a.blur(); return {}; }
  if ($('#aviso').classList.contains('abierto')) { cancelarSiguiente(); return {}; }
  if (viendo && $('#controles').classList.contains('abierto')) { cerrarControles(); return {}; }
  if (viendo) { if (pasos()) volver(); else irA('#/'); return {}; }
  if (ruta().nombre === 'inicio') {
    if (scrollY > 10) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); }
    return {};
  }
  if (pasos()) volver(); else irA('#/');
  return {};
}
// Cuántas páginas se abrieron dentro de la app desde la primera (va en el historial): Atrás solo
// vuelve si hay a dónde; si no, se saldría de la app
const pasos = () => (history.state && history.state.pasos) || 0;
// Atrás en el historial, una vez por página (dos toques seguidos no se saltean la de antes)
let volviendoDe = null;
function volver() {
  if (volviendoDe === location.href) return;
  volviendoDe = location.href;
  history.back();
}
window.addEventListener('popstate', () => { volviendoDe = null; });

document.addEventListener('keydown', (ev) => {
  const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back', ContextMenu: 'menu' }[ev.key]
    || ((ev.key === 'm' || ev.key === 'M') && document.activeElement.tagName !== 'INPUT' ? 'menu' : null)
    || (ev.key === 'Backspace' && document.activeElement.tagName !== 'INPUT' ? 'back' : null);
  if (!k) return;
  const enInput = document.activeElement.tagName === 'INPUT';
  if (enInput && (k === 'left' || k === 'right')) return;
  ev.preventDefault();
  if (ev.altKey && ev.key === 'ArrowLeft') { accion('back'); return; }
  accion(k);
}, true);
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-f]');
  if (!el) return;
  ev.preventDefault();
  enfocar(el);
  activar(el);
});
document.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const el = ev.target.closest('[data-f]');
  if (el && !menuAbierto()) enfocar(el);
  if (menuAbierto()) cerrarMenu(); else abrirMenu();
});

// ---------- Rutas ----------
function ruta() {
  const [camino, qs] = (location.hash.slice(1) || '/').split('?');
  const p = camino.split('/').filter(Boolean).map(decodeURIComponent);
  return { nombre: p[0] || 'inicio', p, q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function irA(h) {
  if (location.hash === h || (h === '#/' && !location.hash)) { render(); return; }
  const n = pasos() + 1;
  location.hash = h;
  history.replaceState({ pasos: n }, '');
}
// Cambiar de página sin sumar una entrada al historial (p. ej. del video a su canal)
function irSinHistorial(h) {
  history.replaceState(history.state, '', h);
  render();
}
const memo = new Map();
let paginaActual = '';
window.addEventListener('hashchange', render);

async function render() {
  if (paginaActual && foco && !viendo) memo.set(paginaActual, { k: foco.dataset.k, fila: (filaDe(foco) || {}).dataset?.fila, y: scrollY });
  const r = ruta();
  const h = location.hash || '#/';
  paginaActual = h;
  cerrarMenu();
  if (r.nombre === 'ver') { ver(r.p[1], +(r.q.t || 0)); return; }
  salirDelVideo();
  document.querySelectorAll('#barra .menu').forEach((b) => b.classList.toggle('activo', b.dataset.ir === '#/' + (r.nombre === 'inicio' ? '' : r.nombre)));
  const pant = $('#pantalla');
  pant.innerHTML = '<div class="estado">Cargando…</div>';
  enfocar(null);
  try {
    const pagina = { inicio: pInicio, subs: pSubs, canales: pCanales, canal: pCanal, buscar: pBuscar, historial: pHistorial, tarde: pTarde }[r.nombre] || pInicio;
    await pagina(pant, r);
  } catch (e) {
    if (paginaActual !== h) return;
    pant.innerHTML = `<div class="estado">${esc(e.message)}<div class="botones" data-fila="error">
      <button class="boton principal" data-f data-k="reintentar" data-accion="reintentar">Reintentar</button></div></div>`;
  }
  if (paginaActual !== h) return;
  const m = memo.get(h);
  const el = m && m.k && ((m.fila && document.querySelector(`#pantalla [data-fila="${CSS.escape(m.fila)}"] [data-k="${CSS.escape(m.k)}"]`))
    || document.querySelector(`#pantalla [data-k="${CSS.escape(m.k)}"]`));
  if (el) { scrollTo({ top: m.y }); enfocar(el, { suave: false }); } else { scrollTo({ top: 0 }); enfocar(inicial(), { suave: false }); }
}
function inicial() {
  return $('#pantalla [data-inicial]') || $('#pantalla [data-f]') || $('#barra [data-f]');
}

// ---------- Tarjetas ----------
// Un video está visto si faltan unos segundos (la pantalla final de YouTube): 5 %, entre 15 s y 1 min
const terminado = (t, d) => d > 0 && d - t <= Math.min(60, Math.max(15, d * 0.05));
function progresoDe(v) {
  const g = estado.viendo[v.id];
  if (g && g.d) return terminado(g.t, g.d) ? 1 : g.t / g.d;
  return v.visto || 0;
}
function tVideo(v, { k, sub } = {}) {
  const p = progresoDe(v);
  return `<div class="tarjeta ancha video" data-f data-vid="${esc(v.id)}" data-k="${esc(k || 'v:' + v.id)}" data-ir="#/ver/${esc(v.id)}">
    <div class="img"><img loading="lazy" src="${MINI(v.id)}" data-alt="${MINI2(v.id)}" alt="">
    ${v.dur ? `<span class="insignia dur ${v.vivo ? 'vivo' : ''}">${esc(v.dur)}</span>` : ''}
    ${p ? `<div class="progreso"><i style="width:${Math.round(Math.min(1, p) * 100)}%"></i></div>` : ''}</div>
    <div class="titulo con-sub">${esc(v.title)}</div><span class="sub">${esc(sub ?? [v.canal, v.meta].filter(Boolean).join(' · '))}</span></div>`;
}
function tCanal(c, { k } = {}) {
  const fav = estado.canales[c.canalId];
  return `<div class="tarjeta canal" data-f data-canal="${esc(c.canalId)}" data-nombre="${esc(c.nombre)}" data-avatar="${esc(c.avatar || '')}"
      data-k="${esc(k || 'c:' + c.canalId)}" data-ir="#/canal/${esc(c.canalId)}">
    <div class="img">${c.avatar ? `<img loading="lazy" src="${esc(c.avatar)}" alt="">` : ''}</div>
    <div class="titulo ${c.meta ? 'con-sub' : ''}">${fav ? '<span class="fav">★</span> ' : ''}${esc(c.nombre)}</div>${c.meta ? `<span class="sub">${esc(c.meta)}</span>` : ''}</div>`;
}
function fila(id, titulo, html, extra = '') {
  return html ? `<section class="fila"><h2>${titulo}${extra}</h2><div class="fila-items" data-fila="${id}">${html}</div></section>` : '';
}
function grilla(id, titulo, html, vacio, clase = 'videos') {
  return `<section class="fila"><h2>${titulo}</h2><div class="grilla ${clase}" data-fila="${id}" data-grilla>${html || `<div class="vacio">${vacio}</div>`}</div></section>`;
}
const avisoSesion2 = () => (sinSesion ? '<div class="aviso-sesion">YouTube no ve tu sesión: iniciá sesión en youtube.com en Brave para ver tus suscripciones, recomendados e historial.</div>' : '');

// La cola: al abrir un video desde una fila, «siguiente» y «anterior» son los de esa fila
let cola = [];
function ponerCola(el) {
  const f = filaDe(el);
  cola = f ? [...f.querySelectorAll('[data-vid]')].map((x) => x.dataset.vid) : [];
}

function seguirViendo() {
  return Object.entries(estado.viendo)
    .filter(([, g]) => g.t > 0 && !terminado(g.t, g.d))
    .sort((a, b) => b[1].fecha - a[1].fecha).slice(0, 20)
    .map(([id, g]) => {
      const v = infoVideo.get(id) || { id, title: g.title, canal: g.canal, canalId: g.canalId };
      if (!infoVideo.has(id)) infoVideo.set(id, v);
      return tVideo({ ...v, dur: g.d ? reloj2(g.d) : v.dur }, { k: 'sv:' + id, sub: `Quedó en ${reloj2(g.t)}${g.canal ? ' · ' + g.canal : ''}` });
    }).join('');
}
// El nombre de un favorito sale del video desde el que se agregó; en los videos en colaboración es
// «Canal y Otro». Con la página del canal se guarda el nombre de verdad.
function corregirNombre(c, data) {
  const md = (data.metadata && data.metadata.channelMetadataRenderer) || {};
  if (!md.title || !estado.canales[c.canalId] || md.title === estado.canales[c.canalId].nombre) return;
  c.nombre = md.title;
  const av = urlImg(((md.avatar && md.avatar.thumbnails) || [])[0]?.url) || c.avatar || '';
  guardar({ accion: 'canal', id: c.canalId, nombre: md.title, avatar: av, on: 1 });
}
const favoritos = () => Object.entries(estado.canales).sort((a, b) => a[1].fecha - b[1].fecha)
  .map(([canalId, c]) => ({ canalId, nombre: c.nombre, avatar: c.avatar }));

// ---------- Páginas ----------
async function pInicio(pant) {
  const [subs, inicio] = await Promise.all([
    yt('/feed/subscriptions').then(contenido).catch(() => null),
    yt('/').then(contenido).catch(() => null),
  ]);
  if (!subs && !inicio) throw new Error('No se pudo abrir YouTube');
  let html = avisoSesion2();
  html += fila('seguir', 'Seguir viendo', seguirViendo());
  if (subs) html += fila('subs', 'Suscripciones', subs.videos.slice(0, 24).map((v) => tVideo(v)).join(''));
  const favs = favoritos();
  html += favs.map((c) => `<div data-fav="${esc(c.canalId)}"></div>`).join('');
  if (inicio) html += fila('reco', 'Recomendados', inicio.videos.slice(0, 30).map((v) => tVideo(v)).join(''));
  const vacio = !(subs && subs.videos.length) && !(inicio && inicio.videos.length) && !favs.length && !html.includes('data-f');
  if (vacio) html += '<div class="estado">No hay nada para mostrar todavía. Probá con <b>Buscar</b>.</div>';
  else if (!favs.length) html += '<div class="aviso-sesion">Mantené OK sobre un video y elegí «★ Canal favorito»: cada canal favorito tiene su fila acá.</div>';
  pant.innerHTML = html;
  // Una fila por canal favorito, sin esperar (si falla una, no se muestra)
  const hash = location.hash;
  favs.forEach((c) => {
    yt(`/channel/${c.canalId}/videos`).then((data) => {
      const d = contenido(data.contents || data);
      corregirNombre(c, data);
      const hueco = location.hash === hash && pant.querySelector(`[data-fav="${CSS.escape(c.canalId)}"]`);
      if (!hueco) return;
      const k = foco && foco.dataset.k;
      hueco.outerHTML = fila('f:' + c.canalId, `<span class="fav">★</span> ${esc(c.nombre)}`, d.videos.slice(0, 20).map((v) => tVideo(v, { sub: v.meta })).join(''));
      if (k && !foco.isConnected) enfocar(document.querySelector(`#pantalla [data-k="${CSS.escape(k)}"]`));
    }).catch(() => {});
  });
}

async function pSubs(pant) {
  const d = contenido(await yt('/feed/subscriptions'));
  pant.innerHTML = avisoSesion2() + grilla('subs', 'Suscripciones', d.videos.map((v) => tVideo(v)).join(''),
    'No hay videos de tus suscripciones.');
}
async function pHistorial(pant) {
  const d = contenido(await yt('/feed/history', 60000));
  const sv = seguirViendo();
  pant.innerHTML = avisoSesion2() + fila('seguir', 'Seguir viendo', sv)
    + grilla('hist', 'Historial de YouTube', d.videos.map((v) => tVideo(v)).join(''), 'El historial está vacío.');
}
async function pTarde(pant) {
  const d = contenido(await yt('/playlist?list=WL', 60000));
  pant.innerHTML = avisoSesion2() + grilla('tarde', 'Ver más tarde', d.videos.map((v) => tVideo(v)).join(''),
    'No hay videos guardados para ver más tarde.');
}
async function pCanales(pant) {
  const favs = favoritos();
  const d = await yt('/feed/channels').then(contenido).catch(() => ({ canales: [] }));
  const otros = d.canales.filter((c) => !estado.canales[c.canalId]);
  pant.innerHTML = avisoSesion2()
    + grilla('favs', 'Canales favoritos', favs.map((c) => tCanal(c)).join(''),
      'Todavía no hay favoritos. Mantené OK sobre un canal (o un video) y elegí «★ Canal favorito».', 'canales')
    + (otros.length ? grilla('suscritos', 'Tus suscripciones', otros.map((c) => tCanal(c)).join(''), '', 'canales') : '');
}
async function pCanal(pant, r) {
  const id = r.p[1];
  const data = await yt(`/channel/${id}/videos`);
  const md = (data.metadata && data.metadata.channelMetadataRenderer) || {};
  const nombre = md.title || (estado.canales[id] || {}).nombre || 'Canal';
  const avatar = urlImg(((md.avatar && md.avatar.thumbnails) || [])[0]?.url) || (estado.canales[id] || {}).avatar || '';
  const fav = !!estado.canales[id];
  if (fav) corregirNombre({ canalId: id, ...estado.canales[id] }, data);
  const d = contenido(data.contents || data);
  pant.innerHTML = `<section class="canal-cab">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}<div>
      <h1>${esc(nombre)}</h1><p>${esc(md.description || '')}</p>
      <div class="botones" data-fila="acciones">
        <button class="boton ${fav ? 'marcado' : ''}" data-f data-k="a:fav" data-accion="fav" data-canal="${esc(id)}" data-nombre="${esc(nombre)}" data-avatar="${esc(avatar)}">${fav ? '★ Favorito' : '☆ Agregar a favoritos'}</button>
      </div></div></section>`
    + grilla('vids', 'Videos', d.videos.map((v) => tVideo(v, { sub: v.meta })).join(''), 'Este canal no tiene videos.');
  const primero = $('#pantalla .grilla .tarjeta');
  if (primero) primero.setAttribute('data-inicial', '');
}

let busquedaT = 0, ultimaBusqueda = '';
async function pBuscar(pant, r) {
  pant.innerHTML = `<div class="buscador" data-fila="buscar"><input id="q" data-f data-inicial data-k="q" type="search"
      placeholder="Buscar en YouTube…" autocomplete="off" value="${esc(r.q.q || '')}">
      <p>Escribí con el teclado del celular. OK busca; ↓ baja a los resultados.</p></div>
    <div id="res"></div>`;
  const inp = $('#q');
  inp.addEventListener('input', () => { clearTimeout(busquedaT); busquedaT = setTimeout(buscarYa, 900); });
  ultimaBusqueda = '';
  if (r.q.q) await buscarYa(); else setTimeout(() => { if (document.activeElement !== inp && ruta().nombre === 'buscar') inp.focus(); }, 50);
}
async function buscarYa() {
  clearTimeout(busquedaT);
  const inp = $('#q');
  if (!inp) return;
  const t = inp.value.trim();
  if (t === ultimaBusqueda) return;
  ultimaBusqueda = t;
  history.replaceState(history.state, '', '#/buscar' + (t ? '?q=' + encodeURIComponent(t) : ''));
  paginaActual = location.hash;
  const res = $('#res');
  if (!t) { res.innerHTML = ''; return; }
  res.innerHTML = '<div class="vacio">Buscando…</div>';
  try {
    const d = contenido(await yt('/results?search_query=' + encodeURIComponent(t)));
    if (ultimaBusqueda !== t || !$('#res')) return;
    res.innerHTML = fila('rcan', 'Canales', d.canales.map((c) => tCanal(c)).join(''))
      + grilla('res', d.videos.length ? 'Videos' : 'Sin resultados', d.videos.map((v) => tVideo(v)).join(''), '');
  } catch (e) { if ($('#res')) res.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

// ---------- Botones ----------
function hacer(acc, el) {
  if (acc.startsWith('m-')) return hacerMenu(acc);
  if (acc === 'reintentar') { cacheYt.clear(); render(); return {}; }
  if (acc === 'anime') { location.href = '../anime/'; return {}; }
  if (acc === 'fav') {
    alternarFavorito({ canalId: el.dataset.canal, nombre: el.dataset.nombre, avatar: el.dataset.avatar }).then((on) => {
      el.classList.toggle('marcado', on);
      el.textContent = on ? '★ Favorito' : '☆ Agregar a favoritos';
    });
    return {};
  }
  return hacerVideo(acc, el);
}
async function alternarFavorito(c) {
  const on = !estado.canales[c.canalId];
  await guardar({ accion: 'canal', id: c.canalId, nombre: c.nombre || '', avatar: c.avatar || '', on: on ? 1 : 0 });
  toast(on ? `★ ${c.nombre || 'Canal'}: favorito` : 'Quitado de favoritos');
  return on;
}

// ---------- Reproductor ----------
let viendo = null; // {id, info, desde, cola, relacionados, ultimo, ...}
let winFull = false;
let ocultarT = 0, siguienteT = 0, guardarT = 0;

function ver(id, t = 0) {
  if (viendo && viendo.id === id) return;
  salirDelVideo(true);
  document.body.classList.add('viendo');
  $('#cargando').textContent = 'Cargando…';
  $('#cargando').style.display = '';
  enfocar(null);
  const g = estado.viendo[id];
  const info = infoVideo.get(id) || { id, title: g ? g.title : '', canal: g ? g.canal : '', canalId: g ? g.canalId : '' };
  const v = viendo = { id, info, relacionados: [], ultimo: null, arranco: false, visto: false,
    cola: cola.includes(id) ? cola.slice() : [] };
  v.desde = t || (g && g.t > 20 && !terminado(g.t, g.d) ? Math.max(0, Math.floor(g.t) - 3) : 0);
  if (!winFull) { winFull = true; aExt({ winFull: true }); }
  aExt({ watch: true });
  const f = document.createElement('iframe');
  f.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1&iv_load_policy=3`
    + `&hl=es&cc_lang_pref=es${v.desde ? '&start=' + v.desde : ''}`;
  f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube no deja ver videos sin saber desde dónde
  $('#reproductor').insertBefore(f, $('#reproductor').firstChild);
  f.addEventListener('load', () => { if (viendo === v) $('#cargando').style.display = 'none'; }, { once: true });
  if (v.desde) toast('Continúa en ' + reloj2(v.desde));
  pintarControles();
  abrirControles(false, 5000);
  // Si no arranca solo (el navegador pide un clic), la extensión lo arranca
  (async () => {
    await sleep(3500);
    if (viendo === v && !v.arranco) aExt({ autoplay: true });
    await sleep(6000);
    if (viendo === v && !v.arranco) aExt({ autoplay: true });
  })();
  // Título, canal y relacionados (de la página del video)
  yt('/watch?v=' + encodeURIComponent(id), 600000).then((d) => {
    if (viendo !== v) return;
    const res = (d.contents && d.contents.twoColumnWatchNextResults) || {};
    const prim = buscar(res.results, (x) => x.videoPrimaryInfoRenderer);
    const dueño = buscar(res.results, (x) => x.videoOwnerRenderer);
    if (prim) v.info.title = texto(prim.title) || v.info.title;
    if (dueño) {
      v.info.canal = texto(dueño.title) || v.info.canal;
      v.info.canalId = idCanal(dueño.navigationEndpoint || dueño.title) || v.info.canalId;
      v.info.avatar = urlImg(buscar(dueño.thumbnail, (x) => (x.thumbnails ? x.thumbnails[0].url : undefined))) || v.info.avatar;
    }
    v.relacionados = contenido(res.secondaryResults || {}).videos.filter((x) => x.id !== id).slice(0, 20);
    const foc = foco && foco.dataset.k;
    pintarControles();
    if (foc && $('#controles').classList.contains('abierto')) enfocar($(`#controles [data-k="${CSS.escape(foc)}"]`) || $('#controles [data-inicial]'));
  }).catch(() => {});
}

function siguienteDe(v) {
  const i = v.cola.indexOf(v.id);
  if (i >= 0 && i < v.cola.length - 1) return v.cola[i + 1];
  return v.relacionados[0] ? v.relacionados[0].id : null;
}
function pintarControles() {
  const v = viendo;
  if (!v) return;
  $('#c-titulo').textContent = v.info.title || 'Video';
  $('#c-ayuda').textContent = (v.info.canal ? v.info.canal + ' · ' : '') + 'Con el panel cerrado: ←/→ 10 s · OK pausa · ↑ o Atrás: cerrar este panel';
  const i = v.cola.indexOf(v.id);
  const sig = siguienteDe(v);
  const b = [`<button class="boton principal" data-f data-inicial data-k="b:canal" data-accion="a-canal">☰ ${esc(v.info.canal || 'Canal')}</button>`];
  if (i > 0) b.push(`<button class="boton" data-f data-k="b:ant" data-accion="otro" data-id="${esc(v.cola[i - 1])}">⏮ Anterior</button>`);
  if (sig) b.push(`<button class="boton" data-f data-k="b:sig" data-accion="otro" data-id="${esc(sig)}">Siguiente ⏭</button>`);
  b.push('<span class="sep"></span><button class="boton" data-f data-k="b:cc" data-accion="cc">Subtítulos</button>');
  if (v.info.canalId) {
    const fav = estado.canales[v.info.canalId];
    b.push(`<button class="boton ${fav ? 'marcado' : ''}" data-f data-k="b:fav" data-accion="fav-video">${fav ? '★ Favorito' : '☆ Canal favorito'}</button>`);
  }
  b.push('<button class="boton" data-f data-k="b:yt" data-accion="en-youtube">Abrir en YouTube</button>');
  $('#c-botones').innerHTML = b.join('');
  $('#c-rel').innerHTML = fila('rel', 'Relacionados', v.relacionados.map((x) => tVideo(x, { k: 'r:' + x.id })).join(''));
}
function abrirControles(conFoco = true, dura = 10000) {
  $('#controles').classList.add('abierto');
  enfocar(conFoco ? $('#controles [data-inicial]') : null);
  clearTimeout(ocultarT);
  ocultarT = setTimeout(cerrarControles, dura);
}
function cerrarControles() {
  clearTimeout(ocultarT);
  $('#controles').classList.remove('abierto');
  enfocar(null);
  aExt({ park: true });
}
function accionVideo(a) {
  const abiertos = $('#controles').classList.contains('abierto') && foco;
  if (abiertos) {
    clearTimeout(ocultarT); ocultarT = setTimeout(cerrarControles, 10000);
    if (a === 'ok') return activar(foco);
    if (a === 'up' && !mover('up')) { cerrarControles(); return {}; }
    if (a !== 'up') mover(a);
    return {};
  }
  if (a === 'left' || a === 'right') return { media: 'seek', s: a === 'left' ? -10 : 10 };
  if (a === 'ok') return { media: 'play' };
  if (a === 'down' || a === 'up') { abrirControles(); return {}; }
  return {};
}
function enYouTube(id, t) {
  location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${t > 5 ? '&t=' + Math.floor(t) + 's' : ''}`;
}
function hacerVideo(acc, el) {
  const v = viendo;
  if (acc === 'siguiente-ya') { siguienteYa(); return {}; }
  if (acc === 'cancelar-siguiente') { cancelarSiguiente(); return {}; }
  if (!v) return {};
  if (acc === 'otro') { cambiarA(el.dataset.id); return {}; }
  if (acc === 'cc') { cerrarControles(); return { media: 'cc' }; }
  if (acc === 'a-canal') { if (v.info.canalId) irSinHistorial('#/canal/' + v.info.canalId); else toast('Todavía no sé de qué canal es'); return {}; }
  if (acc === 'fav-video') {
    alternarFavorito({ canalId: v.info.canalId, nombre: v.info.canal, avatar: v.info.avatar }).then(() => { pintarControles(); enfocar($('#controles [data-k="b:fav"]')); });
    return {};
  }
  if (acc === 'en-youtube') { guardarProgreso(); enYouTube(v.id, v.ultimo ? v.ultimo.t : 0); return {}; }
  return {};
}
// Otro video de la cola sin sumar una entrada al historial (Atrás vuelve a la lista)
function cambiarA(id) {
  if (viendo) cola = viendo.cola;
  history.replaceState(history.state, '', '#/ver/' + encodeURIComponent(id));
  render();
}

// ---------- Menú de opciones («clic derecho»: mantener OK en el celular) ----------
let menuDe = null, focoAntes = null;
const menuAbierto = () => $('#menu').classList.contains('abierto');
function abrirMenu() {
  let d = null;
  if (viendo) d = { ...viendo.info, id: viendo.id, enVideo: true };
  else if (foco && foco.isConnected && foco.dataset.vid) d = { ...(infoVideo.get(foco.dataset.vid) || { id: foco.dataset.vid }), el: foco };
  else if (foco && foco.isConnected && foco.dataset.canal) d = { canalId: foco.dataset.canal, canal: foco.dataset.nombre, avatar: foco.dataset.avatar, soloCanal: true, el: foco };
  if (!d) { toast('Elegí un video o un canal para ver sus opciones'); return {}; }
  menuDe = d;
  focoAntes = foco;
  const ops = [];
  const enSuCanal = ruta().nombre === 'canal' && ruta().p[1] === d.canalId;
  if (d.canalId && !enSuCanal) ops.push(['m-canal', d.soloCanal ? 'Ver el canal' : `Ir al canal${d.canal ? ' · ' + d.canal : ''}`]);
  if (d.canalId) ops.push(['m-fav', estado.canales[d.canalId] ? 'Quitar canal de favoritos' : '★ Canal favorito']);
  if (d.id && estado.viendo[d.id]) ops.push(['m-sv', 'Quitar de «Seguir viendo»']);
  if (d.id && !d.enVideo) ops.push(['m-yt', 'Abrir en YouTube']);
  ops.push(['m-cerrar', 'Cancelar']);
  $('#m-titulo').textContent = d.soloCanal ? d.canal : d.title || 'Video';
  $('#m-sub').textContent = d.soloCanal ? '' : d.canal || '';
  $('#m-opciones').innerHTML = ops.map(([acc, t], i) =>
    `<div data-fila="m${i}"><button class="boton ${i === 0 ? 'principal' : ''}" data-f data-accion="${acc}">${esc(t)}</button></div>`).join('');
  clearTimeout(ocultarT);
  $('#menu').classList.add('abierto');
  enfocar($('#m-opciones [data-f]'));
  return {};
}
function cerrarMenu(volver = true) {
  if (!menuAbierto()) return;
  $('#menu').classList.remove('abierto');
  if (volver) enfocar(focoAntes && focoAntes.isConnected && !viendo ? focoAntes : null);
  if (viendo) cerrarControles();
}
function refrescar(quitada) {
  if (viendo) { pintarControles(); return; }
  const el = menuDe && menuDe.el;
  let k = el && el.dataset.k, fl = el && filaDe(el) && filaDe(el).dataset.fila;
  if (quitada && el) {
    const todos = filaDe(el) ? [...filaDe(el).querySelectorAll('[data-f]')] : [];
    const i = todos.indexOf(el);
    const vecino = todos[i + 1] || todos[i - 1];
    if (vecino) k = vecino.dataset.k; else { k = null; fl = null; }
  }
  memo.set(location.hash || '#/', { k, fila: fl, y: scrollY });
  paginaActual = '';
  render();
}
function hacerMenu(acc) {
  const d = menuDe;
  if (!d) return {};
  if (acc === 'm-cerrar') { cerrarMenu(); return {}; }
  cerrarMenu(false);
  const fl = d.el && filaDe(d.el) && filaDe(d.el).dataset.fila;
  if (acc === 'm-canal') { if (viendo) irSinHistorial('#/canal/' + d.canalId); else irA('#/canal/' + d.canalId); return {}; }
  if (acc === 'm-fav') {
    alternarFavorito({ canalId: d.canalId, nombre: d.canal, avatar: d.avatar }).then((on) => refrescar(!on && fl === 'favs'));
    return {};
  }
  if (acc === 'm-sv') {
    guardar({ accion: 'quitar', id: d.id }).then(() => { toast('Quitado de «Seguir viendo»'); refrescar(fl === 'seguir'); });
    return {};
  }
  if (acc === 'm-yt') { enYouTube(d.id, (estado.viendo[d.id] || {}).t || 0); return {}; }
  return {};
}

function salirDelVideo(cambiando = false) {
  if (!viendo) return;
  guardarProgreso();
  viendo = null;
  clearTimeout(ocultarT); clearTimeout(siguienteT); clearTimeout(guardarT); guardarT = 0;
  $('#aviso').classList.remove('abierto');
  $('#controles').classList.remove('abierto');
  $('#reproductor').querySelectorAll('iframe').forEach((f) => f.remove());
  if (cambiando) return;
  document.body.classList.remove('viendo');
  if (winFull) { winFull = false; aExt({ winFull: false }); }
  aExt({ watch: false });
}

// El reproductor (dentro del iframe) avisa por la extensión cómo va: {t, d, paused, ended} o {error}
function progresoVideo(p) {
  const v = viendo;
  if (!v) return;
  if (p.error) {
    if (v.error) return;
    v.error = true;
    $('#cargando').style.display = '';
    $('#cargando').textContent = 'Este video no se puede ver acá: se abre en YouTube…';
    setTimeout(() => { if (viendo === v) enYouTube(v.id, v.desde); }, 2500);
    return;
  }
  if (p.d > 0 && p.t > 0 && !p.paused && !v.arranco) { v.arranco = true; $('#cargando').style.display = 'none'; }
  if (p.d > 0) v.ultimo = { t: p.t, d: p.d };
  if (!v.visto && terminado(p.t, p.d)) { v.visto = true; guardar({ accion: 'quitar', id: v.id }); }
  if (!guardarT) guardarT = setTimeout(() => { guardarT = 0; guardarProgreso(); }, 15000);
  if (p.ended) terminoVideo();
}
function guardarProgreso() {
  const v = viendo;
  if (!v || !v.ultimo || v.visto || v.info.vivo) return;
  const { t, d } = v.ultimo;
  if (t < 30 || terminado(t, d)) return; // recién empezado o ya visto: no va a «seguir viendo»
  guardar({ accion: 'progreso', id: v.id, title: v.info.title || '', canal: v.info.canal || '', canalId: v.info.canalId || '',
    t: Math.round(t), d: Math.round(d) });
}

// Recién al terminar de verdad (evento ended): aviso con cuenta regresiva y el siguiente solo
function terminoVideo() {
  const v = viendo;
  if (!v || v.terminado) return;
  v.terminado = true;
  const sig = siguienteDe(v);
  if (!sig) return;
  v.siguiente = sig;
  const info = infoVideo.get(sig);
  let falta = 10;
  $('#a-titulo').textContent = info ? info.title : 'Siguiente video';
  const tic = () => {
    $('#a-texto').textContent = `${info && info.canal ? info.canal + ' · ' : ''}Empieza en ${falta} s`;
    if (falta-- <= 0) { siguienteYa(); return; }
    siguienteT = setTimeout(tic, 1000);
  };
  $('#controles').classList.remove('abierto');
  $('#aviso').classList.add('abierto');
  enfocar($('#aviso [data-f]'));
  tic();
}
function siguienteYa() {
  clearTimeout(siguienteT);
  $('#aviso').classList.remove('abierto');
  if (viendo && viendo.siguiente) cambiarA(viendo.siguiente);
}
function cancelarSiguiente() {
  clearTimeout(siguienteT);
  $('#aviso').classList.remove('abierto');
  enfocar(null);
}

// ---------- Arranque ----------
(async () => {
  try { estado = await api('estado'); } catch { /* sin estado guardado */ }
  await Promise.race([saludo, sleep(1500)]); // con la extensión, YouTube se lee con la sesión
  render();
})();
