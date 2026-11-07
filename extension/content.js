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
