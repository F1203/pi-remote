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
