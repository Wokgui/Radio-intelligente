(function () {
  'use strict';

  const panel = document.getElementById('uiPanel');
  if (!panel || document.getElementById('veLauncher')) return;

  const params = new URLSearchParams(location.search);
  const hosted = params.get('visual-editor') === '1';
  const GUIDE_THRESHOLD = 5;

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
      '<span class="ve-help">Glisser : déplacer · flèches : 1 px · Ctrl + flèches : 10 px · Maj + flèches : taille</span>' +
    '</div>' +
    '<div class="ve-actions">' +
      '<button type="button" class="ve-copy">Copier CSS</button>' +
      '<button type="button" class="ve-download">Exporter</button>' +
      '<button type="button" class="ve-reset">Annuler tout</button>' +
      '<button type="button" class="ve-close">Fermer</button>' +
    '</div>';

  const outline = document.createElement('div');
  outline.className = 've-selection';
  outline.innerHTML =
    '<i class="ve-handle ve-handle-nw" data-handle="nw"></i>' +
    '<i class="ve-handle ve-handle-ne" data-handle="ne"></i>' +
    '<i class="ve-handle ve-handle-sw" data-handle="sw"></i>' +
    '<i class="ve-handle ve-handle-se" data-handle="se"></i>';

  const guideV = document.createElement('div');
  guideV.className = 've-guide ve-guide-v';
  const guideH = document.createElement('div');
  guideH.className = 've-guide ve-guide-h';
  const guideVLabel = document.createElement('span');
  guideVLabel.className = 've-guide-label ve-guide-v-label';
  const guideHLabel = document.createElement('span');
  guideHLabel.className = 've-guide-label ve-guide-h-label';

  document.body.append(toolbar, outline, guideV, guideH, guideVLabel, guideHLabel);

  const targetLabel = toolbar.querySelector('.ve-target');
  const metrics = toolbar.querySelector('.ve-metrics');
  const registry = new Map();
  const touched = new Map();

  let active = false;
  let selected = null;
  let drag = null;
  let resizeDrag = null;
  let grid = 1;

  const history = [];
  let historyIndex = -1;
  let applyingHistory = false;

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
    if (!element || element.nodeType !== 1) return '';
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

  function register(element) {
    const selector = selectorFor(element);
    if (!selector) return null;
    if (registry.has(selector)) {
      const existing = registry.get(selector);
      existing.element = element;
      return existing;
    }
    const original = {};
    ['translate', 'width', 'height', 'font-size', 'display', 'color', 'background-color', 'border-color', 'z-index'].forEach(function (prop) {
      original[prop] = {
        value: element.style.getPropertyValue(prop),
        priority: element.style.getPropertyPriority(prop)
      };
    });
    const entry = { selector: selector, element: element, original: original };
    registry.set(selector, entry);
    return entry;
  }

  function remember(element) {
    const reg = register(element);
    if (!reg) return null;
    if (touched.has(element)) return touched.get(element);
    const rect = element.getBoundingClientRect();
    const state = {
      selector: reg.selector,
      dx: 0,
      dy: 0,
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      resized: false,
      fontSize: parseFloat(getComputedStyle(element).fontSize) || 16,
      fontAdjusted: false,
      color: getComputedStyle(element).color || '#000000',
      backgroundColor: getComputedStyle(element).backgroundColor || 'rgba(0,0,0,0)',
      borderColor: getComputedStyle(element).borderColor || 'rgba(0,0,0,0)',
      colorAdjusted: false,
      backgroundAdjusted: false,
      borderAdjusted: false,
      zIndex: parseInt(getComputedStyle(element).zIndex,10) || 0,
      zAdjusted: false,
      deleted: false
    };
    touched.set(element, state);
    return state;
  }

  function snapGrid(value) {
    if (grid <= 1) return Math.round(value);
    return Math.round(value / grid) * grid;
  }

  function setInline(element, prop, value) {
    if (value === null || value === undefined || value === '') element.style.removeProperty(prop);
    else element.style.setProperty(prop, value, 'important');
  }

  function restoreOriginalProp(selector, prop) {
    const reg = registry.get(selector);
    if (!reg || !reg.element) return;
    const item = reg.original[prop];
    if (!item) return;
    if (item.value) reg.element.style.setProperty(prop, item.value, item.priority);
    else reg.element.style.removeProperty(prop);
  }

  function applyState(element, state, update) {
    if (!element || !state) return;

    if (state.deleted) {
      setInline(element, 'display', 'none');
      if (update !== false) updateOverlay();
      return;
    }
    restoreOriginalProp(state.selector, 'display');

    setInline(element, 'translate', (state.dx || state.dy) ? state.dx + 'px ' + state.dy + 'px' : null);

    if (state.resized) {
      setInline(element, 'width', Math.max(1, state.width) + 'px');
      setInline(element, 'height', Math.max(1, state.height) + 'px');
    } else {
      restoreOriginalProp(state.selector, 'width');
      restoreOriginalProp(state.selector, 'height');
    }

    if (state.fontAdjusted) setInline(element, 'font-size', Math.max(4, state.fontSize) + 'px');
    else restoreOriginalProp(state.selector, 'font-size');

    if (state.colorAdjusted) setInline(element, 'color', state.color);
    else restoreOriginalProp(state.selector, 'color');
    if (state.backgroundAdjusted) setInline(element, 'background-color', state.backgroundColor);
    else restoreOriginalProp(state.selector, 'background-color');
    if (state.borderAdjusted) setInline(element, 'border-color', state.borderColor);
    else restoreOriginalProp(state.selector, 'border-color');
    if (state.zAdjusted) {
      setInline(element, 'z-index', String(state.zIndex));
      const position = getComputedStyle(element).position;
      if (position === 'static') element.style.setProperty('position', 'relative', 'important');
    } else {
      restoreOriginalProp(state.selector, 'z-index');
    }

    if (update !== false) updateOverlay();
  }

  function restoreEntry(entry) {
    if (!entry || !entry.element) return;
    Object.keys(entry.original).forEach(function (prop) {
      const item = entry.original[prop];
      if (item.value) entry.element.style.setProperty(prop, item.value, item.priority);
      else entry.element.style.removeProperty(prop);
    });
  }

  function hideGuides() {
    guideV.style.display = 'none';
    guideH.style.display = 'none';
    guideVLabel.style.display = 'none';
    guideHLabel.style.display = 'none';
  }

  function showVerticalGuide(x, label) {
    guideV.style.display = 'block';
    guideV.style.left = Math.round(x) + 'px';
    guideVLabel.style.display = 'block';
    guideVLabel.style.left = Math.round(x) + 'px';
    guideVLabel.textContent = label;
  }

  function showHorizontalGuide(y, label) {
    guideH.style.display = 'block';
    guideH.style.top = Math.round(y) + 'px';
    guideHLabel.style.display = 'block';
    guideHLabel.style.top = Math.round(y) + 'px';
    guideHLabel.textContent = label;
  }

  function isEditorNode(node) {
    return node === launcher || toolbar.contains(node) || node === outline || outline.contains(node) ||
      node === guideV || node === guideH || node === guideVLabel || node === guideHLabel;
  }

  function alignmentCandidates(element) {
    const x = [{ value: window.innerWidth / 2, label: 'Centre écran' }];
    const y = [{ value: window.innerHeight / 2, label: 'Milieu écran' }];
    const candidates = [];
    const parent = element.parentElement;

    if (parent) {
      Array.from(parent.children).forEach(function (el) {
        if (el !== element) candidates.push(el);
      });
    }

    const scope = element.closest('.track,.cover,.music-player,.player,.app-page') || document.body;
    Array.from(scope.querySelectorAll('[id],button,.choice,.stat,.tag,.artist,h1')).forEach(function (el) {
      if (el !== element && !candidates.includes(el)) candidates.push(el);
    });

    candidates.slice(0, 120).forEach(function (el) {
      if (!el || !el.getBoundingClientRect || element.contains(el) || el.contains(element) || isEditorNode(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      const short = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase());
      x.push({ value: r.left, label: 'Bord gauche ' + short });
      x.push({ value: r.left + r.width / 2, label: 'Centre ' + short });
      x.push({ value: r.right, label: 'Bord droit ' + short });
      y.push({ value: r.top, label: 'Haut ' + short });
      y.push({ value: r.top + r.height / 2, label: 'Milieu ' + short });
      y.push({ value: r.bottom, label: 'Bas ' + short });
    });

    return { x: x, y: y };
  }

  function smartSnap(element, state) {
    hideGuides();
    if (!element || !state || state.deleted) return;

    let rect = element.getBoundingClientRect();
    const anchorsX = [rect.left, rect.left + rect.width / 2, rect.right];
    const anchorsY = [rect.top, rect.top + rect.height / 2, rect.bottom];
    const candidates = alignmentCandidates(element);
    let bestX = null;
    let bestY = null;

    anchorsX.forEach(function (anchor) {
      candidates.x.forEach(function (candidate) {
        const diff = candidate.value - anchor;
        const abs = Math.abs(diff);
        if (abs <= GUIDE_THRESHOLD && (!bestX || abs < bestX.abs || (abs === bestX.abs && candidate.label === 'Centre écran'))) {
          bestX = { abs: abs, diff: diff, value: candidate.value, label: candidate.label };
        }
      });
    });

    anchorsY.forEach(function (anchor) {
      candidates.y.forEach(function (candidate) {
        const diff = candidate.value - anchor;
        const abs = Math.abs(diff);
        if (abs <= GUIDE_THRESHOLD && (!bestY || abs < bestY.abs || (abs === bestY.abs && candidate.label === 'Milieu écran'))) {
          bestY = { abs: abs, diff: diff, value: candidate.value, label: candidate.label };
        }
      });
    });

    if (bestX) state.dx = Math.round(state.dx + bestX.diff);
    if (bestY) state.dy = Math.round(state.dy + bestY.diff);
    if (bestX || bestY) applyState(element, state, false);

    rect = element.getBoundingClientRect();
    if (bestX) showVerticalGuide(bestX.value, bestX.label);
    else if (Math.abs((rect.left + rect.width / 2) - innerWidth / 2) < 0.75) showVerticalGuide(innerWidth / 2, 'Centre écran');

    if (bestY) showHorizontalGuide(bestY.value, bestY.label);
    else if (Math.abs((rect.top + rect.height / 2) - innerHeight / 2) < 0.75) showHorizontalGuide(innerHeight / 2, 'Milieu écran');
  }

  function snapshot() {
    const items = [];
    touched.forEach(function (state, element) {
      if (!document.documentElement.contains(element)) return;
      items.push({
        selector: state.selector,
        dx: state.dx,
        dy: state.dy,
        width: state.width,
        height: state.height,
        resized: state.resized,
        fontSize: state.fontSize,
        fontAdjusted: state.fontAdjusted,
        color: state.color,
        backgroundColor: state.backgroundColor,
        borderColor: state.borderColor,
        colorAdjusted: state.colorAdjusted,
        backgroundAdjusted: state.backgroundAdjusted,
        borderAdjusted: state.borderAdjusted,
        zIndex: state.zIndex,
        zAdjusted: state.zAdjusted,
        deleted: state.deleted
      });
    });
    items.sort(function (a, b) { return a.selector.localeCompare(b.selector); });
    return {
      items: items,
      selectedSelector: selected ? selectorFor(selected) : ''
    };
  }

  function snapshotKey(snap) {
    return JSON.stringify(snap.items);
  }

  function emitHistory() {
    emit('history', {
      canUndo: historyIndex > 0,
      canRedo: historyIndex >= 0 && historyIndex < history.length - 1
    });
  }

  function commitHistory() {
    if (applyingHistory) return;
    const snap = snapshot();
    const key = snapshotKey(snap);
    if (historyIndex >= 0 && snapshotKey(history[historyIndex]) === key) {
      emitHistory();
      return;
    }
    history.splice(historyIndex + 1);
    history.push(snap);
    historyIndex = history.length - 1;
    emitHistory();
  }

  function loadSnapshot(snap) {
    applyingHistory = true;
    registry.forEach(restoreEntry);
    touched.clear();

    (snap.items || []).forEach(function (saved) {
      const element = document.querySelector(saved.selector);
      if (!element) return;
      register(element);
      const state = {
        selector: saved.selector,
        dx: saved.dx || 0,
        dy: saved.dy || 0,
        width: Math.max(1, saved.width || 1),
        height: Math.max(1, saved.height || 1),
        resized: !!saved.resized,
        fontSize: saved.fontSize || parseFloat(getComputedStyle(element).fontSize) || 16,
        fontAdjusted: !!saved.fontAdjusted,
        color: saved.color || getComputedStyle(element).color || '#000000',
        backgroundColor: saved.backgroundColor || getComputedStyle(element).backgroundColor || 'rgba(0,0,0,0)',
        borderColor: saved.borderColor || getComputedStyle(element).borderColor || 'rgba(0,0,0,0)',
        colorAdjusted: !!saved.colorAdjusted,
        backgroundAdjusted: !!saved.backgroundAdjusted,
        borderAdjusted: !!saved.borderAdjusted,
        zIndex: Number(saved.zIndex) || 0,
        zAdjusted: !!saved.zAdjusted,
        deleted: !!saved.deleted
      };
      touched.set(element, state);
      applyState(element, state, false);
    });

    selected = snap.selectedSelector ? document.querySelector(snap.selectedSelector) : null;
    if (selected) {
      const st = touched.get(selected);
      if (st && st.deleted) selected = null;
    }
    applyingHistory = false;
    hideGuides();
    updateOverlay();
    emitHistory();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    loadSnapshot(history[historyIndex]);
  }

  function redo() {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return;
    historyIndex += 1;
    loadSnapshot(history[historyIndex]);
  }

  function restoreAll() {
    registry.forEach(restoreEntry);
    touched.clear();
    selected = null;
    hideGuides();
    updateOverlay();
    commitHistory();
  }

  function cssText() {
    const rules = [];
    touched.forEach(function (state) {
      const declarations = [];
      if (state.deleted) {
        declarations.push('  display: none !important;');
      } else {
        if (state.dx || state.dy) declarations.push('  translate: ' + state.dx + 'px ' + state.dy + 'px !important;');
        if (state.resized) {
          declarations.push('  width: ' + Math.max(1, state.width) + 'px !important;');
          declarations.push('  height: ' + Math.max(1, state.height) + 'px !important;');
        }
        if (state.fontAdjusted) declarations.push('  font-size: ' + Math.max(4, state.fontSize).toFixed(1).replace(/\.0$/, '') + 'px !important;');
        if (state.colorAdjusted) declarations.push('  color: ' + state.color + ' !important;');
        if (state.backgroundAdjusted) declarations.push('  background-color: ' + state.backgroundColor + ' !important;');
        if (state.borderAdjusted) declarations.push('  border-color: ' + state.borderColor + ' !important;');
        if (state.zAdjusted) {
          declarations.push('  position: relative !important;');
          declarations.push('  z-index: ' + state.zIndex + ' !important;');
        }
      }
      if (declarations.length) rules.push(state.selector + ' {\n' + declarations.join('\n') + '\n}');
    });
    return rules.join('\n\n') || '/* Aucun ajustement. */';
  }

  function currentPayload() {
    if (!selected || !document.documentElement.contains(selected)) {
      return { active: active, selected: false, css: cssText(), grid: grid };
    }
    const state = remember(selected);
    if (!state || state.deleted) return { active: active, selected: false, css: cssText(), grid: grid };
    const rect = selected.getBoundingClientRect();
    return {
      active: active,
      selected: true,
      selector: state.selector,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontSize: Math.round(state.fontSize * 10) / 10,
      color: state.color,
      backgroundColor: state.backgroundColor,
      borderColor: state.borderColor,
      zIndex: state.zIndex,
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

    const state = remember(selected);
    if (!state || state.deleted) {
      outline.style.display = 'none';
      emit('state', currentPayload());
      return;
    }

    const rect = selected.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = rect.left + 'px';
    outline.style.top = rect.top + 'px';
    outline.style.width = rect.width + 'px';
    outline.style.height = rect.height + 'px';
    targetLabel.textContent = state.selector;
    metrics.textContent = 'X ' + Math.round(rect.left) + ' · Y ' + Math.round(rect.top) +
      ' · L ' + Math.round(rect.width) + ' · H ' + Math.round(rect.height) +
      ' · texte ' + Math.round(state.fontSize * 10) / 10 + ' px';
    emit('state', currentPayload());
  }

  function select(element) {
    if (!element || isEditorNode(element)) return;
    selected = element;
    remember(element);
    hideGuides();
    updateOverlay();
  }

  function adjustMove(dx, dy, commit) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.dx = snapGrid(state.dx + dx);
    state.dy = snapGrid(state.dy + dy);
    applyState(selected, state, false);
    smartSnap(selected, state);
    updateOverlay();
    if (commit !== false) commitHistory();
  }

  function adjustSize(dw, dh, commit, proportional) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.resized = true;

    const square = proportional || Math.abs(state.width - state.height) <= Math.max(4, Math.min(state.width, state.height) * 0.12);
    if (square && dw === dh) {
      const size = Math.max(1, snapGrid(Math.max(state.width, state.height) + dw));
      state.width = size;
      state.height = size;
    } else if (square && dw && !dh) {
      const size = Math.max(1, snapGrid(Math.max(state.width, state.height) + dw));
      state.width = size;
      state.height = size;
    } else if (square && dh && !dw) {
      const size = Math.max(1, snapGrid(Math.max(state.width, state.height) + dh));
      state.width = size;
      state.height = size;
    } else {
      state.width = Math.max(1, snapGrid(state.width + dw));
      state.height = Math.max(1, snapGrid(state.height + dh));
    }

    applyState(selected, state);
    if (commit !== false) commitHistory();
  }

  function adjustFont(delta, commit) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.fontAdjusted = true;
    state.fontSize = Math.max(4, Math.round((state.fontSize + delta) * 10) / 10);
    applyState(selected, state);
    if (commit !== false) commitHistory();
  }

  function setVisualStyle(kind, value) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (kind === 'color') {
      state.color = String(value || '');
      state.colorAdjusted = true;
    }
    if (kind === 'background') {
      state.backgroundColor = String(value || '');
      state.backgroundAdjusted = true;
    }
    if (kind === 'border') {
      state.borderColor = String(value || '');
      state.borderAdjusted = true;
    }
    applyState(selected, state);
    commitHistory();
  }

  function adjustZ(delta) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.zAdjusted = true;
    state.zIndex = (Number(state.zIndex) || 0) + delta;
    applyState(selected, state);
    commitHistory();
  }

  function setZ(value) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.zAdjusted = true;
    state.zIndex = Number(value) || 0;
    applyState(selected, state);
    commitHistory();
  }

  function deleteSelected() {
    if (!active || !selected) return;
    const element = selected;
    const state = remember(element);
    state.deleted = true;
    applyState(element, state, false);
    selected = null;
    hideGuides();
    updateOverlay();
    commitHistory();
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
    if (historyIndex < 0) {
      history.push(snapshot());
      historyIndex = 0;
    }
    updateOverlay();
    emitHistory();
  }

  function disable() {
    if (!active) return;
    active = false;
    drag = null;
    resizeDrag = null;
    document.body.classList.remove('ve-active');
    outline.style.display = 'none';
    hideGuides();
    emit('state', currentPayload());
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
    state.dx = snapGrid(drag.dx + event.clientX - drag.x);
    state.dy = snapGrid(drag.dy + event.clientY - drag.y);
    applyState(selected, state, false);
    smartSnap(selected, state);
    updateOverlay();
  }, true);

  window.addEventListener('pointerup', function (event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = null;
    hideGuides();
    updateOverlay();
    commitHistory();
  }, true);

  outline.querySelectorAll('.ve-handle').forEach(function (handle) {
    handle.addEventListener('pointerdown', function (event) {
      if (!active || !selected) return;
      event.preventDefault();
      event.stopPropagation();
      const state = remember(selected);
      const rect = selected.getBoundingClientRect();
      resizeDrag = {
        pointerId: event.pointerId,
        handle: handle.dataset.handle,
        startX: event.clientX,
        startY: event.clientY,
        width: state.width || Math.round(rect.width),
        height: state.height || Math.round(rect.height),
        square: Math.abs(rect.width - rect.height) <= Math.max(4, Math.min(rect.width, rect.height) * 0.12)
      };
      handle.setPointerCapture && handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', function (event) {
      if (!resizeDrag || event.pointerId !== resizeDrag.pointerId || !selected) return;
      event.preventDefault();
      const state = remember(selected);
      const h = resizeDrag.handle;
      let dx = event.clientX - resizeDrag.startX;
      let dy = event.clientY - resizeDrag.startY;
      if (h.indexOf('w') >= 0) dx = -dx;
      if (h.indexOf('n') >= 0) dy = -dy;

      state.resized = true;
      if (resizeDrag.square) {
        const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        const size = Math.max(1, snapGrid(Math.max(resizeDrag.width, resizeDrag.height) + delta));
        state.width = size;
        state.height = size;
      } else {
        state.width = Math.max(1, snapGrid(resizeDrag.width + dx));
        state.height = Math.max(1, snapGrid(resizeDrag.height + dy));
      }
      applyState(selected, state);
    });

    handle.addEventListener('pointerup', function (event) {
      if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
      event.preventDefault();
      resizeDrag = null;
      commitHistory();
    });
  });

  window.addEventListener('click', function (event) {
    if (!active || isEditorNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function handleKeyboard(event) {
    if (!active) return false;

    const key = event.key;
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return true;
    }
    if (modifier && key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return true;
    }
    if ((key === 'Delete' || key === 'Backspace') && selected) {
      event.preventDefault();
      deleteSelected();
      return true;
    }
    if (!selected || !key.startsWith('Arrow')) return false;

    event.preventDefault();
    const step = modifier ? 10 : 1;
    if (event.shiftKey) {
      if (key === 'ArrowLeft') adjustSize(-step, 0);
      if (key === 'ArrowRight') adjustSize(step, 0);
      if (key === 'ArrowUp') adjustSize(0, -step);
      if (key === 'ArrowDown') adjustSize(0, step);
    } else {
      if (key === 'ArrowLeft') adjustMove(-step, 0);
      if (key === 'ArrowRight') adjustMove(step, 0);
      if (key === 'ArrowUp') adjustMove(0, -step);
      if (key === 'ArrowDown') adjustMove(0, step);
    }
    return true;
  }

  window.addEventListener('keydown', function (event) {
    if (handleKeyboard(event)) event.stopImmediatePropagation();
  }, true);

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.source !== 'radio-layout-host') return;
    const payload = data.payload || {};

    if (data.type === 'enable') enable();
    if (data.type === 'disable') disable();
    if (data.type === 'reset') restoreAll();
    if (data.type === 'undo') undo();
    if (data.type === 'redo') redo();
    if (data.type === 'delete') deleteSelected();
    if (data.type === 'move') adjustMove(Number(payload.dx) || 0, Number(payload.dy) || 0);
    if (data.type === 'resize') adjustSize(Number(payload.dw) || 0, Number(payload.dh) || 0, true, !!payload.proportional);
    if (data.type === 'font-size') adjustFont(Number(payload.delta) || 0);
    if (data.type === 'style') setVisualStyle(String(payload.kind || ''), payload.value);
    if (data.type === 'z-change') adjustZ(Number(payload.delta) || 0);
    if (data.type === 'z-set') setZ(payload.value);
    if (data.type === 'grid') {
      grid = Math.max(1, Number(payload.grid) || 1);
      updateOverlay();
    }
    if (data.type === 'activate-element') {
      const element = document.getElementById(String(payload.id || ''));
      if (element) {
        const wasActive = active;
        active = false;
        document.body.classList.remove('ve-active');
        element.click();
        active = wasActive;
        if (wasActive) document.body.classList.add('ve-active');
        selected = null;
        hideGuides();
        updateOverlay();
      }
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
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    move: adjustMove,
    resize: adjustSize,
    fontSize: adjustFont,
    setVisualStyle: setVisualStyle,
    adjustZ: adjustZ,
    setZ: setZ,
    state: currentPayload
  };

  emit('ready', { hosted: hosted });
  if (hosted) setTimeout(enable, 80);
})();