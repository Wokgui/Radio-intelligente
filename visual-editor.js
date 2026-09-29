(function () {
  'use strict';

  const panel = document.getElementById('uiPanel');
  if (!panel || document.getElementById('veLauncher')) return;

  const params = new URLSearchParams(location.search);
  const hosted = params.get('visual-editor') === '1';

  const launcher = document.createElement('button');
  launcher.id = 'veLauncher';
  launcher.className = 've-launcher';
  launcher.type = 'button';
  launcher.textContent = '✥ Activer l’éditeur visuel';
  panel.appendChild(launcher);

  const toolbar = document.createElement('aside');
  toolbar.className = 've-toolbar';
  toolbar.setAttribute('aria-label', 'Éditeur visuel');
  toolbar.innerHTML =
    '<div class="ve-info">' +
      '<strong class="ve-target">Clique un élément</strong>' +
      '<span class="ve-metrics">X — · Y — · L — · H —</span>' +
      '<span class="ve-help">Glisser : déplacer · flèches : 1 px · Ctrl + flèches : 10 px · Maj + flèches : redimensionner</span>' +
    '</div>' +
    '<div class="ve-actions">' +
      '<button type="button" class="ve-copy">Copier CSS</button>' +
      '<button type="button" class="ve-download">Exporter</button>' +
      '<button type="button" class="ve-reset">Annuler</button>' +
      '<button type="button" class="ve-close">Fermer</button>' +
    '</div>';

  const outline = document.createElement('div');
  outline.className = 've-selection';
  document.body.append(toolbar, outline);

  const targetLabel = toolbar.querySelector('.ve-target');
  const metrics = toolbar.querySelector('.ve-metrics');
  const touched = new Map();
  let active = false;
  let selected = null;
  let drag = null;
  let grid = 1;

  if (hosted) document.body.classList.add('ve-hosted');

  function emit(type, payload) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ source: 'radio-visual-editor', type: type, payload: payload || {} }, location.origin);
    } catch (_) {}
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function selectorFor(element) {
    if (element.id) return '#' + cssEscape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const usableClass = Array.from(node.classList).find(function (name) { return !name.startsWith('ve-'); });
      if (usableClass) part += '.' + cssEscape(usableClass);
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(function (child) { return child.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
      node = parent;
    }
    return parts.join(' > ');
  }

  function remember(element) {
    if (touched.has(element)) return touched.get(element);
    const rect = element.getBoundingClientRect();
    const state = {
      selector: selectorFor(element),
      dx: 0,
      dy: 0,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      resized: false,
      original: ['translate', 'width', 'height'].map(function (prop) {
        return {
          prop: prop,
          value: element.style.getPropertyValue(prop),
          priority: element.style.getPropertyPriority(prop)
        };
      })
    };
    touched.set(element, state);
    return state;
  }

  function snap(value) {
    if (grid <= 1) return Math.round(value);
    return Math.round(value / grid) * grid;
  }

  function apply(element, state) {
    if (state.dx || state.dy) {
      element.style.setProperty('translate', state.dx + 'px ' + state.dy + 'px', 'important');
    } else {
      element.style.removeProperty('translate');
    }
    if (state.resized) {
      element.style.setProperty('width', Math.max(1, state.width) + 'px', 'important');
      element.style.setProperty('height', Math.max(1, state.height) + 'px', 'important');
    }
    updateOverlay();
  }

  function currentPayload() {
    if (!selected || !document.documentElement.contains(selected)) {
      return { active: active, selected: false, css: cssText(), grid: grid };
    }
    const rect = selected.getBoundingClientRect();
    const state = remember(selected);
    return {
      active: active,
      selected: true,
      selector: state.selector,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      dx: state.dx,
      dy: state.dy,
      css: cssText(),
      grid: grid
    };
  }

  function updateOverlay() {
    if (!active || !selected || !document.documentElement.contains(selected)) {
      outline.style.display = 'none';
      targetLabel.textContent = 'Clique un élément';
      metrics.textContent = 'X — · Y — · L — · H —';
      emit('state', currentPayload());
      return;
    }
    const rect = selected.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = rect.left + 'px';
    outline.style.top = rect.top + 'px';
    outline.style.width = rect.width + 'px';
    outline.style.height = rect.height + 'px';
    targetLabel.textContent = remember(selected).selector;
    metrics.textContent = 'X ' + Math.round(rect.left) + ' · Y ' + Math.round(rect.top) +
      ' · L ' + Math.round(rect.width) + ' · H ' + Math.round(rect.height);
    emit('state', currentPayload());
  }

  function select(element) {
    selected = element;
    remember(element);
    updateOverlay();
  }

  function restoreAll() {
    touched.forEach(function (state, element) {
      state.original.forEach(function (item) {
        if (item.value) element.style.setProperty(item.prop, item.value, item.priority);
        else element.style.removeProperty(item.prop);
      });
    });
    touched.clear();
    selected = null;
    updateOverlay();
  }

  function cssText() {
    const rules = [];
    touched.forEach(function (state) {
      const declarations = [];
      if (state.dx || state.dy) declarations.push('  translate: ' + state.dx + 'px ' + state.dy + 'px !important;');
      if (state.resized) {
        declarations.push('  width: ' + Math.max(1, state.width) + 'px !important;');
        declarations.push('  height: ' + Math.max(1, state.height) + 'px !important;');
      }
      if (declarations.length) rules.push(state.selector + ' {\n' + declarations.join('\n') + '\n}');
    });
    return rules.join('\n\n') || '/* Aucun déplacement ou redimensionnement. */';
  }

  async function copyCss() {
    const value = cssText();
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toolbar.querySelector('.ve-copy').textContent = 'CSS copié ✓';
    setTimeout(function () { toolbar.querySelector('.ve-copy').textContent = 'Copier CSS'; }, 1300);
    emit('css', { css: value, copied: true });
  }

  function downloadCss() {
    const value = cssText() + '\n';
    const url = URL.createObjectURL(new Blob([value], { type: 'text/css' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'radio-ajustements.css';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    emit('css', { css: value, downloaded: true });
  }

  function enable() {
    if (active) return;
    const back = document.getElementById('settingsBack');
    if (back && document.body.classList.contains('settings-open')) back.click();
    active = true;
    document.body.classList.add('ve-active');
    updateOverlay();
  }

  function disable() {
    if (!active) return;
    restoreAll();
    active = false;
    drag = null;
    document.body.classList.remove('ve-active');
    outline.style.display = 'none';
    emit('state', currentPayload());
  }

  function adjustMove(dx, dy) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.dx = snap(state.dx + dx);
    state.dy = snap(state.dy + dy);
    apply(selected, state);
  }

  function adjustSize(dw, dh) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.resized = true;
    state.width = Math.max(1, snap(state.width + dw));
    state.height = Math.max(1, snap(state.height + dh));
    apply(selected, state);
  }

  function isEditorNode(node) {
    return node === launcher || toolbar.contains(node) || node === outline;
  }

  window.addEventListener('pointerdown', function (event) {
    if (!active || isEditorNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    select(event.target);
    const state = remember(selected);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: state.dx, dy: state.dy };
  }, true);

  window.addEventListener('pointermove', function (event) {
    if (!active || !drag || event.pointerId !== drag.pointerId || !selected) return;
    event.preventDefault();
    const state = remember(selected);
    state.dx = snap(drag.dx + event.clientX - drag.x);
    state.dy = snap(drag.dy + event.clientY - drag.y);
    apply(selected, state);
  }, true);

  window.addEventListener('pointerup', function (event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = null;
  }, true);

  window.addEventListener('click', function (event) {
    if (!active || isEditorNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('keydown', function (event) {
    if (!active || !selected || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const step = event.ctrlKey || event.metaKey ? 10 : 1;
    if (event.shiftKey) {
      if (event.key === 'ArrowLeft') adjustSize(-step, 0);
      if (event.key === 'ArrowRight') adjustSize(step, 0);
      if (event.key === 'ArrowUp') adjustSize(0, -step);
      if (event.key === 'ArrowDown') adjustSize(0, step);
    } else {
      if (event.key === 'ArrowLeft') adjustMove(-step, 0);
      if (event.key === 'ArrowRight') adjustMove(step, 0);
      if (event.key === 'ArrowUp') adjustMove(0, -step);
      if (event.key === 'ArrowDown') adjustMove(0, step);
    }
  }, true);

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.source !== 'radio-layout-host') return;
    const payload = data.payload || {};
    if (data.type === 'enable') enable();
    if (data.type === 'disable') disable();
    if (data.type === 'reset') restoreAll();
    if (data.type === 'move') adjustMove(Number(payload.dx) || 0, Number(payload.dy) || 0);
    if (data.type === 'resize') adjustSize(Number(payload.dw) || 0, Number(payload.dh) || 0);
    if (data.type === 'grid') {
      grid = Math.max(1, Number(payload.grid) || 1);
      updateOverlay();
    }
    if (data.type === 'get-css') emit('css', { css: cssText() });
    if (data.type === 'download-css') downloadCss();
    if (data.type === 'copy-css') copyCss();
  });

  window.addEventListener('resize', updateOverlay);
  window.addEventListener('scroll', updateOverlay, true);
  launcher.addEventListener('click', enable);
  toolbar.querySelector('.ve-copy').addEventListener('click', copyCss);
  toolbar.querySelector('.ve-download').addEventListener('click', downloadCss);
  toolbar.querySelector('.ve-reset').addEventListener('click', restoreAll);
  toolbar.querySelector('.ve-close').addEventListener('click', disable);

  window.RadioVisualEditor = {
    enable: enable,
    disable: disable,
    css: cssText,
    reset: restoreAll,
    move: adjustMove,
    resize: adjustSize,
    state: currentPayload
  };

  emit('ready', { hosted: hosted });
  if (hosted) setTimeout(enable, 80);
})();
