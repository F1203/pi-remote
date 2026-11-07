#!/usr/bin/env python3
"""Control remoto para la Raspberry Pi: trackpad, scroll, teclado y atajos de Brave desde el celular."""
import asyncio
import json
import logging
import re
import socket
import time
from http import HTTPStatus
from pathlib import Path

from evdev import UInput, ecodes as e
from websockets.asyncio.server import serve, broadcast
from websockets.datastructures import Headers
from websockets.http11 import Response

PORT = 8080
BASE = Path(__file__).resolve().parent
MODS = {"ctrl": e.KEY_LEFTCTRL, "shift": e.KEY_LEFTSHIFT, "alt": e.KEY_LEFTALT, "logo": e.KEY_LEFTMETA}
# Nombres de tecla que manda la página -> códigos evdev (las letras no cambian de lugar en es/latam)
KEYS = {
    "space": e.KEY_SPACE, "Tab": e.KEY_TAB, "Return": e.KEY_ENTER, "BackSpace": e.KEY_BACKSPACE,
    "Escape": e.KEY_ESC, "Left": e.KEY_LEFT, "Right": e.KEY_RIGHT, "Up": e.KEY_UP, "Down": e.KEY_DOWN,
    "Home": e.KEY_HOME, "End": e.KEY_END, "Delete": e.KEY_DELETE,
    **{f"F{i}": getattr(e, f"KEY_F{i}") for i in range(1, 13)},
    **{c: getattr(e, f"KEY_{c.upper()}") for c in "abcdefghijklmnopqrstuvwxyz"},
    **{c: getattr(e, f"KEY_{c}") for c in "0123456789"}, ".": e.KEY_DOT, ",": e.KEY_COMMA,
}

clients = set()
last_click = {}  # último clic izquierdo pedido desde el celular: id, ws, time
key_lock = asyncio.Lock()

mouse = UInput(
    {
        e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE],
        e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL, e.REL_HWHEEL,
                   e.REL_WHEEL_HI_RES, e.REL_HWHEEL_HI_RES],
    },
    name="pi-remote-mouse",
)
BUTTONS = {"l": e.BTN_LEFT, "r": e.BTN_RIGHT, "m": e.BTN_MIDDLE}
keyboard = UInput({e.EV_KEY: sorted(set(KEYS.values()) | set(MODS.values()))}, name="pi-remote-keyboard")
scroll_acc = {"v": 0.0, "h": 0.0}


def move(dx, dy):
    mouse.write(e.EV_REL, e.REL_X, int(dx))
    mouse.write(e.EV_REL, e.REL_Y, int(dy))
    mouse.syn()


def scroll(dx, dy):
    # 120 unidades hi-res = 1 "click" de rueda
    for axis, d, hi, lo in (("v", dy, e.REL_WHEEL_HI_RES, e.REL_WHEEL),
                            ("h", dx, e.REL_HWHEEL_HI_RES, e.REL_HWHEEL)):
        hi_val = int(d * 6)
        if not hi_val:
            continue
        mouse.write(e.EV_REL, hi, hi_val)
        scroll_acc[axis] += hi_val
        notches = int(scroll_acc[axis] / 120)
        if notches:
            mouse.write(e.EV_REL, lo, notches)
            scroll_acc[axis] -= notches * 120
    mouse.syn()


def button(b, down):
    mouse.write(e.EV_KEY, BUTTONS[b], 1 if down else 0)
    mouse.syn()


async def run(*args):
    async with key_lock:
        proc = await asyncio.create_subprocess_exec(*args)
        await proc.wait()


def press_key(key, mods=()):
    # Teclado virtual real: más confiable que wtype para atajos (no cambia el keymap)
    code = KEYS[key]
    mods = [MODS[m] for m in mods if m in MODS]
    for m in mods:
        keyboard.write(e.EV_KEY, m, 1)
    keyboard.syn()
    keyboard.write(e.EV_KEY, code, 1)
    keyboard.syn()
    keyboard.write(e.EV_KEY, code, 0)
    keyboard.syn()
    for m in reversed(mods):
        keyboard.write(e.EV_KEY, m, 0)
    keyboard.syn()


# Caracteres que el teclado virtual puede escribir directo con la distribución latam (sin wtype)
DIRECT = {" ": ("space", ()), ".": (".", ()), ",": (",", ())}
DIRECT.update({c: (c, ()) for c in "abcdefghijklmnopqrstuvwxyz0123456789"})
DIRECT.update({c.upper(): (c, ("shift",)) for c in "abcdefghijklmnopqrstuvwxyz"})


async def wtype_text(text, backspaces):
    # wtype arma un teclado temporal y le da al primer carácter el código físico 1 (= Escape).
    # Brave, para lo que no es letra o número, mira la tecla física: un espacio o un punto le
    # llegaban como Escape y deshacía lo escrito en la barra de direcciones. Por eso lo común se
    # escribe con el teclado virtual real y wtype queda solo para tildes, ñ y símbolos.
    async with key_lock:
        for _ in range(backspaces):
            press_key("BackSpace")
        chunk = ""
        for ch in text + "\0":
            if ch in DIRECT or ch == "\0":
                if chunk:
                    await asyncio.sleep(0.02)  # que el compositor procese antes lo del teclado virtual
                    # Shift_L ocupa el código 1 (Escape) para que ningún carácter real caiga ahí
                    proc = await asyncio.create_subprocess_exec(
                        "wtype", "-P", "Shift_L", "-p", "Shift_L", "--", chunk)
                    await proc.wait()
                    chunk = ""
                if ch != "\0":
                    key, mods = DIRECT[ch]
                    press_key(key, mods)
            else:
                chunk += ch


async def output(text):
    proc = await asyncio.create_subprocess_exec(*text, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.DEVNULL)
    out, _ = await proc.communicate()
    return out.decode()


asleep = False


async def go_to_sleep():
    """Modo reposo: pausa lo que se esté reproduciendo (MPRIS) y apaga la señal de la pantalla."""
    global asleep
    names = await output(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                          "--object-path", "/org/freedesktop/DBus",
                          "--method", "org.freedesktop.DBus.ListNames"])
    for name in re.findall(r"org\.mpris\.MediaPlayer2\.[\w.\-]+", names):
        await output(["gdbus", "call", "--session", "--dest", name, "--object-path",
                      "/org/mpris/MediaPlayer2", "--method", "org.mpris.MediaPlayer2.Player.Pause"])
    await run("wlopm", "--off", "*")
    asleep = True
    broadcast(clients, json.dumps({"t": "sleep", "on": True}))


async def wake():
    global asleep
    if asleep:
        asleep = False
        await run("wlopm", "--on", "*")
        broadcast(clients, json.dumps({"t": "sleep", "on": False}))


extensions = set()  # conexiones de la extensión de Brave (/ext)
seek_waiters = {}  # id -> Future con la respuesta de la extensión
seek_seq = 0


async def mpris_seek(seconds):
    """Respaldo fuera de Brave: adelanta los reproductores MPRIS que estén reproduciendo."""
    names = await output(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                          "--object-path", "/org/freedesktop/DBus",
                          "--method", "org.freedesktop.DBus.ListNames"])
    done = False
    for name in re.findall(r"org\.mpris\.MediaPlayer2\.[\w.\-]+", names):
        status = await output(["gdbus", "call", "--session", "--dest", name, "--object-path",
                               "/org/mpris/MediaPlayer2", "--method", "org.freedesktop.DBus.Properties.Get",
                               "org.mpris.MediaPlayer2.Player", "PlaybackStatus"])
        if "Playing" in status:
            await output(["gdbus", "call", "--session", "--dest", name, "--object-path",
                          "/org/mpris/MediaPlayer2", "--method", "org.mpris.MediaPlayer2.Player.Seek",
                          str(int(seconds * 1_000_000))])
            done = True
    return done


async def seek(seconds):
    """Adelanta el video: primero en la pestaña activa de Brave (vía extensión), si no por MPRIS."""
    global seek_seq
    for ext in list(extensions):
        seek_seq += 1
        fut = asyncio.get_running_loop().create_future()
        seek_waiters[seek_seq] = fut
        try:
            await ext.send(json.dumps({"t": "seek", "s": seconds, "id": seek_seq}))
            if await asyncio.wait_for(fut, 2):
                return True
        except Exception as ex:
            logging.warning("extensión no respondió al seek: %s", ex)
        finally:
            seek_waiters.pop(seek_seq, None)
    return await mpris_seek(seconds)


async def handle_extension(ws):
    extensions.add(ws)
    logging.info("extensión de Brave conectada")
    try:
        async for raw in ws:
            m = json.loads(raw)
            if m.get("t") == "seekres":
                fut = seek_waiters.get(m.get("id"))
                if fut and not fut.done():
                    fut.set_result(bool(m.get("ok")))
    finally:
        extensions.discard(ws)


async def keep_extension_alive():
    # Brave suspende el service worker de la extensión si pasan 30 s sin mensajes
    while True:
        await asyncio.sleep(20)
        broadcast(extensions, json.dumps({"t": "ping"}))


async def handle(ws):
    if ws.request.path == "/ext":
        return await handle_extension(ws)
    clients.add(ws)
    await ws.send(json.dumps({"t": "sleep", "on": asleep}))
    try:
        async for raw in ws:
            try:
                m = json.loads(raw)
                t = m.get("t")
                if t == "hb":  # latido del celular: responder sin despertar la pantalla
                    await ws.send('{"t":"hb"}')
                    continue
                if t == "poweroff":
                    logging.info("apagando la Raspberry Pi por pedido del celular")
                    await run("systemctl", "poweroff")
                    continue
                if t == "sleep":
                    await go_to_sleep()
                    continue
                await wake()  # cualquier otra acción despierta la pantalla
                if t == "wake":
                    continue
                if t == "m":
                    move(m["x"], m["y"])
                elif t == "s":
                    scroll(m.get("x", 0), m.get("y", 0))
                elif t == "c":
                    if m.get("b", "l") == "l" and "id" in m:
                        last_click.update(id=m["id"], ws=ws, time=time.monotonic())
                    button(m.get("b", "l"), True)
                    button(m.get("b", "l"), False)
                elif t == "d":
                    button(m.get("b", "l"), bool(m.get("down")))
                elif t == "k":
                    async with key_lock:  # respetar el orden respecto al texto que escribe wtype
                        press_key(str(m["k"]), m.get("mods", []))
                elif t == "txt":
                    await wtype_text(str(m.get("s", "")), int(m.get("bs", 0)))
                elif t == "vol":
                    step = "5%+" if m.get("d", 1) > 0 else "5%-"
                    await run("wpctl", "set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", step)
                elif t == "seek":
                    ok = await seek(float(m.get("s", 85)))
                    await ws.send(json.dumps({"t": "seekres", "ok": ok}))
                elif t == "mute":
                    await run("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle")
            except Exception as ex:  # un mensaje malo no debe tirar la conexión
                logging.warning("mensaje inválido %r: %s", raw, ex)
    finally:
        clients.discard(ws)


def http_response(status, body, ctype):
    body = body if isinstance(body, bytes) else body.encode()
    headers = Headers([
        ("Content-Type", ctype),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
        ("Access-Control-Allow-Origin", "*"),
    ])
    return Response(status.value, status.phrase, headers, body)


def process_request(connection, request):
    path, _, query = request.path.partition("?")
    if path in ("/ws", "/ext"):
        return None
    if path == "/focus":
        # La extensión de Brave informa, tras cada clic, si quedó enfocado un campo de texto.
        # Solo se reenvía si responde a un clic reciente hecho desde el celular.
        editable = "editable=1" in query
        logging.info("extensión: clic -> editable=%s", editable)
        ws = last_click.get("ws")
        if ws in clients and time.monotonic() - last_click["time"] < 1.5:
            broadcast([ws], json.dumps({"t": "clickres", "id": last_click["id"], "editable": editable}))
            last_click.clear()
        return http_response(HTTPStatus.OK, "ok", "text/plain")
    if path in ("/", "/index.html"):
        return http_response(HTTPStatus.OK, (BASE / "index.html").read_bytes(),
                             "text/html; charset=utf-8")
    return http_response(HTTPStatus.NOT_FOUND, "not found", "text/plain")


def local_ips():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def main():
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    async with serve(handle, "0.0.0.0", PORT, process_request=process_request,
                     ping_interval=10, compression=None) as server:
        print(f"Pi Remote en http://{local_ips()}:{PORT}  o  http://{socket.gethostname()}.local:{PORT}",
              flush=True)
        asyncio.create_task(keep_extension_alive())
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
