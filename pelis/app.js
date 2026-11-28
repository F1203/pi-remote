// Modo pelis: películas de Cinecalidad como una app de Smart TV. Los datos los trae el servidor
// (pelis.py); la cruceta del celular llega por la extensión (tv.js le pasa cada acción a esta página
// con postMessage y esta página contesta qué hacer: {media}, {winFull}, {editable}).
// La navegación (foco, filas, historial, menú) es la misma que la del modo anime.
// Sin la extensión también se maneja con el teclado (flechas, Enter, Escape/Retroceso).
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const hmin = (t) => { const m = Math.round(t / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
// «Heartland (2026)» -> título «Heartland» y año «2026»
const partir = (t) => { const m = String(t || '').match(/^(.*?)\s*\((\d{4})\)\s*$/); return m ? [m[1], m[2]] : [t || '', '']; };
const grande = (img) => String(img || '').replace(/-\d+x\d+(\.\w+)$/, '$1');

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

let estado = { favoritos: {}, viendo: {}, servidor: '' };
async function guardar(q) {
  try { const r = await api('guardar', q); if (r.estado) estado = r.estado; } catch (e) { console.warn(e); }
}

const GENEROS = {
  accion: ['Acción', '#e5383b', '#7a1012'], animacion: ['Animación', '#f9a826', '#b3541e'],
  aventura: ['Aventura', '#2a9d8f', '#14524b'], 'ciencia-ficcion': ['Ciencia ficción', '#4361ee', '#1b2a7a'],
  comedia: ['Comedia', '#f4a261', '#b5582a'], crimen: ['Crimen', '#495057', '#1b1e21'],
  drama: ['Drama', '#7b2cbf', '#3c096c'], familiar: ['Familiar', '#52b788', '#1b5e3f'],
  fantasia: ['Fantasía', '#c77dff', '#5a189a'], misterio: ['Misterio', '#3a506b', '#0b132b'],
  romance: ['Romance', '#ff4d6d', '#8b1e3f'], suspenso: ['Suspenso', '#6c757d', '#212529'],
  terror: ['Terror', '#8d0801', '#1a0000'],
};
const nombreGenero = (g) => (GENEROS[g] || [g])[0];

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

// Imágenes que no cargan: probar la alternativa (la portada chica) o dejar el hueco gris
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
  if (fila && (fila.dataset.fila === 'hero' || fila.dataset.fila === 'acciones')) scrollTo({ top: 0, behavior: suave ? 'smooth' : 'auto' });
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
  // Desde algo muy ancho (el buscador) se entra por el primero de la izquierda
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
  if (a === 'home' || a === 'pelis') {
    if (ruta().nombre === 'inicio' && !viendo) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); } else irA('#/');
    return {};
  }
  if (a === 'search') { irA('#/buscar'); return { editable: true }; }
  if (a === 'favoritos' || a === 'generos') { irA('#/' + a); return {}; }
  if (a === 'anime') { location.href = '../anime/'; return {}; }
  if (a === 'back') return atras();
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
  if (viendo && $('#controles').classList.contains('abierto')) { cerrarControles(); return {}; }
  if (viendo && viendo.trailer) { salirDelVideo(); return {}; } // el trailer no es una página: se cierra
  if (viendo) { if (pasos()) volver(); else irDeVideoAPeli(); return {}; }
  if (ruta().nombre === 'inicio') {
    // En el inicio: subir y, si ya está arriba, no hacer nada (para salir: botones Anime/YouTube)
    if (scrollY > 10 || (foco && filaDe(foco) && filaDe(foco).dataset.fila !== 'hero')) { scrollTo({ top: 0, behavior: 'smooth' }); enfocar(inicial()); }
    return {};
  }
  if (pasos()) volver(); else irA('#/');
  return {};
}
// Cuántas páginas se abrieron dentro de la app desde la primera (va en el historial): Atrás solo
// vuelve si hay a dónde; si no, se saldría de la app
const pasos = () => (history.state && history.state.pasos) || 0;
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
    || (ev.key === 'Backspace' && document.activeElement.tagName !== 'INPUT' ? 'back' : null);
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
// Clic derecho (trackpad): el menú de opciones de esa película
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
  if (r.nombre === 'ver') { await verPelicula(r.p[1]); return; }
  salirDelVideo();
  const seccion = r.nombre === 'genero' ? 'generos' : r.nombre;
  document.querySelectorAll('#barra .menu').forEach((b) => b.classList.toggle('activo', b.dataset.ir === '#/' + (seccion === 'inicio' ? '' : seccion)));
  const pant = $('#pantalla');
  pant.innerHTML = '<div class="estado">Cargando…</div>';
  enfocar(null);
  try {
    const pagina = { inicio: pInicio, peli: pPelicula, buscar: pBuscar, favoritos: pFavoritos, generos: pGeneros, genero: pGenero }[r.nombre] || pInicio;
    await pagina(pant, r);
  } catch (e) {
    if (paginaActual !== h) return;
    pant.innerHTML = `<div class="estado">${esc(e.message)}<div class="botones" data-fila="error">
      <button class="boton principal" data-f data-k="reintentar" data-accion="reintentar">Reintentar</button></div></div>`;
  }
  if (paginaActual !== h) return; // ya se fue a otra página mientras cargaba
  const m = memo.get(h);
  const el = m && m.k && ((m.fila && document.querySelector(`#pantalla [data-fila="${CSS.escape(m.fila)}"] [data-k="${CSS.escape(m.k)}"]`))
    || document.querySelector(`#pantalla [data-k="${CSS.escape(m.k)}"]`));
  if (el) { scrollTo({ top: m.y }); enfocar(el, { suave: false }); } else { scrollTo({ top: 0 }); enfocar(inicial(), { suave: false }); }
}
function inicial() {
  return $('#pantalla [data-inicial]') || $('#pantalla [data-f]') || $('#barra [data-f]');
}

// ---------- Tarjetas ----------
const datosPeli = (p) => `data-slug="${esc(p.slug)}" data-title="${esc(p.title)}" data-img="${esc(p.img)}" data-url="${esc(p.url || '')}"`;
function tPeli(p, { k, sub, progreso, ir } = {}) {
  const [titulo, anio] = partir(p.title);
  const s = sub ?? [anio, (p.generos || [])[0]].filter(Boolean).join(' · ');
  return `<div class="tarjeta" data-f data-k="${esc(k || 'p:' + p.slug)}" data-ir="${esc(ir || '#/peli/' + encodeURIComponent(p.slug))}" ${datosPeli(p)}>
    <div class="img"><img loading="lazy" src="${esc(p.img)}" alt="">
    ${progreso ? `<div class="progreso"><i style="width:${Math.round(progreso * 100)}%"></i></div>` : ''}</div>
    <div class="titulo ${s ? 'con-sub' : ''}">${esc(titulo)}</div>${s ? `<span class="sub">${esc(s)}</span>` : ''}</div>`;
}
function fila(id, titulo, html, extra = '') {
  return html ? `<section class="fila"><h2>${titulo}${extra}</h2><div class="fila-items" data-fila="${id}">${html}</div></section>` : '';
}
const grilla = (id, html) => `<div class="grilla" data-fila="${id}" data-grilla id="${id}">${html}</div>`;

// Vista (ya no va en «seguir viendo»): faltan los créditos, unos minutos o el último 7 %
function terminado(t, d) { return d > 60 && d - t < Math.min(480, d * 0.07); }

function seguirViendo() {
  return Object.entries(estado.viendo)
    .filter(([, v]) => !terminado(v.t, v.d))
    .sort((a, b) => b[1].fecha - a[1].fecha).slice(0, 20)
    .map(([slug, v]) => ({ slug, title: v.title, img: v.img, url: v.url, t: v.t, d: v.d }));
}
const tSeguir = (p) => tPeli(p, {
  k: 'sv:' + p.slug, ir: '#/ver/' + encodeURIComponent(p.slug),
  sub: p.d > 0 ? `Quedan ${hmin(p.d - p.t)}` : 'Empezada', progreso: p.d > 0 ? p.t / p.d : 0,
});
function favoritos() {
  return Object.entries(estado.favoritos).sort((a, b) => b[1].fecha - a[1].fecha)
    .map(([slug, v]) => ({ slug, title: v.title, img: v.img, url: v.url }));
}
// El botón de favoritos (en la portada y en el detalle)
const bFav = (p, k) => {
  const on = p.slug in estado.favoritos;
  return `<button class="boton ${on ? 'marcado' : ''}" data-f data-k="${k}" data-accion="fav" ${datosPeli(p)}>${on ? '✓ En favoritos' : '+ Favoritos'}</button>`;
};

// ---------- Páginas ----------
async function pInicio(pant) {
  const [d, dest] = await Promise.all([apiC('inicio'), apiC('destacadas').catch(() => ({ pelis: [] }))]);
  const destacadas = dest.pelis || [];
  // Portada: una destacada que no se esté viendo (cambia cada vez que se abre la app)
  const opciones = (destacadas.length ? destacadas : d.pelis).filter((p) => !(p.slug in estado.viendo));
  const h = opciones.length ? opciones[portadaN % opciones.length] : null;
  let html = '';
  if (h) {
    const [titulo, anio] = partir(h.title);
    html += `<section class="hero peli"><img class="fondo borroso" src="${esc(grande(h.img))}" data-alt="${esc(h.img)}" alt="">
      <img class="poster" src="${esc(grande(h.img))}" data-alt="${esc(h.img)}" alt="">
      <div class="texto"><div class="etiquetas"><span class="destaque">Destacada</span>${anio ? `<span>${anio}</span>` : ''}${(h.generos || []).slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join('')}</div>
      <h1>${esc(titulo)}</h1><p>${esc(h.sinopsis)}</p>
      <div class="botones" data-fila="hero">
        <button class="boton principal" data-f data-inicial data-k="h:ver" data-ir="#/ver/${esc(encodeURIComponent(h.slug))}">▶ Ver película</button>
        <button class="boton" data-f data-k="h:info" data-ir="#/peli/${esc(encodeURIComponent(h.slug))}">ℹ Más info</button>
        ${bFav(h, 'h:fav')}
      </div></div></section>`;
  }
  html += fila('seguir', 'Seguir viendo', seguirViendo().map(tSeguir).join(''));
  html += fila('estrenos', 'Recién agregadas', d.pelis.map((p) => tPeli(p)).join(''));
  html += fila('destacadas', 'Destacadas', destacadas.map((p) => tPeli(p)).join(''));
  html += fila('favs', 'Mis favoritos', favoritos().slice(0, 20).map((p) => tPeli(p)).join(''));
  html += '<div id="mas-filas"></div>';
  pant.innerHTML = html;
  // Más filas, por género, sin esperar (si fallan, no se muestran)
  const mas = ['accion', 'comedia', 'terror', 'animacion', 'suspenso', 'ciencia-ficcion', 'drama', 'romance'];
  const hash = location.hash;
  const filas = await Promise.all(mas.map((g) => apiC('genero', { g, pagina: 1 })
    .then((c) => fila('g-' + g, esc(nombreGenero(g)), c.pelis.map((p) => tPeli(p)).join(''))).catch(() => '')));
  if (location.hash === hash && $('#mas-filas')) $('#mas-filas').outerHTML = filas.join('');
}
let portadaN = Math.floor(Math.random() * 8);

async function pPelicula(pant, r) {
  const slug = r.p[1];
  const d = await apiC('pelicula', { slug });
  const p = { slug, title: d.title, img: d.img };
  const [titulo, anio] = partir(d.title);
  const v = estado.viendo[slug];
  const seguir = v && v.t > 20 && !terminado(v.t, v.d);
  const g = Object.keys(GENEROS).find((k) => d.generos.some((x) => nombreGenero(k).toLowerCase() === x.toLowerCase()));
  const creditos = [d.director ? `Dirección: <b>${esc(d.director)}</b>` : '', d.elenco && d.elenco.length ? `Con: <b>${esc(d.elenco.join(', '))}</b>` : '']
    .filter(Boolean).join('<br>');
  pant.innerHTML = `<section class="detalle"><img class="fondo borroso" src="${esc(d.img)}" alt="">
      <img class="poster" src="${esc(d.img)}" alt="">
      <div class="info"><h1>${esc(titulo)}</h1>
      ${d.original && d.original.toLowerCase() !== titulo.toLowerCase() ? `<p class="original">${esc(d.original)}</p>` : ''}
      <div class="etiquetas">${[anio, d.calidad].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${d.rating ? `<span class="nota">★ ${esc(d.rating)}</span>` : ''}</div>
      <div class="etiquetas">${d.generos.map((x) => `<span>${esc(x)}</span>`).join('')}${d.audio ? `<span>${esc(d.audio)}</span>` : ''}</div>
      <p class="sinopsis">${esc(d.sinopsis)}</p>
      ${creditos ? `<p class="creditos">${creditos}</p>` : ''}
      <div class="botones" data-fila="acciones">
        ${d.servidores.length
          ? `<button class="boton principal" data-f data-inicial data-k="a:ver" data-ir="#/ver/${esc(encodeURIComponent(slug))}">▶ ${seguir ? 'Seguir viendo · ' + mmss(v.t) : 'Ver película'}</button>
             ${seguir ? `<button class="boton" data-f data-k="a:cero" data-accion="desde-cero" data-slug="${esc(slug)}">↺ Desde el principio</button>` : ''}`
          : '<span class="boton" style="opacity:.6">Sin servidores para ver</span>'}
        ${bFav(p, 'a:fav')}
        ${d.trailer ? `<button class="boton" data-f data-k="a:trailer" data-accion="trailer" data-v="${esc(d.trailer)}">Trailer</button>` : ''}
        ${v ? `<button class="boton" data-f data-k="a:quitar" data-accion="quitar" data-slug="${esc(slug)}">Quitar de «Seguir viendo»</button>` : ''}
      </div></div></section><div id="parecidas"></div>`;
  // Más del mismo género, debajo
  if (!g) return;
  const hash = location.hash;
  const c = await apiC('genero', { g, pagina: 1 }).catch(() => null);
  const otras = c ? c.pelis.filter((x) => x.slug !== slug) : [];
  if (location.hash === hash && $('#parecidas')) $('#parecidas').outerHTML = fila('parecidas', 'Más de ' + esc(nombreGenero(g)), otras.map((x) => tPeli(x)).join(''));
}

let busquedaT = 0, ultimaBusqueda = '';
async function pBuscar(pant, r) {
  pant.innerHTML = `<div class="buscador" data-fila="buscar"><input id="q" data-f data-inicial data-k="q" type="search"
      placeholder="Buscar película…" autocomplete="off" value="${esc(r.q.q || '')}">
      <p>Escribí con el teclado del celular. OK busca; ↓ baja a los resultados.</p></div>
    <section class="fila"><h2 id="r-titulo"></h2>${grilla('res', '')}</section>`;
  const inp = $('#q');
  inp.addEventListener('input', () => { clearTimeout(busquedaT); busquedaT = setTimeout(buscarYa, 700); });
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
    const c = await apiC('buscar', { q: t });
    if (ultimaBusqueda !== t) return;
    $('#r-titulo').textContent = c.pelis.length ? `Resultados para «${t}»` : 'Sin resultados';
    $('#res').innerHTML = c.pelis.map((p) => tPeli(p)).join('');
  } catch (e) { $('#r-titulo').textContent = e.message; }
}

async function pFavoritos(pant) {
  const f = favoritos();
  const sv = seguirViendo();
  pant.innerHTML = `<h1 class="titulo-pagina">Mis favoritos${f.length ? `<small>${f.length} película${f.length === 1 ? '' : 's'}</small>` : ''}</h1>`
    + (f.length ? grilla('favs', f.map((p) => tPeli(p)).join(''))
      : '<div class="estado">Todavía no hay favoritos.<br>En una película: «+ Favoritos», o mantené OK sobre ella.</div>')
    + (sv.length ? fila('seguir', 'Seguir viendo', sv.map(tSeguir).join('')) : '');
}

async function pGeneros(pant) {
  pant.innerHTML = '<h1 class="titulo-pagina">Géneros</h1><div class="generos" data-fila="gen" data-grilla>'
    + Object.entries(GENEROS).map(([g, [n, c1, c2]]) =>
      `<button class="genero" data-f data-k="g:${g}" data-ir="#/genero/${g}" style="--c1:${c1};--c2:${c2}">${esc(n)}</button>`).join('')
    + '</div>';
}

// Un género: la grilla trae más páginas sola al acercarse al final
let generoCarga = null;
async function pGenero(pant, r) {
  const g = r.p[1];
  const c = await apiC('genero', { g, pagina: 1 });
  generoCarga = { g, pagina: 1, fin: c.pelis.length < 15, cargando: false, vistos: new Set(c.pelis.map((p) => p.slug)) };
  pant.innerHTML = `<h1 class="titulo-pagina">${esc(nombreGenero(g))}</h1>`
    + (c.pelis.length ? grilla('gen-r', c.pelis.map((p) => tPeli(p)).join('')) + '<div class="mas" id="mas"></div>'
      : '<div class="estado">No hay películas en este género.</div>');
}
async function masGenero() {
  const gc = generoCarga;
  if (!gc || gc.fin || gc.cargando || !$('#gen-r')) return;
  gc.cargando = true;
  $('#mas').textContent = 'Cargando más…';
  try {
    const c = await apiC('genero', { g: gc.g, pagina: gc.pagina + 1 });
    if (generoCarga !== gc || !$('#gen-r')) return;
    gc.pagina++;
    const nuevas = c.pelis.filter((p) => !gc.vistos.has(p.slug));
    nuevas.forEach((p) => gc.vistos.add(p.slug));
    if (!nuevas.length) gc.fin = true;
    $('#gen-r').insertAdjacentHTML('beforeend', nuevas.map((p) => tPeli(p)).join(''));
    $('#mas').textContent = '';
  } catch (e) {
    if ($('#mas')) $('#mas').textContent = e.message;
  } finally { gc.cargando = false; }
}
setInterval(() => {
  if (ruta().nombre !== 'genero' || !foco || !$('#gen-r')) return;
  const items = [...$('#gen-r').children];
  if (items.indexOf(foco) > items.length - 14) masGenero();
}, 700);

// ---------- Acciones ----------
function hacer(acc, el) {
  if (acc.startsWith('m-')) return hacerMenu(acc);
  if (acc === 'reintentar') { cache.clear(); paginaActual = ''; render(); return {}; }
  if (acc === 'anime') { location.href = '../anime/'; return {}; }
  if (acc === 'youtube') { location.href = '../youtube/'; return {}; }
  if (acc === 'fav') {
    const d = el.dataset;
    const on = !(d.slug in estado.favoritos);
    guardar({ accion: 'favorito', slug: d.slug, on: on ? '1' : '0', title: d.title, img: d.img, url: d.url || '' }).then(() => {
      el.classList.toggle('marcado', on);
      el.textContent = on ? '✓ En favoritos' : '+ Favoritos';
      toast(on ? 'Agregada a favoritos' : 'Quitada de favoritos');
    });
    return {};
  }
  if (acc === 'quitar') { guardar({ accion: 'quitar', slug: el.dataset.slug }).then(() => { toast('Quitada de «Seguir viendo»'); paginaActual = ''; render(); }); return {}; }
  if (acc === 'desde-cero') {
    const v = estado.viendo[el.dataset.slug];
    if (v) v.t = 0;
    irA('#/ver/' + encodeURIComponent(el.dataset.slug));
    return {};
  }
  if (acc === 'trailer') { verTrailer(el.dataset.v); return {}; }
  return hacerVideo(acc, el);
}

// ---------- Reproductor ----------
let viendo = null;   // {slug, title, img, servidores, servidor, ...} o {trailer: true}
let winFull = false;
let ocultarT = 0, guardarT = 0;
let vinoDe = '';     // página desde la que se abrió la película

function pantallaCompleta(on) {
  winFull = on;
  return { winFull: on };
}
function elegirServidor(lista, preferido) {
  return lista.find((x) => x.server === preferido) || lista[0];
}
function abrirReproductor() {
  document.body.classList.add('viendo');
  $('#cargando').textContent = 'Cargando…';
  $('#cargando').style.display = '';
  enfocar(null);
  if (!winFull) { winFull = true; aExt({ winFull: true }); }
  aExt({ watch: true });
}
function ponerIframe(url, sandbox) {
  const rep = $('#reproductor');
  rep.querySelectorAll('iframe').forEach((f) => f.remove());
  const f = document.createElement('iframe');
  f.src = url;
  f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'no-referrer';
  // Los servidores con publicidad no pueden abrir ventanas nuevas
  if (sandbox) f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  rep.insertBefore(f, rep.firstChild);
  return f;
}

async function verPelicula(slug) {
  if (viendo && viendo.slug === slug) return;
  salirDelVideo(true);
  const v = viendo = { slug, inicio: Date.now(), reanudado: false, ultimo: null };
  abrirReproductor();
  try {
    const d = await apiC('pelicula', { slug });
    if (viendo !== v) return;
    v.title = d.title; v.img = d.img; v.servidores = d.servidores;
    if (!d.servidores.length) throw new Error('Esta película no tiene servidores para ver.');
    const guardado = estado.viendo[slug];
    v.desde = guardado && guardado.t > 20 && !terminado(guardado.t, guardado.d) ? guardado.t : 0;
    cargarServidor(elegirServidor(d.servidores, estado.servidor));
    // Que figure en «seguir viendo» aunque no llegue el progreso
    guardar({ accion: 'progreso', slug, title: d.title, img: d.img, t: v.desde, d: guardado ? guardado.d : 0, servidor: '' });
  } catch (e) {
    if (viendo !== v) return;
    $('#cargando').textContent = e.message;
    pintarControles();
    abrirControles();
  }
}

function verTrailer(id) {
  salirDelVideo(true);
  viendo = { slug: '', trailer: true, title: 'Trailer', volverA: foco };
  abrirReproductor();
  const f = ponerIframe('https://www.youtube.com/embed/' + encodeURIComponent(id) + '?autoplay=1', false);
  f.addEventListener('load', () => { $('#cargando').style.display = 'none'; }, { once: true });
  pintarControles();
}

function cargarServidor(srv) {
  const v = viendo;
  v.servidor = srv.server;
  v.arranco = false;
  $('#cargando').textContent = 'Cargando ' + srv.server + '…';
  $('#cargando').style.display = '';
  const f = ponerIframe(srv.url, true);
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
  $('#c-titulo').textContent = v.trailer ? 'Trailer' : partir(v.title || v.slug)[0];
  $('#c-ayuda').textContent = 'Con el panel cerrado: ←/→ 10 s · OK pausa · ↑ o Atrás: cerrar este panel';
  const b = [];
  if (v.servidores && v.servidores.length) {
    b.push(v.servidores.map((x, j) =>
      `<button class="boton ${x.server === v.servidor ? 'activo' : ''}" data-f ${x.server === v.servidor ? 'data-inicial' : ''} data-accion="srv" data-j="${j}">${esc(x.server)}</button>`).join(''));
    b.push('<span class="sep"></span>');
  }
  b.push(`<button class="boton" data-f ${b.length ? '' : 'data-inicial'} data-accion="a-peli">ℹ Información</button>`);
  $('#c-botones').innerHTML = b.join('');
}

function abrirControles(conFoco = true, dura = 10000) {
  $('#controles').classList.add('abierto');
  if (conFoco) enfocar($('#controles [data-inicial]') || $('#controles [data-f]'));
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
  if (!v) return {};
  if (acc === 'a-peli') { irDeVideoAPeli(); return {}; }
  if (acc === 'srv') {
    const srv = v.servidores[+el.dataset.j];
    if (srv) { estado.servidor = srv.server; guardar({ accion: 'servidor', v: srv.server }); cargarServidor(srv); toast('Servidor: ' + srv.server); }
    enfocar($(`#controles [data-accion="srv"][data-j="${el.dataset.j}"]`));
    return {};
  }
  return {};
}
function irDeVideoAPeli() {
  const v = viendo;
  if (!v) return;
  if (v.trailer) { salirDelVideo(); return; } // el trailer se abre encima de la página de la película
  const h = `#/peli/${encodeURIComponent(v.slug)}`;
  // Si se llegó desde esa misma película, volver atrás; si no (seguir viendo, portada), cambiar
  // el video por la página de la película
  if (pasos() && vinoDe && vinoDe.split('?')[0] === h) volver(); else { history.replaceState(history.state, '', h); render(); }
}

function salirDelVideo(cambiando = false) {
  if (!viendo) return;
  const v = viendo;
  guardarProgreso();
  viendo = null;
  clearTimeout(ocultarT); clearTimeout(guardarT); guardarT = 0;
  $('#controles').classList.remove('abierto');
  $('#reproductor').querySelectorAll('iframe').forEach((f) => f.remove());
  if (cambiando) return; // otra película: sigue en pantalla completa
  document.body.classList.remove('viendo');
  if (winFull) { winFull = false; aExt({ winFull: false }); }
  aExt({ watch: false });
  if (v.volverA && v.volverA.isConnected) enfocar(v.volverA, { suave: false });
}

// El reproductor (dentro del iframe) avisa por la extensión cómo va: {t, d, paused, ended}
function progresoVideo(p) {
  const v = viendo;
  if (!v || v.trailer) return;
  if (p.d > 0 && p.t > 0 && !p.paused) {
    if (!v.arranco) { v.arranco = true; $('#cargando').style.display = 'none'; }
    if (!v.reanudado) {
      v.reanudado = true;
      if (v.desde && p.t < v.desde - 5) { aExt({ seekTo: v.desde }); toast('Continúa en ' + mmss(v.desde)); }
    }
  }
  if (p.d > 0) v.ultimo = { t: p.t, d: p.d };
  if (!guardarT) guardarT = setTimeout(() => { guardarT = 0; guardarProgreso(); }, 15000);
}
function guardarProgreso() {
  const v = viendo;
  if (!v || v.trailer || !v.ultimo) return;
  guardar({ accion: 'progreso', slug: v.slug, title: v.title || '', img: v.img || '', t: Math.round(v.ultimo.t), d: Math.round(v.ultimo.d), servidor: v.servidor || '' });
}

// ---------- Menú de opciones («clic derecho»: mantener OK en el celular) ----------
let menuDe = null;   // la película sobre la que se abrió
let focoAntes = null;
const menuAbierto = () => $('#menu').classList.contains('abierto');
function abrirMenu() {
  let d = null;
  if (viendo && !viendo.trailer && viendo.title) d = { slug: viendo.slug, title: viendo.title, img: viendo.img, enVideo: true };
  else if (foco && foco.isConnected && foco.dataset.slug && foco.dataset.title) d = { ...foco.dataset, el: foco };
  else if (ruta().nombre === 'peli' && $('#pantalla [data-accion="fav"]')) d = { ...$('#pantalla [data-accion="fav"]').dataset };
  if (!d) { toast('Elegí una película para ver sus opciones'); return {}; }
  menuDe = d;
  focoAntes = foco;
  const ops = [];
  const enSuPagina = ruta().nombre === 'peli' && ruta().p[1] === d.slug;
  if (!d.enVideo) ops.push(['m-ver', '▶ Ver película']);
  if (!enSuPagina) ops.push(['m-info', 'ℹ Información']);
  ops.push(d.slug in estado.favoritos ? ['m-fav', 'Quitar de favoritos'] : ['m-fav', '+ Agregar a favoritos']);
  if (estado.viendo[d.slug]) ops.push(['m-sv', 'Quitar de «Seguir viendo»']);
  ops.push(['m-cerrar', 'Cancelar']);
  $('#m-titulo').textContent = partir(d.title || d.slug)[0];
  $('#m-sub').textContent = partir(d.title)[1];
  $('#m-opciones').innerHTML = ops.map(([acc, t], i) =>
    `<div data-fila="m${i}"><button class="boton ${i === 0 ? 'principal' : ''}" data-f data-accion="${acc}">${esc(t)}</button></div>`).join('');
  clearTimeout(ocultarT);
  $('#menu').classList.add('abierto');
  enfocar($('#m-opciones [data-f]'));
  return {};
}
function cerrarMenu(volverFoco = true) {
  if (!menuAbierto()) return;
  $('#menu').classList.remove('abierto');
  if (volverFoco) enfocar(focoAntes && focoAntes.isConnected && !viendo ? focoAntes : null);
  if (viendo) cerrarControles(); // de vuelta al video, sin el panel
}
// Después de cambiar favoritos o «seguir viendo»: volver a dibujar la página, con el foco en la
// misma tarjeta o, si desapareció de su fila, en la de al lado
function refrescar(quitada) {
  if (viendo) return;
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
  if (acc === 'm-ver') { irA('#/ver/' + encodeURIComponent(d.slug)); return {}; }
  if (acc === 'm-info') { if (viendo) irDeVideoAPeli(); else irA('#/peli/' + encodeURIComponent(d.slug)); return {}; }
  if (acc === 'm-fav') {
    const on = !(d.slug in estado.favoritos);
    guardar({ accion: 'favorito', slug: d.slug, on: on ? '1' : '0', title: d.title, img: d.img, url: d.url || '' }).then(() => {
      toast(on ? 'Agregada a favoritos' : 'Quitada de favoritos');
      refrescar(!on && fl === 'favs');
    });
    return {};
  }
  if (acc === 'm-sv') {
    guardar({ accion: 'quitar', slug: d.slug }).then(() => {
      toast('Quitada de «Seguir viendo»');
      refrescar(fl === 'seguir');
    });
    return {};
  }
  return {};
}

// ---------- Arranque ----------
(async () => {
  try { estado = await api('estado'); } catch { /* sin estado guardado: se usa el de por defecto */ }
  render();
})();
