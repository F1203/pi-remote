(() => {
  const NON_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden']);
  const isEditable = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !NON_TEXT.has((el.type || 'text').toLowerCase());
    return false;
  };
  const deepActive = () => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  };
  // Solo se informa después de un clic real: el autofocus de las páginas no abre el teclado
  window.addEventListener('pointerup', (ev) => {
    if (!ev.isTrusted || ev.button !== 0) return;
    setTimeout(() => {
      try { chrome.runtime.sendMessage({ editable: isEditable(deepActive()) }); } catch {}
    }, 120);
  }, true);
})();

// Modo anime (http://<pi>:8080/anime/): el reproductor, que está en un iframe de otro dominio, le
// cuenta a la página cómo va el video (para «seguir viendo» y pasar solo al episodio siguiente).
// bg.js lo reenvía al frame de arriba (tv.js) y tv.js a la página.
// Diagnóstico de trabadas (temporal): anota en ~/pi-remote/anime-diag.log, vía bg.js y el servidor
const vlog = (ev, extra) => { try { chrome.runtime.sendMessage({ vlog: { ev, ...extra } }); } catch {} };
// Si el hilo de esta página se traba, un temporizador de 1 s llega tarde: anotar cuánto
function vigilarHilo(frame) {
  let antes = performance.now();
  setInterval(() => {
    const ahora = performance.now(), tarde = ahora - antes - 1000;
    antes = ahora;
    if (tarde > 150 && !document.hidden) vlog('hilo-trabado', { frame, ms: Math.round(tarde) });
  }, 1000);
}
if (window === top && /^https?:\/\/[^/]+:8080\/anime(\/|$)/.test(location.href)) vigilarHilo('pagina');

(() => {
  if (window === top) return;
  const anc = [...(location.ancestorOrigins || [])];
  if (!anc.length || !/^https?:\/\/[^/]+:8080$/.test(anc[anc.length - 1])) return;
  // En YouTube cualquier video sirve; en los demás, los de menos de un minuto suelen ser publicidad
  const YT = /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
  const elegido = () => [...document.querySelectorAll('video')]
    .filter((v) => v.readyState > 0 && v.duration > (YT ? 0 : 60) && Number.isFinite(v.duration))
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const enviar = (v, extra) => {
    if (!v) return;
    try { chrome.runtime.sendMessage({ vprog: { t: v.currentTime, d: v.duration, paused: v.paused, ...extra } }); } catch {}
  };
  setInterval(() => { if (!document.hidden) enviar(elegido()); }, 3000);
  // 'playing' avisa enseguida que arrancó (y la página puede seguir desde donde quedó)
  document.addEventListener('playing', (ev) => { if (ev.target === elegido()) enviar(ev.target); }, true);
  document.addEventListener('ended', (ev) => { if (ev.target === elegido()) enviar(ev.target, { ended: true }); }, true);
  // Modo YouTube: el video no se puede ver fuera de YouTube (o no existe): avisar a la página
  if (YT) {
    let avisado = false;
    setInterval(() => {
      // La pantalla de error nueva («Este video no está disponible» + «Mirar en YouTube») y la vieja
      const e = document.querySelector('yt-interstitial-view-model, .playerInterstitialRendererScrim, .ytp-error');
      if (avisado || !e || !e.getClientRects().length) return;
      if ([...document.querySelectorAll('video')].some((v) => !v.paused && v.currentTime > 0)) return;
      avisado = true;
      try { chrome.runtime.sendMessage({ vprog: { error: (e.innerText || '').trim().split('\n')[0].slice(0, 160) } }); } catch {}
    }, 1000);
  }

  // ----- Diagnóstico de trabadas -----
  vigilarHilo('video');
  const adelante = (v) => { // segundos de video ya bajados por delante
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.2 && b.end(i) >= v.currentTime) return b.end(i) - v.currentTime;
    return 0;
  };
  const info = (v) => ({ vt: +v.currentTime.toFixed(1), buf: +adelante(v).toFixed(1), rs: v.readyState });
  let esperaDesde = 0;
  ['waiting', 'stalled', 'playing', 'seeking', 'seeked', 'pause', 'resize', 'error', 'emptied', 'ratechange'].forEach((t) => {
    document.addEventListener(t, (ev) => {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement) || (v !== elegido() && t !== 'resize')) return;
      const extra = {};
      if (t === 'waiting') esperaDesde = performance.now();
      if (t === 'playing' && esperaDesde) { extra.espero_ms = Math.round(performance.now() - esperaDesde); esperaDesde = 0; }
      if (t === 'resize') Object.assign(extra, { w: v.videoWidth, h: v.videoHeight });
      if (t === 'error' && v.error) extra.err = v.error.code + ' ' + (v.error.message || '');
      vlog(t, { ...info(v), ...extra });
    }, true);
  });
  let lastQ = null, lastT = null, tick = 0;
  setInterval(() => {
    const v = elegido();
    if (!v) return;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    if (q && lastQ && q.droppedVideoFrames > lastQ.droppedVideoFrames) {
      vlog('frames-perdidos', { n: q.droppedVideoFrames - lastQ.droppedVideoFrames, ...info(v) });
    }
    lastQ = q;
    if (!v.paused && !v.seeking && lastT !== null && Math.abs(v.currentTime - lastT) < 0.3) vlog('sin-avanzar', info(v));
    lastT = v.paused ? null : v.currentTime;
    if (++tick % 30 === 0) {
      vlog('estado', { ...info(v), paused: v.paused, drop: q && q.droppedVideoFrames, cuadros: q && q.totalVideoFrames,
        w: v.videoWidth, h: v.videoHeight, sys: 1 });
    }
  }, 1000);
  // Cuánto tarda en bajar cada segmento del video
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!/\/segs\/|\.ts(\?|$)|\.m4s(\?|$)/.test(e.name)) continue;
        vlog('segmento', { n: e.name.split('/').pop().split('?')[0], ms: Math.round(e.duration),
          kb: Math.round((e.transferSize || e.encodedBodySize || 0) / 1024) });
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {}
})();

// Modos anime y YouTube (páginas del servidor y sus reproductores): el puntero se esconde solo a
// los 2,5 s sin moverse, como en una tele (el reproductor de YouTube embebido no lo esconde).
(() => {
  const APP = /^https?:\/\/[^/]+:8080\/(anime|youtube)(\/|$)/;
  const anc = [...(location.ancestorOrigins || [])];
  const enApp = window === top ? APP.test(location.href) : anc.length && /^https?:\/\/[^/]+:8080$/.test(anc[anc.length - 1]);
  if (!enApp) return;
  const css = document.createElement('style');
  css.textContent = 'html.__pi_sin_puntero, html.__pi_sin_puntero * { cursor: none !important; }';
  (document.head || document.documentElement).appendChild(css);
  let t = 0, x = -1, y = -1;
  const esconder = () => document.documentElement.classList.add('__pi_sin_puntero');
  const mover = (ev) => {
    if (ev.screenX === x && ev.screenY === y) return; // el navegador repite el último lugar al redibujar
    x = ev.screenX; y = ev.screenY;
    document.documentElement.classList.remove('__pi_sin_puntero');
    clearTimeout(t); t = setTimeout(esconder, 2500);
  };
  window.addEventListener('mousemove', mover, true);
  t = setTimeout(esconder, 2500);
})();
