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
- `anime.py` + `anime/`: modo anime (ver abajo). Lo guardado queda en `anime.json` (fuera del repo).
- `youtube.py` + `youtube/`: modo YouTube (ver abajo). Lo guardado queda en `youtube.json` (fuera del repo).

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
- **Menús desplegables** (los filtros del catálogo de animeav1): OK abre el menú y el recuadro entra
  a la primera opción; mientras está abierto, la cruceta se mueve solo dentro del menú (cada
  opción es la etiqueta entera con su casilla), OK marca/desmarca, y Atrás (o ↑ desde la primera
  fila) lo cierra y vuelve al botón.
- **Accesos rápidos según el sitio abierto en Brave:** en YouTube, **Suscrip.** (a la derecha de
  Buscar); en animeav1, una fila con **Horario** y **Catálogo**. La extensión avisa el sitio
  (`tvstate` → `{t: "tv", watch, site}`).
- **Pantalla completa automática:** usando la cruceta, al poner un video entra solo en pantalla
  completa (YouTube: apenas aparece el reproductor, con la tecla f real; otros sitios: al entrar al
  episodio el reproductor ocupa toda la pantalla y a los 2 s se le da play, con clic real si hace
  falta y sin tocarlo si ya arrancó solo). Una vez por video: si se sale con Atrás o
  ↑/↓, no vuelve a entrar. Si se estaba usando el trackpad, no pasa.
- **Puntero escondido:** al usar la cruceta, el puntero se va a la esquina de abajo a la derecha
  (queda fuera de la pantalla). Lo mueve un mouse absoluto virtual del servidor (`pi-remote-abs`).
  Con el reproductor de otro sitio agrandado (animeav1) va al centro, porque en la esquina dejaría
  los controles del reproductor siempre a la vista.
- **Reproductores que piden un clic** (animeav1): si OK / play no logra arrancar el video por
  código, se hace un clic real en el centro del reproductor. Para acertar, la página mueve el
  puntero a uno o dos puntos fuera del video, mira dónde aparece y corrige la cuenta.
- **Rueda de la barra de reproducción:** con un video abierto, girar el dedo en círculos sobre la
  cruceta adelanta (sentido horario) o atrasa (antihorario): una vuelta = 60 s, y girando rápido hasta
  ×4. Vibra cortito por cada segundo, el OK muestra cuánto va («+12 s») y la tele, dónde quedó
  («12:34 / 24:10»). Por eso, con un video abierto las flechas actúan al soltar (o al mantenerlas).
- **Con un video abierto** (un video o Short de YouTube, o una página con reproductor) los botones de
  abajo cambian por un panel grande: −5 s · reproducir/pausar · +5 s, pantalla completa,
  subtítulos, y volumen / +1:25 / teclado. La extensión avisa el cambio (`tvstate`) y el servidor
  se lo pasa al celular (`{t: "tv", watch}`).

El servidor reenvía `{t: "nav", a: ...}` a la extensión (`bg.js` → `tv.js` de la pestaña activa).
Si la extensión no responde, manda teclas parecidas (flechas, Enter, Alt+←, Ctrl+L).
Después de cambiar la extensión hay que recargarla en `brave://extensions`.

## Modo anime

Una pantalla propia, estilo Smart TV, con el contenido de animeav1.com: `http://<pi>:8080/anime/`.
Se abre con el botón **Anime** del modo tele del celular (en la pestaña activa de Brave). Ahí
los accesos rápidos cambian a **Mi lista**, **Horario** y **Catálogo**.

- **Inicio:** destacado, *Seguir viendo*, últimos episodios, mi lista, recién agregados, en emisión,
  populares y mejor puntuados. **Serie:** continuar / ver el episodio que toca, agregar a mi lista,
  episodios con captura (✓ = visto; en series largas, de a 50). **Catálogo:** filtros de orden, tipo,
  estado y género (trae más al bajar). **Horario:** lo que salió hoy, ayer y los días anteriores.
  **Mi lista** (página y fila del inicio): las series en emisión agrupadas por el día de la semana
  en que salen, empezando por hoy, con una llave arriba de cada grupo que dice el día (sale del
  último episodio publicado según el horario); «Ep N · nuevo» si ese episodio no se vio. Aparte, al
  final: «Próximamente» y «Ya no se emiten».
  **Buscar:** escribe con el teclado del celular. **Audio:** SUB o DUB, se recuerda.
- **Opciones («clic derecho»):** mantener apretado OK en el celular (o clic derecho del trackpad,
  o la tecla Menú / M) abre un menú sobre la tarjeta elegida: ir a la serie, agregar a / quitar de
  mi lista y quitar de «Seguir viendo». Viendo un episodio, el menú es de esa serie.
- **Reproductor:** a pantalla completa y con play solo. ←/→ ±10 s, OK pausa, ↓ (o ↑) abre el panel:
  **Episodios** (a la izquierda, elegido de entrada), episodio anterior/siguiente, subtitulado/doblado, **servidor** (HLS primero; el último elegido a
  mano se recuerda). Episodios siempre lleva a la página de la serie (Atrás, en cambio, vuelve a
  donde se estaba). Al terminar un episodio pasa solo al siguiente en 10 s.
  Al volver a un episodio sigue desde donde quedó.
- **Visto = solo falta el ending:** un episodio cuenta como terminado (✓) si le quedan 2½ minutos o
  menos (en los de menos de 15 minutos, el último 10 %). En «Seguir viendo» aparece entonces el
  episodio siguiente, desde el principio; si todavía no salió, la serie no aparece.
- **Cómo funciona:** `anime.py` lee los datos de animeav1 (`/<página>/__data.json` de SvelteKit) y
  los entrega simplificados en `/anime/api/...`; también guarda mi lista, seguir viendo, vistos y
  preferencias en `anime.json`. La página tiene `<html data-pitv-app>`: con eso `tv.js` no la
  navega, le pasa cada acción de la cruceta (`postMessage`) y hace lo que la página contesta
  (`{media}`, `{winFull}`, `{editable}`). El reproductor de otro dominio avisa cómo va el video
  desde `content.js` (`vprog`, vía `bg.js`). El servidor HLS solo se deja abrir desde animeav1:
  `extension/rules.json` le pone ese `Referer` cuando lo abre esta página.
- **Trabadas cortas en HLS (resuelto):** el reproductor (JW Player) arrancaba con `preload: metadata`
  y así hls.js guarda solo 1 s de margen: cada segmento se pedía al final y uno lento trababa el
  video. `extension/zilla.js` (en el iframe del reproductor, mundo MAIN) le pone `preload: auto`:
  margen de ~25 s. Para diagnosticar quedó un registro temporal en `anime-diag.log`
  (esperas, cuadros perdidos, tiempos de cada segmento, estado de la Pi cada 30 s).
- Sin extensión también se maneja con un teclado (flechas, Enter, Escape).

## Modo YouTube

Tu YouTube (con la sesión de Brave) como una app de tele: `http://<pi>:8080/youtube/`. Se abre con
el botón **YouTube** del modo tele del celular (o desde la barra del modo anime, y al revés). Ahí los
accesos rápidos del celular son **Suscrip.**, **Canales** e **Historial**. Se maneja igual que el
modo anime (misma cruceta, mantener OK = opciones, misma base de estilos `../anime/estilo.css`).

- **Inicio:** *Seguir viendo*, últimos videos de las suscripciones, una fila por cada **canal
  favorito** y los recomendados. También: **Suscripciones**, **Canales** (favoritos y todos los
  canales a los que estás suscrito), **Historial**, **Ver más tarde** y **Buscar** (canales y videos).
  Sin Shorts. Solo se ve la primera tanda de cada lista (lo que trae la página de YouTube).
- **Opciones:** ir al canal, ★ canal favorito / quitarlo, quitar de «Seguir viendo», abrir en YouTube.
- **Reproductor propio** (`youtube.com/embed`, a pantalla completa, con play solo): ←/→ ±10 s, OK
  pausa, la ruedita del celular adelanta. ↓ abre el panel: **canal** (elegido de entrada),
  anterior/siguiente (de la fila desde la que se abrió el video; si no, el primer relacionado),
  subtítulos, ★ canal favorito, abrir en YouTube y una fila de **relacionados**. Al terminar de
  verdad (`ended`) pasa al siguiente en 10 s. Si el video no se deja ver fuera de YouTube, se abre
  solo en youtube.com.
- **Seguir viendo:** desde los 30 s de video; sigue 3 s antes de donde quedó. Un video está visto
  si le falta el 5 % (entre 15 s y 1 min: la pantalla final) y sale de la lista.
- **Cómo funciona:** la página le pide a la extensión cada página de YouTube (`{ytFetch}` → `tv.js`
  → `bg.js`, que la baja con las cookies de Brave y devuelve su `ytInitialData`). La página
  recorre esos datos buscando `videoRenderer` / `lockupViewModel` / `channelRenderer`. Sin la
  extensión (otro navegador), el servidor baja las páginas sin sesión (`/youtube/api/pagina`):
  alcanza para buscar y ver canales. Si YouTube no ve la sesión, la página lo avisa y el servidor
  lo anota en su registro.
