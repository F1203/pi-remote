// Reproductor HLS de animeav1 (JW Player en player.zilla-networks.com). El sitio no le dice cuánto
// cargar por adelantado y JW usa preload «metadata», que deja a hls.js con 1 s de margen: cada
// segmento (de 5 a 14 s) se pide recién cuando el anterior está por terminar y, si uno tarda un
// poco más en bajar, el video se traba un instante. Con preload «auto» el margen es de 25 s.
// Corre en el mundo de la página (world MAIN) antes de que se cargue jwplayer.js.
(() => {
  let real;
  const envolver = (jw) => new Proxy(jw, {
    apply(target, self, args) {
      const player = Reflect.apply(target, self, args);
      if (player && typeof player.setup === 'function' && !player.__piPreload) {
        const setup = player.setup;
        player.setup = function (cfg) {
          return setup.call(this, cfg && typeof cfg === 'object' ? { ...cfg, preload: 'auto' } : cfg);
        };
        player.__piPreload = true;
      }
      return player;
    },
  });
  Object.defineProperty(window, 'jwplayer', {
    configurable: true,
    get: () => real,
    set: (v) => { real = typeof v === 'function' ? envolver(v) : v; },
  });
})();
