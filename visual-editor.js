(function () {
  'use strict';

  const panel = document.getElementById('uiPanel');
  if (document.getElementById('veLauncher')) return;

  const params = new URLSearchParams(location.search);
  const hosted = params.get('visual-editor') === '1' || window.__APP_INTERFACE_STUDIO_HOSTED__ === true;
  const GUIDE_THRESHOLD = 5;

  const launcher = document.createElement('button');
  launcher.id = 'veLauncher';
  launcher.className = 've-launcher';
  launcher.type = 'button';
  launcher.textContent = '✥ Activer l’éditeur visuel';
  if (panel) panel.appendChild(launcher);
  else {
    launcher.classList.add('ve-launcher-generic');
    document.body.appendChild(launcher);
  }

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
  const selectedSet = new Set();
  const secondaryOutlines = new Map();
  let drag = null;
  let resizeDrag = null;
  let grid = 1;
  let keyboardCommitTimer = null;
  let safeArea = { top: 0, right: 0, bottom: 0, left: 0, profile: 'none' };
  let responsiveResizeTimer = null;

  const history = [];
  let historyIndex = -1;
  let applyingHistory = false;

  if (hosted) document.body.classList.add('ve-hosted');

  function emit(type, payload) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ source: 'app-visual-editor', type: type, payload: payload || {} }, '*');
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
    ['translate','width','height','min-width','min-height','max-width','max-height','box-sizing','flex','font-size','font-family','font-weight','font-style','text-decoration','text-align','letter-spacing','line-height','visibility','pointer-events','color','background-color','border-color','z-index','position'].forEach(function (prop) {
      original[prop] = {
        value: element.style.getPropertyValue(prop),
        priority: element.style.getPropertyPriority(prop)
      };
    });
    const entry = { selector: selector, element: element, original: original, originalText: element.children.length === 0 ? element.textContent : null };
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
      fontFamily: getComputedStyle(element).fontFamily || 'system-ui',
      fontWeight: getComputedStyle(element).fontWeight || '400',
      fontStyle: getComputedStyle(element).fontStyle || 'normal',
      textDecoration: getComputedStyle(element).textDecorationLine || 'none',
      textAlign: getComputedStyle(element).textAlign || 'left',
      letterSpacing: getComputedStyle(element).letterSpacing || 'normal',
      lineHeight: getComputedStyle(element).lineHeight || 'normal',
      fontAdjusted: false,
      textContent: element.children.length === 0 ? element.textContent : '',
      textAdjusted: false,
      textEditable: element.children.length === 0 && String(element.textContent || '').trim().length > 0,
      locked: false,
      color: getComputedStyle(element).color || '#000000',
      backgroundColor: getComputedStyle(element).backgroundColor || 'rgba(0,0,0,0)',
      borderColor: getComputedStyle(element).borderColor || 'rgba(0,0,0,0)',
      colorAdjusted: false,
      backgroundAdjusted: false,
      borderAdjusted: false,
      zIndex: parseInt(getComputedStyle(element).zIndex,10) || 0,
      zAdjusted: false,
      deleted: false,
      responsiveDx: 0,
      responsiveDy: 0,
      responsive: {
        enabled: true,
        hAnchor: 'free',
        vAnchor: 'free',
        widthMode: 'auto',
        heightMode: 'auto',
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        centerOffsetX: 0,
        centerOffsetY: 0,
        widthPercent: 100,
        heightPercent: 100,
        safeArea: true
      }
    };
    touched.set(element, state);
    captureResponsiveFromCurrent(element, state, false);
    const bounds = responsiveBounds(element, state);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rx = bounds.width > 0 ? (cx - bounds.left) / bounds.width : .5;
    const ry = bounds.height > 0 ? (cy - bounds.top) / bounds.height : .5;
    state.responsive.hAnchor = rx < .34 ? 'left' : (rx > .66 ? 'right' : 'center');
    state.responsive.vAnchor = ry < .34 ? 'top' : (ry > .66 ? 'bottom' : 'center');
    if (rect.width >= bounds.width * .78) {
      state.responsive.widthMode = 'fill';
      state.responsive.hAnchor = 'stretch';
    }
    return state;
  }


  function selectionElements() {
    const list = Array.from(selectedSet).filter(function (el) {
      const state = touched.get(el);
      return document.documentElement.contains(el) && !(state && state.deleted);
    });
    if (selected && document.documentElement.contains(selected) && !list.includes(selected)) list.push(selected);
    return list;
  }

  function selectionBounds() {
    const items = selectionElements();
    if (!items.length) return null;
    const rects = items.map(function (el) { return el.getBoundingClientRect(); });
    const left = Math.min.apply(null, rects.map(function (r) { return r.left; }));
    const top = Math.min.apply(null, rects.map(function (r) { return r.top; }));
    const right = Math.max.apply(null, rects.map(function (r) { return r.right; }));
    const bottom = Math.max.apply(null, rects.map(function (r) { return r.bottom; }));
    return { left:left, top:top, right:right, bottom:bottom, width:right-left, height:bottom-top };
  }

  function ensureSecondaryOutline(element) {
    if (secondaryOutlines.has(element)) return secondaryOutlines.get(element);
    const box = document.createElement('div');
    box.className = 've-selection ve-selection-secondary';
    document.body.appendChild(box);
    secondaryOutlines.set(element, box);
    return box;
  }

  function clearSecondaryOutlines() {
    secondaryOutlines.forEach(function (box) { box.remove(); });
    secondaryOutlines.clear();
  }

  function syncSecondaryOutlines() {
    const keep = new Set();
    selectionElements().forEach(function (el) {
      if (el === selected) return;
      const box = ensureSecondaryOutline(el);
      const r = el.getBoundingClientRect();
      box.style.display = active ? 'block' : 'none';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      keep.add(el);
    });
    Array.from(secondaryOutlines.entries()).forEach(function (entry) {
      if (!keep.has(entry[0])) {
        entry[1].remove();
        secondaryOutlines.delete(entry[0]);
      }
    });
  }

  function moveResponsiveState(element, state, dx, dy) {
    const cfg = state.responsive;
    if (!cfg || !cfg.enabled) {
      state.dx = snapGrid(state.dx + dx);
      state.dy = snapGrid(state.dy + dy);
      return;
    }
    if (cfg.hAnchor === 'left' || cfg.hAnchor === 'stretch') cfg.marginLeft = snapGrid(cfg.marginLeft + dx);
    else if (cfg.hAnchor === 'right') cfg.marginRight = snapGrid(cfg.marginRight - dx);
    else if (cfg.hAnchor === 'center') cfg.centerOffsetX = snapGrid(cfg.centerOffsetX + dx);
    else state.dx = snapGrid(state.dx + dx);

    if (cfg.vAnchor === 'top' || cfg.vAnchor === 'stretch') cfg.marginTop = snapGrid(cfg.marginTop + dy);
    else if (cfg.vAnchor === 'bottom') cfg.marginBottom = snapGrid(cfg.marginBottom - dy);
    else if (cfg.vAnchor === 'center') cfg.centerOffsetY = snapGrid(cfg.centerOffsetY + dy);
    else state.dy = snapGrid(state.dy + dy);

    applyState(element, state, false);
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


  function cloneResponsive(value) {
    const src = value || {};
    return {
      enabled: !!src.enabled,
      hAnchor: src.hAnchor || 'free',
      vAnchor: src.vAnchor || 'free',
      widthMode: src.widthMode || 'auto',
      heightMode: src.heightMode || 'auto',
      marginLeft: Number(src.marginLeft) || 0,
      marginRight: Number(src.marginRight) || 0,
      marginTop: Number(src.marginTop) || 0,
      marginBottom: Number(src.marginBottom) || 0,
      centerOffsetX: Number(src.centerOffsetX) || 0,
      centerOffsetY: Number(src.centerOffsetY) || 0,
      widthPercent: Math.max(1, Math.min(100, Number(src.widthPercent) || 100)),
      heightPercent: Math.max(1, Math.min(100, Number(src.heightPercent) || 100)),
      safeArea: src.safeArea !== false
    };
  }

  function isViewportParent(parent, rect) {
    if (!parent || parent === document.body || parent === document.documentElement) return true;
    if (!rect) return false;
    return Math.abs(rect.left) < 3 && Math.abs(rect.top) < 3 &&
      Math.abs(rect.width - innerWidth) < 6 && Math.abs(rect.height - innerHeight) < 6;
  }

  function responsiveBounds(element, state) {
    const parent = element.parentElement;
    const viewportParent = !parent || parent === document.body || parent === document.documentElement;
    const parentRect = viewportParent
      ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }
      : parent.getBoundingClientRect();
    const useSafe = state.responsive && state.responsive.safeArea && (viewportParent || isViewportParent(parent, parentRect));
    const leftInset = useSafe ? safeArea.left : 0;
    const rightInset = useSafe ? safeArea.right : 0;
    const topInset = useSafe ? safeArea.top : 0;
    const bottomInset = useSafe ? safeArea.bottom : 0;
    return {
      left: parentRect.left + leftInset,
      top: parentRect.top + topInset,
      right: parentRect.right - rightInset,
      bottom: parentRect.bottom - bottomInset,
      width: Math.max(1, parentRect.width - leftInset - rightInset),
      height: Math.max(1, parentRect.height - topInset - bottomInset)
    };
  }

  function captureResponsiveFromCurrent(element, state, resetFineOffset) {
    if (!element || !state) return;
    const r = element.getBoundingClientRect();
    const b = responsiveBounds(element, state);
    const cfg = state.responsive;
    cfg.marginLeft = Math.round(r.left - b.left);
    cfg.marginRight = Math.round(b.right - r.right);
    cfg.marginTop = Math.round(r.top - b.top);
    cfg.marginBottom = Math.round(b.bottom - r.bottom);
    cfg.centerOffsetX = Math.round((r.left + r.width / 2) - (b.left + b.width / 2));
    cfg.centerOffsetY = Math.round((r.top + r.height / 2) - (b.top + b.height / 2));
    cfg.widthPercent = Math.max(1, Math.min(100, Math.round((r.width / b.width) * 1000) / 10));
    cfg.heightPercent = Math.max(1, Math.min(100, Math.round((r.height / b.height) * 1000) / 10));
    if (resetFineOffset) {
      state.dx = 0;
      state.dy = 0;
      state.responsiveDx = 0;
      state.responsiveDy = 0;
    }
  }

  function applyResponsive(element, state) {
    const cfg = state.responsive;
    if (!cfg || !cfg.enabled) {
      state.responsiveDx = 0;
      state.responsiveDy = 0;
      return;
    }

    const bounds = responsiveBounds(element, state);

    if (cfg.widthMode === 'fill') {
      setInline(element, 'width', Math.max(1, bounds.width - cfg.marginLeft - cfg.marginRight) + 'px');
      setInline(element, 'min-width', '0px');
      setInline(element, 'max-width', 'none');
      setInline(element, 'box-sizing', 'border-box');
    } else if (cfg.widthMode === 'percent') {
      setInline(element, 'width', Math.max(1, bounds.width * cfg.widthPercent / 100) + 'px');
      setInline(element, 'min-width', '0px');
      setInline(element, 'max-width', 'none');
      setInline(element, 'box-sizing', 'border-box');
    } else if (cfg.widthMode === 'fixed') {
      setInline(element, 'width', Math.max(1, state.width) + 'px');
      setInline(element, 'box-sizing', 'border-box');
    }

    if (cfg.heightMode === 'fill') {
      setInline(element, 'height', Math.max(1, bounds.height - cfg.marginTop - cfg.marginBottom) + 'px');
      setInline(element, 'min-height', '0px');
      setInline(element, 'max-height', 'none');
      setInline(element, 'box-sizing', 'border-box');
    } else if (cfg.heightMode === 'percent') {
      setInline(element, 'height', Math.max(1, bounds.height * cfg.heightPercent / 100) + 'px');
      setInline(element, 'min-height', '0px');
      setInline(element, 'max-height', 'none');
      setInline(element, 'box-sizing', 'border-box');
    } else if (cfg.heightMode === 'fixed') {
      setInline(element, 'height', Math.max(1, state.height) + 'px');
      setInline(element, 'box-sizing', 'border-box');
    }

    const visible = element.getBoundingClientRect();
    const currentTx = (state.dx || 0) + (state.responsiveDx || 0);
    const currentTy = (state.dy || 0) + (state.responsiveDy || 0);
    const baseLeft = visible.left - currentTx;
    const baseTop = visible.top - currentTy;
    let targetLeft = baseLeft;
    let targetTop = baseTop;

    if (cfg.hAnchor === 'left') targetLeft = bounds.left + cfg.marginLeft;
    if (cfg.hAnchor === 'right') targetLeft = bounds.right - cfg.marginRight - visible.width;
    if (cfg.hAnchor === 'center') targetLeft = bounds.left + (bounds.width - visible.width) / 2 + cfg.centerOffsetX;
    if (cfg.hAnchor === 'stretch') targetLeft = bounds.left + cfg.marginLeft;

    if (cfg.vAnchor === 'top') targetTop = bounds.top + cfg.marginTop;
    if (cfg.vAnchor === 'bottom') targetTop = bounds.bottom - cfg.marginBottom - visible.height;
    if (cfg.vAnchor === 'center') targetTop = bounds.top + (bounds.height - visible.height) / 2 + cfg.centerOffsetY;
    if (cfg.vAnchor === 'stretch') targetTop = bounds.top + cfg.marginTop;

    state.responsiveDx = cfg.hAnchor === 'free' ? 0 : Math.round(targetLeft - baseLeft);
    state.responsiveDy = cfg.vAnchor === 'free' ? 0 : Math.round(targetTop - baseTop);
  }

  function reflowResponsive() {
    touched.forEach(function (state, element) {
      if (!state.responsive || !state.responsive.enabled || state.deleted || !document.documentElement.contains(element)) return;
      applyState(element, state, false);
    });
    updateOverlay();
  }

  function setResponsiveConfig(payload) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (!state || state.locked) return;
    const wasEnabled = !!state.responsive.enabled;
    if (payload.enabled === true && !wasEnabled) {
      state.responsive.enabled = true;
      captureResponsiveFromCurrent(selected, state, false);
    }

    const currentRect = selected.getBoundingClientRect();
    const bounds = responsiveBounds(selected, state);
    if (payload.hAnchor && payload.hAnchor !== state.responsive.hAnchor) {
      state.responsive.marginLeft = Math.round(currentRect.left - bounds.left);
      state.responsive.marginRight = Math.round(bounds.right - currentRect.right);
      state.responsive.centerOffsetX = Math.round((currentRect.left + currentRect.width / 2) - (bounds.left + bounds.width / 2));
    }
    if (payload.vAnchor && payload.vAnchor !== state.responsive.vAnchor) {
      state.responsive.marginTop = Math.round(currentRect.top - bounds.top);
      state.responsive.marginBottom = Math.round(bounds.bottom - currentRect.bottom);
      state.responsive.centerOffsetY = Math.round((currentRect.top + currentRect.height / 2) - (bounds.top + bounds.height / 2));
    }

    Object.keys(payload || {}).forEach(function (key) {
      if (key in state.responsive && key !== 'enabled') state.responsive[key] = payload[key];
    });
    if (payload.hAnchor === 'stretch') state.responsive.widthMode = 'fill';
    if (payload.vAnchor === 'stretch') state.responsive.heightMode = 'fill';
    if (payload.enabled === false) {
      state.responsive.enabled = false;
      state.responsiveDx = 0;
      state.responsiveDy = 0;
    }
    state.responsive = cloneResponsive(state.responsive);
    applyState(selected, state, false);
    updateOverlay();
    commitHistory();
  }

  function captureResponsiveRules() {
    if (!active || !selected) return;
    const state = remember(selected);
    if (!state || state.locked) return;
    state.responsive.enabled = true;
    if (state.responsive.hAnchor === 'free') state.responsive.hAnchor = 'left';
    if (state.responsive.vAnchor === 'free') state.responsive.vAnchor = 'top';
    captureResponsiveFromCurrent(selected, state, true);
    applyState(selected, state, false);
    updateOverlay();
    commitHistory();
  }

  function setSafeArea(payload) {
    safeArea = {
      top: Math.max(0, Number(payload.top) || 0),
      right: Math.max(0, Number(payload.right) || 0),
      bottom: Math.max(0, Number(payload.bottom) || 0),
      left: Math.max(0, Number(payload.left) || 0),
      profile: String(payload.profile || 'custom')
    };
    reflowResponsive();
  }

  function applyState(element, state, update) {
    if (!element || !state) return;

    if (state.deleted) {
      setInline(element, 'visibility', 'hidden');
      setInline(element, 'pointer-events', 'none');
      if (update !== false) updateOverlay();
      return;
    }
    restoreOriginalProp(state.selector, 'visibility');
    restoreOriginalProp(state.selector, 'pointer-events');

    const responsiveActive = !!(state.responsive && state.responsive.enabled);

    if (state.resized) {
      setInline(element, 'width', Math.max(1, state.width) + 'px');
      setInline(element, 'height', Math.max(1, state.height) + 'px');
      setInline(element, 'min-width', '0px');
      setInline(element, 'min-height', '0px');
      setInline(element, 'max-width', 'none');
      setInline(element, 'max-height', 'none');
      setInline(element, 'box-sizing', 'border-box');
      setInline(element, 'flex', 'none');
    } else {
      ['width','height','min-width','min-height','max-width','max-height','box-sizing','flex'].forEach(function(prop){
        restoreOriginalProp(state.selector, prop);
      });
    }

    if (responsiveActive) applyResponsive(element, state);
    else {
      state.responsiveDx = 0;
      state.responsiveDy = 0;
    }

    const totalDx = (state.dx || 0) + (state.responsiveDx || 0);
    const totalDy = (state.dy || 0) + (state.responsiveDy || 0);
    setInline(element, 'translate', (totalDx || totalDy) ? totalDx + 'px ' + totalDy + 'px' : null);

    if (state.fontAdjusted) {
      setInline(element, 'font-size', Math.max(4, state.fontSize) + 'px');
      setInline(element, 'font-family', state.fontFamily);
      setInline(element, 'font-weight', state.fontWeight);
      setInline(element, 'font-style', state.fontStyle);
      setInline(element, 'text-decoration', state.textDecoration);
      setInline(element, 'text-align', state.textAlign);
      setInline(element, 'letter-spacing', state.letterSpacing);
      setInline(element, 'line-height', state.lineHeight);
    } else {
      ['font-size','font-family','font-weight','font-style','text-decoration','text-align','letter-spacing','line-height'].forEach(function(prop){
        restoreOriginalProp(state.selector, prop);
      });
    }

    const reg = registry.get(state.selector);
    if (state.textAdjusted && state.textEditable) element.textContent = state.textContent;
    else if (reg && reg.originalText !== null && state.textEditable) element.textContent = reg.originalText;

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
      restoreOriginalProp(state.selector, 'position');
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
    if (entry.originalText !== null) entry.element.textContent = entry.originalText;
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
        fontFamily: state.fontFamily,
        fontWeight: state.fontWeight,
        fontStyle: state.fontStyle,
        textDecoration: state.textDecoration,
        textAlign: state.textAlign,
        letterSpacing: state.letterSpacing,
        lineHeight: state.lineHeight,
        fontAdjusted: state.fontAdjusted,
        textContent: state.textContent,
        textAdjusted: state.textAdjusted,
        textEditable: state.textEditable,
        locked: state.locked,
        color: state.color,
        backgroundColor: state.backgroundColor,
        borderColor: state.borderColor,
        colorAdjusted: state.colorAdjusted,
        backgroundAdjusted: state.backgroundAdjusted,
        borderAdjusted: state.borderAdjusted,
        zIndex: state.zIndex,
        zAdjusted: state.zAdjusted,
        deleted: state.deleted,
        responsiveDx: state.responsiveDx || 0,
        responsiveDy: state.responsiveDy || 0,
        responsive: cloneResponsive(state.responsive)
      });
    });
    items.sort(function (a, b) { return a.selector.localeCompare(b.selector); });
    return {
      items: items,
      selectedSelector: selected ? selectorFor(selected) : '',
      selectedSelectors: selectionElements().map(selectorFor).filter(Boolean)
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
        fontFamily: saved.fontFamily || getComputedStyle(element).fontFamily || 'system-ui',
        fontWeight: saved.fontWeight || getComputedStyle(element).fontWeight || '400',
        fontStyle: saved.fontStyle || getComputedStyle(element).fontStyle || 'normal',
        textDecoration: saved.textDecoration || getComputedStyle(element).textDecorationLine || 'none',
        textAlign: saved.textAlign || getComputedStyle(element).textAlign || 'left',
        letterSpacing: saved.letterSpacing || getComputedStyle(element).letterSpacing || 'normal',
        lineHeight: saved.lineHeight || getComputedStyle(element).lineHeight || 'normal',
        fontAdjusted: !!saved.fontAdjusted,
        textContent: saved.textContent !== undefined ? String(saved.textContent) : (element.children.length === 0 ? element.textContent : ''),
        textAdjusted: !!saved.textAdjusted,
        textEditable: saved.textEditable !== undefined ? !!saved.textEditable : (element.children.length === 0 && String(element.textContent || '').trim().length > 0),
        locked: !!saved.locked,
        color: saved.color || getComputedStyle(element).color || '#000000',
        backgroundColor: saved.backgroundColor || getComputedStyle(element).backgroundColor || 'rgba(0,0,0,0)',
        borderColor: saved.borderColor || getComputedStyle(element).borderColor || 'rgba(0,0,0,0)',
        colorAdjusted: !!saved.colorAdjusted,
        backgroundAdjusted: !!saved.backgroundAdjusted,
        borderAdjusted: !!saved.borderAdjusted,
        zIndex: Number(saved.zIndex) || 0,
        zAdjusted: !!saved.zAdjusted,
        deleted: !!saved.deleted,
        responsiveDx: Number(saved.responsiveDx) || 0,
        responsiveDy: Number(saved.responsiveDy) || 0,
        responsive: cloneResponsive(saved.responsive)
      };
      touched.set(element, state);
      applyState(element, state, false);
    });

    selectedSet.clear();
    const restoredSelectors = Array.isArray(snap.selectedSelectors) ? snap.selectedSelectors : (snap.selectedSelector ? [snap.selectedSelector] : []);
    restoredSelectors.forEach(function (sel) {
      const el = document.querySelector(sel);
      const st = el ? touched.get(el) : null;
      if (el && !(st && st.deleted)) selectedSet.add(el);
    });
    selected = snap.selectedSelector ? document.querySelector(snap.selectedSelector) : (selectedSet.values().next().value || null);
    if (selected) {
      const st = touched.get(selected);
      if (st && st.deleted) selected = null;
    }
    if (selected && !selectedSet.has(selected)) selectedSet.add(selected);
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
    selectedSet.clear();
    clearSecondaryOutlines();
    hideGuides();
    updateOverlay();
    commitHistory();
  }

  function cssText() {
    const rules = [];
    touched.forEach(function (state) {
      const declarations = [];
      if (state.deleted) {
        declarations.push('  visibility: hidden !important;');
        declarations.push('  pointer-events: none !important;');
      } else {
        if (state.responsive && state.responsive.enabled) {
          declarations.push('  /* Responsive: horizontal=' + state.responsive.hAnchor + ', vertical=' + state.responsive.vAnchor + ', largeur=' + state.responsive.widthMode + ', hauteur=' + state.responsive.heightMode + ', safe-area=' + state.responsive.safeArea + ' */');
          if (state.responsive.widthMode === 'percent') declarations.push('  width: ' + state.responsive.widthPercent + '% !important;');
          if (state.responsive.widthMode === 'fill') declarations.push('  width: calc(100% - ' + state.responsive.marginLeft + 'px - ' + state.responsive.marginRight + 'px) !important;');
          if (state.responsive.heightMode === 'percent') declarations.push('  height: ' + state.responsive.heightPercent + '% !important;');
          if (state.responsive.heightMode === 'fill') declarations.push('  height: calc(100% - ' + state.responsive.marginTop + 'px - ' + state.responsive.marginBottom + 'px) !important;');
        }
        const responsiveExport = !!(state.responsive && state.responsive.enabled);
        const exportDx = state.dx || 0;
        const exportDy = state.dy || 0;
        if (responsiveExport) declarations.push('  /* Les ancrages et marges ci-dessus sont structurels ; la translation calculée de l’aperçu n’est volontairement pas exportée. */');
        if (exportDx || exportDy) declarations.push('  translate: ' + exportDx + 'px ' + exportDy + 'px !important;');
        if (state.resized) {
          const responsiveActive = !!(state.responsive && state.responsive.enabled);
          if (!responsiveActive || state.responsive.widthMode === 'auto' || state.responsive.widthMode === 'fixed') {
            declarations.push('  width: ' + Math.max(1, state.width) + 'px !important;');
            declarations.push('  min-width: 0 !important;');
            declarations.push('  max-width: none !important;');
          }
          if (!responsiveActive || state.responsive.heightMode === 'auto' || state.responsive.heightMode === 'fixed') {
            declarations.push('  height: ' + Math.max(1, state.height) + 'px !important;');
            declarations.push('  min-height: 0 !important;');
            declarations.push('  max-height: none !important;');
          }
          declarations.push('  box-sizing: border-box !important;');
          declarations.push('  flex: none !important;');
        }
        if (state.fontAdjusted) {
          declarations.push('  font-size: ' + Math.max(4, state.fontSize).toFixed(1).replace(/\.0$/, '') + 'px !important;');
          declarations.push('  font-family: ' + state.fontFamily + ' !important;');
          declarations.push('  font-weight: ' + state.fontWeight + ' !important;');
          declarations.push('  font-style: ' + state.fontStyle + ' !important;');
          declarations.push('  text-decoration: ' + state.textDecoration + ' !important;');
          declarations.push('  text-align: ' + state.textAlign + ' !important;');
          declarations.push('  letter-spacing: ' + state.letterSpacing + ' !important;');
          declarations.push('  line-height: ' + state.lineHeight + ' !important;');
        }
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
      fontFamily: state.fontFamily,
      fontWeight: state.fontWeight,
      fontStyle: state.fontStyle,
      textDecoration: state.textDecoration,
      textAlign: state.textAlign,
      letterSpacing: state.letterSpacing,
      lineHeight: state.lineHeight,
      textContent: state.textContent,
      textEditable: state.textEditable,
      locked: state.locked,
      parentSelector: selected.parentElement ? selectorFor(selected.parentElement) : '',
      color: state.color,
      backgroundColor: state.backgroundColor,
      borderColor: state.borderColor,
      zIndex: state.zIndex,
      dx: state.dx,
      dy: state.dy,
      selectionCount: selectionElements().length,
      selectedSelectors: selectionElements().map(selectorFor).filter(Boolean),
      responsive: cloneResponsive(state.responsive),
      safeArea: Object.assign({}, safeArea),
      css: cssText(),
      grid: grid
    };
  }

  function updateOverlay() {
    if (!active || !selected || !document.documentElement.contains(selected)) {
      outline.style.display = 'none';
      clearSecondaryOutlines();
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
    syncSecondaryOutlines();
    const count = selectionElements().length;
    const groupRect = count > 1 ? selectionBounds() : rect;
    targetLabel.textContent = count > 1 ? (count + ' objets sélectionnés') : state.selector;
    metrics.textContent = 'X ' + Math.round(groupRect.left) + ' · Y ' + Math.round(groupRect.top) +
      ' · L ' + Math.round(groupRect.width) + ' · H ' + Math.round(groupRect.height) +
      (count > 1 ? ' · sélection multiple' : ' · texte ' + Math.round(state.fontSize * 10) / 10 + ' px');
    emit('state', currentPayload());
  }

  function select(element, additive) {
    if (!element || isEditorNode(element)) return;
    if (element.closest && element.closest('svg') && element.tagName && element.tagName.toLowerCase() !== 'svg') {
      element = element.closest('svg');
    }
    remember(element);

    if (!additive) {
      selectedSet.clear();
      selectedSet.add(element);
      selected = element;
    } else if (selectedSet.has(element)) {
      if (selectedSet.size > 1) {
        selectedSet.delete(element);
        if (selected === element) selected = Array.from(selectedSet).pop() || null;
      } else {
        selected = element;
      }
    } else {
      selectedSet.add(element);
      selected = element;
    }

    hideGuides();
    updateOverlay();
  }

  function adjustMove(dx, dy, commit) {
    if (!active || !selected) return;
    const items = selectionElements();
    items.forEach(function (element) {
      const state = remember(element);
      if (!state || state.locked) return;
      moveResponsiveState(element, state, dx, dy);
    });
    hideGuides();
    updateOverlay();
    if (commit !== false) commitHistory();
  }

  function queueKeyboardCommit() {
    if (keyboardCommitTimer) clearTimeout(keyboardCommitTimer);
    keyboardCommitTimer = setTimeout(function () {
      keyboardCommitTimer = null;
      commitHistory();
    }, 180);
  }

  function flushKeyboardCommit() {
    if (!keyboardCommitTimer) return;
    clearTimeout(keyboardCommitTimer);
    keyboardCommitTimer = null;
    commitHistory();
  }

  function adjustSize(dw, dh, commit, proportional) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (state.locked) return;
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
    if (state.locked) return;
    state.fontAdjusted = true;
    state.fontSize = Math.max(4, Math.round((state.fontSize + delta) * 10) / 10);
    applyState(selected, state);
    if (commit !== false) commitHistory();
  }

  function setExactSize(width, height, keepRatio) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (state.locked) return;
    const rect = selected.getBoundingClientRect();
    let w = Math.max(1, Number(width) || rect.width);
    let h = Math.max(1, Number(height) || rect.height);
    if (keepRatio) {
      const ratio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
      if (Number(width) && !Number(height)) h = w / ratio;
      else if (Number(height) && !Number(width)) w = h * ratio;
    }
    state.resized = true;
    state.width = snapGrid(w);
    state.height = snapGrid(h);
    applyState(selected, state);
    commitHistory();
  }

  function setExactPosition(x, y) {
    if (!active || !selected) return;
    const rect = selectionElements().length > 1 ? selectionBounds() : selected.getBoundingClientRect();
    const dx = Number.isFinite(Number(x)) ? snapGrid(Number(x) - rect.left) : 0;
    const dy = Number.isFinite(Number(y)) ? snapGrid(Number(y) - rect.top) : 0;
    adjustMove(dx, dy, true);
  }

  function alignSelected(mode) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (state.locked) return;
    const rect = selected.getBoundingClientRect();
    const parent = selected.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : {left:0,top:0,width:innerWidth,height:innerHeight};
    let dx = 0, dy = 0;
    if (mode === 'screen-x') dx = innerWidth / 2 - (rect.left + rect.width / 2);
    if (mode === 'screen-y') dy = innerHeight / 2 - (rect.top + rect.height / 2);
    if (mode === 'parent-x') dx = parentRect.left + parentRect.width / 2 - (rect.left + rect.width / 2);
    if (mode === 'parent-y') dy = parentRect.top + parentRect.height / 2 - (rect.top + rect.height / 2);
    if (mode === 'parent-both') {
      dx = parentRect.left + parentRect.width / 2 - (rect.left + rect.width / 2);
      dy = parentRect.top + parentRect.height / 2 - (rect.top + rect.height / 2);
    }
    state.dx = snapGrid(state.dx + dx);
    state.dy = snapGrid(state.dy + dy);
    applyState(selected, state, false);
    hideGuides();
    if (mode === 'screen-x') showVerticalGuide(innerWidth / 2, 'Centre écran');
    if (mode === 'screen-y') showHorizontalGuide(innerHeight / 2, 'Milieu écran');
    if (mode === 'parent-x' || mode === 'parent-both') showVerticalGuide(parentRect.left + parentRect.width / 2, 'Centre du parent');
    if (mode === 'parent-y' || mode === 'parent-both') showHorizontalGuide(parentRect.top + parentRect.height / 2, 'Milieu du parent');
    updateOverlay();
    commitHistory();
  }

  function setTextProperty(kind, value) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (!state.textEditable) return;
    state.fontAdjusted = true;
    if (kind === 'family') state.fontFamily = String(value || 'system-ui');
    if (kind === 'size') state.fontSize = Math.max(4, Number(value) || state.fontSize);
    if (kind === 'weight') state.fontWeight = String(value || '400');
    if (kind === 'style') state.fontStyle = String(value || 'normal');
    if (kind === 'decoration') state.textDecoration = String(value || 'none');
    if (kind === 'align') state.textAlign = String(value || 'left');
    if (kind === 'letter-spacing') state.letterSpacing = String(value || 'normal');
    if (kind === 'line-height') state.lineHeight = String(value || 'normal');
    applyState(selected, state);
    commitHistory();
  }

  function setTextContent(value) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (!state.textEditable) return;
    state.textContent = String(value == null ? '' : value);
    state.textAdjusted = true;
    applyState(selected, state);
    commitHistory();
  }

  function toggleLock(value) {
    if (!active || !selected) return;
    const state = remember(selected);
    state.locked = value === undefined ? !state.locked : !!value;
    updateOverlay();
    commitHistory();
  }

  function measureSpacing() {
    if (!active || !selected) return;
    const rect = selected.getBoundingClientRect();
    const parent = selected.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : {left:0,right:innerWidth,top:0,bottom:innerHeight};
    const peers = parent ? Array.from(parent.children).filter(function(el){
      if (el === selected || !el.getBoundingClientRect || isEditorNode(el)) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    }) : [];
    let left = null, right = null, top = null, bottom = null;
    peers.forEach(function(el){
      const r = el.getBoundingClientRect();
      const verticalOverlap = Math.min(rect.bottom,r.bottom) - Math.max(rect.top,r.top) > 0;
      const horizontalOverlap = Math.min(rect.right,r.right) - Math.max(rect.left,r.left) > 0;
      if (verticalOverlap && r.right <= rect.left) {
        const gap = rect.left - r.right;
        if (!left || gap < left.gap) left = {gap:gap, selector:selectorFor(el)};
      }
      if (verticalOverlap && r.left >= rect.right) {
        const gap = r.left - rect.right;
        if (!right || gap < right.gap) right = {gap:gap, selector:selectorFor(el)};
      }
      if (horizontalOverlap && r.bottom <= rect.top) {
        const gap = rect.top - r.bottom;
        if (!top || gap < top.gap) top = {gap:gap, selector:selectorFor(el)};
      }
      if (horizontalOverlap && r.top >= rect.bottom) {
        const gap = r.top - rect.bottom;
        if (!bottom || gap < bottom.gap) bottom = {gap:gap, selector:selectorFor(el)};
      }
    });
    emit('spacing', {
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      parent: {
        left: Math.round(rect.left - parentRect.left),
        right: Math.round(parentRect.right - rect.right),
        top: Math.round(rect.top - parentRect.top),
        bottom: Math.round(parentRect.bottom - rect.bottom)
      }
    });
  }

  function setVisualStyle(kind, value) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (state.locked) return;
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
    if (state.locked) return;
    state.zAdjusted = true;
    state.zIndex = (Number(state.zIndex) || 0) + delta;
    applyState(selected, state);
    commitHistory();
  }

  function setZ(value) {
    if (!active || !selected) return;
    const state = remember(selected);
    if (state.locked) return;
    state.zAdjusted = true;
    state.zIndex = Number(value) || 0;
    applyState(selected, state);
    commitHistory();
  }

  function deleteSelected() {
    if (!active || !selected) return;
    selectionElements().forEach(function (element) {
      const state = remember(element);
      if (!state || state.locked) return;
      state.deleted = true;
      applyState(element, state, false);
    });
    selected = null;
    selectedSet.clear();
    clearSecondaryOutlines();
    hideGuides();
    updateOverlay();
    commitHistory();
  }

  function exportProject() {
    return {
      format: 'app-layout-project',
      version: 2,
      exportedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight, safeArea: Object.assign({}, safeArea) },
      snapshot: snapshot(),
      css: cssText()
    };
  }

  function importProject(project) {
    if (!project || (project.format !== 'app-layout-project' && project.format !== 'radio-layout-project')) return false;
    if (project.viewport && project.viewport.safeArea) setSafeArea(project.viewport.safeArea);
    const snap = project.snapshot || project;
    if (!snap || !Array.isArray(snap.items)) return false;
    loadSnapshot(snap);
    commitHistory();
    emit('project-imported', { ok: true, count: snap.items.length });
    return true;
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
    clearSecondaryOutlines();
    hideGuides();
    emit('state', currentPayload());
  }

  window.addEventListener('pointerdown', function (event) {
    if (!active || isEditorNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    select(event.target, !!event.shiftKey);
    if (!selected) return;
    const movable = selectionElements().filter(function (element) {
      const state = remember(element);
      return state && !state.locked;
    });
    if (!movable.length) return;
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastDx: 0,
      lastDy: 0
    };
  }, true);

  window.addEventListener('pointermove', function (event) {
    if (!active || !drag || event.pointerId !== drag.pointerId || !selected) return;
    event.preventDefault();
    const totalDx = snapGrid(event.clientX - drag.x);
    const totalDy = snapGrid(event.clientY - drag.y);
    const stepDx = totalDx - drag.lastDx;
    const stepDy = totalDy - drag.lastDy;
    if (stepDx || stepDy) {
      selectionElements().forEach(function (element) {
        const state = remember(element);
        if (!state || state.locked) return;
        moveResponsiveState(element, state, stepDx, stepDy);
      });
      drag.lastDx = totalDx;
      drag.lastDy = totalDy;
    }
    hideGuides();
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
      if (state.locked) return;
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
      if (key === 'ArrowLeft') adjustSize(-step, 0, false);
      if (key === 'ArrowRight') adjustSize(step, 0, false);
      if (key === 'ArrowUp') adjustSize(0, -step, false);
      if (key === 'ArrowDown') adjustSize(0, step, false);
    } else {
      if (key === 'ArrowLeft') adjustMove(-step, 0, false);
      if (key === 'ArrowRight') adjustMove(step, 0, false);
      if (key === 'ArrowUp') adjustMove(0, -step, false);
      if (key === 'ArrowDown') adjustMove(0, step, false);
    }
    queueKeyboardCommit();
    return true;
  }

  window.addEventListener('keydown', function (event) {
    if (handleKeyboard(event)) event.stopImmediatePropagation();
  }, true);

  window.addEventListener('keyup', function (event) {
    if (!active || !event.key.startsWith('Arrow')) return;
    flushKeyboardCommit();
  }, true);

  window.addEventListener('resize', function () {
    if (responsiveResizeTimer) clearTimeout(responsiveResizeTimer);
    responsiveResizeTimer = setTimeout(function () {
      responsiveResizeTimer = null;
      reflowResponsive();
    }, 40);
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    if (data.source !== 'app-layout-host' && data.source !== 'radio-layout-host') return;
    const payload = data.payload || {};

    if (data.type === 'enable') enable();
    if (data.type === 'disable') disable();
    if (data.type === 'reset') restoreAll();
    if (data.type === 'undo') undo();
    if (data.type === 'redo') redo();
    if (data.type === 'delete') deleteSelected();
    if (data.type === 'move') adjustMove(Number(payload.dx) || 0, Number(payload.dy) || 0, payload.commit !== false);
    if (data.type === 'resize') adjustSize(Number(payload.dw) || 0, Number(payload.dh) || 0, payload.commit !== false, !!payload.proportional);
    if (data.type === 'keyboard-commit') flushKeyboardCommit();
    if (data.type === 'responsive-set') setResponsiveConfig(payload);
    if (data.type === 'responsive-capture') captureResponsiveRules();
    if (data.type === 'safe-area') setSafeArea(payload);
    if (data.type === 'font-size') adjustFont(Number(payload.delta) || 0);
    if (data.type === 'set-size') setExactSize(payload.width, payload.height, !!payload.keepRatio);
    if (data.type === 'set-position') setExactPosition(payload.x, payload.y);
    if (data.type === 'align') alignSelected(String(payload.mode || ''));
    if (data.type === 'text-style') setTextProperty(String(payload.kind || ''), payload.value);
    if (data.type === 'text-content') setTextContent(payload.value);
    if (data.type === 'lock') toggleLock(payload.value);
    if (data.type === 'measure-spacing') measureSpacing();
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
    if (data.type === 'get-project') emit('project', { project: exportProject() });
    if (data.type === 'load-project') importProject(payload.project);
    if (data.type === 'download-css') downloadCss();
    if (data.type === 'copy-css') copyCss();
  });

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
    exportProject: exportProject,
    importProject: importProject,
    reset: restoreAll,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    move: adjustMove,
    resize: adjustSize,
    fontSize: adjustFont,
    setExactSize: setExactSize,
    setExactPosition: setExactPosition,
    align: alignSelected,
    setTextProperty: setTextProperty,
    setTextContent: setTextContent,
    toggleLock: toggleLock,
    measureSpacing: measureSpacing,
    setVisualStyle: setVisualStyle,
    adjustZ: adjustZ,
    setZ: setZ,
    state: currentPayload
  };

  emit('ready', { hosted: hosted });
  if (hosted) setTimeout(enable, 80);
})();