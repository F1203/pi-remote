"""Modo YouTube: guarda «seguir viendo» y los canales favoritos de la pantalla youtube/.

Los videos los lee la página con la sesión de Brave (la extensión baja la página de YouTube y le
pasa su ytInitialData). Si la extensión no está (p. ej. al probar con otro navegador), la página
pide /youtube/api/pagina y el servidor la baja sin sesión: sirve para buscar y ver canales.
"""

import json
import re
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ESTADO = Path(__file__).resolve().parent / "youtube.json"  # no va al repo (.gitignore)
UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
_lock = threading.Lock()
_cache = {}  # url -> (vence, datos)


def extraer(html):
    """El ytInitialData de una página de YouTube (lo mismo hace bg.js con la sesión)."""
    for marca in ("var ytInitialData = ", 'window["ytInitialData"] = '):
        i = html.find(marca)
        if i >= 0:
            return json.JSONDecoder().raw_decode(html, i + len(marca))[0]
    raise ValueError("la página no trae ytInitialData")


def pagina(ruta):
    if not ruta.startswith("/") or ruta.startswith("//"):
        raise ValueError("ruta inválida")
    url = "https://www.youtube.com" + urllib.parse.quote(ruta, safe="/?=&%:+,;@-_.~")
    ahora = time.time()
    if url in _cache and _cache[url][0] > ahora:
        return _cache[url][1]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-419,es;q=0.9",
                                               "Cookie": "CONSENT=YES+1"})
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html)
    if m:
        _version["v"] = m.group(1)
    datos = {"data": extraer(html), "logueado": False, "embed": '"playableInEmbed":false' not in html}
    _cache[url] = (ahora + 600, datos)
    if len(_cache) > 100:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:40]:
            _cache.pop(k, None)
    return datos


_version = {"v": ""}  # versión del cliente web de YouTube (la piden las continuaciones)


def _cliente():
    if not _version["v"]:
        req = urllib.request.Request("https://www.youtube.com/", headers={"User-Agent": UA, "Cookie": "CONSENT=YES+1"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", "replace")
        m = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html)
        _version["v"] = m.group(1) if m else "2.20251120.01.00"
    return _version["v"]


def mas(token, tipo):
    """La tanda siguiente de una lista (lo que YouTube pide al llegar al final): videos de un canal o
    resultados de una búsqueda. Sin sesión: las listas personales (suscripciones…) no tienen más."""
    if not token or len(token) > 30000:
        raise ValueError("continuación inválida")
    url = "https://www.youtube.com/youtubei/v1/" + ("search" if tipo == "search" else "browse") + "?prettyPrint=false"
    cuerpo = {"context": {"client": {"clientName": "WEB", "clientVersion": _cliente(), "hl": "es-419", "gl": "UY"}},
              "continuation": token}
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode(), method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return {"data": json.load(r)}


# ---------- Estado ----------
def _leer():
    try:
        e = json.loads(ESTADO.read_text())
    except (OSError, ValueError):
        e = {}
    e.setdefault("viendo", {})    # id del video -> {title, canal, canalId, t, d, fecha}
    e.setdefault("canales", {})   # id del canal (UC…) -> {nombre, avatar, fecha}
    return e


def _escribir(e):
    tmp = ESTADO.with_suffix(".tmp")
    tmp.write_text(json.dumps(e, ensure_ascii=False, indent=1))
    tmp.replace(ESTADO)


def guardar(q):
    with _lock:
        e = _leer()
        acc = q.get("accion")
        vid = q.get("id", "")[:40]
        if acc == "progreso" and vid:
            e["viendo"][vid] = {"title": q.get("title", "")[:200], "canal": q.get("canal", "")[:100],
                                "canalId": q.get("canalId", "")[:40], "t": float(q.get("t", 0)),
                                "d": float(q.get("d", 0)), "fecha": time.time()}
            if len(e["viendo"]) > 200:  # los más viejos se olvidan
                for k in sorted(e["viendo"], key=lambda k: e["viendo"][k]["fecha"])[:50]:
                    e["viendo"].pop(k, None)
        elif acc == "quitar" and vid:  # sacarlo de «seguir viendo»
            e["viendo"].pop(vid, None)
        elif acc == "canal" and vid:
            if q.get("on") == "1":
                antes = e["canales"].get(vid) or {}  # al corregir el nombre no cambia de lugar
                e["canales"][vid] = {"nombre": q.get("nombre", "")[:100], "avatar": q.get("avatar", "")[:400],
                                     "fecha": antes.get("fecha", time.time())}
            else:
                e["canales"].pop(vid, None)
        else:
            return {"ok": False, "error": "acción desconocida"}
        _escribir(e)
        return {"ok": True, "estado": e}


def api(ruta, query):
    """Atiende /youtube/api/<ruta>. Devuelve (código HTTP, objeto para JSON)."""
    q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
    try:
        if ruta == "estado":
            with _lock:
                return 200, _leer()
        if ruta == "guardar":
            return 200, guardar(q)
        if ruta == "pagina":
            return 200, pagina(q["p"])
        if ruta == "mas":
            return 200, mas(q.get("token", ""), q.get("tipo", ""))
        if ruta == "log":  # la página avisa si la extensión ve la sesión (para el registro del servicio)
            logging.info("youtube: %s", q.get("m", "")[:200])
            return 200, {"ok": True}
        return 404, {"error": "no existe"}
    except urllib.error.HTTPError as ex:
        return 502, {"error": f"YouTube respondió {ex.code}"}
    except (urllib.error.URLError, TimeoutError, OSError) as ex:
        logging.warning("youtube: sin conexión: %s", ex)
        return 502, {"error": "No se pudo conectar con YouTube"}
    except (KeyError, ValueError, TypeError) as ex:
        logging.warning("youtube: %s %s: %r", ruta, query, ex)
        return 400, {"error": "pedido o respuesta inválida"}
