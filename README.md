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
- `extension/`: extensión de Brave que avisa cuando se enfoca un campo de texto, adelanta videos y
  hace la navegación del modo tele (`tv.js`).

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

## Modo tele (cruceta)

La app tiene dos modos: **trackpad** y **tele**. El botón de abajo a la izquierda (donde antes
estaba «Clic»; tocar el trackpad ya hace clic) cambia entre uno y otro, y se recuerda el último.
En modo tele, la cruceta sirve para usar YouTube (y otros sitios) en Brave como en un Smart TV.
`tele.html` (y la app instalada «Pi Tele») abre la misma app directo en modo tele
(`index.html?modo=tv`).

- **Flechas:** mueven un recuadro azul por los videos, los chips, el menú lateral y el buscador
  (cada video es un solo lugar, no cada link como con Tab). Mantenidas, se repiten. Si el video
  elegido está fuera de la pantalla, la página se mueve sola.
- **OK:** abre lo elegido. Al abrir un video el foco queda en el reproductor: **← / →** atrasan o
  adelantan 10 s, **OK** pausa (o salta el anuncio si se puede) y **↓** baja a los botones y a los
  recomendados. En pantalla completa, ↑/↓ salen de ella.
- **Atrás:** sale de pantalla completa o del buscador, si no vuelve a la página anterior y el
  recuadro queda en el mismo video que se había elegido.
- **Inicio:** portada de YouTube. **Buscar:** va al buscador y abre el teclado del celular.
  Al salir sin buscar (Atrás o una flecha) se cierra también la lista de sugerencias.
- En Shorts, ↑/↓ pasan al anterior/siguiente y OK pausa.
- **Otros sitios** (probado con animeav1.com): cada tarjeta con imagen (serie, episodio) es un solo
  lugar; en una grilla ↑/↓ pasan a la fila siguiente aunque esté incompleta. El reproductor (un
  `<video>` o un iframe grande, aunque sea de otro dominio) funciona como en YouTube: ←/→ ±10 s,
  OK pausa, y los botones del panel de video (±5 s, subtítulos si el reproductor los tiene).
  **Completa** agranda el reproductor a toda la ventana y pone Brave en pantalla completa; ↓ o
  Atrás lo achican. Al abrir otra página el recuadro aparece solo y centrado (en una serie, en el
  primer episodio aunque haya relacionados más arriba), y al volver queda en la misma tarjeta. **Buscar** usa el buscador del sitio (si no tiene, YouTube); **Inicio** va al inicio del
  sitio y, si ya se está ahí, a YouTube.
- Si se usa el trackpad, el recuadro se esconde; la próxima flecha lo vuelve a mostrar.
- **Pantalla completa automática:** usando la cruceta, al poner un video entra solo en pantalla
  completa (YouTube: apenas aparece el reproductor, con la tecla f real; otros sitios: al entrar al
  episodio el reproductor ocupa toda la pantalla y a los 2 s se le da play, con clic real si hace
  falta y sin tocarlo si ya arrancó solo). Una vez por video: si se sale con Atrás o
  ↑/↓, no vuelve a entrar. Si se estaba usando el trackpad, no pasa.
- **Puntero escondido:** al usar la cruceta, el puntero se va a la esquina de abajo a la derecha
  (queda fuera de la pantalla). Lo mueve un mouse absoluto virtual del servidor (`pi-remote-abs`).
- **Reproductores que piden un clic** (animeav1): si OK / play no logra arrancar el video por
  código, se hace un clic real en el centro del reproductor. Para acertar, la página mueve el
  puntero a uno o dos puntos fuera del video, mira dónde aparece y corrige la cuenta.
- **Con un video abierto** (un video o Short de YouTube, o una página con reproductor) los botones de
  abajo cambian por un panel grande: −5 s · reproducir/pausar · +5 s, pantalla completa,
  subtítulos, y volumen / +1:25 / teclado. La extensión avisa el cambio (`tvstate`) y el servidor
  se lo pasa al celular (`{t: "tv", watch}`).

El servidor reenvía `{t: "nav", a: ...}` a la extensión (`bg.js` → `tv.js` de la pestaña activa).
Si la extensión no responde, manda teclas parecidas (flechas, Enter, Alt+←, Ctrl+L).
Después de cambiar la extensión hay que recargarla en `brave://extensions`.
