# Pi Remote

Control remoto de la Raspberry Pi desde el celular: trackpad, teclado, atajos de Brave, volumen y modo reposo.

## Dos formas de conectarse

- **Bluetooth (recomendada):** abrir https://f1203.github.io/pi-remote/ en Chrome para Android y, desde el menú, elegir *Agregar a pantalla principal*. No depende de la IP ni de la red WiFi.
  La primera vez se elige «Pi Remote» en la lista y se escribe el código de 6 dígitos que aparece en la pantalla de la Raspberry. Después reconecta solo.
- **WiFi:** `http://<ip-de-la-pi>:8080` o `http://raspberry.local:8080`, igual que antes.

## Archivos

- `server.py`: servidor (WebSocket + HTTP en el puerto 8080). Inyecta mouse y teclado con `evdev`.
- `ble.py`: servicio Bluetooth LE (GATT) y agente de emparejamiento con código. Depende de `python3-dbus-fast`.
- `docs/`: la página. Es la misma que sirve la Pi y la que publica GitHub Pages.
- `extension/`: extensión de Brave que avisa cuando se enfoca un campo de texto y adelanta videos.

Corre como servicio de usuario: `systemctl --user restart pi-remote`.

## Gestos del trackpad

- 1 dedo: mover · toque: clic · dos toques seguidos: doble clic (tres: triple clic).
- Toque y volver a apoyar el dedo arrastrando: mantener apretado el clic (seleccionar, arrastrar).
- 2 dedos juntos: scroll (con inercia al soltar, se puede apagar en ⚙) · toque con 2: clic derecho.
- Pellizco con 2 dedos: zoom como en el celular (agranda la vista alrededor del cursor sin
  reacomodar la página). El servidor crea un trackpad virtual (`pi-remote-touchpad`) y repite ahí
  los dos dedos; libinput lo convierte en un gesto de pellizco que Brave (en Wayland) entiende.
- 3 dedos hacia la derecha / izquierda: atrás / adelante · toque con 3: clic medio.

En ⚙ se ajusta **Doble toque**: el tiempo máximo entre dos toques para que cuenten como doble clic
(o para empezar a arrastrar). El servidor separa los clics sueltos al menos 550 ms para que Brave
no los junte por su cuenta, aunque el Bluetooth los entregue amontonados.

Al mantener Borrar en el teclado del celular, los borrados que todavía no salieron por Bluetooth
se juntan en un solo mensaje, así al soltar deja de borrar enseguida.
