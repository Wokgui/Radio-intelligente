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

  const constraintBadge = document.createElement('div');
  constraintBadge.className = 've-constraint-badge';
  const altTargetOutline = document.createElement('div');
  altTargetOutline.className = 've-alt-target';
  const altMeasureLabel = document.createElement('div');
  altMeasureLabel.className = 've-alt-measure';

  document.body.append(toolbar, outline, guideV, guideH, guideVLabel, guideHLabel, constraintBadge, altTargetOutline, altMeasureLabel);

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
  let defaultResponsive = true;
  let editingBreakpoint = 'base';
  let environment = { fontScale: 1, displayScale: 1, darkMode: false, keyboardHeight: 0 };
  let designTokens = {
    spacingUnit: 8,
    radiusCard: 12,
    textTitle: 20,
    colorPrimary: '#6f49f5',
    colorSurface: '#ffffff'
  };
  let components = {};
  let prototypeLinks = {};
  let activeInteractiveState = 'normal';
  let lastAuditIssues = [];
  let stressBackup = null;
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
    ['translate','width','height','min-width','min-height','max-width','max-height','box-sizing','flex','display','flex-direction','justify-content','align-items','gap','row-gap','column-gap','grid-template-columns','grid-auto-rows','grid-auto-flow','place-items','font-size','font-family','font-weight','font-style','text-decoration','text-align','letter-spacing','line-height','visibility','pointer-events','color','background-color','border-color','z-index','position','transition-property','transition-duration','transition-timing-function','transition-delay','opacity','transform'].forEach(function (prop) {
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
      layoutAdjusted: false,
      layout: {},
      animationAdjusted: false,
      animation: {
        property: 'all',
        duration: 180,
        easing: 'ease',
        delay: 0
      },
      prototypeTarget: '',
      componentName: '',
      componentInstance: false,
      responsiveDx: 0,
      responsiveDy: 0,
      responsive: {
        enabled: defaultResponsive,
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
        safeArea: true,
        breakpoints: {}
      }
    };
    touched.set(element, state);
    if (defaultResponsive) {
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
    const effective = effectiveResponsive(state);
    if (!effective || !effective.enabled) {
      state.dx = snapGrid(state.dx + dx);
      state.dy = snapGrid(state.dy + dy);
      return;
    }
    const cfg = editableResponsive(state, editingBreakpoint);
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


  function normalizeResponsiveValues(src) {
    src = src || {};
    return {
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

  function cloneResponsive(value) {
    const src = value || {};
    const out = Object.assign({ enabled: !!src.enabled }, normalizeResponsiveValues(src), { breakpoints: {} });
    const points = src.breakpoints || {};
    ['phone','tablet','desktop'].forEach(function (key) {
      if (points[key]) out.breakpoints[key] = normalizeResponsiveValues(points[key]);
    });
    return out;
  }

  function viewportBreakpoint() {
    if (innerWidth < 600) return 'phone';
    if (innerWidth < 1024) return 'tablet';
    return 'desktop';
  }

  function effectiveResponsive(state) {
    const base = state && state.responsive ? state.responsive : {};
    const out = Object.assign({ enabled: !!base.enabled }, normalizeResponsiveValues(base));
    const bp = viewportBreakpoint();
    if (base.breakpoints && base.breakpoints[bp]) Object.assign(out, normalizeResponsiveValues(base.breakpoints[bp]));
    out.breakpoint = bp;
    return out;
  }

  function editableResponsive(state, breakpoint) {
    const base = state.responsive;
    const bp = breakpoint || editingBreakpoint || 'base';
    if (bp === 'base') return base;
    base.breakpoints = base.breakpoints || {};
    if (!base.breakpoints[bp]) {
      const eff = effectiveResponsive(state);
      base.breakpoints[bp] = normalizeResponsiveValues(eff);
    }
    return base.breakpoints[bp];
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
    const useSafe = state.responsive && effectiveResponsive(state).safeArea && (viewportParent || isViewportParent(parent, parentRect));
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
    const cfg = effectiveResponsive(state);
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
    const bp = String(payload.breakpoint || editingBreakpoint || 'base');
    if (bp !== 'base' && ['phone','tablet','desktop'].indexOf(bp) < 0) return;

    const wasEnabled = !!state.responsive.enabled;
    if (payload.enabled === true && !wasEnabled) {
      state.responsive.enabled = true;
      captureResponsiveFromCurrent(selected, state, false);
    }

    const target = editableResponsive(state, bp);
    const currentRect = selected.getBoundingClientRect();
    const bounds = responsiveBounds(selected, state);

    if (payload.hAnchor && payload.hAnchor !== target.hAnchor) {
      target.marginLeft = Math.round(currentRect.left - bounds.left);
      target.marginRight = Math.round(bounds.right - currentRect.right);
      target.centerOffsetX = Math.round((currentRect.left + currentRect.width / 2) - (bounds.left + bounds.width / 2));
    }
    if (payload.vAnchor && payload.vAnchor !== target.vAnchor) {
      target.marginTop = Math.round(currentRect.top - bounds.top);
      target.marginBottom = Math.round(bounds.bottom - currentRect.bottom);
      target.centerOffsetY = Math.round((currentRect.top + currentRect.height / 2) - (bounds.top + bounds.height / 2));
    }

    Object.keys(payload || {}).forEach(function (key) {
      if (key in target && key !== 'enabled' && key !== 'breakpoints') target[key] = payload[key];
    });
    if (payload.hAnchor === 'stretch') target.widthMode = 'fill';
    if (payload.vAnchor === 'stretch') target.heightMode = 'fill';

    if (payload.enabled === false && bp === 'base') {
      state.responsive.enabled = false;
      state.responsiveDx = 0;
      state.responsiveDy = 0;
    }

    state.responsive = cloneResponsive(state.responsive);
    applyState(selected, state, false);
    updateOverlay();
    commitHistory();
  }

  function setEditingBreakpoint(value) {
    const bp = String(value || 'base');
    editingBreakpoint = ['base','phone','tablet','desktop'].indexOf(bp) >= 0 ? bp : 'base';
    updateOverlay();
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

    const layoutProps = ['display','flex-direction','justify-content','align-items','gap','row-gap','column-gap','grid-template-columns','grid-auto-rows','grid-auto-flow','place-items'];
    if (state.layoutAdjusted && state.layout) {
      layoutProps.forEach(function (prop) {
        if (Object.prototype.hasOwnProperty.call(state.layout, prop)) setInline(element, prop, state.layout[prop]);
      });
    } else {
      layoutProps.forEach(function (prop) { restoreOriginalProp(state.selector, prop); });
    }

    const animationProps = ['transition-property','transition-duration','transition-timing-function','transition-delay'];
    if (state.animationAdjusted && state.animation) {
      setInline(element,'transition-property',state.animation.property || 'all');
      setInline(element,'transition-duration',Math.max(0,Number(state.animation.duration)||0)+'ms');
      setInline(element,'transition-timing-function',state.animation.easing || 'ease');
      setInline(element,'transition-delay',Math.max(0,Number(state.animation.delay)||0)+'ms');
    } else {
      animationProps.forEach(function(prop){restoreOriginalProp(state.selector,prop)});
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
      node === guideV || node === guideH || node === guideVLabel || node === guideHLabel ||
      node === constraintBadge || node === altTargetOutline || node === altMeasureLabel;
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
        layoutAdjusted: !!state.layoutAdjusted,
        layout: Object.assign({}, state.layout || {}),
        animationAdjusted: !!state.animationAdjusted,
        animation: Object.assign({}, state.animation || {}),
        prototypeTarget: state.prototypeTarget || '',
        componentName: state.componentName || '',
        componentInstance: !!state.componentInstance,
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
        layoutAdjusted: !!saved.layoutAdjusted,
        layout: Object.assign({}, saved.layout || {}),
        animationAdjusted: !!saved.animationAdjusted,
        animation: Object.assign({property:'all',duration:180,easing:'ease',delay:0}, saved.animation || {}),
        prototypeTarget: saved.prototypeTarget || '',
        componentName: saved.componentName || '',
        componentInstance: !!saved.componentInstance,
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

  function responsiveCssDeclarations(cfg, label) {
    if (!cfg) return [];
    const out = [];
    out.push('  /* ' + (label || 'Responsive') + ': horizontal=' + cfg.hAnchor + ', vertical=' + cfg.vAnchor +
      ', marges=' + cfg.marginLeft + '/' + cfg.marginTop + '/' + cfg.marginRight + '/' + cfg.marginBottom +
      ', largeur=' + cfg.widthMode + ', hauteur=' + cfg.heightMode + ', safe-area=' + cfg.safeArea + ' */');
    if (cfg.widthMode === 'percent') out.push('  width: ' + cfg.widthPercent + '% !important;');
    if (cfg.widthMode === 'fill') out.push('  width: calc(100% - ' + cfg.marginLeft + 'px - ' + cfg.marginRight + 'px) !important;');
    if (cfg.heightMode === 'percent') out.push('  height: ' + cfg.heightPercent + '% !important;');
    if (cfg.heightMode === 'fill') out.push('  height: calc(100% - ' + cfg.marginTop + 'px - ' + cfg.marginBottom + 'px) !important;');
    return out;
  }

  function cssText() {
    const rules = [];
    const mediaRules = { phone:[], tablet:[], desktop:[] };
    touched.forEach(function (state) {
      const declarations = [];
      if (state.deleted) {
        declarations.push('  visibility: hidden !important;');
        declarations.push('  pointer-events: none !important;');
      } else {
        if (state.responsive && state.responsive.enabled) {
          responsiveCssDeclarations(state.responsive, 'Responsive de base').forEach(function(line){declarations.push(line)});
          const points = state.responsive.breakpoints || {};
          ['phone','tablet','desktop'].forEach(function(bp){
            if (!points[bp]) return;
            const bpDecl = responsiveCssDeclarations(points[bp], 'Breakpoint ' + bp);
            if (bpDecl.length) mediaRules[bp].push(state.selector + ' {\n' + bpDecl.join('\n') + '\n}');
          });
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
        if (state.layoutAdjusted && state.layout) {
          Object.keys(state.layout).forEach(function (prop) {
            const value = state.layout[prop];
            if (value !== undefined && value !== null && value !== '') declarations.push('  ' + prop + ': ' + value + ' !important;');
          });
        }
        if (state.animationAdjusted && state.animation) {
          declarations.push('  transition-property: ' + (state.animation.property || 'all') + ' !important;');
          declarations.push('  transition-duration: ' + Math.max(0,Number(state.animation.duration)||0) + 'ms !important;');
          declarations.push('  transition-timing-function: ' + (state.animation.easing || 'ease') + ' !important;');
          declarations.push('  transition-delay: ' + Math.max(0,Number(state.animation.delay)||0) + 'ms !important;');
        }
      }
      if (declarations.length) rules.push(state.selector + ' {\n' + declarations.join('\n') + '\n}');
    });
    const mediaMap = {
      phone:'@media (max-width: 599px)',
      tablet:'@media (min-width: 600px) and (max-width: 1023px)',
      desktop:'@media (min-width: 1024px)'
    };
    ['phone','tablet','desktop'].forEach(function(bp){
      if(mediaRules[bp].length)rules.push(mediaMap[bp] + ' {\n' + mediaRules[bp].join('\n\n').replace(/^/gm,'  ') + '\n}');
    });
    return rules.join('\n\n') || '/* Aucun ajustement. */';
  }


  function parentLayoutPayload(element) {
    const parent = element && element.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      return { selector:'', display:'block', editable:false };
    }
    const cs = getComputedStyle(parent);
    return {
      selector: selectorFor(parent),
      editable: true,
      display: cs.display,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      rowGap: cs.rowGap,
      columnGap: cs.columnGap,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridAutoRows: cs.gridAutoRows,
      gridAutoFlow: cs.gridAutoFlow,
      placeItems: cs.placeItems
    };
  }

  function setParentLayout(payload) {
    if (!active || !selected || !selected.parentElement) return;
    const parent = selected.parentElement;
    if (parent === document.body || parent === document.documentElement) return;
    const state = remember(parent);
    if (!state || state.locked) return;
    state.layoutAdjusted = true;
    state.layout = state.layout || {};
    const map = {
      display:'display',
      flexDirection:'flex-direction',
      justifyContent:'justify-content',
      alignItems:'align-items',
      gap:'gap',
      rowGap:'row-gap',
      columnGap:'column-gap',
      gridTemplateColumns:'grid-template-columns',
      gridAutoRows:'grid-auto-rows',
      gridAutoFlow:'grid-auto-flow',
      placeItems:'place-items'
    };
    Object.keys(map).forEach(function (key) {
      if (payload[key] !== undefined) state.layout[map[key]] = String(payload[key]);
    });
    applyState(parent, state, false);
    updateOverlay();
    commitHistory();
    emit('layout', { layout: parentLayoutPayload(selected) });
  }

  function layerTitle(element) {
    if (!element) return '';
    const aria = element.getAttribute && (element.getAttribute('aria-label') || element.getAttribute('title'));
    if (aria) return String(aria).trim().slice(0,60);
    const text = element.children.length === 0 ? String(element.textContent || '').trim().replace(/\s+/g,' ') : '';
    if (text) return text.slice(0,60);
    if (element.id) return '#' + element.id;
    const cls = element.className && typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean)[0] : '';
    return cls ? '.' + cls : element.tagName.toLowerCase();
  }

  function buildLayerTree() {
    let count = 0;
    const maxNodes = 350;
    function walk(parent, depth) {
      const out = [];
      if (!parent || depth > 7 || count >= maxNodes) return out;
      Array.from(parent.children || []).forEach(function (el) {
        if (count >= maxNodes || isEditorNode(el) || /^SCRIPT|STYLE|LINK|META|NOSCRIPT$/i.test(el.tagName)) return;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (cs.display === 'none' || rect.width < 1 || rect.height < 1) return;
        count += 1;
        const st = touched.get(el);
        out.push({
          selector: selectorFor(el),
          tag: el.tagName.toLowerCase(),
          title: layerTitle(el),
          locked: !!(st && st.locked),
          hidden: !!(st && st.deleted),
          selected: selectedSet.has(el) || selected === el,
          depth: depth,
          children: walk(el, depth + 1)
        });
      });
      return out;
    }
    return walk(document.body,0);
  }

  function emitLayers() {
    emit('layers', { tree: buildLayerTree(), selectedSelectors: selectionElements().map(selectorFor).filter(Boolean) });
  }

  function selectBySelector(selector, additive) {
    let el = null;
    try { el = document.querySelector(String(selector || '')); } catch (_) {}
    if (!el) return;
    select(el, !!additive);
    emitLayers();
  }

  function setLayerLock(selector, value) {
    let el = null;
    try { el = document.querySelector(String(selector || '')); } catch (_) {}
    if (!el) return;
    const st = remember(el);
    st.locked = value === undefined ? !st.locked : !!value;
    updateOverlay();
    commitHistory();
    emitLayers();
  }

  function setLayerHidden(selector, value) {
    let el = null;
    try { el = document.querySelector(String(selector || '')); } catch (_) {}
    if (!el) return;
    const st = remember(el);
    st.deleted = value === undefined ? !st.deleted : !!value;
    applyState(el, st, false);
    if (st.deleted) selectedSet.delete(el);
    if (selected === el && st.deleted) selected = selectionElements()[0] || null;
    updateOverlay();
    commitHistory();
    emitLayers();
  }

  function distributeSelection(mode, gapValue) {
    const items = selectionElements();
    if (items.length < 2) return;
    const rects = items.map(function (el) { return { el:el, rect:el.getBoundingClientRect() }; });
    const bounds = selectionBounds();
    const firstRect = rects[0].rect;

    function moveTo(item, left, top) {
      const r = item.el.getBoundingClientRect();
      const st = remember(item.el);
      if (!st || st.locked) return;
      moveResponsiveState(item.el, st,
        Number.isFinite(left) ? left - r.left : 0,
        Number.isFinite(top) ? top - r.top : 0
      );
    }

    if (mode === 'same-width' || mode === 'same-height') {
      items.forEach(function (el) {
        const st = remember(el);
        if (!st || st.locked) return;
        const cfg = editableResponsive(st, editingBreakpoint);
        st.resized = true;
        if (mode === 'same-width') {
          st.width = Math.round(firstRect.width);
          if (st.responsive && st.responsive.enabled) cfg.widthMode = 'fixed';
        } else {
          st.height = Math.round(firstRect.height);
          if (st.responsive && st.responsive.enabled) cfg.heightMode = 'fixed';
        }
        applyState(el, st, false);
      });
    }

    if (mode === 'align-left') rects.forEach(function (it) { moveTo(it,bounds.left,NaN); });
    if (mode === 'align-right') rects.forEach(function (it) { moveTo(it,bounds.right-it.rect.width,NaN); });
    if (mode === 'align-center-x') rects.forEach(function (it) { moveTo(it,bounds.left+(bounds.width-it.rect.width)/2,NaN); });
    if (mode === 'align-top') rects.forEach(function (it) { moveTo(it,NaN,bounds.top); });
    if (mode === 'align-bottom') rects.forEach(function (it) { moveTo(it,NaN,bounds.bottom-it.rect.height); });
    if (mode === 'align-center-y') rects.forEach(function (it) { moveTo(it,NaN,bounds.top+(bounds.height-it.rect.height)/2); });

    if (mode === 'distribute-x' || mode === 'gap-x') {
      const sorted = rects.slice().sort(function(a,b){return a.rect.left-b.rect.left});
      const total = sorted.reduce(function(sum,it){return sum+it.rect.width},0);
      const gap = mode === 'gap-x' && Number.isFinite(Number(gapValue))
        ? Number(gapValue)
        : Math.max(0,(bounds.width-total)/Math.max(1,sorted.length-1));
      let x = bounds.left;
      sorted.forEach(function (it) { moveTo(it,x,NaN); x += it.rect.width + gap; });
    }

    if (mode === 'distribute-y' || mode === 'gap-y') {
      const sorted = rects.slice().sort(function(a,b){return a.rect.top-b.rect.top});
      const total = sorted.reduce(function(sum,it){return sum+it.rect.height},0);
      const gap = mode === 'gap-y' && Number.isFinite(Number(gapValue))
        ? Number(gapValue)
        : Math.max(0,(bounds.height-total)/Math.max(1,sorted.length-1));
      let y = bounds.top;
      sorted.forEach(function (it) { moveTo(it,NaN,y); y += it.rect.height + gap; });
    }

    hideGuides();
    updateOverlay();
    commitHistory();
  }


  function cloneStateForComponent(state) {
    return {
      width:state.width,height:state.height,resized:!!state.resized,
      fontSize:state.fontSize,fontFamily:state.fontFamily,fontWeight:state.fontWeight,fontStyle:state.fontStyle,
      textDecoration:state.textDecoration,textAlign:state.textAlign,letterSpacing:state.letterSpacing,lineHeight:state.lineHeight,
      fontAdjusted:!!state.fontAdjusted,color:state.color,backgroundColor:state.backgroundColor,borderColor:state.borderColor,
      colorAdjusted:!!state.colorAdjusted,backgroundAdjusted:!!state.backgroundAdjusted,borderAdjusted:!!state.borderAdjusted,
      zIndex:state.zIndex,zAdjusted:!!state.zAdjusted,layoutAdjusted:!!state.layoutAdjusted,layout:Object.assign({},state.layout||{}),
      animationAdjusted:!!state.animationAdjusted,animation:Object.assign({},state.animation||{}),
      responsive:cloneResponsive(state.responsive)
    };
  }

  function applyComponentState(element, saved) {
    if(!element||!saved)return;
    const state=remember(element);
    state.width=saved.width;state.height=saved.height;state.resized=!!saved.resized;
    state.fontSize=saved.fontSize;state.fontFamily=saved.fontFamily;state.fontWeight=saved.fontWeight;state.fontStyle=saved.fontStyle;
    state.textDecoration=saved.textDecoration;state.textAlign=saved.textAlign;state.letterSpacing=saved.letterSpacing;state.lineHeight=saved.lineHeight;
    state.fontAdjusted=!!saved.fontAdjusted;state.color=saved.color;state.backgroundColor=saved.backgroundColor;state.borderColor=saved.borderColor;
    state.colorAdjusted=!!saved.colorAdjusted;state.backgroundAdjusted=!!saved.backgroundAdjusted;state.borderAdjusted=!!saved.borderAdjusted;
    state.zIndex=saved.zIndex;state.zAdjusted=!!saved.zAdjusted;state.layoutAdjusted=!!saved.layoutAdjusted;state.layout=Object.assign({},saved.layout||{});
    state.animationAdjusted=!!saved.animationAdjusted;state.animation=Object.assign({property:'all',duration:180,easing:'ease',delay:0},saved.animation||{});
    state.responsive=cloneResponsive(saved.responsive);
    applyState(element,state,false);
  }

  function componentSummary() {
    return Object.keys(components).sort().map(function(name){
      const item=components[name];
      return {name:name,count:(item.instances||[]).length,variants:Object.keys(item.variants||{}).sort()};
    });
  }

  function emitComponents() {
    emit('components',{items:componentSummary()});
  }

  function createComponent(name) {
    name=String(name||'').trim();
    const items=selectionElements();
    if(!name||!items.length)return;
    const selectors=items.map(selectorFor).filter(Boolean);
    const states=items.map(function(el){return cloneStateForComponent(remember(el))});
    components[name]={name:name,states:states,instances:[selectors],variants:{}};
    items.forEach(function(el){const st=remember(el);st.componentName=name;st.componentInstance=true});
    commitHistory();emitComponents();updateOverlay();
  }

  function linkComponentInstance(name) {
    const component=components[String(name||'')];
    const items=selectionElements();
    if(!component||!items.length)return;
    const selectors=items.map(selectorFor).filter(Boolean);
    const count=Math.min(items.length,component.states.length);
    for(let i=0;i<count;i+=1){
      applyComponentState(items[i],component.states[i]);
      const st=remember(items[i]);st.componentName=component.name;st.componentInstance=true;
    }
    if(!(component.instances||[]).some(function(list){return JSON.stringify(list)===JSON.stringify(selectors)})){
      component.instances.push(selectors);
    }
    commitHistory();emitComponents();updateOverlay();
  }

  function updateComponentFromSelection(name) {
    const component=components[String(name||'')];
    const items=selectionElements();
    if(!component||!items.length)return;
    component.states=items.map(function(el){return cloneStateForComponent(remember(el))});
    (component.instances||[]).forEach(function(selectors){
      selectors.forEach(function(sel,index){
        let el=null;try{el=document.querySelector(sel)}catch(_){}
        if(el&&component.states[index])applyComponentState(el,component.states[index]);
      });
    });
    commitHistory();emitComponents();updateOverlay();
  }

  function saveComponentVariant(name,variantName) {
    const component=components[String(name||'')];
    const items=selectionElements();
    variantName=String(variantName||'').trim();
    if(!component||!variantName||!items.length)return;
    component.variants=component.variants||{};
    component.variants[variantName]=items.map(function(el){return cloneStateForComponent(remember(el))});
    emitComponents();
  }

  function applyComponentVariant(name,variantName,allInstances) {
    const component=components[String(name||'')];
    const variant=component&&component.variants&&component.variants[String(variantName||'')];
    if(!component||!variant)return;
    const groups=allInstances?(component.instances||[]):[selectionElements().map(selectorFor).filter(Boolean)];
    groups.forEach(function(selectors){
      selectors.forEach(function(sel,index){
        let el=null;try{el=document.querySelector(sel)}catch(_){}
        if(el&&variant[index])applyComponentState(el,variant[index]);
      });
    });
    commitHistory();updateOverlay();
  }

  function deleteComponent(name) {
    delete components[String(name||'')];
    emitComponents();
  }

  function applyDesignTokens(payload) {
    designTokens=Object.assign({},designTokens,payload||{});
    const root=document.documentElement;
    root.style.setProperty('--ais-space',Math.max(1,Number(designTokens.spacingUnit)||8)+'px');
    root.style.setProperty('--ais-radius-card',Math.max(0,Number(designTokens.radiusCard)||12)+'px');
    root.style.setProperty('--ais-text-title',Math.max(8,Number(designTokens.textTitle)||20)+'px');
    root.style.setProperty('--ais-color-primary',String(designTokens.colorPrimary||'#6f49f5'));
    root.style.setProperty('--ais-color-surface',String(designTokens.colorSurface||'#ffffff'));
    emit('tokens',{tokens:Object.assign({},designTokens)});
  }

  function setAnimation(payload) {
    if(!selected)return;
    selectionElements().forEach(function(el){
      const st=remember(el);if(!st||st.locked)return;
      st.animationAdjusted=true;
      st.animation=Object.assign({},st.animation||{},{
        property:String(payload.property||'all'),
        duration:Math.max(0,Number(payload.duration)||0),
        easing:String(payload.easing||'ease'),
        delay:Math.max(0,Number(payload.delay)||0)
      });
      applyState(el,st,false);
    });
    commitHistory();updateOverlay();
  }

  function setInteractiveState(stateName) {
    activeInteractiveState=String(stateName||'normal');
    if(!selected)return;
    selectionElements().forEach(function(el){
      el.classList.remove('ais-state-hover','ais-state-active','ais-state-focus','ais-state-disabled');
      if(activeInteractiveState==='hover')el.classList.add('ais-state-hover');
      if(activeInteractiveState==='active')el.classList.add('ais-state-active');
      if(activeInteractiveState==='focus'){el.classList.add('ais-state-focus');if(el.focus)try{el.focus({preventScroll:true})}catch(_){}}
      if(activeInteractiveState==='disabled'){
        el.classList.add('ais-state-disabled');
        if('disabled' in el)el.disabled=true;
        else el.setAttribute('aria-disabled','true');
      }else{
        if('disabled' in el&&el.dataset.aisWasDisabled!=='true')el.disabled=false;
        if(el.getAttribute('aria-disabled')==='true')el.removeAttribute('aria-disabled');
      }
    });
    emit('interactive-state',{state:activeInteractiveState});
  }

  function setPrototypeLink(payload) {
    if(!selected)return;
    const target=String(payload.target||'').trim();
    const trigger=String(payload.trigger||'click');
    const selector=selectorFor(selected);
    if(!selector)return;
    prototypeLinks[selector]={target:target,trigger:trigger};
    const st=remember(selected);st.prototypeTarget=target;
    emit('prototype',{links:Object.assign({},prototypeLinks)});
    updateOverlay();
  }

  function runPrototypeTarget(sourceEl) {
    const selector=selectorFor(sourceEl);
    const link=prototypeLinks[selector];
    if(!link||!link.target)return false;
    let target=null;try{target=document.querySelector(link.target)}catch(_){}
    if(!target)return false;
    if(target.scrollIntoView)target.scrollIntoView({behavior:'smooth',block:'center'});
    if(target.click&&/button|a|input/i.test(target.tagName))try{target.click()}catch(_){}
    target.animate&&target.animate([{outline:'3px solid #6f49f5'},{outline:'0 solid transparent'}],{duration:700});
    return true;
  }

  function stressTest(mode) {
    mode=String(mode||'normal');
    if(mode==='normal'){
      if(stressBackup){
        stressBackup.texts.forEach(function(item){if(document.documentElement.contains(item.el))item.el.textContent=item.text});
        stressBackup.images.forEach(function(item){if(document.documentElement.contains(item.el))item.el.style.visibility=item.visibility});
        stressBackup.clones.forEach(function(el){el.remove()});
      }
      stressBackup=null;reflowResponsive();emit('stress',{mode:'normal'});return;
    }

    if(!stressBackup){
      stressBackup={texts:[],images:[],clones:[]};
      Array.from(document.body.querySelectorAll('*')).slice(0,700).forEach(function(el){
        if(isEditorNode(el))return;
        if(el.children.length===0&&String(el.textContent||'').trim())stressBackup.texts.push({el:el,text:el.textContent});
        if(el.tagName==='IMG')stressBackup.images.push({el:el,visibility:el.style.visibility});
      });
    }
    if(mode==='long-text'){
      stressBackup.texts.forEach(function(item){
        if(!document.documentElement.contains(item.el))return;
        const base=String(item.text||'Texte');
        item.el.textContent=(base+' — contenu exceptionnellement long pour tester toutes les traductions et les petits écrans').slice(0,180);
      });
    }
    if(mode==='no-images')stressBackup.images.forEach(function(item){if(document.documentElement.contains(item.el))item.el.style.visibility='hidden'});
    if(mode==='empty')stressBackup.texts.forEach(function(item){if(document.documentElement.contains(item.el))item.el.textContent=''});
    if(mode==='many-items'){
      const list=document.querySelector('ul,ol,[role="list"],.list,.items,.articles,.tracks');
      if(list&&list.children.length){
        const source=list.children[0];
        for(let i=0;i<12;i+=1){const clone=source.cloneNode(true);clone.dataset.aisStressClone='1';list.appendChild(clone);stressBackup.clones.push(clone)}
      }
    }
    reflowResponsive();emit('stress',{mode:mode});
  }

  function autoFixAudit() {
    const fixed=[];
    (lastAuditIssues||[]).forEach(function(issue){
      let el=null;try{el=issue.selector==='html'?document.documentElement:document.querySelector(issue.selector)}catch(_){}
      if(!el)return;
      if(issue.type==='touch-target'){
        el.style.setProperty('min-width','44px','important');
        el.style.setProperty('min-height','44px','important');
        fixed.push(issue);
      }
      if(issue.type==='text-clipped'){
        el.style.setProperty('white-space','normal','important');
        el.style.setProperty('overflow','visible','important');
        el.style.setProperty('text-overflow','clip','important');
        fixed.push(issue);
      }
      if(issue.type==='overflow-x'&&el===document.documentElement){
        document.body.style.setProperty('max-width','100vw','important');
        document.body.style.setProperty('overflow-x','hidden','important');
        fixed.push(issue);
      }
      if(issue.type==='accessible-name'){
        const text=String(el.textContent||el.getAttribute('title')||'Action').trim().slice(0,80);
        el.setAttribute('aria-label',text||'Action');
        fixed.push(issue);
      }
    });
    auditInterface();
    emit('audit-fixed',{count:fixed.length});
  }

  function parseRgb(value) {
    const m = String(value || '').match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/i);
    if (!m) return null;
    return { r:Number(m[1]), g:Number(m[2]), b:Number(m[3]), a:m[4]===undefined?1:Number(m[4]) };
  }

  function luminance(rgb) {
    function channel(v) {
      v /= 255;
      return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
    }
    return .2126*channel(rgb.r)+.7152*channel(rgb.g)+.0722*channel(rgb.b);
  }

  function contrastRatio(a,b) {
    const l1=luminance(a),l2=luminance(b);
    return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
  }

  function solidBackground(element) {
    let node = element;
    while (node && node.nodeType === 1) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > .85) return bg;
      node = node.parentElement;
    }
    return {r:255,g:255,b:255,a:1};
  }

  function auditInterface() {
    const issues = [];
    const nodes = Array.from(document.body.querySelectorAll('*')).filter(function (el) {
      if (isEditorNode(el) || /^SCRIPT|STYLE|LINK|META$/i.test(el.tagName)) return false;
      const cs=getComputedStyle(el),r=el.getBoundingClientRect();
      return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>1&&r.height>1;
    }).slice(0,650);

    if (document.documentElement.scrollWidth > innerWidth + 2) {
      issues.push({severity:'error',type:'overflow-x',selector:'html',message:'La page dépasse horizontalement le viewport de '+Math.round(document.documentElement.scrollWidth-innerWidth)+' px.'});
    }

    const interactive = [];
    nodes.forEach(function (el) {
      const r=el.getBoundingClientRect();
      const cs=getComputedStyle(el);
      const selector=selectorFor(el);
      const isInteractive=/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)||el.getAttribute('role')==='button';

      if (el.children.length===0 && String(el.textContent||'').trim()) {
        const clipped=(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2) &&
          (/(hidden|clip)/.test(cs.overflow+cs.overflowX+cs.overflowY)||cs.whiteSpace==='nowrap');
        if(clipped)issues.push({severity:'error',type:'text-clipped',selector:selector,message:'Texte potentiellement coupé dans '+selector+'.'});

        const fg=parseRgb(cs.color),bg=solidBackground(el);
        if(fg&&bg&&fg.a>.8){
          const ratio=contrastRatio(fg,bg);
          const min=parseFloat(cs.fontSize)>=18?3:4.5;
          if(ratio<min)issues.push({severity:'warning',type:'contrast',selector:selector,message:'Contraste faible ('+ratio.toFixed(1)+':1).'});
        }
      }

      if(isInteractive){
        interactive.push({el:el,rect:r,selector:selector});
        if(r.width<44||r.height<44)issues.push({severity:'warning',type:'touch-target',selector:selector,message:'Zone tactile '+Math.round(r.width)+' × '+Math.round(r.height)+' px, sous 44 × 44.'});
        if(r.top<safeArea.top-1||r.left<safeArea.left-1||r.right>innerWidth-safeArea.right+1||r.bottom>innerHeight-safeArea.bottom+1){
          issues.push({severity:'error',type:'safe-area',selector:selector,message:'Élément interactif en dehors de la zone sûre.'});
        }
      }
    });

    for(let i=0;i<interactive.length&&i<90;i+=1){
      for(let j=i+1;j<interactive.length&&j<90;j+=1){
        const a=interactive[i],b=interactive[j];
        if(a.el.contains(b.el)||b.el.contains(a.el))continue;
        const iw=Math.max(0,Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left));
        const ih=Math.max(0,Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top));
        const area=iw*ih;
        const minArea=Math.min(a.rect.width*a.rect.height,b.rect.width*b.rect.height);
        if(area>0&&minArea>0&&area/minArea>.25){
          issues.push({severity:'warning',type:'overlap',selector:a.selector,message:'Chevauchement important avec '+b.selector+'.'});
        }
      }
    }

    const order={error:0,warning:1,info:2};
    issues.sort(function(a,b){return order[a.severity]-order[b.severity]});
    emit('audit',{issues:issues.slice(0,120),summary:{
      errors:issues.filter(function(i){return i.severity==='error'}).length,
      warnings:issues.filter(function(i){return i.severity==='warning'}).length
    }});
  }

  function applyEnvironment(payload) {
    environment = {
      fontScale: Math.max(.75,Math.min(2,Number(payload.fontScale)||1)),
      displayScale: Math.max(.75,Math.min(1.6,Number(payload.displayScale)||1)),
      darkMode: !!payload.darkMode
    };
    let style=document.getElementById('ve-environment-style');
    if(!style){style=document.createElement('style');style.id='ve-environment-style';document.head.appendChild(style);}
    style.textContent=
      'html{-webkit-text-size-adjust:'+Math.round(environment.fontScale*100)+'% !important;text-size-adjust:'+Math.round(environment.fontScale*100)+'% !important;color-scheme:'+(environment.darkMode?'dark':'light')+';}'+
      'body{zoom:'+environment.displayScale+';}';
    document.documentElement.dataset.aisTheme=environment.darkMode?'dark':'light';
    reflowResponsive();
    emit('environment',{environment:Object.assign({},environment)});
  }

  function currentPayload() {
    if (!selected || !document.documentElement.contains(selected)) {
      return { active: active, selected: false, css: cssText(), grid: grid };
    }
    const state = remember(selected);
    if (!state || state.deleted) return { active: active, selected: false, css: cssText(), grid: grid };
    const rect = selected.getBoundingClientRect();
    const selectedItems = selectionElements();
    const payloadRect = selectedItems.length > 1 ? selectionBounds() : rect;
    return {
      active: active,
      selected: true,
      selector: state.selector,
      x: Math.round(payloadRect.left),
      y: Math.round(payloadRect.top),
      width: Math.round(payloadRect.width),
      height: Math.round(payloadRect.height),
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
      responsiveEffective: effectiveResponsive(state),
      activeBreakpoint: viewportBreakpoint(),
      editingBreakpoint: editingBreakpoint,
      parentLayout: parentLayoutPayload(selected),
      safeArea: Object.assign({}, safeArea),
      environment: Object.assign({}, environment),
      css: cssText(),
      grid: grid
    };
  }

  function updateOverlay() {
    if (!active || !selected || !document.documentElement.contains(selected)) {
      outline.style.display = 'none';
      constraintBadge.style.display = 'none';
      altTargetOutline.style.display = 'none';
      altMeasureLabel.style.display = 'none';
      clearSecondaryOutlines();
      targetLabel.textContent = 'Clique un élément';
      metrics.textContent = 'X — · Y — · L — · H —';
      emit('state', currentPayload());
      return;
    }

    const state = remember(selected);
    if (!state || state.deleted) {
      outline.style.display = 'none';
      constraintBadge.style.display = 'none';
      emit('state', currentPayload());
      return;
    }

    const rect = selected.getBoundingClientRect();
    const cfg = effectiveResponsive(state);
    constraintBadge.style.display = 'block';
    constraintBadge.style.left = Math.max(4, rect.left) + 'px';
    constraintBadge.style.top = Math.max(4, rect.top - 25) + 'px';
    const hIcon = cfg.hAnchor === 'left' ? '←' : cfg.hAnchor === 'right' ? '→' : cfg.hAnchor === 'center' ? '↔' : cfg.hAnchor === 'stretch' ? '⇆' : '·';
    const vIcon = cfg.vAnchor === 'top' ? '↑' : cfg.vAnchor === 'bottom' ? '↓' : cfg.vAnchor === 'center' ? '↕' : cfg.vAnchor === 'stretch' ? '⇅' : '·';
    constraintBadge.textContent = hIcon + ' ' + vIcon + ' · ' + viewportBreakpoint();
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
    emitLayers();
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
    const responsive = state.responsive && state.responsive.enabled;

    if (responsive && (mode === 'parent-x' || mode === 'parent-y' || mode === 'parent-both')) {
      if (mode === 'parent-x' || mode === 'parent-both') {
        state.responsive.hAnchor = 'center';
        state.responsive.centerOffsetX = 0;
      }
      if (mode === 'parent-y' || mode === 'parent-both') {
        state.responsive.vAnchor = 'center';
        state.responsive.centerOffsetY = 0;
      }
      applyState(selected, state, false);
    } else {
      let dx = 0, dy = 0;
      if (mode === 'screen-x') dx = innerWidth / 2 - (rect.left + rect.width / 2);
      if (mode === 'screen-y') dy = innerHeight / 2 - (rect.top + rect.height / 2);
      if (mode === 'parent-x') dx = parentRect.left + parentRect.width / 2 - (rect.left + rect.width / 2);
      if (mode === 'parent-y') dy = parentRect.top + parentRect.height / 2 - (rect.top + rect.height / 2);
      if (mode === 'parent-both') {
        dx = parentRect.left + parentRect.width / 2 - (rect.left + rect.width / 2);
        dy = parentRect.top + parentRect.height / 2 - (rect.top + rect.height / 2);
      }
      moveResponsiveState(selected, state, dx, dy);
    }

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

  function intervalGap(a1, a2, b1, b2) {
    if (a2 < b1) return b1 - a2;
    if (b2 < a1) return a1 - b2;
    return 0;
  }

  function measurementCandidates() {
    const selectedItems = selectionElements();
    const selectedLookup = new Set(selectedItems);
    const scope = selected && (selected.closest('.track,.cover,.music-player,.player,.app-page,[data-page],main,section') || document.body);
    return Array.from((scope || document.body).querySelectorAll('*')).filter(function (el) {
      if (!el || selectedLookup.has(el) || isEditorNode(el) || !el.getBoundingClientRect) return false;
      if (selectedItems.some(function (sel) { return sel.contains(el) || el.contains(sel); })) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
      return true;
    });
  }

  function measureSpacing() {
    if (!active || !selected) return;
    const rect = selectionElements().length > 1 ? selectionBounds() : selected.getBoundingClientRect();
    const parent = selected.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : {left:0,right:innerWidth,top:0,bottom:innerHeight};
    const candidates = measurementCandidates();

    let left = null, right = null, top = null, bottom = null;

    function consider(current, gap, crossGap, el) {
      const score = Math.max(0, gap) + Math.max(0, crossGap) * 0.35;
      const next = {gap:Math.max(0,gap), crossGap:Math.max(0,crossGap), score:score, selector:selectorFor(el)};
      if (!current || next.score < current.score || (next.score === current.score && next.gap < current.gap)) return next;
      return current;
    }

    candidates.forEach(function (el) {
      const r = el.getBoundingClientRect();

      if (r.right <= rect.left) {
        left = consider(left, rect.left - r.right, intervalGap(rect.top, rect.bottom, r.top, r.bottom), el);
      }
      if (r.left >= rect.right) {
        right = consider(right, r.left - rect.right, intervalGap(rect.top, rect.bottom, r.top, r.bottom), el);
      }
      if (r.bottom <= rect.top) {
        top = consider(top, rect.top - r.bottom, intervalGap(rect.left, rect.right, r.left, r.right), el);
      }
      if (r.top >= rect.bottom) {
        bottom = consider(bottom, r.top - rect.bottom, intervalGap(rect.left, rect.right, r.left, r.right), el);
      }
    });

    emit('spacing', {
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      selectionCount: selectionElements().length,
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
    emitLayers();
  }

  function exportProject() {
    return {
      format: 'app-layout-project',
      version: 3,
      exportedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight, safeArea: Object.assign({}, safeArea), breakpoint: viewportBreakpoint() },
      editingBreakpoint: editingBreakpoint,
      environment: Object.assign({}, environment),
      snapshot: snapshot(),
      css: cssText()
    };
  }

  function importProject(project) {
    if (!project || (project.format !== 'app-layout-project' && project.format !== 'radio-layout-project')) return false;
    if (project.viewport && project.viewport.safeArea) setSafeArea(project.viewport.safeArea);
    if (project.editingBreakpoint) setEditingBreakpoint(project.editingBreakpoint);
    if (project.environment) applyEnvironment(project.environment);
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
    constraintBadge.style.display = 'none';
    clearAltMeasure();
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

  function clearAltMeasure() {
    altTargetOutline.style.display = 'none';
    altMeasureLabel.style.display = 'none';
  }

  function showAltMeasure(event) {
    if (!active || !selected || !event.altKey) { clearAltMeasure(); return; }
    const target = event.target && event.target.closest ? event.target.closest('*') : event.target;
    if (!target || target === selected || isEditorNode(target) || selected.contains(target) || target.contains(selected)) {
      clearAltMeasure(); return;
    }
    const a = selectionElements().length > 1 ? selectionBounds() : selected.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!b || b.width < 1 || b.height < 1) { clearAltMeasure(); return; }

    altTargetOutline.style.display = 'block';
    altTargetOutline.style.left = b.left + 'px';
    altTargetOutline.style.top = b.top + 'px';
    altTargetOutline.style.width = b.width + 'px';
    altTargetOutline.style.height = b.height + 'px';

    const horizontal = b.left >= a.right ? Math.round(b.left - a.right) :
      (a.left >= b.right ? Math.round(a.left - b.right) : 0);
    const vertical = b.top >= a.bottom ? Math.round(b.top - a.bottom) :
      (a.top >= b.bottom ? Math.round(a.top - b.bottom) : 0);

    altMeasureLabel.style.display = 'block';
    altMeasureLabel.style.left = Math.min(innerWidth - 180, Math.max(6, event.clientX + 12)) + 'px';
    altMeasureLabel.style.top = Math.min(innerHeight - 46, Math.max(6, event.clientY + 12)) + 'px';
    altMeasureLabel.textContent = '↔ ' + horizontal + ' px · ↕ ' + vertical + ' px';
    emit('alt-measure', { selector:selectorFor(target), horizontal:horizontal, vertical:vertical });
  }

  window.addEventListener('pointermove', showAltMeasure, true);
  window.addEventListener('keyup', function(event){ if(event.key==='Alt') clearAltMeasure(); }, true);
  window.addEventListener('blur', clearAltMeasure);

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
    if (data.type === 'breakpoint-edit') setEditingBreakpoint(payload.breakpoint);
    if (data.type === 'responsive-capture') captureResponsiveRules();
    if (data.type === 'safe-area') setSafeArea(payload);
    if (data.type === 'preferences') {
      if (payload.defaultResponsive !== undefined) defaultResponsive = !!payload.defaultResponsive;
    }
    if (data.type === 'font-size') adjustFont(Number(payload.delta) || 0);
    if (data.type === 'set-size') setExactSize(payload.width, payload.height, !!payload.keepRatio);
    if (data.type === 'set-position') setExactPosition(payload.x, payload.y);
    if (data.type === 'align') alignSelected(String(payload.mode || ''));
    if (data.type === 'text-style') setTextProperty(String(payload.kind || ''), payload.value);
    if (data.type === 'text-content') setTextContent(payload.value);
    if (data.type === 'lock') toggleLock(payload.value);
    if (data.type === 'measure-spacing') measureSpacing();
    if (data.type === 'get-layers') emitLayers();
    if (data.type === 'select-selector') selectBySelector(payload.selector, !!payload.additive);
    if (data.type === 'layer-lock') setLayerLock(payload.selector, payload.value);
    if (data.type === 'layer-hidden') setLayerHidden(payload.selector, payload.value);
    if (data.type === 'parent-layout') setParentLayout(payload);
    if (data.type === 'distribute') distributeSelection(String(payload.mode || ''), payload.gap);
    if (data.type === 'audit') auditInterface();
    if (data.type === 'environment-set') applyEnvironment(payload);
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
    emitLayers: emitLayers,
    setParentLayout: setParentLayout,
    distributeSelection: distributeSelection,
    auditInterface: auditInterface,
    applyEnvironment: applyEnvironment,
    setVisualStyle: setVisualStyle,
    adjustZ: adjustZ,
    setZ: setZ,
    state: currentPayload
  };

  emit('ready', { hosted: hosted });
  if (hosted) setTimeout(enable, 80);
})();