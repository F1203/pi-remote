// Modo pelis: películas de Cinecalidad como una app de Smart TV.
// Los datos los trae el servidor (pelis.py); la cruceta del celular llega por la extensión
// (tv.js le pasa cada acción a esta página con postMessage y contesta qué hacer).
'use strict';

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
const cache = new Map();
async function apiC(ruta, q = {}) {
  const k = ruta + '?' + new URLSearchParams(q);
  if (!cache.has(k)) cache.set(k, api(ruta, q).catch((e) => { cache.delete(k); throw e; }));
  return cache.get(k);
}

let estado = { favoritos: {}, viendo: {}, servidor: '' };
async function guardar(q) {
  try { const r = await api('guardar', q); if (r.estado) estado = r.estado; } catch (e) { console.warn(e); }
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

// Imágenes que no cargan
document.addEventListener('error', (ev) => {
  if (ev.target.tagName === 'IMG') ev.target.classList.add('sin-img');
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
  if (fila && fila.dataset.fila === 'hero') scrollTo({ top: 0, behavior: suave ? 'smooth' : 'auto' });
  else if (r.top < arriba) scrollBy({ top: r.top - arriba - 20, behavior: suave ? 'smooth' : 'auto' });
  else if (r.bottom > innerHeight - 20) scrollBy({ top: r.bottom - innerHeight + 40, behavior: suave ? 'smooth' : 'auto' });
}

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
  const lineas = [...grupos.entries()].map(([k, els]) => ({ k, els, y: Math.min(...els.map(top)) }))
    .sort((a, b) => a.y - b.y);
  const i = lineas.findIndex((x) => x.k === l) + (dir === 'down' ? 1 : -1);
  const dest = lineas[i];
  if (!dest) return false;
  const a = foco.getBoundingClientRect();
  const cx = a.width > innerWidth * 0.5 ? 0 : a.left + a.width / 2;
  const enVista = dest.els.filter((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; });
  const recordado = memoFila.get(dest.k);
  let el;
  const activo = dest.els.find((x) => x.classList.contains('activo'));
  if (recordado && enVista.includes(recordado) && filaDe(recordado) && !filaDe(recordado).hasAttribute('data-grilla')) el = recordado;
  else if (activo && filaDe(activo).classList.contains('chips')) el = activo;
  else el = (enVista.length ? enVista : dest.els).reduce((best, x) => {
    const r = x.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx);
    return !best || d < best.d ? { x, d } : best;
  }, null).x;
  memoFila.set(l, foco);
  enfocar(el);
  return true;
}
const memoFila = new Map();

function activar(el) {
  if (!el) return {};
  if (el.tagName === 'INPUT') { el.focus(); el.select(); return { editable: true }; }
  if (el.dataset.ir) { irA(el.dataset.ir); return {}; }
  if (el.dataset.accion) return hacer(el.dataset.accion, el) || {};
  return {};
}

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
    cerrarMenu();
  }
  if (viendo) {
    if (a === 'back') { salirDelVideo(); return {}; }
    return accionVideo(a);
  }
  if (a === 'ok') return activar(foco);
  if (a === 'menu') return activarMenu();
  if (['up', 'down', 'left', 'right'].includes(a)) { mover(a); return {}; }
  if (a === 'back') { volver(); return {}; }
  if (a === 'home') { irA('#/'); return {}; }
  if (a === 'search') { irA('#/buscar'); return { editable: true }; }
  if (a === 'anime') { location.href = '../anime/'; return {}; }
  if (a === 'youtube') { location.href = '../youtube/'; return {}; }
  return {};
}

// ---------- Navegación ----------
let rutaActual = '';
let vinoDe = '';
function ruta() {
  const h = location.hash.slice(1) || '/';
  const [nombre, ...partes] = h.slice(1).split('/');
  return { nombre: nombre || 'inicio', partes, hash: h };
}
function irA(hash) {
  vinoDe = location.hash;
  location.hash = hash;
}
function volver() {
  if (history.state && history.state.paso > 0) history.back();
  else irA('#/');
}
function pasos() { return history.state ? history.state.paso : 0; }

window.addEventListener('hashchange', render);

function inicial() {
  const items = focables().filter((x) => !$('#barra').contains(x));
  return items[0] || null;
}

// ---------- Renderizado ----------
let cargandoPagina = false;

async function render() {
  const r = ruta();
  if (r.hash === rutaActual && !cargandoPagina) return;
  rutaActual = r.hash;
  const p = $('#pantalla');

  if (!history.state || history.state.hash !== r.hash) {
    history.replaceState({ hash: r.hash, paso: pasos() + (vinoDe ? 1 : 0) }, '');
  }

  try {
    if (r.nombre === 'inicio') await pintarInicio(p);
    else if (r.nombre === 'buscar') await pintarBuscar(p, r.partes[0] || '');
    else if (r.nombre === 'favoritos') await pintarFavoritos(p);
    else if (r.nombre === 'generos') await pintarGeneros(p);
    else if (r.nombre === 'genero') await pintarGenero(p, r.partes[0], +(r.partes[1] || 1));
    else if (r.nombre === 'peli') await pintarPelicula(p, r.partes[0]);
    else if (r.nombre === 'ver') await verPelicula(r.partes[0]);
    else { p.innerHTML = '<p style="padding:40px">Página no encontrada</p>'; }
  } catch (e) {
    p.innerHTML = `<p style="padding:40px;color:#e55">${esc(e.message)}</p>`;
  }

  if (!viendo) {
    await sleep(50);
    const el = inicial();
    if (el && !foco) enfocar(el, { suave: false });
  }
}

// ---------- Tarjeta ----------
function htmlTarjeta(p) {
  return `<button class="tarjeta-peli" data-f data-accion="abrir" data-slug="${esc(p.slug)}" data-title="${esc(p.title)}" data-img="${esc(p.img)}" data-url="${esc(p.url || '')}" data-sitio="${esc(p.sitio || 'cinecalidad')}">
    <img src="${esc(p.img)}" loading="lazy">
    <div class="titulo">${esc(p.title)}</div>
    <div class="meta">${esc((p.generos || []).join(' · '))}</div>
  </button>`;
}

function htmlFila(titulo, pelis, id) {
  if (!pelis.length) return '';
  return `<div class="fila"><h3 class="fila-titulo">${esc(titulo)}</h3>
    <div class="fila-items" data-fila="${esc(id)}">${pelis.map(htmlTarjeta).join('')}</div></div>`;
}

// ---------- Páginas ----------
async function pintarInicio(p) {
  p.innerHTML = '<p style="padding:40px;color:#8a94a3">Cargando…</p>';
  const [d] = await Promise.all([apiC('inicio')]);

  let html = '';

  // Seguir viendo
  const sv = Object.entries(estado.viendo)
    .filter(([, v]) => v.d > 0 && !terminado(v.t, v.d))
    .sort((a, b) => b[1].fecha - a[1].fecha);
  if (sv.length) {
    html += htmlFila('Seguir viendo', sv.map(([slug, v]) => ({
      slug, title: v.title, img: v.img, url: v.url, sitio: v.sitio, generos: [mmss(v.t) + ' / ' + mmss(v.d)],
    })), 'seguir');
  }

  // Cartelera
  html += htmlFila('Cartelera', d.pelis || [], 'cartelera');

  // Favoritos (los primeros 20)
  const favs = Object.entries(estado.favoritos).sort((a, b) => b[1].fecha - a[1].fecha).slice(0, 20);
  if (favs.length) {
    html += htmlFila('Favoritos', favs.map(([slug, v]) => ({
      slug, title: v.title, img: v.img, url: v.url, sitio: v.sitio, generos: [],
    })), 'favs');
  }

  p.innerHTML = html || '<p style="padding:40px">No hay películas</p>';
}

async function pintarBuscar(p, q) {
  const input = `<div style="padding:16px 20px"><input type="text" id="buscar-input" data-f placeholder="Buscar película…" value="${esc(decodeURIComponent(q))}" style="width:100%;max-width:500px;padding:12px 16px;font-size:16px;background:#262d36;color:#e8ecf1;border:0;border-radius:10px;outline:none"></div>`;
  if (!q) {
    p.innerHTML = input + '<p style="padding:0 20px;color:#8a94a3">Escribí el nombre de la película</p>';
    await sleep(50);
    const inp = $('#buscar-input');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && inp.value.trim()) {
          irA('#/buscar/' + encodeURIComponent(inp.value.trim()));
        }
      });
    }
    return;
  }
  p.innerHTML = input + '<p style="padding:0 20px;color:#8a94a3">Buscando…</p>';
  const d = await api('buscar', { q: decodeURIComponent(q) });
  const grid = (d.pelis || []).map(htmlTarjeta).join('');
  p.innerHTML = input + (grid
    ? `<div class="grilla" data-fila="res" data-grilla>${grid}</div>`
    : '<p style="padding:0 20px;color:#8a94a3">Sin resultados</p>');
  const inp = $('#buscar-input');
  if (inp) {
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && inp.value.trim()) {
        irA('#/buscar/' + encodeURIComponent(inp.value.trim()));
      }
    });
  }
}

async function pintarFavoritos(p) {
  const favs = Object.entries(estado.favoritos).sort((a, b) => b[1].fecha - a[1].fecha);
  if (!favs.length) {
    p.innerHTML = '<p style="padding:40px;color:#8a94a3">No tenés favoritos. Mantené OK en una película para agregarla.</p>';
    return;
  }
  const grid = favs.map(([slug, v]) => htmlTarjeta({
    slug, title: v.title, img: v.img, url: v.url, sitio: v.sitio, generos: [],
  })).join('');
  p.innerHTML = `<h3 class="fila-titulo" style="padding:16px 20px">Favoritos</h3><div class="grilla" data-fila="favs" data-grilla>${grid}</div>`;
}

async function pintarGeneros(p) {
  const d = await apiC('generos');
  const nombres = {
    'accion': 'Acción', 'animacion': 'Animación', 'aventura': 'Aventura',
    'ciencia-ficcion': 'Ciencia Ficción', 'comedia': 'Comedia', 'crimen': 'Crimen',
    'drama': 'Drama', 'familiar': 'Familiar', 'fantasia': 'Fantasía',
    'misterio': 'Misterio', 'romance': 'Romance', 'suspenso': 'Suspenso', 'terror': 'Terror',
  };
  const chips = (d.generos || []).map((g) =>
    `<button class="genero-chip" data-f data-ir="#/genero/${esc(g)}">${esc(nombres[g] || g)}</button>`
  ).join('');
  p.innerHTML = `<h3 class="fila-titulo" style="padding:16px 20px">Géneros</h3><div class="grilla" data-fila="gen" data-grilla style="padding:8px 16px">${chips}</div>`;
}

async function pintarGenero(p, genero, pagina) {
  const nombres = {
    'accion': 'Acción', 'animacion': 'Animación', 'aventura': 'Aventura',
    'ciencia-ficcion': 'Ciencia Ficción', 'comedia': 'Comedia', 'crimen': 'Crimen',
    'drama': 'Drama', 'familiar': 'Familiar', 'fantasia': 'Fantasía',
    'misterio': 'Misterio', 'romance': 'Romance', 'suspenso': 'Suspenso', 'terror': 'Terror',
  };
  p.innerHTML = '<p style="padding:40px;color:#8a94a3">Cargando…</p>';
  const d = await api('genero', { g: genero, pagina });
  const grid = (d.pelis || []).map(htmlTarjeta).join('');
  let nav = '';
  if (pagina > 1 || (d.pelis && d.pelis.length >= 15)) {
    nav = '<div style="padding:12px 20px;display:flex;gap:12px" data-fila="nav">';
    if (pagina > 1) nav += `<button class="boton" data-f data-ir="#/genero/${esc(genero)}/${pagina - 1}">← Anterior</button>`;
    if (d.pelis && d.pelis.length >= 15) nav += `<button class="boton" data-f data-ir="#/genero/${esc(genero)}/${pagina + 1}">Siguiente →</button>`;
    nav += '</div>';
  }
  p.innerHTML = `<h3 class="fila-titulo" style="padding:16px 20px">${esc(nombres[genero] || genero)}</h3>`
    + (grid ? `<div class="grilla" data-fila="gen-r" data-grilla>${grid}</div>` : '<p style="padding:0 20px;color:#8a94a3">Sin películas</p>')
    + nav;
}

async function pintarPelicula(p, slug) {
  p.innerHTML = '<p style="padding:40px;color:#8a94a3">Cargando…</p>';
  const d = await api('pelicula', { slug });
  const esFav = slug in estado.favoritos;
  p.innerHTML = `<div class="detalle">
    <div class="poster"><img src="${esc(d.img)}" data-f data-accion="ver" data-slug="${esc(slug)}"></div>
    <div class="info">
      <h2>${esc(d.title)}</h2>
      ${d.rating ? `<div class="dato">⭐ <b>${esc(d.rating)}</b>/10</div>` : ''}
      ${d.anio ? `<div class="dato">${esc(d.anio)}</div>` : ''}
      ${d.director ? `<div class="dato">Director: <b>${esc(d.director)}</b></div>` : ''}
      ${d.generos.length ? `<div class="dato">${esc(d.generos.join(' · '))}</div>` : ''}
      <div class="sinopsis">${esc(d.sinopsis)}</div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap" data-fila="acciones">
        <button class="boton principal" data-f data-inicial data-accion="ver" data-slug="${esc(slug)}">▶ Ver película</button>
        <button class="boton" data-f data-accion="fav" data-slug="${esc(slug)}" data-title="${esc(d.title)}" data-img="${esc(d.img)}">${esFav ? '★ Quitar de favoritos' : '☆ Agregar a favoritos'}</button>
        ${d.trailer ? `<button class="boton" data-f data-accion="trailer" data-v="${esc(d.trailer)}">🎬 Trailer</button>` : ''}
      </div>
      ${d.servidores.length ? `<div style="margin-top:12px;font-size:13px;color:#8a94a3">Servidores: ${esc(d.servidores.map((s) => s.server).join(', '))}</div>` : ''}
    </div>
  </div>`;
  // Guardar datos para cuando se dé play
  _peliActual = d;
}
let _peliActual = null;

// ---------- Acciones ----------
function hacer(acc, el) {
  if (acc === 'abrir') {
    const slug = el.dataset.slug;
    irA('#/peli/' + encodeURIComponent(slug));
    return {};
  }
  if (acc === 'ver') {
    const slug = el.dataset.slug;
    irA('#/ver/' + encodeURIComponent(slug));
    return {};
  }
  if (acc === 'fav') {
    const slug = el.dataset.slug;
    const on = slug in estado.favoritos ? '0' : '1';
    guardar({ accion: 'favorito', slug, on, title: el.dataset.title, img: el.dataset.img,
              url: el.dataset.url || '', sitio: el.dataset.sitio || 'cinecalidad' }).then(() => {
      toast(on === '1' ? 'Agregada a favoritos' : 'Quitada de favoritos');
      if (ruta().nombre === 'peli') render();
    });
    return {};
  }
  if (acc === 'trailer') {
    const id = el.dataset.v;
    salirDelVideo(true);
    document.body.classList.add('viendo');
    $('#cargando').style.display = 'none';
    const rep = $('#reproductor');
    rep.querySelectorAll('iframe').forEach((f) => f.remove());
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1';
    f.allow = 'autoplay; fullscreen; encrypted-media';
    f.allowFullscreen = true;
    rep.insertBefore(f, rep.firstChild);
    viendo = { slug: '__trailer__', trailer: true };
    winFull = true; aExt({ winFull: true }); aExt({ watch: true });
    return {};
  }
  if (acc === 'anime') { location.href = '../anime/'; return {}; }
  if (acc === 'youtube') { location.href = '../youtube/'; return {}; }
  return hacerVideo(acc, el);
}

// ---------- Menú contextual (mantener OK) ----------
let menuDatos = null;
function menuAbierto() { return $('#menu').classList.contains('abierto'); }
function cerrarMenu() { $('#menu').classList.remove('abierto'); menuDatos = null; enfocar(null); }

function activarMenu() {
  if (!foco || !foco.dataset.slug) return {};
  const slug = foco.dataset.slug;
  const esFav = slug in estado.favoritos;
  menuDatos = { slug, el: foco, title: foco.dataset.title, img: foco.dataset.img, url: foco.dataset.url, sitio: foco.dataset.sitio };
  $('#m-titulo').textContent = menuDatos.title || slug;
  $('#m-sub').textContent = '';
  let opts = `<button class="boton" data-f data-accion="m-ver">▶ Ver película</button>`;
  opts += `<button class="boton" data-f data-accion="m-info">ℹ Información</button>`;
  opts += `<button class="boton" data-f data-accion="m-fav">${esFav ? '★ Quitar de favoritos' : '☆ Agregar a favoritos'}</button>`;
  if (slug in estado.viendo) opts += `<button class="boton" data-f data-accion="m-sv">✕ Quitar de «Seguir viendo»</button>`;
  $('#m-opciones').innerHTML = `<div data-fila="mopts">${opts}</div>`;
  $('#menu').classList.add('abierto');
  enfocar($('#m-opciones [data-f]'));
  return {};
}

function hacerMenu(acc) {
  const d = menuDatos;
  if (!d) return {};
  cerrarMenu();
  if (acc === 'm-ver') { irA('#/ver/' + encodeURIComponent(d.slug)); return {}; }
  if (acc === 'm-info') { irA('#/peli/' + encodeURIComponent(d.slug)); return {}; }
  if (acc === 'm-fav') {
    const on = d.slug in estado.favoritos ? '0' : '1';
    guardar({ accion: 'favorito', slug: d.slug, on, title: d.title, img: d.img, url: d.url || '', sitio: d.sitio || 'cinecalidad' }).then(() => {
      toast(on === '1' ? 'Agregada a favoritos' : 'Quitada de favoritos');
    });
    return {};
  }
  if (acc === 'm-sv') {
    guardar({ accion: 'quitar', slug: d.slug }).then(() => {
      toast('Quitada de «Seguir viendo»');
      refrescar();
    });
    return {};
  }
  return {};
}

function refrescar() {
  cache.clear();
  cargandoPagina = true;
  rutaActual = '';
  render().then(() => { cargandoPagina = false; });
}

// ---------- Reproductor ----------
let viendo = null;   // {slug, servidores, servidor, ...}
let winFull = false;
let ocultarT = 0, guardarT = 0;

function pantallaCompleta(on) {
  winFull = on;
  return { winFull: on };
}
function terminado(t, d) { return d > 30 && t > d * 0.95; }

function elegirServidor(lista, preferido) {
  return lista.find((x) => x.server === preferido) || lista[0];
}

async function verPelicula(slug) {
  if (viendo && viendo.slug === slug) return;
  salirDelVideo(true);
  document.body.classList.add('viendo');
  $('#cargando').textContent = 'Cargando…';
  $('#cargando').style.display = '';
  enfocar(null);
  const v = viendo = { slug, inicio: Date.now(), reanudado: false, ultimo: null };
  if (!winFull) { winFull = true; aExt({ winFull: true }); }
  aExt({ watch: true });
  try {
    const d = _peliActual && _peliActual.servidores ? _peliActual : await api('pelicula', { slug });
    if (viendo !== v) return;
    v.title = d.title; v.img = d.img;
    v.servidores = d.servidores;
    if (!d.servidores.length) throw new Error('No hay servidores para esta película.');
    const guardado = estado.viendo[slug];
    v.desde = guardado && guardado.t > 20 && !terminado(guardado.t, guardado.d) ? guardado.t : 0;
    cargarServidor(elegirServidor(d.servidores, estado.servidor));
    guardar({ accion: 'progreso', slug, title: d.title, img: d.img, t: v.desde, d: guardado ? guardado.d : 0, servidor: '' });
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
  f.referrerPolicy = 'no-referrer';
  // Sandbox: evitar popups del reproductor
  f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  rep.insertBefore(f, rep.firstChild);
  f.addEventListener('load', () => { if (viendo === v) $('#cargando').style.display = 'none'; }, { once: true });
  pintarControles();
  abrirControles(false, 5000);
  // Autoplay
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
  $('#c-titulo').textContent = v.title || v.slug;
  $('#c-ayuda').textContent = 'Con el panel cerrado: ←/→ 10 s · OK pausa · ↑ o Atrás: cerrar este panel';
  const b = [];
  if (v.servidores && v.servidores.length) {
    b.push(v.servidores.map((x, j) =>
      `<button class="boton ${x.server === v.servidor ? 'activo' : ''}" data-f ${j === 0 ? 'data-inicial' : ''} data-accion="srv" data-j="${j}">${esc(x.server)}</button>`
    ).join(''));
  }
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
  if (!v) {
    if (acc.startsWith('m-')) return hacerMenu(acc);
    return {};
  }
  if (acc === 'srv') {
    const srv = v.servidores[+el.dataset.j];
    if (srv) { estado.servidor = srv.server; guardar({ accion: 'servidor', v: srv.server }); cargarServidor(srv); toast('Servidor: ' + srv.server); }
    enfocar($(`#controles [data-accion="srv"][data-j="${el.dataset.j}"]`));
    return {};
  }
  if (acc.startsWith('m-')) return hacerMenu(acc);
  return {};
}

function salirDelVideo(cambiando = false) {
  if (!viendo) return;
  guardarProgreso(true);
  viendo = null;
  clearTimeout(ocultarT); clearTimeout(guardarT);
  $('#controles').classList.remove('abierto');
  $('#reproductor').querySelectorAll('iframe').forEach((f) => f.remove());
  if (cambiando) return;
  document.body.classList.remove('viendo');
  if (winFull) { winFull = false; aExt({ winFull: false }); }
  aExt({ watch: false });
}

// Progreso del video (la extensión informa)
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
function guardarProgreso(forzar) {
  const v = viendo;
  if (!v || v.trailer || !v.ultimo) return;
  guardar({ accion: 'progreso', slug: v.slug, title: v.title || '', img: v.img || '', t: Math.round(v.ultimo.t), d: Math.round(v.ultimo.d), servidor: v.servidor || '' });
}

// Sin extensión: teclado
document.addEventListener('keydown', (ev) => {
  if (conExtension) return;
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                Enter: 'ok', Escape: 'back', Backspace: 'back', ' ': 'play',
                m: 'menu', M: 'menu' };
  const a = map[ev.key];
  if (!a) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT' && !['Escape', 'Enter'].includes(ev.key)) return;
  ev.preventDefault();
  accion(a);
});

// ---------- Arranque ----------
(async () => {
  try { estado = await api('estado'); } catch { }
  render();
})();
