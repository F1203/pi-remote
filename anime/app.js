// Modo anime: animeav1 como una app de Smart TV. Los datos los trae el servidor (anime.py);
// la cruceta del celular llega por la extensión (tv.js le pasa cada acción a esta página con
// postMessage y esta página contesta qué hacer: {media}, {winFull}, {editable}).
// Sin la extensión también se maneja con el teclado (flechas, Enter, Escape/Retroceso).
'use strict';

const CDN = 'https://cdn.animeav1.com/';
const IMG = {
  portada: (id) => `${CDN}covers/${id}.jpg`,
  mini: (id) => `${CDN}thumbnails/${id}.jpg`,
  fondo: (id) => `${CDN}backdrops/${id}.jpg`,
  captura: (id, n) => `${CDN}screenshots/${id}/${n}.jpg`,
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

async function api(ruta, q = {}) {
  const r = await fetch('api/' + ruta + '?' + new URLSearchParams(q));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
const cache = new Map(); // datos ya pedidos en esta sesión (volver atrás es instantáneo)
async function apiC(ruta, q = {}) {
  const k = ruta + '?' + new URLSearchParams(q);
  if (!cache.has(k)) cache.set(k, api(ruta, q).catch((e) => { cache.delete(k); throw e; }));
  return cache.get(k);
}

let estado = { audio: 'SUB', lista: {}, viendo: {}, vistos: {}, servidor: '' };
async function guardar(q) {
  try { const r = await api('guardar', q); if (r.estado) estado = r.estado; } catch (e) { console.warn(e); }
  pintarAudio();
}

// ---------- Mensajes ----------
let toastT = 0;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = 'none'; }, 1600);
}
function reloj() {
  const d = new Date();
  $('#reloj').textContent = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}
setInterval(reloj, 10000); reloj();
function pintarAudio() { $('#b-audio').textContent = 'Audio: ' + estado.audio; }

// Imágenes que no existen (no todas las series tienen fondo o captura): probar la siguiente
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (img.tagName !== 'IMG') return;
  const alt = (img.dataset.alt || '').split('|').filter(Boolean);
  if (alt.length) { img.src = alt.shift(); img.dataset.alt = alt.join('|'); } else img.classList.add('sin-img');
}, true);

// ---------- Extensión (tv.js) ----------
let conExtension = false;
const aExt = (req) => window.postMessage({ pitvReq: req }, '*');
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data) return;
  const d = ev.data;
  if (d.pitvNav) {
    conExtension = true;
    let res = {};
    try { res = accion(d.pitvNav) || {}; } catch (e) { console.error(e); res = { ok: false }; }
    window.postMessage({ pitvRes: d.id, res }, '*');
  } else if (d.pitvEv) {
    conExtension = true;
    if (d.pitvEv.vprog) progresoVideo(d.pitvEv.vprog);
  }
});

// ---------- Foco y cruceta ----------
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
  // Fila horizontal: correrla para que la tarjeta quede a la vista
  const cont = foco.closest('.fila-items, .chips');
  if (cont) {
    const pad = cont.clientWidth * 0.06;
    const cr = cont.getBoundingClientRect(), fr = foco.getBoundingClientRect();
    const izq = fr.left - cr.left + cont.scrollLeft, der = izq + fr.width;
    if (izq - pad < cont.scrollLeft) cont.scrollTo({ left: Math.max(0, izq - pad * 2), behavior: suave ? 'smooth' : 'auto' });
    else if (der + pad > cont.scrollLeft + cont.clientWidth) cont.scrollTo({ left: der + pad - cont.clientWidth, behavior: suave ? 'smooth' : 'auto' });
  }
  if (viendo || (fila && fila.id === 'barra')) return;
  // Vertical: que se vea la fila entera (con su título); en las grillas, la tarjeta
  const bloque = fila && !fila.hasAttribute('data-grilla') && fila.getBoundingClientRect().height < innerHeight * 0.7
    ? (fila.closest('.fila') || fila) : foco;
  const r = bloque.getBoundingClientRect();
  const arriba = $('#barra').offsetHeight + 10;
  if (fila && fila.dataset.fila === 'hero') scrollTo({ top: 0, behavior: suave ? 'smooth' : 'auto' });
  else if (r.top < arriba) scrollBy({ top: r.top - arriba - 20, behavior: suave ? 'smooth' : 'auto' });
  else if (r.bottom > innerHeight - 20) scrollBy({ top: r.bottom - innerHeight + 40, behavior: suave ? 'smooth' : 'auto' });
}

// Cada elemento está en una "línea": una fila entera, o un renglón de una grilla
function linea(el) {
  const f = filaDe(el);
  if (!f) return 'suelto';
  if (f.hasAttribute('data-grilla')) return f.dataset.fila + ':' + Math.round(el.offsetTop / 8);
  return f.dataset.fila;
}
function mover(dir) {
  const items = focables();
  if (!items.length) return false;
  if (!foco || !items.includes(foco)) { enfocar(inicial() || items[0]); return true; }
  const barra = $('#barra');
  const enBarra = barra.contains(foco);
  if (enBarra && dir === 'down') {
    // De la barra al contenido: a lo último elegido, o a lo primero que se ve debajo de la barra
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
  // ↑/↓: la línea más cercana en esa dirección y, dentro de ella, lo que está más alineado
  const top = (el) => el.getBoundingClientRect().top;
  const grupos = new Map();
  for (const el of items.filter((x) => enBarra || !barra.contains(x))) {
    const k = linea(el);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(el);
  }
  const lineas = [...grupos.entries()].map(([k, els]) => ({ k, els, y: Math.min(...els.map(top)) }))
    .sort((a, b) => a.y - b.y);
  const i = lineas.findIndex((x) => x.k === l) + (dir === 'down' ? 1 : -1);
  const dest = lineas[i];
  if (!dest) return false;
  const a = foco.getBoundingClientRect();
  // Desde algo muy ancho (el buscador, la portada) se entra por el primero de la izquierda
  const cx = a.width > innerWidth * 0.5 ? 0 : a.left + a.width / 2;
  const enVista = dest.els.filter((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; });
  const recordado = memoFila.get(dest.k);
  let el;
  const activo = dest.els.find((x) => x.classList.contains('activo'));
  if (recordado && enVista.includes(recordado) && filaDe(recordado) && !filaDe(recordado).hasAttribute('data-grilla')) el = recordado;
  else if (activo && filaDe(activo).classList.contains('chips')) el = activo; // en los filtros, el elegido
  else el = (enVista.length ? enVista : dest.els).reduce((best, x) => {
    const r = x.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx);
    return !best || d < best.d ? { x, d } : best;
  }, null).x;
  memoFila.set(l, foco);
  enfocar(el);
  return true;
}
const memoFila = new Map(); // última tarjeta elegida en cada fila (al volver a la fila, la misma)

function activar(el) {
  if (!el) return {};
  if (el.tagName === 'INPUT') { el.focus(); el.select(); return { editable: true }; }
  if (el.dataset.ir) { irA(el.dataset.ir); return {}; }
  if (el.dataset.accion) return hacer(el.dataset.accion, el) || {};
  return {};
}

// Acciones de la cruceta y de los botones del celular. Devuelve lo que tiene que hacer la extensión.
function accion(a) {
  const enInput = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (['play', 'rw5', 'ff5', 'cc', 'full'].includes(a)) {
    if (!viendo) return { ok: false };
    if (a === 'full') return pantallaCompleta(!winFull);
    if (a === 'play') return { media: 'play' };
    if (a === 'cc') return { media: 'cc' };
    return { media: 'seek', s: a === 'rw5' ? -5 : 5 };
  }
  if (menuAbierto()) {
    if (a === 'menu' || a === 'back') { cerrarMenu(); return {}; }
    if (a === 'ok') return activar(foco);
    if (['up', 'down', 'left', 'right'].includes(a)) { mover(a); return {}; }
    cerrarMenu(); // otra cosa (Inicio, Buscar…): cerrar el menú y seguir
  }
  if (a === 'menu') return abrirMenu();
  if (a === 'home' || a === 'anime') { if (ruta().nombre === 'inicio' && !viendo) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); } else irA('#/'); return {}; }
  if (a === 'search') { irA('#/buscar'); return { editable: true }; }
  if (a === 'horario' || a === 'catalogo' || a === 'lista') { irA('#/' + a); return {}; }
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
    return {}; // ←/→ dentro del texto
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
  if (viendo) { if (pasos()) volver(); else irDeVideoASerie(); return {}; }
  if (ruta().nombre === 'inicio') {
    // En el inicio: subir y, si ya está arriba, no hacer nada (para salir: botón YouTube)
    if (scrollY > 10 || (foco && filaDe(foco) && filaDe(foco).dataset.fila !== 'hero')) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); }
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

// Teclado de verdad (sin extensión, o al probar con un teclado)
document.addEventListener('keydown', (ev) => {
  const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back', ContextMenu: 'menu' }[ev.key]
    || ((ev.key === 'm' || ev.key === 'M') && document.activeElement.tagName !== 'INPUT' ? 'menu' : null)
    || (ev.key === 'Backspace' && document.activeElement.tagName !== 'INPUT' ? 'back' : null)
    || (ev.key === 'ArrowLeft' && ev.altKey ? 'back' : null);
  if (!k) return;
  const enInput = document.activeElement.tagName === 'INPUT';
  if (enInput && (k === 'left' || k === 'right')) return;
  ev.preventDefault();
  if (ev.altKey && ev.key === 'ArrowLeft') { accion('back'); return; }
  const res = accion(k);
  if (res && res.media === 'seek') toast('Usá el control del reproductor');
}, true);
// Mouse / trackpad: un clic hace lo mismo que OK
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-f]');
  if (!el) return;
  ev.preventDefault();
  enfocar(el);
  activar(el);
});

// Clic derecho (trackpad): el menú de opciones de esa tarjeta
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
const memo = new Map(); // foco y scroll de cada página, para volver al mismo lugar
let paginaActual = '';
window.addEventListener('hashchange', render);

async function render() {
  if (paginaActual && foco && !viendo) memo.set(paginaActual, { k: foco.dataset.k, fila: (filaDe(foco) || {}).dataset?.fila, y: scrollY });
  const r = ruta();
  const h = location.hash || '#/';
  if (r.nombre === 'ver' && paginaActual && !paginaActual.startsWith('#/ver/')) vinoDe = paginaActual;
  paginaActual = h;
  cerrarMenu();
  if (r.nombre === 'ver') { await ver(r.p[1], r.p[2]); return; }
  salirDelVideo();
  document.querySelectorAll('#barra .menu').forEach((b) => b.classList.toggle('activo', b.dataset.ir === '#/' + (r.nombre === 'inicio' ? '' : r.nombre)));
  const pant = $('#pantalla');
  pant.innerHTML = '<div class="estado">Cargando…</div>';
  enfocar(null);
  try {
    const pagina = { inicio: pInicio, serie: pSerie, catalogo: pCatalogo, horario: pHorario, buscar: pBuscar, lista: pLista }[r.nombre] || pInicio;
    await pagina(pant, r);
  } catch (e) {
    if (paginaActual !== h) return;
    pant.innerHTML = `<div class="estado">${esc(e.message)}<div class="botones" data-fila="error">
      <button class="boton principal" data-f data-k="reintentar" data-accion="reintentar">Reintentar</button></div></div>`;
  }
  if (paginaActual !== h) return; // ya se fue a otra página mientras cargaba
  const m = memo.get(h);
  // La misma tarjeta, en la misma fila si está (una serie puede estar en varias filas)
  const el = m && m.k && ((m.fila && document.querySelector(`#pantalla [data-fila="${CSS.escape(m.fila)}"] [data-k="${CSS.escape(m.k)}"]`))
    || document.querySelector(`#pantalla [data-k="${CSS.escape(m.k)}"]`));
  if (el) { scrollTo({ top: m.y }); enfocar(el, { suave: false }); } else { scrollTo({ top: 0 }); enfocar(inicial(), { suave: false }); }
}
function inicial() {
  return $('#pantalla [data-inicial]') || $('#pantalla [data-f]') || $('#barra [data-f]');
}

// ---------- Tarjetas ----------
function tPortada(s, { sub = '', insignia = '' } = {}) {
  return `<div class="tarjeta" data-f data-k="s:${esc(s.slug)}" data-ir="#/serie/${esc(s.slug)}" ${datosSerie(s)}>
    <div class="img"><img loading="lazy" src="${IMG.portada(s.id)}" data-alt="${IMG.mini(s.id)}" alt="">
    ${insignia ? `<span class="insignia">${esc(insignia)}</span>` : ''}</div>
    <div class="titulo ${sub ? 'con-sub' : ''}">${esc(s.title)}</div>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
}
function tEpisodio(s, n, { titulo, sub = '', k, progreso, visto, inicialAttr = '', ir } = {}) {
  return `<div class="tarjeta ancha" data-f ${inicialAttr} data-k="${esc(k || `e:${s.slug}:${n}`)}" data-ir="${esc(ir || `#/ver/${s.slug}/${n}`)}" ${datosSerie(s)} data-ep="${esc(n)}">
    <div class="img"><img loading="lazy" src="${IMG.captura(s.id, n)}" data-alt="${IMG.mini(s.id)}|${IMG.fondo(s.id)}" alt="">
    <span class="insignia">Ep ${n}</span>${visto ? '<span class="insignia visto">✓</span>' : ''}
    ${progreso ? `<div class="progreso"><i style="width:${Math.round(progreso * 100)}%"></i></div>` : ''}</div>
    <div class="titulo ${sub ? 'con-sub' : ''}">${esc(titulo ?? s.title)}</div>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
}
const datosSerie = (s) => `data-serie="${esc(s.slug)}" data-id="${esc(s.id)}" data-title="${esc(s.title)}"`;
function fila(id, titulo, html, extra = '') {
  return html ? `<section class="fila"><h2>${titulo}${extra}</h2><div class="fila-items" data-fila="${id}">${html}</div></section>` : '';
}

// Un episodio está visto si solo falta el ending: 2½ minutos o menos (en los episodios cortos,
// de menos de 15 minutos, el último 10 %)
const FINAL = 150;
function terminado(t, d) {
  return d > 0 && d - t <= (d >= 900 ? FINAL : d * 0.1);
}

// Lo que conviene ver de una serie: el episodio a medias o el siguiente al último visto
function proximo(slug, episodios) {
  const v = estado.viendo[slug];
  if (!v) return null;
  if (!terminado(v.t, v.d)) return { ep: v.ep, t: v.t, d: v.d };
  if (episodios) {
    const sig = episodios.find((n) => n > v.ep);
    return sig !== undefined ? { ep: sig, t: 0, d: 0 } : null;
  }
  return { ep: v.ep, t: v.t, d: v.d, terminado: true };
}
// «Seguir viendo»: el episodio a medias o, si ya se terminó (solo quedaba el ending), el siguiente
// desde el principio. Si no hay siguiente todavía (al día), la serie no aparece.
async function seguirViendo() {
  const items = Object.entries(estado.viendo).sort((a, b) => b[1].fecha - a[1].fecha).slice(0, 20);
  const out = await Promise.all(items.map(async ([slug, v]) => {
    const s = { slug, id: v.id, title: v.title };
    if (!terminado(v.t, v.d)) return { s, ep: v.ep, t: v.t, d: v.d };
    const serie = await apiC('serie', { slug }).catch(() => null);
    const sig = serie && serie.episodes.find((n) => n > v.ep);
    return sig !== undefined && serie ? { s, ep: sig, t: 0, d: 0, siguiente: true } : null;
  }));
  return out.filter(Boolean);
}
const tSeguir = (x) => tEpisodio(x.s, x.ep, {
  k: `sv:${x.s.slug}`, titulo: x.s.title, progreso: x.d ? x.t / x.d : 0,
  sub: x.siguiente ? 'Siguiente episodio' : x.t ? `Quedó en ${mmss(x.t)}` : '',
});

// ---------- Páginas ----------
async function pInicio(pant) {
  const d = await apiC('inicio');
  const dest = d.destacados[0] || d.nuevos[0];
  const enLista = dest && estado.lista[dest.slug];
  let html = '';
  if (dest) {
    html += `<section class="hero"><img class="fondo" src="${IMG.fondo(dest.id)}" data-alt="${IMG.mini(dest.id)}" alt="">
      <div class="etiquetas"><span>Destacado</span>${dest.cat ? `<span>${esc(dest.cat)}</span>` : ''}${(dest.genres || []).slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join('')}</div>
      <h1>${esc(dest.title)}</h1><p>${esc(dest.synopsis)}</p>
      <div class="botones" data-fila="hero">
        <button class="boton principal" data-f data-inicial data-k="h:ver" data-ir="#/serie/${esc(dest.slug)}">▶ Ver serie</button>
        <button class="boton ${enLista ? 'marcado' : ''}" data-f data-k="h:lista" data-accion="lista" data-slug="${esc(dest.slug)}" data-id="${dest.id}" data-title="${esc(dest.title)}">${enLista ? '✓ En mi lista' : '+ Mi lista'}</button>
      </div></section>`;
  }
  const sv = (await seguirViendo()).map(tSeguir).join('');
  html += fila('seguir', 'Seguir viendo', sv);
  html += fila('ultimos', 'Últimos episodios', d.episodios.map((e) => tEpisodio(e, e.ep, {
    k: `u:${e.slug}:${e.ep}`, visto: (estado.vistos[e.slug] || []).includes(e.ep),
  })).join(''));
  const ml = await miListaPorDia().catch(() => null);
  html += ml ? fila('lista', 'Mi lista', ml.html, ml.extra) : '';
  html += fila('nuevos', 'Recién agregados', d.nuevos.map((s) => tPortada(s, { sub: s.cat })).join(''));
  html += '<div id="mas-filas"></div>';
  pant.innerHTML = html;
  // Más filas sin esperar (si fallan, no se muestran)
  const mas = [['emision', 'En emisión', { status: 'emision' }], ['populares', 'Más populares', { order: 'popular' }],
    ['puntuados', 'Mejor puntuados', { order: 'score' }]];
  const hash = location.hash;
  const filas = await Promise.all(mas.map(([id, t, q]) => apiC('catalogo', q)
    .then((c) => fila(id, t, c.results.map((s) => tPortada(s, { sub: s.cat })).join(''))).catch(() => '')));
  if (location.hash === hash && $('#mas-filas')) $('#mas-filas').outerHTML = filas.join('');
}

async function pSerie(pant, r) {
  const slug = r.p[1];
  const s = await apiC('serie', { slug });
  const eps = s.episodes;
  const vistos = new Set(estado.vistos[slug] || []);
  const prox = proximo(slug, eps);
  const enLista = estado.lista[slug];
  const primero = eps[0];
  let boton;
  if (prox && !prox.terminado) boton = prox.t > 30 ? `▶ Continuar ep ${prox.ep} (${mmss(prox.t)})` : `▶ Ver episodio ${prox.ep}`;
  else if (primero !== undefined) boton = `▶ Ver episodio ${primero}`;
  const epBoton = prox && !prox.terminado ? prox.ep : primero;
  // Series largas: los episodios de a 50 (una fila de rangos para elegir)
  const BLOQUE = 50;
  const bloques = [];
  for (let i = 0; i < eps.length; i += BLOQUE) bloques.push(eps.slice(i, i + BLOQUE));
  const elegido = Math.max(0, bloques.findIndex((b) => b.includes(epBoton)));
  const rq = r.q.b !== undefined ? Math.min(+r.q.b, bloques.length - 1) : elegido;
  pant.innerHTML = `<section class="detalle"><img class="fondo" src="${IMG.fondo(s.id)}" data-alt="${IMG.mini(s.id)}" alt="">
      <img class="poster" src="${IMG.portada(s.id)}" alt="">
      <div><h1>${esc(s.title)}</h1>
      <div class="etiquetas">${[s.cat, s.year, s.status, eps.length ? eps.length + ' episodios' : '', s.score ? '★ ' + s.score : '']
        .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      <div class="etiquetas">${s.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>
      <p class="sinopsis">${esc(s.synopsis)}</p>
      <div class="botones" data-fila="acciones">
        ${boton ? `<button class="boton principal" data-f data-inicial data-k="a:ver" data-ir="#/ver/${esc(slug)}/${epBoton}">${esc(boton)}</button>` : ''}
        <button class="boton ${enLista ? 'marcado' : ''}" data-f data-k="a:lista" data-accion="lista" data-slug="${esc(slug)}" data-id="${s.id}" data-title="${esc(s.title)}">${enLista ? '✓ En mi lista' : '+ Mi lista'}</button>
        ${estado.viendo[slug] ? `<button class="boton" data-f data-k="a:quitar" data-accion="quitar" data-slug="${esc(slug)}">Quitar de «Seguir viendo»</button>` : ''}
      </div></div></section>
    ${bloques.length > 1 ? `<div class="chips" data-fila="bloques">${bloques.map((b, i) =>
      `<button class="chip ${i === rq ? 'activo' : ''}" data-f data-k="b:${i}" data-accion="bloque" data-b="${i}">${b[0]}–${b[b.length - 1]}</button>`).join('')}</div>` : ''}
    <section class="fila"><h2>Episodios</h2><div class="grilla ancha" data-fila="eps" data-grilla>
      ${(bloques[rq] || []).map((n) => {
        const v = estado.viendo[slug];
        const p = v && v.ep === n && v.d ? v.t / v.d : 0;
        return tEpisodio(s, n, { titulo: `Episodio ${n}`, visto: vistos.has(n), progreso: p });
      }).join('') || '<div class="vacio">Todavía no hay episodios.</div>'}
    </div></section>
    ${fila('rel', 'Relacionados', s.relations.map((x) => tPortada(x)).join(''))}`;
}

const ORDENES = [['', 'Destacados'], ['popular', 'Populares'], ['score', 'Puntuación'], ['latest_added', 'Recientes'], ['title', 'A–Z']];
const TIPOS = [['', 'Todos'], ['tv-anime', 'TV'], ['pelicula', 'Películas'], ['ova', 'OVA'], ['especial', 'Especiales'], ['ona', 'ONA']];
const ESTADOS = [['', 'Todos'], ['emision', 'En emisión'], ['finalizado', 'Finalizados'], ['proximamente', 'Próximamente']];
const GENEROS = [['', 'Todos'], ...'accion:Acción aventura:Aventura ciencia-ficcion:Ciencia ficción comedia:Comedia deportes:Deportes drama:Drama fantasia:Fantasía misterio:Misterio recuentos-de-la-vida:Recuentos de la vida romance:Romance seinen:Seinen shoujo:Shoujo shounen:Shounen sobrenatural:Sobrenatural suspenso:Suspenso terror:Terror isekai:Isekai mecha:Mecha escolares:Escolares psicologico:Psicológico superpoderes:Superpoderes artes-marciales:Artes marciales historico:Histórico militar:Militar musica:Música gore:Gore harem:Harem ecchi:Ecchi josei:Josei mahou-shoujo:Mahou shoujo vampiros:Vampiros samurai:Samurái detectives:Detectives espacial:Espacial gourmet:Gourmet infantil:Infantil parodia:Parodia mitologia:Mitología'
  .split(' ').reduce((acc, x) => { if (x.includes(':')) acc.push(x.split(':')); else acc[acc.length - 1][1] += ' ' + x; return acc; }, [])];

let catalogo = null; // {q, page, pages, cargando}
async function pCatalogo(pant, r) {
  const q = { order: r.q.order || '', category: r.q.category || '', status: r.q.status || '', genre: r.q.genre || '' };
  const filtro = (clave, titulo, ops) => `<div class="filtro"><b>${titulo}</b><div class="chips" data-fila="f-${clave}">${ops.map(([v, t]) =>
    `<button class="chip ${q[clave] === v ? 'activo' : ''}" data-f ${q[clave] === v && clave === 'order' ? 'data-inicial' : ''} data-k="f:${clave}:${v}" data-accion="filtro" data-clave="${clave}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>`;
  const qq = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
  const c = await apiC('catalogo', qq);
  catalogo = { q: qq, page: c.page, pages: c.pages, cargando: false };
  pant.innerHTML = filtro('order', 'Orden', ORDENES) + filtro('category', 'Tipo', TIPOS) + filtro('status', 'Estado', ESTADOS)
    + filtro('genre', 'Género', GENEROS)
    + `<section class="fila"><h2>Catálogo<small>${c.total} series</small></h2>
       <div class="grilla" data-fila="cat" data-grilla id="cat">${c.results.map((s) => tPortada(s, { sub: s.cat })).join('')
       || '<div class="vacio">No hay resultados con estos filtros.</div>'}</div></section>`;
}
// En el catálogo, al llegar cerca del final, traer la página siguiente
async function masCatalogo() {
  if (!catalogo || catalogo.cargando || catalogo.page >= catalogo.pages || ruta().nombre !== 'catalogo') return;
  catalogo.cargando = true;
  const hash = location.hash;
  try {
    const c = await apiC('catalogo', { ...catalogo.q, page: catalogo.page + 1 });
    if (location.hash !== hash) return;
    catalogo.page = c.page;
    $('#cat').insertAdjacentHTML('beforeend', c.results.map((s) => tPortada(s, { sub: s.cat })).join(''));
  } catch { toast('No se pudo cargar más'); } finally { catalogo.cargando = false; }
}

async function pHorario(pant) {
  const d = await apiC('horario');
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const hoy = new Date().getDay();
  const porDia = DIAS.map(() => []);
  for (const m of d.media) {
    const f = m.fecha ? new Date(m.fecha) : null;
    if (f && !isNaN(f)) porDia[f.getDay()].push({ ...m, f });
  }
  let html = '';
  for (let i = 0; i < 7; i++) {
    const dia = (hoy - i + 7) % 7; // hoy primero, después los días anteriores (lo que salió hace poco)
    const items = porDia[dia].filter((m) => m.ep != null).sort((a, b) => b.f - a.f);
    const nombre = i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : DIAS[dia];
    html += fila('d' + dia, nombre, items.map((m) => {
      const s = { ...m };
      return tEpisodio(s, m.ep, { k: `hz:${m.slug}`, sub: m.f.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + ' · ' + (m.cat || ''),
        visto: (estado.vistos[m.slug] || []).includes(m.ep) });
    }).join(''), `<small>${items.length} ${items.length === 1 ? 'serie' : 'series'}</small>`);
  }
  pant.innerHTML = html || '<div class="vacio">No hay horario.</div>';
  const primero = $('#pantalla .tarjeta');
  if (primero) primero.setAttribute('data-inicial', '');
}

let busquedaT = 0, ultimaBusqueda = '';
async function pBuscar(pant, r) {
  pant.innerHTML = `<div class="buscador" data-fila="buscar"><input id="q" data-f data-inicial data-k="q" type="search"
      placeholder="Buscar anime…" autocomplete="off" value="${esc(r.q.q || '')}">
      <p>Escribí con el teclado del celular. OK busca; ↓ baja a los resultados.</p></div>
    <section class="fila"><h2 id="r-titulo"></h2><div class="grilla" data-fila="res" data-grilla id="res"></div></section>`;
  const inp = $('#q');
  inp.addEventListener('input', () => { clearTimeout(busquedaT); busquedaT = setTimeout(buscarYa, 600); });
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
  if (!t) { $('#res').innerHTML = ''; $('#r-titulo').textContent = ''; return; }
  $('#r-titulo').textContent = 'Buscando…';
  try {
    const c = await apiC('catalogo', { search: t });
    if (ultimaBusqueda !== t) return;
    $('#r-titulo').textContent = c.total ? `${c.total} resultado${c.total === 1 ? '' : 's'}` : 'Sin resultados';
    $('#res').innerHTML = c.results.map((s) => tPortada(s, { sub: s.cat })).join('');
  } catch (e) { $('#r-titulo').textContent = e.message; }
}

// Mi lista ordenada por día de emisión: las series en emisión agrupadas por día de la semana (desde
// hoy), cada grupo con una llave que dice el día; después las próximas y las que ya terminaron.
// El día sale del último episodio publicado (lo que trae el horario de animeav1).
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
async function miListaPorDia() {
  const lista = Object.entries(estado.lista).map(([slug, v]) => ({ slug, id: v.id, title: v.title, fecha: v.fecha }));
  if (!lista.length) return null;
  const hz = await apiC('horario').catch(() => ({ media: [] }));
  const enHorario = new Map(hz.media.map((m) => [m.slug, m]));
  const hoy = new Date().getDay();
  const porDia = DIAS.map(() => []), resto = [];
  for (const s of lista) {
    const m = enHorario.get(s.slug);
    const f = m && m.fecha ? new Date(m.fecha) : null;
    if (f && !isNaN(f)) porDia[f.getDay()].push({ ...s, ep: m.ep, f });
    else resto.push(s);
  }
  // Las que no están en el horario: próximamente o terminadas (según la serie)
  const estados = await Promise.all(resto.map((s) => apiC('serie', { slug: s.slug }).then((x) => x.status).catch(() => '')));
  const proximas = resto.filter((_, i) => estados[i] === 'Próximamente');
  const terminadas = resto.filter((_, i) => estados[i] !== 'Próximamente');
  const grupo = (titulo, items, clase = '') => `<div class="grupo ${clase}"><div class="llave"><span>${esc(titulo)}</span></div>
    <div class="grupo-items">${items.join('')}</div></div>`;
  const grupos = [];
  for (let i = 0; i < 7; i++) {
    const dia = (hoy + i) % 7;
    const items = porDia[dia].sort((a, b) => (a.f.getHours() * 60 + a.f.getMinutes()) - (b.f.getHours() * 60 + b.f.getMinutes()));
    if (!items.length) continue;
    const nombre = i === 0 ? `Hoy · ${DIAS[dia]}` : i === 1 ? `Mañana · ${DIAS[dia]}` : DIAS[dia];
    grupos.push(grupo(nombre, items.map((s) => {
      const nuevo = s.ep != null && !(estado.vistos[s.slug] || []).includes(s.ep);
      return tPortada(s, { insignia: s.ep != null ? `Ep ${s.ep}${nuevo ? ' · nuevo' : ''}` : '' });
    }), i === 0 ? 'hoy' : ''));
  }
  if (proximas.length) grupos.push(grupo('Próximamente', proximas.map((s) => tPortada(s)), 'aparte'));
  if (terminadas.length) grupos.push(grupo('Ya no se emiten', terminadas.sort((a, b) => b.fecha - a.fecha).map((s) => tPortada(s)), 'aparte'));
  const enEmision = porDia.reduce((n, d) => n + d.length, 0);
  return { html: grupos.join(''), extra: `<small>${enEmision} en emisión · ${resto.length} aparte</small>` };
}

async function pLista(pant) {
  const [sv, ml] = await Promise.all([seguirViendo(), miListaPorDia()]);
  pant.innerHTML = `${ml ? fila('lista', 'Mi lista', ml.html, ml.extra)
      : '<section class="fila"><h2>Mi lista</h2><div class="vacio">Todavía no agregaste nada. Mantené OK sobre una serie y elegí «+ Agregar a mi lista».</div></section>'}
    ${sv.length ? `<section class="fila"><h2>Seguir viendo</h2><div class="grilla ancha" data-fila="sv" data-grilla>
      ${sv.map(tSeguir).join('')}</div></section>` : ''}`;
}

// ---------- Botones ----------
function hacer(acc, el) {
  if (acc.startsWith('m-')) return hacerMenu(acc);
  if (acc === 'reintentar') { cache.clear(); render(); return {}; }
  if (acc === 'youtube') { location.href = '../youtube/'; return {}; }
  if (acc === 'audio') {
    guardar({ accion: 'audio', v: estado.audio === 'SUB' ? 'DUB' : 'SUB' }).then(() => toast('Audio preferido: ' + (estado.audio === 'SUB' ? 'japonés con subtítulos' : 'doblado')));
    return {};
  }
  if (acc === 'lista') {
    const on = !estado.lista[el.dataset.slug];
    guardar({ accion: 'lista', slug: el.dataset.slug, id: el.dataset.id, title: el.dataset.title, on: on ? 1 : 0 }).then(() => {
      el.classList.toggle('marcado', on);
      el.textContent = on ? '✓ En mi lista' : '+ Mi lista';
      toast(on ? 'Agregado a mi lista' : 'Quitado de mi lista');
    });
    return {};
  }
  if (acc === 'quitar') { guardar({ accion: 'quitar', slug: el.dataset.slug }).then(() => { toast('Quitado de «Seguir viendo»'); render(); }); return {}; }
  if (acc === 'bloque') {
    const r = ruta();
    history.replaceState(history.state, '', `#/serie/${encodeURIComponent(r.p[1])}?b=${el.dataset.b}`);
    memo.set(location.hash, { k: el.dataset.k, y: scrollY });
    paginaActual = '';
    render();
    return {};
  }
  if (acc === 'filtro') {
    const q = { ...ruta().q, [el.dataset.clave]: el.dataset.v };
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
    history.replaceState(history.state, '', '#/catalogo' + (qs ? '?' + qs : ''));
    memo.set(location.hash, { k: el.dataset.k, y: scrollY });
    paginaActual = '';
    render();
    return {};
  }
  return hacerVideo(acc, el);
}

// ---------- Reproductor ----------
let viendo = null;   // {slug, ep, serie, embeds, audio, servidor, ...}
let winFull = false;
let ocultarT = 0, siguienteT = 0, guardarT = 0;

function pantallaCompleta(on) {
  winFull = on;
  return { winFull: on };
}
function elegirServidor(lista, preferido) {
  return lista.find((x) => x.server === preferido) || lista.find((x) => x.server === 'HLS') || lista[0];
}

async function ver(slug, n) {
  const ep = isNaN(+n) ? n : +n;
  if (viendo && viendo.slug === slug && viendo.ep === ep) return;
  salirDelVideo(true);
  document.body.classList.add('viendo');
  $('#cargando').textContent = 'Cargando…';
  $('#cargando').style.display = '';
  enfocar(null);
  const v = viendo = { slug, ep, inicio: Date.now(), reanudado: false, visto: false, ultimo: null };
  if (!winFull) { winFull = true; aExt({ winFull: true }); }
  aExt({ watch: true });
  try {
    const [serie, epi] = await Promise.all([apiC('serie', { slug }), api('episodio', { slug, n: ep })]);
    if (viendo !== v) return;
    v.serie = serie; v.embeds = epi.embeds;
    const audios = Object.keys(epi.embeds).filter((k) => epi.embeds[k].length);
    if (!audios.length) throw new Error('Este episodio no tiene reproductores.');
    v.audio = audios.includes(estado.audio) ? estado.audio : audios[0];
    if (v.audio !== estado.audio) toast(`Sin ${estado.audio}: ${v.audio === 'DUB' ? 'doblado' : 'subtitulado'}`);
    const guardado = estado.viendo[slug];
    v.desde = guardado && guardado.ep === ep && guardado.t > 20 && !terminado(guardado.t, guardado.d) ? guardado.t : 0;
    cargarServidor(elegirServidor(epi.embeds[v.audio], estado.servidor));
    // Que figure en «seguir viendo» aunque no llegue el progreso
    guardar({ accion: 'progreso', slug, id: serie.id, title: serie.title, ep, t: v.desde, d: guardado && guardado.ep === ep ? guardado.d : 0 });
  } catch (e) {
    if (viendo !== v) return;
    $('#cargando').textContent = e.message;
    abrirControles();
  }
}

function cargarServidor(srv) {
  const v = viendo;
  v.servidor = srv.server;
  v.arranco = false;
  const rep = $('#reproductor');
  rep.querySelectorAll('iframe').forEach((f) => f.remove());
  const f = document.createElement('iframe');
  f.src = srv.url;
  f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'origin';
  // Los servidores con publicidad no pueden abrir ventanas nuevas (HLS no tiene)
  if (srv.server !== 'HLS') f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  rep.insertBefore(f, rep.firstChild);
  f.addEventListener('load', () => { if (viendo === v) $('#cargando').style.display = 'none'; }, { once: true });
  pintarControles();
  abrirControles(false, 5000);
  // Darle play cuando ya cargó (la extensión hace un clic real si el reproductor lo pide)
  const intento = v.intento = Symbol('play');
  (async () => {
    await sleep(3000);
    if (viendo !== v || v.intento !== intento) return;
    if (!v.arranco) aExt({ autoplay: true });
    await sleep(6000);
    if (viendo === v && v.intento === intento && !v.arranco) {
      aExt({ autoplay: true });
      if (conExtension) toast('Si no arranca: ↓ y elegí otro servidor');
    }
  })();
}

function pintarControles() {
  const v = viendo;
  if (!v) return;
  const s = v.serie;
  const eps = s ? s.episodes : [];
  const i = eps.indexOf(v.ep);
  $('#c-titulo').textContent = s ? `${s.title} — Episodio ${v.ep}` : `Episodio ${v.ep}`;
  $('#c-ayuda').textContent = 'Con el panel cerrado: ←/→ 10 s · OK pausa · ↑ o Atrás: cerrar este panel';
  const b = ['<button class="boton principal" data-f data-inicial data-accion="a-serie">☰ Episodios</button>'];
  if (i > 0) b.push(`<button class="boton" data-f data-accion="ep" data-n="${eps[i - 1]}">⏮ Ep ${eps[i - 1]}</button>`);
  if (i >= 0 && i < eps.length - 1) b.push(`<button class="boton" data-f data-accion="ep" data-n="${eps[i + 1]}">Ep ${eps[i + 1]} ⏭</button>`);
  if (v.embeds) {
    const audios = Object.keys(v.embeds).filter((k) => v.embeds[k].length);
    if (audios.length > 1) b.push('<span class="sep"></span>' + audios.map((a) =>
      `<button class="boton ${a === v.audio ? 'activo' : ''}" data-f data-accion="audio-ep" data-v="${a}">${a === 'SUB' ? 'Subtitulado' : 'Doblado'}</button>`).join(''));
    b.push('<span class="sep"></span>' + (v.embeds[v.audio] || []).map((x, j) =>
      `<button class="boton ${x.server === v.servidor ? 'activo' : ''}" data-f data-accion="srv" data-j="${j}">${esc(x.server)}</button>`).join(''));
  }
  $('#c-botones').innerHTML = b.join('');
}

function abrirControles(conFoco = true, dura = 10000) {
  $('#controles').classList.add('abierto');
  if (conFoco) enfocar($('#controles .activo[data-accion="srv"]') && foco && foco.dataset.accion === 'srv' ? foco : $('#controles [data-inicial]'));
  else enfocar(null);
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

function hacerVideo(acc, el) {
  const v = viendo;
  if (acc === 'siguiente-ya') { siguienteYa(); return {}; }
  if (acc === 'cancelar-siguiente') { cancelarSiguiente(); return {}; }
  if (!v) return {};
  if (acc === 'ep') { history.replaceState(history.state, '', `#/ver/${encodeURIComponent(v.slug)}/${el.dataset.n}`); render(); return {}; }
  if (acc === 'a-serie') { irDeVideoASerie(); return {}; }
  if (acc === 'audio-ep') {
    v.audio = el.dataset.v;
    cargarServidor(elegirServidor(v.embeds[v.audio], v.servidor));
    abrirControles();
    return {};
  }
  if (acc === 'srv') {
    const srv = v.embeds[v.audio][+el.dataset.j];
    if (srv) { estado.servidor = srv.server; guardar({ accion: 'servidor', v: srv.server }); cargarServidor(srv); toast('Servidor: ' + srv.server); }
    enfocar($(`#controles [data-accion="srv"][data-j="${el.dataset.j}"]`));
    return {};
  }
  return {};
}
function irDeVideoASerie() {
  const v = viendo;
  if (!v) return;
  const h = `#/serie/${encodeURIComponent(v.slug)}`;
  // Si se llegó desde esa misma serie, volver atrás (queda en el episodio elegido);
  // si no (seguir viendo, últimos, horario…), cambiar el video por la página de la serie
  if (pasos() && vinoDe && vinoDe.split('?')[0] === h) volver(); else { history.replaceState(history.state, '', h); render(); }
}
let vinoDe = ''; // página desde la que se abrió el episodio

// ---------- Menú de opciones («clic derecho»: mantener OK en el celular) ----------
let menuDe = null;   // la serie sobre la que se abrió
let focoAntes = null;
const menuAbierto = () => $('#menu').classList.contains('abierto');
function abrirMenu() {
  let d = null;
  if (viendo && viendo.serie) d = { slug: viendo.slug, id: viendo.serie.id, title: viendo.serie.title, ep: viendo.ep, enVideo: true };
  else if (foco && foco.isConnected && foco.dataset.serie) d = { slug: foco.dataset.serie, id: foco.dataset.id, title: foco.dataset.title, ep: foco.dataset.ep, el: foco };
  else if (ruta().nombre === 'serie' && $('#pantalla [data-accion="lista"]')) {
    const b = $('#pantalla [data-accion="lista"]');
    d = { slug: b.dataset.slug, id: b.dataset.id, title: b.dataset.title };
  }
  if (!d) { toast('Elegí una serie para ver sus opciones'); return {}; }
  menuDe = d;
  focoAntes = foco;
  const ops = [];
  const enSuSerie = ruta().nombre === 'serie' && ruta().p[1] === d.slug;
  if (!enSuSerie) ops.push(['m-serie', d.enVideo ? 'Ir a los episodios' : 'Ir a la serie']);
  ops.push(estado.lista[d.slug] ? ['m-lista', 'Quitar de mi lista'] : ['m-lista', '+ Agregar a mi lista']);
  if (estado.viendo[d.slug]) ops.push(['m-sv', 'Quitar de «Seguir viendo»']);
  ops.push(['m-cerrar', 'Cancelar']);
  $('#m-titulo').textContent = d.title || d.slug;
  $('#m-sub').textContent = d.ep != null && d.ep !== '' ? `Episodio ${d.ep}` : '';
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
  if (viendo) cerrarControles(); // de vuelta al video, sin el panel
}
// Después de cambiar la lista o «seguir viendo»: volver a dibujar la página, con el foco en la
// misma tarjeta o, si desapareció de su fila, en la de al lado
function refrescar(quitada) {
  if (viendo) return;
  const el = menuDe && menuDe.el;
  let k = el && el.dataset.k, fila = el && filaDe(el) && filaDe(el).dataset.fila;
  if (quitada && el) {
    const todos = filaDe(el) ? [...filaDe(el).querySelectorAll('[data-f]')] : [];
    const i = todos.indexOf(el);
    const vecino = todos[i + 1] || todos[i - 1];
    if (vecino) k = vecino.dataset.k;
    else { k = null; fila = null; }
  }
  memo.set(location.hash || '#/', { k, fila, y: scrollY });
  paginaActual = '';
  render();
}
function hacerMenu(acc) {
  const d = menuDe;
  if (!d) return {};
  if (acc === 'm-cerrar') { cerrarMenu(); return {}; }
  cerrarMenu(false);
  if (acc === 'm-serie') { if (viendo) irDeVideoASerie(); else irA(`#/serie/${encodeURIComponent(d.slug)}`); return {}; }
  if (acc === 'm-lista') {
    const on = !estado.lista[d.slug];
    guardar({ accion: 'lista', slug: d.slug, id: d.id, title: d.title, on: on ? 1 : 0 }).then(() => {
      toast(on ? 'Agregada a mi lista' : 'Quitada de mi lista');
      // En la fila/página «Mi lista» la tarjeta desaparece; en las demás solo se actualiza
      const fila = d.el && filaDe(d.el) && filaDe(d.el).dataset.fila;
      refrescar(!on && fila === 'lista');
    });
    return {};
  }
  if (acc === 'm-sv') {
    guardar({ accion: 'quitar', slug: d.slug }).then(() => {
      toast('Quitada de «Seguir viendo»');
      const fila = d.el && filaDe(d.el) && filaDe(d.el).dataset.fila;
      refrescar(fila === 'seguir' || fila === 'sv');
    });
    return {};
  }
  return {};
}

function salirDelVideo(cambiando = false) {
  if (!viendo) return;
  const v = viendo;
  guardarProgreso(true);
  viendo = null;
  clearTimeout(ocultarT); clearTimeout(siguienteT); clearTimeout(guardarT);
  $('#aviso').classList.remove('abierto');
  $('#controles').classList.remove('abierto');
  $('#reproductor').querySelectorAll('iframe').forEach((f) => f.remove());
  if (cambiando) return; // otro episodio: sigue en pantalla completa
  document.body.classList.remove('viendo');
  if (winFull) { winFull = false; aExt({ winFull: false }); }
  aExt({ watch: false });
  cache.delete('serie?' + new URLSearchParams({ slug: v.slug })); // que se vean los vistos nuevos
}

// El reproductor (dentro del iframe) avisa por la extensión cómo va: {t, d, paused, ended}
function progresoVideo(p) {
  const v = viendo;
  if (!v || !v.serie) return;
  if (p.d > 0 && p.t > 0 && !p.paused) {
    if (!v.arranco) { v.arranco = true; $('#cargando').style.display = 'none'; }
    if (!v.reanudado) {
      v.reanudado = true;
      if (v.desde && p.t < v.desde - 5) { aExt({ seekTo: v.desde }); toast('Continúa en ' + mmss(v.desde)); }
    }
  }
  if (p.d > 0) v.ultimo = { t: p.t, d: p.d };
  if (!v.visto && terminado(p.t, p.d)) {
    v.visto = true;
    guardar({ accion: 'visto', slug: v.slug, ep: v.ep });
  }
  if (!guardarT) guardarT = setTimeout(() => { guardarT = 0; guardarProgreso(); }, 15000);
  if (p.ended) terminoEpisodio();
}
function guardarProgreso() {
  const v = viendo;
  if (!v || !v.serie || !v.ultimo) return;
  guardar({ accion: 'progreso', slug: v.slug, id: v.serie.id, title: v.serie.title, ep: v.ep, t: Math.round(v.ultimo.t), d: Math.round(v.ultimo.d) });
}

// Al terminar un episodio: aviso con cuenta regresiva y el siguiente solo
function terminoEpisodio() {
  const v = viendo;
  if (!v || v.terminado) return;
  v.terminado = true;
  const eps = v.serie.episodes, i = eps.indexOf(v.ep);
  const sig = i >= 0 ? eps[i + 1] : undefined;
  if (sig === undefined) { toast('Último episodio disponible'); return; }
  v.siguiente = sig;
  let falta = 10;
  $('#a-titulo').textContent = `Episodio ${sig}`;
  const tic = () => {
    $('#a-texto').textContent = `Empieza en ${falta} s`;
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
  const v = viendo;
  if (!v || v.siguiente === undefined) return;
  history.replaceState(history.state, '', `#/ver/${encodeURIComponent(v.slug)}/${v.siguiente}`);
  render();
}
function cancelarSiguiente() {
  clearTimeout(siguienteT);
  $('#aviso').classList.remove('abierto');
  enfocar(null);
}

// En el catálogo: cerca del final de la grilla, traer más
setInterval(() => {
  if (ruta().nombre !== 'catalogo' || !foco || !$('#cat')) return;
  const items = [...$('#cat').children];
  if (items.indexOf(foco) > items.length - 14) masCatalogo();
}, 700);

// ---------- Arranque ----------
(async () => {
  try { estado = await api('estado'); } catch { /* sin estado guardado: se usa el de por defecto */ }
  pintarAudio();
  render();
})();
