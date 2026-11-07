"""Transporte Bluetooth LE de Pi Remote.

Expone un servicio GATT con dos características, al estilo de un puerto serie:
  RX (celular -> Pi): el celular escribe mensajes JSON terminados en "\\n", partidos en trozos
                      del tamaño que permita la conexión (MTU).
  TX (Pi -> celular): notificaciones con el mismo formato; leerla devuelve el estado inicial.

Las dos exigen un enlace cifrado y autenticado: la primera vez el celular tiene que emparejarse
escribiendo el código de 6 dígitos que la Raspberry muestra en su pantalla. Sin eso, nadie que
esté cerca puede mover el mouse ni escribir.
"""
import asyncio
import json
import logging

from dbus_fast import BusType, DBusError, Variant
from dbus_fast.aio import MessageBus
from dbus_fast.service import PropertyAccess, ServiceInterface, dbus_property, method

SERVICE_UUID = "b551c54d-9c48-4fe0-9d31-977e0f89ca05"
RX_UUID = "73aafe26-bfae-4d37-913b-605c6c5c1896"
TX_UUID = "9c421de1-3bfe-4d09-a4c8-f5e99e7e2580"

BLUEZ = "org.bluez"
ADAPTER = "/org/bluez/hci0"
ROOT = "/pi_remote"
SERVICE_PATH = ROOT + "/service0"
RX_PATH = SERVICE_PATH + "/rx"
TX_PATH = SERVICE_PATH + "/tx"
ADV_PATH = ROOT + "/adv0"
AGENT_PATH = ROOT + "/agent"

log = logging.getLogger("ble")


class GattService(ServiceInterface):
    def __init__(self):
        super().__init__("org.bluez.GattService1")

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> "s":
        return SERVICE_UUID

    @dbus_property(access=PropertyAccess.READ)
    def Primary(self) -> "b":
        return True


class Characteristic(ServiceInterface):
    def __init__(self, uuid, flags):
        super().__init__("org.bluez.GattCharacteristic1")
        self._uuid = uuid
        self._flags = flags

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> "s":
        return self._uuid

    @dbus_property(access=PropertyAccess.READ)
    def Service(self) -> "o":
        return SERVICE_PATH

    @dbus_property(access=PropertyAccess.READ)
    def Flags(self) -> "as":
        return self._flags


class RxChar(Characteristic):
    def __init__(self, link):
        super().__init__(RX_UUID, ["write", "write-without-response", "encrypt-authenticated-write"])
        self.link = link

    @method()
    def WriteValue(self, value: "ay", options: "a{sv}"):
        self.link._on_write(bytes(value), options)


class TxChar(Characteristic):
    def __init__(self, link):
        super().__init__(TX_UUID, ["read", "notify", "encrypt-authenticated-read",
                                   "encrypt-authenticated-notify"])
        self.link = link
        self.notifying = False
        self._value = b""

    @method()
    def ReadValue(self, options: "a{sv}") -> "ay":
        offset = options["offset"].value if "offset" in options else 0
        self.link._on_authenticated(options, announce=False)
        hello = dict(json.loads(self.link.hello()), mtu=self.link.mtu)
        return json.dumps(hello).encode()[offset:]

    @method()
    def StartNotify(self):
        self.notifying = True

    @method()
    def StopNotify(self):
        self.notifying = False

    @dbus_property(access=PropertyAccess.READ)
    def Value(self) -> "ay":
        return self._value

    def notify(self, data):
        self._value = data
        self.emit_properties_changed({"Value": data})


class Advertisement(ServiceInterface):
    def __init__(self):
        super().__init__("org.bluez.LEAdvertisement1")

    @dbus_property(access=PropertyAccess.READ)
    def Type(self) -> "s":
        return "peripheral"

    @dbus_property(access=PropertyAccess.READ)
    def ServiceUUIDs(self) -> "as":
        return [SERVICE_UUID]

    @dbus_property(access=PropertyAccess.READ)
    def LocalName(self) -> "s":
        return "Pi Remote"

    @dbus_property(access=PropertyAccess.READ)
    def Discoverable(self) -> "b":
        # Agrega los Flags "LE General Discoverable": sin ellos muchos celulares ignoran el anuncio
        return True

    @method()
    def Release(self):
        log.info("BlueZ liberó el anuncio")


class Agent(ServiceInterface):
    """Emparejamiento con código: la Pi lo muestra (DisplayOnly) y el celular lo escribe."""

    def __init__(self, link):
        super().__init__("org.bluez.Agent1")
        self.link = link

    @method()
    def Release(self):
        pass

    @method()
    def DisplayPasskey(self, device: "o", passkey: "u", entered: "q"):
        if entered == 0:
            self.link._show_code(device, f"{passkey:06d}")

    @method()
    def DisplayPinCode(self, device: "o", pincode: "s"):
        self.link._show_code(device, pincode)

    @method()
    def RequestPinCode(self, device: "o") -> "s":
        raise DBusError("org.bluez.Error.Rejected", "sin teclado en la Pi")

    @method()
    def RequestPasskey(self, device: "o") -> "u":
        raise DBusError("org.bluez.Error.Rejected", "sin teclado en la Pi")

    @method()
    def RequestConfirmation(self, device: "o", passkey: "u"):
        # Comparación numérica: no hay nadie del lado de la Pi para confirmar
        raise DBusError("org.bluez.Error.Rejected", "se requiere código")

    @method()
    def RequestAuthorization(self, device: "o"):
        # "Just Works" (sin código): rechazado, cualquiera cerca podría emparejarse
        raise DBusError("org.bluez.Error.Rejected", "se requiere código")

    @method()
    def AuthorizeService(self, device: "o", uuid: "s"):
        pass

    @method()
    def Cancel(self):
        self.link._hide_code()


class BleLink:
    """Se comporta como un cliente más del servidor: tiene send() y entrega los mensajes en orden."""

    def __init__(self, on_message, hello, on_pairing=None):
        self.on_message = on_message  # async (dict) -> None
        self.hello = hello            # () -> str, estado inicial que se lee al conectar
        self.on_pairing = on_pairing  # async () -> None, p. ej. encender la pantalla
        self.mtu = 23
        self.bufs = {}
        self.inbox = asyncio.Queue()
        self.rx = RxChar(self)
        self.tx = TxChar(self)
        self.dialog = None
        self.bus = None

    # ---------- celular -> Pi ----------
    def _on_write(self, value, options):
        self._on_authenticated(options)
        dev = options["device"].value if "device" in options else ""
        buf = self.bufs.setdefault(dev, bytearray())
        buf += value
        if len(buf) > 8192:  # algo se desfasó: descartar antes de crecer sin límite
            buf.clear()
        while (i := buf.find(b"\n")) >= 0:
            line = bytes(buf[:i])
            del buf[:i + 1]
            if not line.strip():
                continue
            try:
                self.inbox.put_nowait(json.loads(line))
            except ValueError:
                log.warning("mensaje BLE inválido: %r", line[:80])

    def _on_authenticated(self, options, announce=True):
        # Solo llegan lecturas/escrituras de un enlace ya emparejado: cerrar el cartel del código
        self._hide_code()
        if "mtu" in options:
            mtu = options["mtu"].value
            if mtu != self.mtu:
                self.mtu = mtu
                log.info("MTU BLE: %d", mtu)
                if announce:
                    asyncio.get_running_loop().create_task(self.send(json.dumps({"t": "mtu", "n": mtu})))

    async def _consume(self):
        while True:
            m = await self.inbox.get()
            try:
                await self.on_message(m)
            except Exception as ex:
                log.warning("mensaje BLE %r: %s", m, ex)

    # ---------- Pi -> celular ----------
    async def send(self, text):
        if not self.tx.notifying:
            return
        data = (text + "\n").encode()
        size = max(20, self.mtu - 3)
        for i in range(0, len(data), size):
            self.tx.notify(data[i:i + size])

    # ---------- código de emparejamiento en la pantalla ----------
    def _show_code(self, device, code):
        log.info("emparejando %s: código %s", device, code)
        asyncio.get_running_loop().create_task(self._dialog(code))

    async def _dialog(self, code):
        self._hide_code()
        if self.on_pairing:
            try:
                await self.on_pairing()
            except Exception as ex:
                log.warning("on_pairing: %s", ex)
        try:
            self.dialog = await asyncio.create_subprocess_exec(
                "zenity", "--info", "--no-wrap", "--title", "Pi Remote", "--timeout", "90",
                "--text", f"<span size='xx-large'>Código: <b>{code}</b></span>\n\n"
                          "Escribí este código en el celular para emparejarlo.",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        except OSError as ex:
            log.warning("no pude mostrar el código en pantalla: %s", ex)

    def _hide_code(self):
        if self.dialog and self.dialog.returncode is None:
            try:
                self.dialog.terminate()
            except ProcessLookupError:
                pass
        self.dialog = None

    # ---------- registro en BlueZ ----------
    async def start(self):
        self.bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        self.bus.export(SERVICE_PATH, GattService())
        self.bus.export(RX_PATH, self.rx)
        self.bus.export(TX_PATH, self.tx)
        self.bus.export(ADV_PATH, Advertisement())
        self.bus.export(AGENT_PATH, Agent(self))
        asyncio.get_running_loop().create_task(self._consume())
        await self._watch_bluez()
        while True:
            try:
                await self._register()
                return
            except Exception as ex:
                log.warning("no pude registrar el servicio Bluetooth (reintento en 10 s): %s", ex)
                await asyncio.sleep(10)

    async def _register(self):
        adapter = self.bus.get_proxy_object(BLUEZ, ADAPTER, await self.bus.introspect(BLUEZ, ADAPTER))
        props = adapter.get_interface("org.freedesktop.DBus.Properties")
        await props.call_set("org.bluez.Adapter1", "Powered", Variant("b", True))
        await props.call_set("org.bluez.Adapter1", "Pairable", Variant("b", True))
        await props.call_set("org.bluez.Adapter1", "PairableTimeout", Variant("u", 0))
        await adapter.get_interface("org.bluez.GattManager1").call_register_application(ROOT, {})
        await adapter.get_interface("org.bluez.LEAdvertisingManager1").call_register_advertisement(ADV_PATH, {})
        bluez = self.bus.get_proxy_object(BLUEZ, "/org/bluez", await self.bus.introspect(BLUEZ, "/org/bluez"))
        agents = bluez.get_interface("org.bluez.AgentManager1")
        await agents.call_register_agent(AGENT_PATH, "DisplayOnly")
        await agents.call_request_default_agent(AGENT_PATH)
        log.info("Bluetooth listo: anunciando el servicio Pi Remote")

    async def _watch_bluez(self):
        # Si bluetoothd se reinicia, todo lo registrado se pierde: volver a registrarlo
        intro = await self.bus.introspect("org.freedesktop.DBus", "/org/freedesktop/DBus")
        dbus = self.bus.get_proxy_object("org.freedesktop.DBus", "/org/freedesktop/DBus", intro)

        def changed(name, old, new):
            if name == BLUEZ and new:
                log.info("bluetoothd reiniciado: registrando de nuevo")
                asyncio.get_running_loop().create_task(self._retry_register())

        dbus.get_interface("org.freedesktop.DBus").on_name_owner_changed(changed)

    async def _retry_register(self):
        await asyncio.sleep(2)
        while True:
            try:
                await self._register()
                return
            except Exception as ex:
                log.warning("reintento de registro Bluetooth: %s", ex)
                await asyncio.sleep(10)
