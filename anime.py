"""Modo anime: lee animeav1.com (sus datos en JSON de SvelteKit) y guarda «seguir viendo» y «mi lista».

La pantalla está en anime/ y la sirve server.py en /anime/. Las rutas /anime/api/... llegan acá.
"""

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITIO = "https://animeav1.com"
UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
ESTADO = Path(__file__).resolve().parent / "anime.json"  # no va al repo (.gitignore)

_cache = {}  # url -> (vence, datos)
_lock = threading.Lock()


# ---------- Lectura de animeav1 ----------
def _unflatten(a):
    """Formato «devalue» de SvelteKit: una lista plana donde los objetos apuntan a índices."""
    hechos = {}

    def h(i):
        if i == -1:
            return None
        if i in hechos:
            return hechos[i]
        v = a[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in ("Date", "Set", "Map", "BigInt"):
                r = v[1]
            else:
                r = []
                hechos[i] = r
                r.extend(h(x) for x in v)
        elif isinstance(v, dict):
            r = {}
            hechos[i] = r
            for k, x in v.items():
                r[k] = h(x)
        else:
            r = v
        hechos[i] = r
        return r

    return h(0)


def _datos(ruta, query=None, dura=600):
    """Datos de una página de animeav1 (el último nodo con datos de su __data.json)."""
    url = f"{SITIO}{ruta.rstrip('/')}/__data.json"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    ahora = time.time()
    if url in _cache and _cache[url][0] > ahora:
        return _cache[url][1]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        crudo = json.load(r)
    nodos = [n for n in crudo.get("nodes", []) if n and n.get("type") == "data" and n.get("data")]
    if not nodos:
        raise ValueError("respuesta sin datos")
    datos = _unflatten(nodos[-1]["data"])
    _cache[url] = (ahora + dura, datos)
    if len(_cache) > 300:  # que no crezca sin fin
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:100]:
            _cache.pop(k, None)
    return datos


def _serie_corta(m):
    cat = m.get("category") or {}
    return {"id": m.get("id"), "slug": m.get("slug"), "title": m.get("title"),
            "cat": cat.get("name"), "synopsis": (m.get("synopsis") or "")[:400]}


def inicio():
    d = _datos("/", dura=300)
    destacados = []
    for m in d.get("featured") or []:
        s = _serie_corta(m)
        s["genres"] = [g.get("name") for g in m.get("genres") or []]
        destacados.append(s)
    episodios = [{"id": (e.get("media") or {}).get("id"), "slug": (e.get("media") or {}).get("slug"),
                  "title": (e.get("media") or {}).get("title"), "ep": e.get("number"),
                  "fecha": e.get("publishedAt") or e.get("createdAt")}
                 for e in d.get("latestEpisodes") or []]
    return {"destacados": destacados, "episodios": episodios,
            "nuevos": [_serie_corta(m) for m in d.get("latestMedia") or []]}


def serie(slug):
    m = _datos(f"/media/{slug}", dura=600)["media"]
    s = _serie_corta(m)
    s["synopsis"] = m.get("synopsis") or ""
    s.update({
        "genres": [g.get("name") for g in m.get("genres") or []],
        "status": {0: "Finalizado", 1: "Próximamente", 2: "En emisión"}.get(m.get("status"), ""),
        "score": m.get("score"), "year": (m.get("startDate") or "")[:4], "nextDate": m.get("nextDate"),
        "episodes": sorted(e.get("number") for e in m.get("episodes") or [] if e.get("number") is not None),
        "relations": [{**_serie_corta(r.get("destination") or r), "rel": r.get("type")}
                      for r in m.get("relations") or [] if (r.get("destination") or r).get("slug")],
    })
    return s


def episodio(slug, n):
    d = _datos(f"/media/{slug}/{n}", dura=600)
    ep = d.get("episode") or {}
    return {"ep": ep.get("number"), "title": ep.get("title"),
            "embeds": {k: [{"server": x.get("server"), "url": x.get("url")} for x in v or []]
                       for k, v in (d.get("embeds") or {}).items()}}


FILTROS = ("search", "genre", "category", "status", "order", "letter", "page")


def catalogo(q):
    query = {k: q[k] for k in FILTROS if q.get(k)}
    d = _datos("/catalogo", query, dura=900)
    pag = d.get("pagination") or {}
    return {"results": [_serie_corta(m) for m in d.get("results") or []],
            "page": pag.get("currentPage", 1), "pages": pag.get("totalPages", 1),
            "total": pag.get("totalRecords", 0)}


def horario():
    d = _datos("/horario", dura=1800)
    out = []
    for m in d.get("media") or []:
        s = _serie_corta(m)
        le = m.get("latestEpisode") or {}
        s.update({"ep": le.get("number"), "fecha": le.get("createdAt")})
        out.append(s)
    return {"media": out}


# ---------- Estado: seguir viendo, mi lista, vistos, audio ----------
def _leer():
    try:
        e = json.loads(ESTADO.read_text())
    except (OSError, ValueError):
        e = {}
    e.setdefault("audio", "SUB")
    e.setdefault("lista", {})    # slug -> {id, title, agregado}
    e.setdefault("viendo", {})   # slug -> {id, title, ep, t, d, fecha}
    e.setdefault("vistos", {})   # slug -> [números de episodio]
    e.setdefault("servidor", "")  # último servidor elegido a mano
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
        if acc == "audio" and q.get("v") in ("SUB", "DUB"):
            e["audio"] = q["v"]
        elif acc == "servidor":
            e["servidor"] = q.get("v", "")[:40]
        elif acc == "lista" and slug:
            if q.get("on") == "1":
                e["lista"][slug] = {"id": q.get("id"), "title": q.get("title", ""), "fecha": time.time()}
            else:
                e["lista"].pop(slug, None)
        elif acc == "progreso" and slug:
            ep = float(q.get("ep", 0))
            ep = int(ep) if ep == int(ep) else ep
            e["viendo"][slug] = {"id": q.get("id"), "title": q.get("title", ""), "ep": ep,
                                 "t": float(q.get("t", 0)), "d": float(q.get("d", 0)), "fecha": time.time()}
        elif acc == "visto" and slug:
            ep = float(q.get("ep", 0))
            ep = int(ep) if ep == int(ep) else ep
            vistos = set(e["vistos"].get(slug, []))
            vistos.add(ep)
            e["vistos"][slug] = sorted(vistos)
        elif acc == "quitar" and slug:  # sacarlo de «seguir viendo»
            e["viendo"].pop(slug, None)
        else:
            return {"ok": False, "error": "acción desconocida"}
        _escribir(e)
        return {"ok": True, "estado": e}


# ---------- Diagnóstico de trabadas (temporal) ----------
DIAG = Path(__file__).resolve().parent / "anime-diag.log"


def _sistema():
    """Temperatura, carga, frecuencia, baja de velocidad y señal WiFi, para el registro."""
    def leer(ruta):
        try:
            return Path(ruta).read_text().strip()
        except OSError:
            return ""
    temp = leer("/sys/class/thermal/thermal_zone0/temp")
    wifi = ""
    for linea in leer("/proc/net/wireless").splitlines()[2:]:
        partes = linea.split()
        if len(partes) > 3:
            wifi = f"{partes[0]} calidad {partes[2].rstrip('.')} señal {partes[3].rstrip('.')} dBm"
    try:
        import subprocess
        thr = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=2).stdout.strip()
    except Exception:
        thr = ""
    return (f"temp {int(temp) / 1000:.1f}°C · carga {' '.join(leer('/proc/loadavg').split()[:3])} · "
            f"cpu {int(leer('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') or 0) // 1000} MHz · {thr} · {wifi}")


def diag(q):
    try:
        d = json.loads(q.get("d", "{}"))
    except ValueError:
        d = {}
    ev = d.pop("ev", "?")
    sys_ = d.pop("sys", None)
    vt = d.pop("vt", None)
    hora = time.strftime("%H:%M:%S")
    minuto = f"{int(vt // 60)}:{int(vt % 60):02d}" if isinstance(vt, (int, float)) else "-"
    extra = " ".join(f"{k}={v}" for k, v in d.items())
    linea = f"{hora} [{q.get('ep', '')}] video {minuto:>6} {ev:<15} {extra}"
    if sys_:
        linea += " | " + _sistema()
    with _lock, DIAG.open("a") as f:
        f.write(linea + "\n")
    return {"ok": True}


def api(ruta, query):
    """Atiende /anime/api/<ruta>. Devuelve (código HTTP, objeto para JSON)."""
    q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
    try:
        if ruta == "inicio":
            return 200, inicio()
        if ruta == "serie":
            return 200, serie(q["slug"])
        if ruta == "episodio":
            return 200, episodio(q["slug"], q["n"])
        if ruta == "catalogo":
            return 200, catalogo(q)
        if ruta == "horario":
            return 200, horario()
        if ruta == "estado":
            with _lock:
                return 200, _leer()
        if ruta == "guardar":
            return 200, guardar(q)
        if ruta == "log":
            return 200, diag(q)
        return 404, {"error": "no existe"}
    except urllib.error.HTTPError as ex:
        return (404 if ex.code == 404 else 502), {"error": f"animeav1 respondió {ex.code}"}
    except (urllib.error.URLError, TimeoutError, OSError) as ex:
        logging.warning("anime: sin conexión con animeav1: %s", ex)
        return 502, {"error": "No se pudo conectar con animeav1"}
    except (KeyError, ValueError, TypeError) as ex:
        logging.warning("anime: %s %s: %r", ruta, query, ex)
        return 400, {"error": "pedido o respuesta inválida"}
