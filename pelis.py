"""Modo pelis: películas de Cinecalidad (y otros sitios) como una app de Smart TV.

La pantalla está en pelis/ y la sirve server.py en /pelis/. Las rutas /pelis/api/... llegan acá.
Scrapeamos el HTML de cada sitio para extraer la cartelera, búsqueda y los servidores de video.
"""

import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
ESTADO = Path(__file__).resolve().parent / "pelis.json"  # no va al repo (.gitignore)

_cache = {}  # url -> (vence, datos)
_lock = threading.Lock()


# ---------- HTTP ----------
def _get(url, dura=600):
    """Descarga una página con caché."""
    ahora = time.time()
    if url in _cache and _cache[url][0] > ahora:
        return _cache[url][1]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-419,es;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    _cache[url] = (ahora + dura, html)
    if len(_cache) > 200:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:60]:
            _cache.pop(k, None)
    return html


# ==========================================================================
#  Cinecalidad
# ==========================================================================
CC_HOST = "https://www.cinecalidad.my"

# Mapeo service -> plantilla de embed  (el JS de Cinecalidad hace exactamente esto)
CC_EMBED = {
    "OnlineFilemoon":   "https://bysedikamoum.com/e/{data}",
    "OnlineVoe":        "https://voe.sx/e/{data}",
    "OnlineDoodstream": "https://doodstream.com/e/{data}",
    "OnlineMega":       "https://mega.nz/embed/{data}",
    "OnlineNetu":       "https://www.zarato.top/watch_video.php?v={data}",
}
CC_NOMBRES = {
    "OnlineFilemoon": "Filemoon", "OnlineVoe": "Voe", "OnlineDoodstream": "Doodstream",
    "OnlineMega": "Mega", "OnlineNetu": "Netu",
}


def _cc_tarjetas(html):
    """Extrae las tarjetas de películas del HTML de Cinecalidad."""
    pelis = []
    for m in re.finditer(
        r'home_post_cont[^>]*>\s*<a\s+href=(\S+)\s*>\s*<img[^>]*src=(\S+)[^>]*extract="([^"]+)"',
        html
    ):
        url, img, extract = m.groups()
        extract = unescape(extract)
        titulo = re.search(r'in_title[^>]*>([^<]+)', extract)
        titulo = unescape(titulo.group(1)).strip() if titulo else ""
        sinopsis = re.search(r'<p>([^<]+)', extract)
        sinopsis = unescape(sinopsis.group(1)).strip() if sinopsis else ""
        cat = re.search(r'home_post_cat(.*?)</div>', extract, re.DOTALL)
        generos = [unescape(g).strip() for g in re.findall(r'>([^<]+)</a>', cat.group(1))] if cat else []
        # Slug: la parte útil de la URL
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        pelis.append({
            "slug": slug, "url": url, "title": titulo, "img": img, "img_grande": _img_grande(img),
            "sinopsis": sinopsis[:300], "generos": [g for g in generos if g.lower() != "destacada"],
            "destacada": any(g.lower() == "destacada" for g in generos), "sitio": "cinecalidad",
        })
    return pelis


def _img_grande(img):
    """La misma portada sin achicar (Cinecalidad sirve la miniatura como nombre-220x320.jpg)."""
    return re.sub(r"-\d+x\d+(\.\w+)$", r"\1", img)


def cc_inicio():
    html = _get(CC_HOST + "/", dura=600)
    return {"pelis": _cc_tarjetas(html)}


def cc_destacadas():
    return cc_genero("destacada")


def cc_genero(genero, pagina=1):
    url = f"{CC_HOST}/genero-peliculas/{genero}/"
    if pagina > 1:
        url += f"page/{pagina}/"
    html = _get(url, dura=900)
    return {"pelis": _cc_tarjetas(html), "pagina": pagina}


def cc_buscar(q, pagina=1):
    params = urllib.parse.urlencode({"s": q})
    url = f"{CC_HOST}/?{params}"
    if pagina > 1:
        url += f"&paged={pagina}"
    html = _get(url, dura=300)
    return {"pelis": _cc_tarjetas(html), "pagina": pagina}


def cc_pelicula(slug):
    """Detalles y servidores de una película de Cinecalidad."""
    url = f"{CC_HOST}/pelicula/{slug}/"
    html = _get(url, dura=1800)

    titulo = ""
    m = re.search(r"<h1>([^<]+)", html)
    if m:
        titulo = m.group(1).strip()

    rating = ""
    m = re.search(r"([\d.]+)/10", html)
    if m:
        rating = m.group(1)

    sinopsis = ""
    m = re.search(r"text-align:justify[^>]*>(.+?)</td>", html, re.DOTALL)
    if m:
        raw = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        # Cortar antes de los metadatos (Títulos:, IMDb:, Género:, Audio:, etc.)
        for corte in ("Títulos:", "IMDb:", "Género:", "Audio:", "Calidad:", "Director:", "Elenco:"):
            i = raw.find(corte)
            if i > 0:
                raw = raw[:i].strip()
                break
        sinopsis = unescape(raw).replace("\xa0", " ").strip()

    img = ""
    m = re.search(r"single_left.*?<img[^>]*src=(\S+)", html)
    if m:
        img = m.group(1)

    # Los datos de la ficha (no el menú del sitio, que también enlaza a todos los géneros)
    def dato(nombre):
        m = re.search(nombre + r":</strong>(.*?)</span>", html, re.DOTALL)
        return unescape(re.sub(r"<[^>]+>", "", m.group(1))).replace("\xa0", " ").strip() if m else ""

    generos = []
    m = re.search(r"Género:</strong>(.*?)</span>", html, re.DOTALL)
    if m:
        for g in re.findall(r">([^<]+)</a>", m.group(1)):
            g = unescape(g).strip()
            if g.lower() != "destacada" and g.lower() not in [x.lower() for x in generos]:
                generos.append(g[:1].upper() + g[1:])
    director = dato("Director")
    elenco = [x.strip() for x in dato("Elenco").split(",") if x.strip()][:5]
    audio = dato("Audio")
    calidad = dato("Calidad").split("|")[0].strip()
    original = dato("Títulos")

    anio = ""
    m = re.search(r"\((\d{4})\)", titulo)
    if m:
        anio = m.group(1)

    # Servidores de video online
    servidores = []
    for sm in re.finditer(
        r'class=(?:"link onlinelink"|link\s+onlinelink)\s+service=(\w+)\s+data=([^>]+?)><li>',
        html
    ):
        service, data = sm.groups()
        if service == "Trailer":
            continue
        nombre = CC_NOMBRES.get(service, service.replace("Online", ""))
        plantilla = CC_EMBED.get(service)
        embed = plantilla.format(data=data) if plantilla else ""
        if embed:
            servidores.append({"server": nombre, "url": embed})

    # Trailer
    trailer = ""
    m = re.search(r'service=Trailer\s+data=([^>]+?)><li>', html)
    if m:
        trailer = m.group(1)

    return {
        "title": titulo, "rating": rating, "sinopsis": sinopsis, "img": img,
        "generos": generos, "director": director, "anio": anio, "elenco": elenco,
        "audio": audio, "calidad": calidad, "original": original,
        "img_grande": _img_grande(img),
        "servidores": servidores, "trailer": trailer, "sitio": "cinecalidad",
    }


# ==========================================================================
#  Cuevana (cuevana.biz) — otro sitio popular, estructura similar
# ==========================================================================
CV_HOST = "https://ww1.cuevana.biz"


def _cv_tarjetas(html):
    pelis = []
    for m in re.finditer(
        r'<article[^>]*>.*?<a\s+href="([^"]+)"[^>]*>.*?<img[^>]+src="([^"]+)".*?'
        r'<h2[^>]*>([^<]+)</h2>.*?</article>',
        html, re.DOTALL
    ):
        url, img, titulo = m.groups()
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        pelis.append({
            "slug": slug, "url": url, "title": titulo.strip(), "img": img,
            "sinopsis": "", "generos": [], "sitio": "cuevana",
        })
    return pelis


# ==========================================================================
#  Estado: favoritos, seguir viendo
# ==========================================================================
def _leer():
    try:
        e = json.loads(ESTADO.read_text())
    except (OSError, ValueError):
        e = {}
    e.setdefault("favoritos", {})   # slug -> {title, img, url, sitio, fecha}
    e.setdefault("viendo", {})      # slug -> {title, img, url, sitio, t, d, servidor, fecha}
    e.setdefault("servidor", "")    # último servidor elegido a mano
    return e


def _escribir(e):
    tmp = ESTADO.with_suffix(".tmp")
    tmp.write_text(json.dumps(e, ensure_ascii=False, indent=1))
    tmp.replace(ESTADO)


def guardar(q):
    with _lock:
        e = _leer()
        acc = q.get("accion")
        slug = q.get("slug", "")
        if acc == "servidor":
            e["servidor"] = q.get("v", "")[:40]
        elif acc == "favorito" and slug:
            if q.get("on") == "1":
                e["favoritos"][slug] = {
                    "title": q.get("title", "")[:200], "img": q.get("img", "")[:400],
                    "url": q.get("url", "")[:400], "sitio": q.get("sitio", "cinecalidad"),
                    "fecha": time.time(),
                }
            else:
                e["favoritos"].pop(slug, None)
        elif acc == "progreso" and slug:
            e["viendo"][slug] = {
                "title": q.get("title", "")[:200], "img": q.get("img", "")[:400],
                "url": q.get("url", "")[:400], "sitio": q.get("sitio", "cinecalidad"),
                "t": float(q.get("t", 0)), "d": float(q.get("d", 0)),
                "servidor": q.get("servidor", "")[:40], "fecha": time.time(),
            }
            if len(e["viendo"]) > 100:
                for k in sorted(e["viendo"], key=lambda k: e["viendo"][k]["fecha"])[:30]:
                    e["viendo"].pop(k, None)
        elif acc == "quitar" and slug:
            e["viendo"].pop(slug, None)
        else:
            return {"ok": False, "error": "acción desconocida"}
        _escribir(e)
        return {"ok": True, "estado": e}


GENEROS = [
    "accion", "animacion", "aventura", "ciencia-ficcion", "comedia", "crimen",
    "drama", "familiar", "fantasia", "misterio", "romance", "suspenso", "terror",
]


def api(ruta, query):
    """Atiende /pelis/api/<ruta>. Devuelve (código HTTP, objeto para JSON)."""
    q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
    try:
        if ruta == "inicio":
            return 200, cc_inicio()
        if ruta == "buscar":
            return 200, cc_buscar(q.get("q", ""), int(q.get("pagina", 1)))
        if ruta == "genero":
            return 200, cc_genero(q["g"], int(q.get("pagina", 1)))
        if ruta == "pelicula":
            return 200, cc_pelicula(q["slug"])
        if ruta == "destacadas":
            return 200, cc_destacadas()
        if ruta == "generos":
            return 200, {"generos": GENEROS}
        if ruta == "estado":
            with _lock:
                return 200, _leer()
        if ruta == "guardar":
            return 200, guardar(q)
        return 404, {"error": "no existe"}
    except urllib.error.HTTPError as ex:
        return (404 if ex.code == 404 else 502), {"error": f"el sitio respondió {ex.code}"}
    except (urllib.error.URLError, TimeoutError, OSError) as ex:
        logging.warning("pelis: sin conexión: %s", ex)
        return 502, {"error": "No se pudo conectar con el sitio"}
    except (KeyError, ValueError, TypeError) as ex:
        logging.warning("pelis: %s %s: %r", ruta, query, ex)
        return 400, {"error": "pedido o respuesta inválida"}
