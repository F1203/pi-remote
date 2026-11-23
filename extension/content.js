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
(() => {
  if (window === top) return;
  const anc = [...(location.ancestorOrigins || [])];
  if (!anc.length || !/^https?:\/\/[^/]+:8080$/.test(anc[anc.length - 1])) return;
  const elegido = () => [...document.querySelectorAll('video')]
    .filter((v) => v.readyState > 0 && v.duration > 60 && Number.isFinite(v.duration))
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const enviar = (v, extra) => {
    if (!v) return;
    try { chrome.runtime.sendMessage({ vprog: { t: v.currentTime, d: v.duration, paused: v.paused, ...extra } }); } catch {}
  };
  setInterval(() => { if (!document.hidden) enviar(elegido()); }, 3000);
  // 'playing' avisa enseguida que arrancó (y la página puede seguir desde donde quedó)
  document.addEventListener('playing', (ev) => { if (ev.target === elegido()) enviar(ev.target); }, true);
  document.addEventListener('ended', (ev) => { if (ev.target === elegido()) enviar(ev.target, { ended: true }); }, true);
})();
