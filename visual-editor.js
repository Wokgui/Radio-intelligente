(function () {
  'use strict';

  const panel = document.getElementById('uiPanel');
  if (document.getElementById('veLauncher')) return;

  const params = new URLSearchParams(location.search);
  const hosted = params.get('visual-editor') === '1' || window.__APP_INTERFACE_STUDIO_HOSTED__ === true;
  let guideThreshold = 5;

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
    '<i class="ve-handle ve-handle-se" data-handle="se"></i>' +
    '<i class="ve-handle ve-handle-n" data-handle="n"></i>' +
    '<i class="ve-handle ve-handle-e" data-handle="e"></i>' +
    '<i class="ve-handle ve-handle-s" data-handle="s"></i>' +
    '<i class="ve-handle ve-handle-w" data-handle="w"></i>' +
    '<button class="ve-anchor-pin ve-anchor-left" data-anchor-axis="h" data-anchor-value="left" title="Ancrer à gauche">←</button>' +
    '<button class="ve-anchor-pin ve-anchor-hcenter" data-anchor-axis="h" data-anchor-value="center" title="Centrer horizontalement">↔</button>' +
    '<button class="ve-anchor-pin ve-anchor-right" data-anchor-axis="h" data-anchor-value="right" title="Ancrer à droite">→</button>' +
    '<button class="ve-anchor-pin ve-anchor-top" data-anchor-axis="v" data-anchor-value="top" title="Ancrer en haut">↑</button>' +
    '<button class="ve-anchor-pin ve-anchor-vcenter" data-anchor-axis="v" data-anchor-value="center" title="Centrer verticalement">↕</button>' +
    '<button class="ve-anchor-pin ve-anchor-bottom" data-anchor-axis="v" data-anchor-value="bottom" title="Ancrer en bas">↓</button>' +
    '<button class="ve-anchor-pin ve-anchor-hstretch" data-anchor-axis="h" data-anchor-value="stretch" title="Étirer horizontalement">⇆</button>' +
    '<button class="ve-anchor-pin ve-anchor-vstretch" data-anchor-axis="v" data-anchor-value="stretch" title="Étirer verticalement">⇅</button>' +
    '<button class="ve-box-handle margin" data-box-kind="margin" data-side="top">M ↑</button>' +
    '<button class="ve-box-handle margin" data-box-kind="margin" data-side="right">M →</button>' +
    '<button class="ve-box-handle margin" data-box-kind="margin" data-side="bottom">M ↓</button>' +
    '<button class="ve-box-handle margin" data-box-kind="margin" data-side="left">M ←</button>' +
    '<button class="ve-box-handle padding" data-box-kind="padding" data-side="top">P ↑</button>' +
    '<button class="ve-box-handle padding" data-box-kind="padding" data-side="right">P →</button>' +
    '<button class="ve-box-handle padding" data-box-kind="padding" data-side="bottom">P ↓</button>' +
    '<button class="ve-box-handle padding" data-box-kind="padding" data-side="left">P ←</button>' +
    '<button class="ve-media-focal" type="button" title="Déplacer le point focal de l’image" aria-label="Point focal de l’image">◎</button>';

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
  const boxMarginRing = document.createElement('div');
  boxMarginRing.className = 've-box-ring-margin';
  const boxPaddingRing = document.createElement('div');
  boxPaddingRing.className = 've-box-ring-padding';
  const constraintLines = ['left','right','top','bottom','center-x','center-y'].map(function(kind){
    const line=document.createElement('div');
    const horizontal=kind==='left'||kind==='right'||kind==='center-y';
    line.className='ve-constraint-line '+(horizontal?'horizontal':'vertical')+(kind.indexOf('center-')===0?' center':'');
    line.dataset.kind=kind;
    return line;
  });
  const altTargetOutline = document.createElement('div');
  altTargetOutline.className = 've-alt-target';
  const altMeasureLabel = document.createElement('div');
  altMeasureLabel.className = 've-alt-measure';
  const dragMeasureLabel = document.createElement('div');
  dragMeasureLabel.className = 've-drag-measure';
  const marqueeBox = document.createElement('div');
  marqueeBox.className = 've-marquee';
  const layoutDiagnosticLayer = document.createElement('div');
  layoutDiagnosticLayer.className = 've-layout-diagnostics';
  const spacingVisuals = ['left','right','top','bottom'].map(function(direction){
    const line=document.createElement('div');
    line.className='ve-spacing-line '+((direction==='left'||direction==='right')?'horizontal':'vertical');
    line.dataset.direction=direction;
    const label=document.createElement('span');
    label.className='ve-spacing-label';
    label.dataset.direction=direction;
    return {direction:direction,line:line,label:label};
  });

  document.body.append(toolbar, outline, guideV, guideH, guideVLabel, guideHLabel, constraintBadge, boxMarginRing, boxPaddingRing, altTargetOutline, altMeasureLabel, dragMeasureLabel, marqueeBox, layoutDiagnosticLayer);
  constraintLines.forEach(function(line){document.body.appendChild(line)});
  spacingVisuals.forEach(function(item){document.body.append(item.line,item.label)});

  const targetLabel = toolbar.querySelector('.ve-target');
  const metrics = toolbar.querySelector('.ve-metrics');
  const mediaFocalHandle = outline.querySelector('.ve-media-focal');
  const registry = new Map();
  const touched = new Map();
  const svgTintOriginals = new WeakMap();

  let active = false;
  let selected = null;
  let lastPointerPoint = {x:Math.round(innerWidth/2),y:Math.round(innerHeight/2)};
  const selectedSet = new Set();
  const secondaryOutlines = new Map();
  let drag = null;
  let resizeDrag = null;
  let marqueeDrag = null;
  let marqueeMode = false;
  let spaceHeld = false;
  let canvasPan = null;
  let clipboardNodes = [];
  let styleClipboard = null;
  let cloneSequence = 0;
  let pasteSequence = 0;
  let grid = 1;
  let smartGuidesEnabled = true;
  let customGuides = {x:[],y:[]};
  let layoutGuidesX = [];
  let boxModelVisible = true;
  let boxDrag = null;
  let mediaFocalDrag = null;
  let inlineTextEdit = null;
  let nudgeStep = 1;
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
  let selectionGroups = {};
  let isolationActive = false;
  let isolatedNodes = [];
  let activeInteractiveState = 'normal';
  let lastAuditIssues = [];
  let lastConsistency = null;
  let repairSuggestions = [];
  let repairPreviewSnapshot = null;
  let stressBackup = null;
  let contrastPreview = null;
  let layoutDiagnostics = [];
  let responsiveResizeTimer = null;
  let spacingVisualTimer = null;

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
    if (element.dataset && element.dataset.aisCloneId) return '[data-ais-clone-id="' + element.dataset.aisCloneId + '"]';
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
    ['translate','width','height','min-width','min-height','max-width','max-height','box-sizing','flex','display','flex-direction','justify-content','align-items','gap','row-gap','column-gap','grid-template-columns','grid-auto-rows','grid-auto-flow','place-items','font-size','font-family','font-weight','font-style','text-decoration','text-align','letter-spacing','line-height','visibility','pointer-events','color','background-color','border-color','border-radius','white-space','overflow','overflow-x','text-overflow','max-width','z-index','position','transition-property','transition-duration','transition-timing-function','transition-delay','opacity','transform','padding','padding-left','padding-right','padding-top','padding-bottom','margin','margin-left','margin-right','margin-top','margin-bottom','box-shadow','filter','aspect-ratio','top','right','bottom','left','object-fit','object-position','background-image','background-size','background-position','background-repeat'].forEach(function (prop) {
      original[prop] = {
        value: element.style.getPropertyValue(prop),
        priority: element.style.getPropertyPriority(prop)
      };
    });
    const tag=String(element.tagName||'').toLowerCase();
    const hrefValue=element.getAttribute('href')||element.getAttributeNS('http://www.w3.org/1999/xlink','href');
    const entry = {
      selector: selector, element: element, original: original,
      originalText: element.children.length === 0 ? element.textContent : null,
      originalAriaLabel: element.getAttribute('aria-label'),
      originalSrc: element.getAttribute('src'),
      originalHref: hrefValue,
      originalSvgMarkup: tag==='svg'?element.innerHTML:null,
      originalSvgViewBox: tag==='svg'?element.getAttribute('viewBox'):null
    };
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
      tokenStyles: {},
      advancedAdjusted: false,
      advancedStyles: {},
      stateStyles: {hover:{},active:{},focus:{},disabled:{}},
      accessibilityAdjusted: false,
      accessibilityLabel: element.getAttribute('aria-label') || '',
      mediaAdjusted: false,
      mediaKind: '',
      mediaSource: '',
      mediaAssetPath: '',
      mediaName: '',
      mediaFit: 'contain',
      mediaPositionX: 50,
      mediaPositionY: 50,
      svgTintAdjusted: false,
      svgTintColor: '#000000',
      svgTintMode: 'both',
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
      applyState(element, state, false);
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

    if(state.mediaAdjusted&&state.mediaSource){
      const kind=state.mediaKind||mediaKindForElement(element);
      const fit=state.mediaFit||'contain';
      const px=mediaPercent(state.mediaPositionX,50);
      const py=mediaPercent(state.mediaPositionY,50);
      const ax=px<34?'xMin':px>66?'xMax':'xMid';
      const ay=py<34?'YMin':py>66?'YMax':'YMid';
      if(kind==='img'){
        element.setAttribute('src',state.mediaSource);setInline(element,'object-fit',fit);setInline(element,'object-position',px+'% '+py+'%');
      }else if(kind==='svg-image'){
        element.setAttribute('href',state.mediaSource);element.setAttributeNS('http://www.w3.org/1999/xlink','href',state.mediaSource);
        element.setAttribute('preserveAspectRatio',fit==='fill'?'none':ax+ay+(fit==='cover'?' slice':' meet'));
      }else if(kind==='svg'){
        while(element.firstChild)element.removeChild(element.firstChild);
        const image=document.createElementNS('http://www.w3.org/2000/svg','image');
        image.setAttribute('href',state.mediaSource);image.setAttribute('x','0');image.setAttribute('y','0');image.setAttribute('width','100%');image.setAttribute('height','100%');
        image.setAttribute('preserveAspectRatio',fit==='fill'?'none':ax+ay+(fit==='cover'?' slice':' meet'));element.appendChild(image);
      }else{
        setInline(element,'background-image','url("'+String(state.mediaSource).replace(/"/g,'%22')+'")');
        setInline(element,'background-size',fit==='fill'?'100% 100%':fit==='none'?'auto':fit);
        setInline(element,'background-position',px+'% '+py+'%');setInline(element,'background-repeat','no-repeat');
      }
    }

    applySvgTint(element,state);

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

    const tokenProps=['border-radius','min-width','min-height','white-space','overflow','overflow-x','text-overflow','max-width'];
    tokenProps.forEach(function(prop){
      if(state.tokenStyles&&state.tokenStyles[prop])setInline(element,prop,state.tokenStyles[prop]);
      else if(!((prop==='min-width'||prop==='min-height'||prop==='max-width')&&state.resized))restoreOriginalProp(state.selector,prop);
    });
    const advancedProps=['padding','padding-left','padding-right','padding-top','padding-bottom','margin','margin-left','margin-right','margin-top','margin-bottom','box-shadow','filter','aspect-ratio','opacity','transform','position','top','right','bottom','left','object-fit','object-position'];
    advancedProps.forEach(function(prop){
      if((prop==='object-fit'||prop==='object-position')&&state.mediaAdjusted)return;
      if(state.advancedAdjusted&&state.advancedStyles&&Object.prototype.hasOwnProperty.call(state.advancedStyles,prop))setInline(element,prop,state.advancedStyles[prop]);
      else if(!(prop==='position'&&state.zAdjusted))restoreOriginalProp(state.selector,prop);
    });

    if(state.accessibilityAdjusted)element.setAttribute('aria-label',state.accessibilityLabel||'Action');
    else {
      const regAria=registry.get(state.selector);
      if(regAria&&regAria.originalAriaLabel!==null)element.setAttribute('aria-label',regAria.originalAriaLabel);
      else element.removeAttribute('aria-label');
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
    clearSvgTint(entry.element);
    Object.keys(entry.original).forEach(function (prop) {
      const item = entry.original[prop];
      if (item.value) entry.element.style.setProperty(prop, item.value, item.priority);
      else entry.element.style.removeProperty(prop);
    });
    if (entry.originalText !== null) entry.element.textContent = entry.originalText;
    const tag=String(entry.element.tagName||'').toLowerCase();
    if(tag==='img'){
      if(entry.originalSrc!==null)entry.element.setAttribute('src',entry.originalSrc);else entry.element.removeAttribute('src');
    }
    if(tag==='image'){
      if(entry.originalHref!==null){entry.element.setAttribute('href',entry.originalHref);entry.element.setAttributeNS('http://www.w3.org/1999/xlink','href',entry.originalHref);}
      else{entry.element.removeAttribute('href');entry.element.removeAttributeNS('http://www.w3.org/1999/xlink','href');}
    }
    if(tag==='svg'&&entry.originalSvgMarkup!==null){
      entry.element.innerHTML=entry.originalSvgMarkup;
      if(entry.originalSvgViewBox!==null)entry.element.setAttribute('viewBox',entry.originalSvgViewBox);else entry.element.removeAttribute('viewBox');
    }
    if (entry.originalAriaLabel !== null) entry.element.setAttribute('aria-label',entry.originalAriaLabel);
    else entry.element.removeAttribute('aria-label');
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
      node === constraintBadge || node === boxMarginRing || node === boxPaddingRing || node === altTargetOutline || node === altMeasureLabel || node === dragMeasureLabel || node === marqueeBox ||
      constraintLines.includes(node) ||
      spacingVisuals.some(function(item){return node===item.line||node===item.label});
  }

  function alignmentCandidates(element) {
    const x = [{ value: window.innerWidth / 2, label: 'Centre écran' }];
    const y = [{ value: window.innerHeight / 2, label: 'Milieu écran' }];
    (customGuides.x||[]).forEach(function(value){x.push({value:Number(value)||0,label:'Repère vertical '+Math.round(Number(value)||0)+' px'})});
    (customGuides.y||[]).forEach(function(value){y.push({value:Number(value)||0,label:'Repère horizontal '+Math.round(Number(value)||0)+' px'})});
    (layoutGuidesX||[]).forEach(function(item){
      if(!item||!Number.isFinite(Number(item.value)))return;
      x.push({value:Number(item.value),label:String(item.label||'Grille de colonnes')});
    });
    const candidates = [];
    const parent = element.parentElement;

    if (parent) {
      const parentRect = (parent === document.body || parent === document.documentElement)
        ? {left:0,top:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight}
        : parent.getBoundingClientRect();
      if (parentRect && parentRect.width > 0 && parentRect.height > 0) {
        x.push({value:parentRect.left,label:'Bord gauche parent'});
        x.push({value:parentRect.left + parentRect.width / 2,label:'Centre parent'});
        x.push({value:parentRect.right,label:'Bord droit parent'});
        y.push({value:parentRect.top,label:'Haut parent'});
        y.push({value:parentRect.top + parentRect.height / 2,label:'Milieu parent'});
        y.push({value:parentRect.bottom,label:'Bas parent'});

        if (isViewportParent(parent,parentRect) && (safeArea.top || safeArea.right || safeArea.bottom || safeArea.left)) {
          x.push({value:safeArea.left,label:'Zone sûre gauche'});
          x.push({value:innerWidth - safeArea.right,label:'Zone sûre droite'});
          y.push({value:safeArea.top,label:'Zone sûre haute'});
          y.push({value:innerHeight - safeArea.bottom,label:'Zone sûre basse'});
        }
      }
      Array.from(parent.children).forEach(function (el) {
        if (el !== element && !selectedSet.has(el)) candidates.push(el);
      });
    }

    const scope = element.closest('.track,.cover,.music-player,.player,.app-page') || document.body;
    Array.from(scope.querySelectorAll('[id],button,.choice,.stat,.tag,.artist,h1')).forEach(function (el) {
      if (el !== element && !selectedSet.has(el) && !candidates.includes(el)) candidates.push(el);
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

  function equalSpacingSnap(rect) {
    const candidates=measurementCandidates();
    let left=null,right=null,top=null,bottom=null;
    const crossLimit=Math.max(12,guideThreshold*2);

    candidates.forEach(function(el){
      const r=el.getBoundingClientRect();
      const verticalGap=intervalGap(rect.top,rect.bottom,r.top,r.bottom);
      const horizontalGap=intervalGap(rect.left,rect.right,r.left,r.right);

      if(r.right<=rect.left&&verticalGap<=crossLimit){
        if(!left||r.right>left.rect.right)left={element:el,rect:r};
      }
      if(r.left>=rect.right&&verticalGap<=crossLimit){
        if(!right||r.left<right.rect.left)right={element:el,rect:r};
      }
      if(r.bottom<=rect.top&&horizontalGap<=crossLimit){
        if(!top||r.bottom>top.rect.bottom)top={element:el,rect:r};
      }
      if(r.top>=rect.bottom&&horizontalGap<=crossLimit){
        if(!bottom||r.top<bottom.rect.top)bottom={element:el,rect:r};
      }
    });

    let x=null,y=null;
    if(left&&right){
      const available=right.rect.left-left.rect.right-rect.width;
      if(available>=0){
        const gap=available/2;
        const targetLeft=left.rect.right+gap;
        const diff=targetLeft-rect.left;
        if(Math.abs(diff)<=guideThreshold)x={diff:diff,gap:gap,left:left,right:right};
      }
    }
    if(top&&bottom){
      const available=bottom.rect.top-top.rect.bottom-rect.height;
      if(available>=0){
        const gap=available/2;
        const targetTop=top.rect.bottom+gap;
        const diff=targetTop-rect.top;
        if(Math.abs(diff)<=guideThreshold)y={diff:diff,gap:gap,top:top,bottom:bottom};
      }
    }
    return {x:x,y:y};
  }

  function smartSnapSelection() {
    hideGuides();
    if (!smartGuidesEnabled || !selected) return;

    const items = selectionElements().filter(function(element){
      const state = remember(element);
      return state && !state.deleted && !state.locked;
    });
    if (!items.length) return;

    let rect = items.length > 1 ? selectionBounds() : items[0].getBoundingClientRect();
    if (!rect) return;

    const anchorsX = [rect.left, rect.left + rect.width / 2, rect.right];
    const anchorsY = [rect.top, rect.top + rect.height / 2, rect.bottom];
    const candidates = alignmentCandidates(items[0]);
    const spacingSnap = equalSpacingSnap(rect);
    let bestX = null;
    let bestY = null;

    anchorsX.forEach(function (anchor) {
      candidates.x.forEach(function (candidate) {
        const diff = candidate.value - anchor;
        const abs = Math.abs(diff);
        if (abs <= guideThreshold && (!bestX || abs < bestX.abs || (abs === bestX.abs && candidate.label === 'Centre écran'))) {
          bestX = { abs: abs, diff: diff, value: candidate.value, label: candidate.label };
        }
      });
    });

    anchorsY.forEach(function (anchor) {
      candidates.y.forEach(function (candidate) {
        const diff = candidate.value - anchor;
        const abs = Math.abs(diff);
        if (abs <= guideThreshold && (!bestY || abs < bestY.abs || (abs === bestY.abs && candidate.label === 'Milieu écran'))) {
          bestY = { abs: abs, diff: diff, value: candidate.value, label: candidate.label };
        }
      });
    });

    const dx = bestX ? bestX.diff : (spacingSnap.x ? spacingSnap.x.diff : 0);
    const dy = bestY ? bestY.diff : (spacingSnap.y ? spacingSnap.y.diff : 0);
    if (dx || dy) {
      items.forEach(function (element) {
        const state = remember(element);
        moveResponsiveState(element, state, dx, dy);
      });
    }

    rect = items.length > 1 ? selectionBounds() : items[0].getBoundingClientRect();
    if (bestX) showVerticalGuide(bestX.value, bestX.label);
    else if (rect && Math.abs((rect.left + rect.width / 2) - innerWidth / 2) < 0.75) showVerticalGuide(innerWidth / 2, 'Centre écran');

    if (bestY) showHorizontalGuide(bestY.value, bestY.label);
    else if (rect && Math.abs((rect.top + rect.height / 2) - innerHeight / 2) < 0.75) showHorizontalGuide(innerHeight / 2, 'Milieu écran');

    if((!bestX&&spacingSnap.x)||(!bestY&&spacingSnap.y)){
      const visual={left:null,right:null,top:null,bottom:null};
      if(!bestX&&spacingSnap.x){
        visual.left={gap:spacingSnap.x.gap};
        visual.right={gap:spacingSnap.x.gap};
      }
      if(!bestY&&spacingSnap.y){
        visual.top={gap:spacingSnap.y.gap};
        visual.bottom={gap:spacingSnap.y.gap};
      }
      showSpacingVisuals(rect,visual);
      emit('equal-spacing',{
        horizontal:!bestX&&spacingSnap.x?Math.round(spacingSnap.x.gap):null,
        vertical:!bestY&&spacingSnap.y?Math.round(spacingSnap.y.gap):null
      });
    }
  }

  function nextCloneId() {
    cloneSequence += 1;
    return 'clone-' + Date.now().toString(36) + '-' + cloneSequence.toString(36);
  }

  function sanitizeCloneIds(clone, cloneId) {
    const idMap = {};
    const nodes = [clone].concat(Array.from(clone.querySelectorAll('[id]')));
    let index = 0;
    nodes.forEach(function(node){
      if(!node.id)return;
      const oldId=node.id;
      index += 1;
      const newId=oldId + '__ais_' + cloneId.replace(/[^a-z0-9_-]/gi,'') + '_' + index;
      idMap[oldId]=newId;
      node.id=newId;
    });
    const attrs=['for','aria-controls','aria-labelledby','aria-describedby','aria-owns'];
    [clone].concat(Array.from(clone.querySelectorAll('*'))).forEach(function(node){
      attrs.forEach(function(attr){
        const value=node.getAttribute&&node.getAttribute(attr);
        if(!value)return;
        const parts=String(value).split(/\s+/).map(function(part){return idMap[part]||part});
        node.setAttribute(attr,parts.join(' '));
      });
      const href=node.getAttribute&&node.getAttribute('href');
      if(href&&href.charAt(0)==='#'&&idMap[href.slice(1)])node.setAttribute('href','#'+idMap[href.slice(1)]);
    });
  }

  function createCloneFromHtml(html,parentSelector,index,offset) {
    let parent=null;
    try{parent=document.querySelector(parentSelector||'')}catch(_){}
    if(!parent)parent=document.body;
    const template=document.createElement('template');
    template.innerHTML=String(html||'').trim();
    const clone=template.content.firstElementChild;
    if(!clone)return null;
    const cloneId=nextCloneId();
    clone.dataset.aisCloneId=cloneId;
    sanitizeCloneIds(clone,cloneId);
    const children=Array.from(parent.children);
    const before=Number.isInteger(index)&&index>=0&&index<children.length?children[index]:null;
    parent.insertBefore(clone,before);
    const state=remember(clone);
    if(state&&offset){
      moveResponsiveState(clone,state,offset,offset);
    }
    return clone;
  }

  function serializeSelectionForClipboard() {
    return selectionElements().map(function(element){
      return {
        html: element.outerHTML,
        parentSelector: element.parentElement ? selectorFor(element.parentElement) : '',
        index: element.parentElement ? Array.from(element.parentElement.children).indexOf(element) + 1 : -1
      };
    });
  }

  function captureSelectionStyle(element) {
    if(!element)return null;
    const cs=getComputedStyle(element);
    return {
      fontSize:parseFloat(cs.fontSize)||16,
      fontFamily:cs.fontFamily||'system-ui',
      fontWeight:cs.fontWeight||'400',
      fontStyle:cs.fontStyle||'normal',
      textDecoration:cs.textDecorationLine||'none',
      textAlign:cs.textAlign||'left',
      letterSpacing:cs.letterSpacing||'normal',
      lineHeight:cs.lineHeight||'normal',
      color:cs.color||'rgb(0, 0, 0)',
      backgroundColor:cs.backgroundColor||'rgba(0, 0, 0, 0)',
      borderColor:cs.borderColor||'rgba(0, 0, 0, 0)',
      advancedStyles:{
        'border-radius':cs.borderRadius||'0px',
        'box-shadow':cs.boxShadow||'none',
        'filter':cs.filter||'none',
        'opacity':cs.opacity||'1',
        'object-fit':cs.objectFit||'fill'
      }
    };
  }

  function copySelectionStyle() {
    if(!active||!selected)return false;
    styleClipboard=captureSelectionStyle(selected);
    if(!styleClipboard)return false;
    emit('style-copied',{selector:selectorFor(selected)});
    return true;
  }

  function pasteSelectionStyle() {
    if(!active||!selected||!styleClipboard)return false;
    let count=0;
    selectionElements().forEach(function(element){
      const state=remember(element);
      if(!state||state.locked)return;

      state.fontAdjusted=true;
      state.fontSize=styleClipboard.fontSize;
      state.fontFamily=styleClipboard.fontFamily;
      state.fontWeight=styleClipboard.fontWeight;
      state.fontStyle=styleClipboard.fontStyle;
      state.textDecoration=styleClipboard.textDecoration;
      state.textAlign=styleClipboard.textAlign;
      state.letterSpacing=styleClipboard.letterSpacing;
      state.lineHeight=styleClipboard.lineHeight;

      state.color=styleClipboard.color;
      state.backgroundColor=styleClipboard.backgroundColor;
      state.borderColor=styleClipboard.borderColor;
      state.colorAdjusted=true;
      state.backgroundAdjusted=true;
      state.borderAdjusted=true;

      state.advancedAdjusted=true;
      state.advancedStyles=Object.assign({},state.advancedStyles||{},styleClipboard.advancedStyles||{});

      applyState(element,state,false);
      count+=1;
    });
    if(!count)return false;
    updateOverlay();
    commitHistory();
    emit('style-pasted',{count:count});
    return true;
  }

  function copySelection() {
    if(!active||!selected)return false;
    clipboardNodes=serializeSelectionForClipboard();
    pasteSequence=0;
    emit('selection-copied',{count:clipboardNodes.length});
    return clipboardNodes.length>0;
  }

  function pasteSelection() {
    if(!active||!clipboardNodes.length)return false;
    pasteSequence += 1;
    const offset=12*Math.min(6,pasteSequence);
    const created=[];
    clipboardNodes.forEach(function(item){
      const clone=createCloneFromHtml(item.html,item.parentSelector,item.index,offset);
      if(clone)created.push(clone);
    });
    if(!created.length)return false;
    selectedSet.clear();
    created.forEach(function(el){selectedSet.add(el)});
    selected=created[created.length-1];
    updateOverlay();
    emitLayers();
    commitHistory();
    emit('selection-pasted',{count:created.length});
    return true;
  }

  function duplicateSelection() {
    if(!active||!selected)return false;
    clipboardNodes=serializeSelectionForClipboard();
    pasteSequence=0;
    const ok=pasteSelection();
    if(ok)emit('selection-duplicated',{count:selectionElements().length});
    return ok;
  }

  function setSelectionZ(mode) {
    if(!active||!selected)return false;
    const items=selectionElements();
    if(!items.length)return false;
    const parents=[];
    items.forEach(function(el){if(el.parentElement&&!parents.includes(el.parentElement))parents.push(el.parentElement)});
    items.forEach(function(el){
      const state=remember(el);
      if(!state||state.locked)return;
      const parent=el.parentElement;
      const siblingZ=parent?Array.from(parent.children).filter(function(x){return x!==el}).map(function(x){
        const sx=touched.get(x);return sx&&sx.zAdjusted?Number(sx.zIndex)||0:(parseInt(getComputedStyle(x).zIndex,10)||0);
      }):[0];
      if(mode==='front')state.zIndex=Math.max.apply(null,[0].concat(siblingZ))+1;
      else state.zIndex=Math.min.apply(null,[0].concat(siblingZ))-1;
      state.zAdjusted=true;
      applyState(el,state,false);
    });
    updateOverlay();
    commitHistory();
    emit('selection-z',{mode:mode,count:items.length});
    return true;
  }

  function generatedNodesSnapshot() {
    return Array.from(document.querySelectorAll('[data-ais-clone-id]')).map(function(el){
      const parent=el.parentElement;
      return {
        cloneId:el.dataset.aisCloneId,
        parentSelector:parent?selectorFor(parent):'',
        index:parent?Array.from(parent.children).indexOf(el):-1,
        html:el.outerHTML
      };
    });
  }

  function clearGeneratedNodes() {
    Array.from(document.querySelectorAll('[data-ais-clone-id]')).forEach(function(el){el.remove()});
    Array.from(registry.keys()).forEach(function(key){
      if(String(key).indexOf('[data-ais-clone-id="')===0)registry.delete(key);
    });
  }

  function restoreGeneratedNodes(list) {
    (Array.isArray(list)?list:[]).forEach(function(item){
      let parent=null;
      try{parent=document.querySelector(item.parentSelector||'')}catch(_){}
      if(!parent)parent=document.body;
      const template=document.createElement('template');
      template.innerHTML=String(item.html||'').trim();
      const clone=template.content.firstElementChild;
      if(!clone)return;
      clone.dataset.aisCloneId=item.cloneId||nextCloneId();
      const children=Array.from(parent.children);
      const before=Number.isInteger(item.index)&&item.index>=0&&item.index<children.length?children[item.index]:null;
      parent.insertBefore(clone,before);
    });
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
        tokenStyles: Object.assign({}, state.tokenStyles || {}),
        advancedAdjusted: !!state.advancedAdjusted,
        advancedStyles: Object.assign({}, state.advancedStyles || {}),
        stateStyles: JSON.parse(JSON.stringify(state.stateStyles || {hover:{},active:{},focus:{},disabled:{}})),
        accessibilityAdjusted: !!state.accessibilityAdjusted,
        accessibilityLabel: state.accessibilityLabel || '',
        mediaAdjusted: !!state.mediaAdjusted,
        mediaKind: state.mediaKind || '',
        mediaSource: state.mediaSource || '',
        mediaAssetPath: state.mediaAssetPath || '',
        mediaName: state.mediaName || '',
        mediaFit: state.mediaFit || 'contain',
        mediaPositionX: mediaPercent(state.mediaPositionX,50),
        mediaPositionY: mediaPercent(state.mediaPositionY,50),
        svgTintAdjusted: !!state.svgTintAdjusted,
        svgTintColor: state.svgTintColor || '#000000',
        svgTintMode: state.svgTintMode || 'both',
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
      generatedNodes: generatedNodesSnapshot(),
      selectedSelector: selected ? selectorFor(selected) : '',
      selectedSelectors: selectionElements().map(selectorFor).filter(Boolean)
    };
  }

  function snapshotKey(snap) {
    return JSON.stringify({items:snap.items,generatedNodes:snap.generatedNodes||[]});
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
    clearGeneratedNodes();
    restoreGeneratedNodes(snap.generatedNodes||[]);
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
        tokenStyles: Object.assign({}, saved.tokenStyles || {}),
        advancedAdjusted: !!saved.advancedAdjusted,
        advancedStyles: Object.assign({}, saved.advancedStyles || {}),
        stateStyles: JSON.parse(JSON.stringify(saved.stateStyles || {hover:{},active:{},focus:{},disabled:{}})),
        accessibilityAdjusted: !!saved.accessibilityAdjusted,
        accessibilityLabel: saved.accessibilityLabel || '',
        mediaAdjusted: !!saved.mediaAdjusted,
        mediaKind: saved.mediaKind || '',
        mediaSource: saved.mediaSource || '',
        mediaAssetPath: saved.mediaAssetPath || '',
        mediaName: saved.mediaName || '',
        mediaFit: saved.mediaFit || 'contain',
        mediaPositionX: mediaPercent(saved.mediaPositionX,50),
        mediaPositionY: mediaPercent(saved.mediaPositionY,50),
        svgTintAdjusted: !!saved.svgTintAdjusted,
        svgTintColor: saved.svgTintColor || '#000000',
        svgTintMode: ['fill','stroke','both'].indexOf(saved.svgTintMode)>=0?saved.svgTintMode:'both',
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
    buildForcedStateStyle();
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
    clearGeneratedNodes();
    touched.clear();
    buildForcedStateStyle();
    selected = null;
    selectedSet.clear();
    isolationActive=false;
    clearIsolation();
    clearSecondaryOutlines();
    hideGuides();
    updateOverlay();
    commitHistory();
    emit('isolation',{active:false,count:0});
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
    rules.push(':root {\n'+
      '  --ais-space: '+Math.max(1,Number(designTokens.spacingUnit)||8)+'px;\n'+
      '  --ais-radius-card: '+Math.max(0,Number(designTokens.radiusCard)||12)+'px;\n'+
      '  --ais-text-title: '+Math.max(8,Number(designTokens.textTitle)||20)+'px;\n'+
      '  --ais-color-primary: '+String(designTokens.colorPrimary||'#6f49f5')+';\n'+
      '  --ais-color-surface: '+String(designTokens.colorSurface||'#ffffff')+';\n}');
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
        if (state.tokenStyles) {
          Object.keys(state.tokenStyles).forEach(function(prop){
            if(state.tokenStyles[prop])declarations.push('  '+prop+': '+state.tokenStyles[prop]+' !important;');
          });
        }
        if (state.advancedAdjusted && state.advancedStyles) {
          Object.keys(state.advancedStyles).forEach(function(prop){
            const value=state.advancedStyles[prop];
            if(value!==undefined&&value!==null&&value!=='')declarations.push('  '+prop+': '+value+' !important;');
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
      const pseudoMap={hover:':hover',active:':active'};
      const stateStyles=state.stateStyles||{};
      ['hover','active','focus','disabled'].forEach(function(name){
        const styles=stateStyles[name]||{};
        const stateDecl=[];
        if(styles.color)stateDecl.push('  color: '+styles.color+' !important;');
        if(styles.backgroundColor)stateDecl.push('  background-color: '+styles.backgroundColor+' !important;');
        if(styles.borderColor)stateDecl.push('  border-color: '+styles.borderColor+' !important;');
        if(styles.opacity!==undefined&&styles.opacity!=='')stateDecl.push('  opacity: '+Math.max(0,Math.min(1,Number(styles.opacity)))+' !important;');
        if(!stateDecl.length)return;
        let selector=state.selector+(pseudoMap[name]||'');
        if(name==='focus')selector=state.selector+':focus-visible, '+state.selector+':focus';
        if(name==='disabled')selector=state.selector+':disabled, '+state.selector+'[aria-disabled="true"]';
        rules.push(selector+' {\n'+stateDecl.join('\n')+'\n}');
      });
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


  function addSpecificity(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]}
  function maxSpecificity(list){
    return (list||[]).reduce(function(best,item){return compareSpecificity(item,best)>0?item:best},[0,0,0]);
  }
  function splitTopLevelSelectorList(text){
    const out=[];let start=0,depth=0,quote='';
    for(let i=0;i<String(text||'').length;i+=1){
      const ch=text[i];
      if(quote){if(ch===quote&&text[i-1]!=='\\')quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;continue}
      if(ch==='('||ch==='[')depth+=1;
      else if(ch===')'||ch===']')depth=Math.max(0,depth-1);
      else if(ch===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1}
    }
    out.push(String(text||'').slice(start).trim());
    return out.filter(Boolean);
  }
  function cssSpecificity(selectorText) {
    const text=String(selectorText||'');
    let score=[0,0,0];
    function identEnd(input,index){while(index<input.length&&/[a-zA-Z0-9_-]/.test(input[index]))index+=1;return index}
    function balancedEnd(input,index,open,close){
      let depth=0,quote='';
      for(let i=index;i<input.length;i+=1){
        const ch=input[i];
        if(quote){if(ch===quote&&input[i-1]!=='\\')quote='';continue}
        if(ch==='"'||ch==="'"){quote=ch;continue}
        if(ch===open)depth+=1;
        else if(ch===close){depth-=1;if(depth===0)return i}
      }
      return input.length-1;
    }
    for(let i=0;i<text.length;){
      const ch=text[i];
      if(/\s|[>+~,]/.test(ch)){i+=1;continue}
      if(ch==='*'||ch==='&'){i+=1;continue}
      if(ch==='#'){score[0]+=1;i=identEnd(text,i+1);continue}
      if(ch==='.'){score[1]+=1;i=identEnd(text,i+1);continue}
      if(ch==='['){score[1]+=1;i=balancedEnd(text,i,'[',']')+1;continue}
      if(ch===':'){
        const pseudoElement=text[i+1]===':';
        let nameStart=i+(pseudoElement?2:1),nameEnd=identEnd(text,nameStart);
        const name=text.slice(nameStart,nameEnd).toLowerCase();
        if(pseudoElement)score[2]+=1;
        if(text[nameEnd]==='('){
          const close=balancedEnd(text,nameEnd,'(',')');
          const inner=text.slice(nameEnd+1,close);
          if(pseudoElement){
            if(name==='slotted')score=addSpecificity(score,maxSpecificity(splitTopLevelSelectorList(inner).map(cssSpecificity)));
          }else if(name==='where'){
            // :where() a toujours une spécificité nulle.
          }else if(name==='is'||name==='not'||name==='has'){
            score=addSpecificity(score,maxSpecificity(splitTopLevelSelectorList(inner).map(cssSpecificity)));
          }else if(name==='nth-child'||name==='nth-last-child'){
            score[1]+=1;
            const match=inner.match(/\bof\b([\s\S]*)$/i);
            if(match)score=addSpecificity(score,maxSpecificity(splitTopLevelSelectorList(match[1]).map(cssSpecificity)));
          }else if(name==='host'||name==='host-context'){
            score[1]+=1;
            score=addSpecificity(score,maxSpecificity(splitTopLevelSelectorList(inner).map(cssSpecificity)));
          }else score[1]+=1;
          i=close+1;continue;
        }
        if(!pseudoElement)score[1]+=1;
        i=nameEnd;continue;
      }
      if(/[a-zA-Z_-]/.test(ch)){score[2]+=1;i=identEnd(text,i+1);continue}
      i+=1;
    }
    return score;
  }

  function compareSpecificity(a,b) {
    for(let i=0;i<3;i+=1){if(a[i]!==b[i])return a[i]-b[i]}
    return 0;
  }

  function selectorMatches(element,selector) {
    try{return element.matches(selector)}catch(_){return false}
  }

  function inspectCssCascade() {
    const started=(window.performance&&performance.now)?performance.now():Date.now();
    if(!selected){emit('css-cascade',{selected:false,rules:[],computed:{},variables:[],meta:{}});return}
    const element=selected,candidates=[],unreadableSheets=[],layerOrder=new Map();
    let order=0,visitedRules=0,truncated=false,nextLayerOrder=1;

    function registerLayer(name){
      name=String(name||'').trim();
      if(!name)return 0;
      if(!layerOrder.has(name))layerOrder.set(name,nextLayerOrder++);
      return layerOrder.get(name);
    }
    function childContext(context,label){return context?(context+' · '+label):label}
    function visitRules(rules,href,context,currentLayer){
      Array.from(rules||[]).forEach(function(rule){
        if(visitedRules++>3500){truncated=true;return}
        const ctor=String(rule&&rule.constructor&&rule.constructor.name||'');
        if(/CSSLayerStatementRule/.test(ctor)){
          String(rule.cssText||'').replace(/^\s*@layer\s+/,'').replace(/;\s*$/,'').split(',').forEach(function(name){registerLayer(name)});
          return;
        }
        if(rule.type===1&&rule.selectorText){
          order+=1;
          String(rule.selectorText).split(',').map(function(x){return x.trim()}).filter(Boolean).forEach(function(selector){
            if(!selectorMatches(element,selector))return;
            const declarations=[];
            for(let i=0;i<rule.style.length;i+=1){
              const property=rule.style[i];
              declarations.push({
                property:property,
                value:rule.style.getPropertyValue(property).trim(),
                important:rule.style.getPropertyPriority(property)==='important'
              });
            }
            candidates.push({
              selector:selector,
              selectorText:rule.selectorText,
              href:href||'',
              context:context||'',
              layer:currentLayer||'',
              layerOrder:currentLayer?registerLayer(currentLayer):0,
              specificity:cssSpecificity(selector),
              order:order,
              declarations:declarations
            });
          });
          return;
        }
        if(rule.cssRules){
          let active=true,nextContext=context||'',nextLayer=currentLayer||'';
          if(rule.type===4&&rule.conditionText){
            try{active=matchMedia(rule.conditionText).matches}catch(_){active=true}
            nextContext=childContext(nextContext,'@media '+rule.conditionText);
          }else if(/CSSSupportsRule/.test(ctor)&&rule.conditionText){
            try{active=CSS.supports(rule.conditionText)}catch(_){active=true}
            nextContext=childContext(nextContext,'@supports '+rule.conditionText);
          }else if(/CSSLayerBlockRule/.test(ctor)){
            const local=String(rule.name||'(anonyme)');
            nextLayer=nextLayer?(nextLayer+'.'+local):local;
            registerLayer(nextLayer);
            nextContext=childContext(nextContext,'@layer '+local);
          }else if(/CSSScopeRule/.test(ctor)){
            nextContext=childContext(nextContext,String(rule.cssText||'').split('{')[0].trim()||'@scope');
          }else if(/CSSContainerRule/.test(ctor)){
            nextContext=childContext(nextContext,'@container '+String(rule.conditionText||''));
          }else if(rule.conditionText){
            nextContext=childContext(nextContext,String(rule.conditionText));
          }
          if(active)visitRules(rule.cssRules,href,nextContext,nextLayer);
        }
      });
    }

    Array.from(document.styleSheets||[]).slice(0,160).forEach(function(sheet){
      try{visitRules(sheet.cssRules,sheet.href||'','','')}
      catch(error){unreadableSheets.push({href:sheet.href||'(feuille inline)',reason:String(error&&error.name||'accès refusé')})}
    });
    if((document.styleSheets||[]).length>160)truncated=true;

    if(element.style&&element.style.length){
      const declarations=[];
      for(let i=0;i<element.style.length;i+=1){
        const property=element.style[i];
        declarations.push({property:property,value:element.style.getPropertyValue(property).trim(),important:element.style.getPropertyPriority(property)==='important'});
      }
      candidates.push({selector:'style=""',selectorText:'style=""',href:'inline',context:'attribut style',layer:'',layerOrder:0,specificity:[1000,0,0],order:1000000,declarations:declarations,inline:true});
    }

    function layerPriority(rule,important){
      if(important)return rule.layer?100000-rule.layerOrder:0;
      return rule.layer?rule.layerOrder:100000;
    }
    const winners={};
    candidates.forEach(function(rule){
      rule.declarations.forEach(function(dec){
        const previous=winners[dec.property];
        const rank={important:dec.important?1:0,layer:layerPriority(rule,dec.important),specificity:rule.specificity,order:rule.order};
        let wins=!previous;
        if(previous){
          if(rank.important!==previous.rank.important)wins=rank.important>previous.rank.important;
          else if(rank.layer!==previous.rank.layer)wins=rank.layer>previous.rank.layer;
          else{
            const cmp=compareSpecificity(rank.specificity,previous.rank.specificity);
            wins=cmp>0||(cmp===0&&rank.order>=previous.rank.order);
          }
        }
        if(wins)winners[dec.property]={rule:rule,dec:dec,rank:rank};
      });
    });
    candidates.forEach(function(rule){
      rule.declarations.forEach(function(dec){
        const winner=winners[dec.property];
        dec.winner=!!winner&&winner.rule===rule&&winner.dec===dec;
      });
      rule.winningProperties=rule.declarations.filter(function(d){return d.winner}).map(function(d){return d.property});
    });

    const cs=getComputedStyle(element),computed={};
    ['display','position','width','height','min-width','max-width','min-height','max-height','margin','padding','gap','flex','flex-direction','flex-wrap','justify-content','align-items','grid-template-columns','overflow','overflow-x','overflow-y','font-size','line-height','color','background-color','z-index'].forEach(function(prop){
      computed[prop]=cs.getPropertyValue(prop);
    });
    candidates.sort(function(a,b){
      const aw=a.winningProperties.length?1:0,bw=b.winningProperties.length?1:0;
      return bw-aw||b.order-a.order;
    });
    const variableNames=new Set();
    candidates.forEach(function(rule){
      rule.declarations.forEach(function(dec){
        const refs=String(dec.value||'').match(/var\(\s*(--[\w-]+)/g)||[];
        refs.forEach(function(ref){
          const m=ref.match(/--[\w-]+/);if(m)variableNames.add(m[0]);
        });
        if(String(dec.property||'').indexOf('--')===0)variableNames.add(dec.property);
      });
    });
    const variables=Array.from(variableNames).sort().map(function(name){
      const chain=[];let node=element,guard=0;
      while(node&&node.nodeType===1&&guard++<12){
        const inline=node.style&&node.style.getPropertyValue(name);
        if(inline)chain.push({selector:selectorFor(node),value:inline.trim(),source:'inline'});
        node=node.parentElement;
      }
      return {name:name,value:cs.getPropertyValue(name).trim(),chain:chain};
    });
    const elapsed=Math.round((((window.performance&&performance.now)?performance.now():Date.now())-started)*10)/10;
    emit('css-cascade',{
      selected:true,
      selector:selectorFor(element),
      rules:candidates.slice(0,160),
      computed:computed,
      variables:variables,
      meta:{
        scannedRules:visitedRules,
        totalSheets:(document.styleSheets||[]).length,
        unreadableSheets:unreadableSheets.slice(0,30),
        layers:Array.from(layerOrder.entries()).map(function(pair){return {name:pair[0],order:pair[1]}}),
        truncated:truncated||candidates.length>160,
        elapsedMs:elapsed
      }
    });
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

  function selectRelated(mode) {
    if(!active||!selected)return false;
    const current=selected;
    let candidates=[];
    if(mode==='siblings'){
      const parent=current.parentElement;
      candidates=parent?Array.from(parent.children):[current];
    }else if(mode==='similar'){
      const tag=current.tagName;
      const cls=Array.from(current.classList||[]).find(function(name){return !name.startsWith('ve-')});
      const selector=cls?tag.toLowerCase()+'.'+cssEscape(cls):tag.toLowerCase();
      try{candidates=Array.from(document.querySelectorAll(selector)).slice(0,250)}catch(_){candidates=[current]}
    }else{
      candidates=[current];
    }
    candidates=candidates.filter(function(el){
      if(!el||isEditorNode(el)||/^SCRIPT|STYLE|LINK|META|NOSCRIPT$/i.test(el.tagName))return false;
      const st=touched.get(el);
      const cs=getComputedStyle(el);
      const r=el.getBoundingClientRect();
      return !(st&&st.deleted)&&cs.display!=='none'&&r.width>=1&&r.height>=1;
    });
    selectedSet.clear();
    candidates.forEach(function(el){remember(el);selectedSet.add(el)});
    selected=selectedSet.has(current)?current:(candidates[candidates.length-1]||null);
    if(isolationActive)refreshIsolation();
    updateOverlay();
    emitLayers();
    emit('selection-bulk',{mode:mode,count:selectedSet.size});
    return selectedSet.size>0;
  }

  function bulkLayerAction(action) {
    let count=0;
    if(action==='show-all'){
      touched.forEach(function(state,element){
        if(state&&state.deleted){
          state.deleted=false;
          applyState(element,state,false);
          count+=1;
        }
      });
    }
    if(action==='unlock-all'){
      touched.forEach(function(state){
        if(state&&state.locked){state.locked=false;count+=1}
      });
    }
    if(action==='lock-selected'){
      selectionElements().forEach(function(element){
        const state=remember(element);
        if(state&&!state.locked){state.locked=true;count+=1}
      });
    }
    updateOverlay();
    emitLayers();
    if(count)commitHistory();
    emit('layers-bulk',{action:action,count:count});
    return count;
  }

  function selectionGroupSummary() {
    return Object.keys(selectionGroups).sort().map(function(name){
      const selectors=Array.isArray(selectionGroups[name])?selectionGroups[name]:[];
      return {name:name,count:selectors.length,selectors:selectors.slice()};
    });
  }

  function emitSelectionGroups() {
    emit('selection-groups',{items:selectionGroupSummary()});
  }

  function createSelectionGroup(name) {
    const selectors=selectionElements().map(selectorFor).filter(Boolean);
    if(selectors.length<2){
      emit('selection-group-error',{message:'Sélectionne au moins deux objets pour créer un groupe.'});
      return false;
    }
    let base=String(name||'').trim()||('Groupe '+(Object.keys(selectionGroups).length+1));
    let finalName=base;
    let index=2;
    while(selectionGroups[finalName]&&JSON.stringify(selectionGroups[finalName])!==JSON.stringify(selectors)){
      finalName=base+' '+index;
      index+=1;
    }
    selectionGroups[finalName]=selectors;
    emitSelectionGroups();
    emit('selection-group-created',{name:finalName,count:selectors.length});
    return true;
  }

  function selectSelectionGroup(name) {
    const selectors=selectionGroups[String(name||'')]||[];
    selectedSet.clear();
    selectors.forEach(function(sel){
      let el=null;
      try{el=document.querySelector(sel)}catch(_){}
      const st=el?touched.get(el):null;
      if(el&&!(st&&st.deleted))selectedSet.add(el);
    });
    selected=Array.from(selectedSet).pop()||null;
    updateOverlay();
    emitLayers();
    emit('selection-group-selected',{name:String(name||''),count:selectedSet.size});
    return selectedSet.size>0;
  }

  function deleteSelectionGroup(name) {
    name=String(name||'');
    if(!selectionGroups[name])return false;
    delete selectionGroups[name];
    emitSelectionGroups();
    emit('selection-group-deleted',{name:name});
    return true;
  }

  function clearIsolation() {
    isolatedNodes.forEach(function(node){
      if(node&&node.removeAttribute)node.removeAttribute('data-ais-isolation-hidden');
    });
    isolatedNodes=[];
  }

  function refreshIsolation() {
    clearIsolation();
    if(!isolationActive||!selected)return;
    const items=selectionElements();
    if(!items.length)return;

    function relation(node){
      let selectedSubtree=false;
      let ancestorOfSelection=false;
      items.forEach(function(sel){
        if(node===sel||sel.contains(node))selectedSubtree=true;
        else if(node.contains(sel))ancestorOfSelection=true;
      });
      return {selectedSubtree:selectedSubtree,ancestorOfSelection:ancestorOfSelection};
    }

    function walk(parent){
      Array.from(parent.children||[]).forEach(function(child){
        if(isEditorNode(child)||/^SCRIPT|STYLE|LINK|META|NOSCRIPT$/i.test(child.tagName))return;
        const rel=relation(child);
        if(rel.selectedSubtree)return;
        if(rel.ancestorOfSelection){walk(child);return}
        child.setAttribute('data-ais-isolation-hidden','1');
        isolatedNodes.push(child);
      });
    }
    walk(document.body);
  }

  function isolateSelection(value) {
    isolationActive=value===undefined?!isolationActive:!!value;
    if(isolationActive&&!selected){
      isolationActive=false;
      emit('isolation',{active:false,error:'Sélectionne un objet à isoler.'});
      return false;
    }
    refreshIsolation();
    updateOverlay();
    emit('isolation',{active:isolationActive,count:selectionElements().length});
    return isolationActive;
  }

  function overlapCandidatesAt(x,y) {
    let list=[];
    try{list=document.elementsFromPoint(Number(x)||0,Number(y)||0)}catch(_){}
    return list.filter(function(el){
      if(!el||el===document.body||el===document.documentElement||isEditorNode(el))return false;
      if(/^SCRIPT|STYLE|LINK|META|NOSCRIPT$/i.test(el.tagName))return false;
      const state=touched.get(el);
      if(state&&state.deleted)return false;
      const cs=getComputedStyle(el);
      const r=el.getBoundingClientRect();
      return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)!==0&&r.width>=2&&r.height>=2;
    }).filter(function(el,index,arr){return arr.indexOf(el)===index}).slice(0,40);
  }

  function cycleOverlapSelection(direction) {
    if(!active)return false;
    direction=Number(direction)<0?-1:1;
    let x=lastPointerPoint.x,y=lastPointerPoint.y;
    if(selected){
      const r=selected.getBoundingClientRect();
      const pointInside=x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
      if(!pointInside){x=r.left+r.width/2;y=r.top+r.height/2}
    }
    const candidates=overlapCandidatesAt(x,y);
    if(!candidates.length){
      emit('selection-cycle',{ok:false,count:0});
      return false;
    }
    let index=selected?candidates.indexOf(selected):-1;
    if(index<0)index=direction>0?-1:0;
    index=(index+direction+candidates.length)%candidates.length;
    const target=candidates[index];
    select(target,false);
    emit('selection-cycle',{
      ok:true,
      index:index+1,
      count:candidates.length,
      selector:selectorFor(target),
      title:layerTitle(target)
    });
    return true;
  }

  function navigateSelection(direction) {
    if (!active || !selected) return;
    let target = null;
    const current = selected;

    function usable(element) {
      if (!element || element === document.body || element === document.documentElement || isEditorNode(element)) return false;
      const cs = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return cs.display !== 'none' && rect.width >= 1 && rect.height >= 1;
    }

    if (direction === 'parent') {
      let parent = current.parentElement;
      while (parent && !usable(parent)) parent = parent.parentElement;
      target = parent;
    } else if (direction === 'child') {
      target = Array.from(current.children || []).find(usable) || null;
    } else if (direction === 'prev') {
      let node = current.previousElementSibling;
      while (node && !usable(node)) node = node.previousElementSibling;
      target = node;
    } else if (direction === 'next') {
      let node = current.nextElementSibling;
      while (node && !usable(node)) node = node.nextElementSibling;
      target = node;
    }

    if (!target) {
      emit('selection-navigation',{ok:false,direction:direction});
      return;
    }

    select(target, false);
    emit('selection-navigation',{
      ok:true,
      direction:direction,
      selector:selectorFor(target),
      title:layerTitle(target)
    });
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



  function median(values) {
    const list=(values||[]).filter(Number.isFinite).sort(function(a,b){return a-b});
    if(!list.length)return 0;
    const mid=Math.floor(list.length/2);
    return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;
  }

  function commonSelectionParent() {
    const items=selectionElements();
    if(!items.length)return null;
    const parent=items[0].parentElement;
    return items.every(function(el){return el.parentElement===parent})?parent:null;
  }

  function inferAutoLayout(applyNow) {
    const items=selectionElements();
    const parent=commonSelectionParent();
    if(items.length<2||!parent){
      emit('auto-layout',{ok:false,message:'Sélectionne au moins deux objets ayant le même parent.'});
      return;
    }
    const rects=items.map(function(el){return {el:el,r:el.getBoundingClientRect()}});
    const avgW=rects.reduce(function(s,x){return s+x.r.width},0)/rects.length;
    const avgH=rects.reduce(function(s,x){return s+x.r.height},0)/rects.length;
    const xCenters=rects.map(function(x){return x.r.left+x.r.width/2});
    const yCenters=rects.map(function(x){return x.r.top+x.r.height/2});
    const xSpread=Math.max.apply(null,xCenters)-Math.min.apply(null,xCenters);
    const ySpread=Math.max.apply(null,yCenters)-Math.min.apply(null,yCenters);
    let mode='grid',layout={display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax('+Math.max(80,Math.round(avgW))+'px, 1fr))',gap:'8px'};
    if(ySpread<=Math.max(10,avgH*.55)){
      const sorted=rects.slice().sort(function(a,b){return a.r.left-b.r.left});
      const gaps=[];for(let i=1;i<sorted.length;i+=1)gaps.push(Math.max(0,sorted[i].r.left-sorted[i-1].r.right));
      mode='row';layout={display:'flex',flexDirection:'row',justifyContent:'flex-start',alignItems:'center',gap:Math.round(median(gaps))+'px'};
    }else if(xSpread<=Math.max(10,avgW*.55)){
      const sorted=rects.slice().sort(function(a,b){return a.r.top-b.r.top});
      const gaps=[];for(let i=1;i<sorted.length;i+=1)gaps.push(Math.max(0,sorted[i].r.top-sorted[i-1].r.bottom));
      mode='column';layout={display:'flex',flexDirection:'column',justifyContent:'flex-start',alignItems:'stretch',gap:Math.round(median(gaps))+'px'};
    }else{
      const ys=rects.map(function(x){return x.r.top}).sort(function(a,b){return a-b});
      const rowThreshold=Math.max(12,avgH*.65);let rows=1,last=ys[0];
      ys.slice(1).forEach(function(y){if(y-last>rowThreshold){rows+=1;last=y}});
      const cols=Math.max(1,Math.ceil(rects.length/rows));
      const xSorted=rects.slice().sort(function(a,b){return a.r.left-b.r.left});
      const gaps=[];for(let i=1;i<xSorted.length;i+=1){const g=xSorted[i].r.left-xSorted[i-1].r.right;if(g>=0&&g<avgW*2)gaps.push(g)}
      layout={display:'grid',gridTemplateColumns:'repeat('+cols+', minmax(0, 1fr))',gap:Math.max(0,Math.round(median(gaps)||8))+'px'};
    }
    const suggestion={ok:true,mode:mode,parentSelector:selectorFor(parent),layout:layout,count:items.length};
    emit('auto-layout',suggestion);
    if(!applyNow)return;
    const state=remember(parent);if(!state||state.locked)return;
    state.layoutAdjusted=true;state.layout=state.layout||{};
    const map={display:'display',flexDirection:'flex-direction',justifyContent:'justify-content',alignItems:'align-items',gap:'gap',gridTemplateColumns:'grid-template-columns'};
    Object.keys(layout).forEach(function(key){if(map[key])state.layout[map[key]]=String(layout[key])});
    items.forEach(function(el){
      const st=remember(el);
      if(st){
        st.dx=0;st.dy=0;st.responsiveDx=0;st.responsiveDy=0;
        st.responsive.enabled=false;
        applyState(el,st,false);
      }
    });
    applyState(parent,state,false);commitHistory();updateOverlay();
  }

  function inferSmartConstraints(applyNow) {
    const items=selectionElements();
    if(!items.length){emit('smart-constraints',{ok:false,message:'Sélectionne un ou plusieurs objets.'});return}
    const suggestions=[];
    items.forEach(function(el){
      const st=remember(el);if(!st)return;
      const r=el.getBoundingClientRect(),b=responsiveBounds(el,st);
      const left=r.left-b.left,right=b.right-r.right,top=r.top-b.top,bottom=b.bottom-r.bottom;
      const cx=Math.abs((r.left+r.width/2)-(b.left+b.width/2)),cy=Math.abs((r.top+r.height/2)-(b.top+b.height/2));
      let h='left',v='top',widthMode='auto',heightMode='auto';
      if(r.width>=b.width*.78){h='stretch';widthMode='fill'}
      else if(cx<=Math.max(8,b.width*.05))h='center';
      else if(right<left)h='right';
      if(r.height>=b.height*.78){v='stretch';heightMode='fill'}
      else if(cy<=Math.max(8,b.height*.05))v='center';
      else if(bottom<top)v='bottom';
      const suggestion={selector:selectorFor(el),hAnchor:h,vAnchor:v,widthMode:widthMode,heightMode:heightMode,
        marginLeft:Math.round(left),marginRight:Math.round(right),marginTop:Math.round(top),marginBottom:Math.round(bottom),
        centerOffsetX:Math.round((r.left+r.width/2)-(b.left+b.width/2)),centerOffsetY:Math.round((r.top+r.height/2)-(b.top+b.height/2))};
      suggestions.push(suggestion);
      if(applyNow){
        st.responsive.enabled=true;
        const cfg=editableResponsive(st,editingBreakpoint);
        Object.assign(cfg,suggestion);
        delete cfg.selector;
        applyState(el,st,false);
      }
    });
    if(applyNow){commitHistory();updateOverlay()}
    emit('smart-constraints',{ok:true,applied:!!applyNow,suggestions:suggestions});
  }

  function setAdvancedStyles(payload) {
    if(!selected)return;
    const allowed=new Set(['padding','padding-left','padding-right','padding-top','padding-bottom','margin','margin-left','margin-right','margin-top','margin-bottom','border-radius','box-shadow','filter','opacity','transform','aspect-ratio','min-width','max-width','min-height','max-height','overflow','position','top','right','bottom','left','object-fit']);
    selectionElements().forEach(function(el){
      const st=remember(el);if(!st||st.locked)return;
      st.advancedAdjusted=true;st.advancedStyles=st.advancedStyles||{};
      Object.keys(payload||{}).forEach(function(prop){
        if(!allowed.has(prop))return;
        const value=payload[prop];
        if(value===null||value===undefined||value==='')delete st.advancedStyles[prop];
        else st.advancedStyles[prop]=String(value);
      });
      applyState(el,st,false);
    });
    commitHistory();updateOverlay();
  }

  function frequencySummary(values) {
    const map=new Map();
    values.forEach(function(item){
      const key=String(item.value);
      if(!map.has(key))map.set(key,{value:item.value,count:0,selectors:[]});
      const row=map.get(key);row.count+=1;if(row.selectors.length<8)row.selectors.push(item.selector);
    });
    return Array.from(map.values()).sort(function(a,b){return b.count-a.count});
  }

  function scanVisibleElements(limit) {
    const collection=document.body.getElementsByTagName('*');
    const total=collection.length;
    const maxItems=Math.max(1,Number(limit)||700);
    const maxInspect=Math.min(total,maxItems*3);
    const items=[];
    let inspected=0;
    for(let i=0;i<maxInspect&&items.length<maxItems;i+=1){
      const el=collection[i];inspected+=1;
      if(isEditorNode(el)||/^SCRIPT|STYLE|LINK|META$/i.test(el.tagName))continue;
      const cs=getComputedStyle(el),r=el.getBoundingClientRect();
      if(cs.display==='none'||cs.visibility==='hidden'||r.width<=1||r.height<=1)continue;
      items.push(el);
    }
    return {items:items,total:total,inspected:inspected,truncated:inspected<total};
  }

  function clearLayoutDiagnostics() {
    layoutDiagnostics=[];
    layoutDiagnosticLayer.innerHTML='';
    layoutDiagnosticLayer.classList.remove('visible');
    emit('layout-diagnostic',{items:[],summary:{errors:0,warnings:0,info:0},cleared:true});
  }

  function diagnosticRectFinding(element,type,severity,message,cause,action,targetSelector) {
    const rect=element.getBoundingClientRect();
    const selector=selectorFor(element);
    return {
      id:'layout-'+(layoutDiagnostics.length+1),
      selector:selector,
      targetSelector:targetSelector||selector,
      type:type,
      severity:severity||'warning',
      message:message,
      cause:cause||'',
      rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
      action:action||null
    };
  }

  function drawLayoutDiagnostics() {
    layoutDiagnosticLayer.innerHTML='';
    layoutDiagnostics.slice(0,80).forEach(function(item,index){
      if(!item.rect||item.rect.width<1||item.rect.height<1)return;
      const box=document.createElement('div');
      box.className='ve-layout-diagnostic '+(item.severity||'warning');
      box.style.left=Math.round(item.rect.left)+'px';
      box.style.top=Math.round(item.rect.top)+'px';
      box.style.width=Math.max(2,Math.round(item.rect.width))+'px';
      box.style.height=Math.max(2,Math.round(item.rect.height))+'px';
      const badge=document.createElement('span');
      badge.textContent=(index+1)+' · '+item.type;
      box.appendChild(badge);
      layoutDiagnosticLayer.appendChild(box);
    });
    layoutDiagnosticLayer.classList.toggle('visible',layoutDiagnostics.length>0);
  }

  function analyzeLayoutDiagnostics(scope) {
    layoutDiagnostics=[];
    const scan=scanVisibleElements(900);
    const all=scan.items;
    let targets=all;
    if(scope==='selection'&&selected){
      const set=new Set(selectionElements());
      selectionElements().forEach(function(el){if(el.parentElement)set.add(el.parentElement)});
      targets=Array.from(set);
    }
    const seen=new Set();
    function add(f){
      const key=f.type+'|'+f.selector+'|'+f.targetSelector;
      if(seen.has(key))return;
      seen.add(key);layoutDiagnostics.push(f);
    }
    targets.forEach(function(el){
      const cs=getComputedStyle(el),r=el.getBoundingClientRect();
      const parent=el.parentElement;
      const parentCs=parent&&getComputedStyle(parent);
      const parentRect=parent&&parent.getBoundingClientRect();

      if(el.scrollWidth>el.clientWidth+3){
        add(diagnosticRectFinding(
          el,'overflow-x','error',
          'Le contenu dépasse horizontalement de '+Math.round(el.scrollWidth-el.clientWidth)+' px.',
          'scrollWidth '+el.scrollWidth+' px > largeur intérieure '+el.clientWidth+' px. Vérifie largeur fixe, min-width, gap ou pistes Grid.',
          {'overflow-x':'auto','max-width':'100%','box-sizing':'border-box'}
        ));
      }
      if(el.scrollHeight>el.clientHeight+3&&/(hidden|clip)/.test(cs.overflowY+cs.overflow)){
        add(diagnosticRectFinding(
          el,'contenu-coupé','warning',
          'Du contenu vertical est coupé dans ce conteneur.',
          'scrollHeight '+el.scrollHeight+' px > hauteur intérieure '+el.clientHeight+' px alors que overflow masque le dépassement.',
          {'overflow-y':'auto'}
        ));
      }

      if(parent&&parentRect&&parentRect.width>2&&r.width>parentRect.width+3&&cs.position!=='fixed'){
        add(diagnosticRectFinding(
          el,'plus-large-parent','warning',
          'Cet objet est plus large que son parent de '+Math.round(r.width-parentRect.width)+' px.',
          'Largeur rendue '+Math.round(r.width)+' px pour un parent de '+Math.round(parentRect.width)+' px.',
          {'max-width':'100%','box-sizing':'border-box'}
        ));
      }

      if(parentCs&&/flex/.test(parentCs.display)){
        const vertical=/column/.test(parentCs.flexDirection);
        if(!vertical&&parentCs.flexWrap==='nowrap'&&parent.scrollWidth>parent.clientWidth+3){
          add(diagnosticRectFinding(
            parent,'flex-nowrap','warning',
            'La rangée Flex ne tient pas sur la largeur disponible.',
            'flex-wrap: nowrap avec un contenu total plus large que le conteneur.',
            {'flex-wrap':'wrap'},
            selectorFor(parent)
          ));
        }
        if(!vertical&&parseFloat(cs.minWidth)>0&&r.right>parentRect.right+3){
          add(diagnosticRectFinding(
            el,'min-width-flex','warning',
            'La largeur minimale de cet enfant Flex contribue au débordement.',
            'Dans un conteneur Flex, min-width:auto ou une min-width fixe peut empêcher l’élément de rétrécir.',
            {'min-width':'0','max-width':'100%'}
          ));
        }
      }

      if(/grid/.test(cs.display)){
        const tracks=String(cs.gridTemplateColumns||'').split(/\s+/).filter(Boolean);
        const fixed=tracks.filter(function(x){return /^\d+(\.\d+)?px$/.test(x)});
        const fixedTotal=fixed.reduce(function(n,x){return n+(parseFloat(x)||0)},0);
        if(fixed.length&&fixedTotal>r.width+3){
          const count=Math.max(1,tracks.length);
          add(diagnosticRectFinding(
            el,'grid-pistes-fixes','warning',
            'Les colonnes Grid fixes dépassent la largeur du conteneur.',
            'Somme des pistes fixes ≈ '+Math.round(fixedTotal)+' px pour '+Math.round(r.width)+' px disponibles.',
            {'grid-template-columns':'repeat('+count+', minmax(0, 1fr))'}
          ));
        }
      }

      if(parent&&parentRect&&parentCs&&/flex|grid/.test(parentCs.display)&&cs.position==='absolute'){
        add(diagnosticRectFinding(
          el,'hors-flux','info',
          'Cet objet est positionné hors du flux de son conteneur '+(parentCs.display.indexOf('grid')>=0?'Grid':'Flex')+'.',
          'position:absolute retire l’objet du calcul normal des alignements, gaps et dimensions du parent.',
          null
        ));
      }
    });

    // Detect meaningful sibling overlaps.
    const containers=targets.filter(function(el){
      const cs=getComputedStyle(el);return /flex|grid|block/.test(cs.display)&&el.children&&el.children.length>1;
    }).slice(0,160);
    containers.forEach(function(parent){
      const children=Array.from(parent.children).filter(function(el){
        if(isEditorNode(el))return false;const cs=getComputedStyle(el),r=el.getBoundingClientRect();
        return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>4&&r.height>4;
      }).slice(0,40);
      for(let i=0;i<children.length;i+=1){
        const a=children[i],ar=a.getBoundingClientRect(),acs=getComputedStyle(a);
        if(acs.position==='absolute'||acs.position==='fixed')continue;
        for(let j=i+1;j<children.length;j+=1){
          const b=children[j],br=b.getBoundingClientRect(),bcs=getComputedStyle(b);
          if(bcs.position==='absolute'||bcs.position==='fixed')continue;
          const w=Math.min(ar.right,br.right)-Math.max(ar.left,br.left);
          const h=Math.min(ar.bottom,br.bottom)-Math.max(ar.top,br.top);
          if(w>6&&h>6&&w*h>Math.min(ar.width*ar.height,br.width*br.height)*.12){
            add(diagnosticRectFinding(
              parent,'chevauchement','warning',
              'Deux enfants se chevauchent de façon significative.',
              selectorFor(a)+' et '+selectorFor(b)+' occupent une zone commune d’environ '+Math.round(w)+' × '+Math.round(h)+' px.',
              null
            ));
            break;
          }
        }
      }
    });

    layoutDiagnostics=layoutDiagnostics.slice(0,120);
    drawLayoutDiagnostics();
    const summary={
      errors:layoutDiagnostics.filter(function(x){return x.severity==='error'}).length,
      warnings:layoutDiagnostics.filter(function(x){return x.severity==='warning'}).length,
      info:layoutDiagnostics.filter(function(x){return x.severity==='info'}).length,
      fixable:layoutDiagnostics.filter(function(x){return !!x.action}).length
    };
    emit('layout-diagnostic',{items:layoutDiagnostics,summary:summary,scope:scope||'screen',scan:{total:scan.total,inspected:scan.inspected,truncated:scope==='selection'?false:scan.truncated}});
  }

  function applyLayoutDiagnostic(id) {
    const item=layoutDiagnostics.find(function(x){return x.id===id});
    if(!item||!item.action)return;
    let el=null;try{el=document.querySelector(item.targetSelector||item.selector)}catch(_){}
    if(!el)return;
    const st=remember(el);if(!st||st.locked)return;
    st.advancedAdjusted=true;st.advancedStyles=st.advancedStyles||{};
    Object.assign(st.advancedStyles,item.action);
    applyState(el,st,false);
    commitHistory();updateOverlay();
    analyzeLayoutDiagnostics('screen');
    emit('layout-diagnostic-applied',{id:id,selector:item.targetSelector||item.selector});
  }

  function applyAllLayoutDiagnostics() {
    const applicable=layoutDiagnostics.filter(function(item){return !!item.action});
    let count=0;
    applicable.forEach(function(item){
      let el=null;try{el=document.querySelector(item.targetSelector||item.selector)}catch(_){}
      if(!el)return;
      const st=remember(el);if(!st||st.locked)return;
      st.advancedAdjusted=true;st.advancedStyles=st.advancedStyles||{};
      Object.assign(st.advancedStyles,item.action);
      applyState(el,st,false);
      count+=1;
    });
    if(count){
      commitHistory();
      updateOverlay();
      analyzeLayoutDiagnostics('screen');
    }
    emit('layout-diagnostic-batch',{count:count});
  }

  function analyzeDesignConsistency() {
    const scan=scanVisibleElements(700);
    const nodes=scan.items;
    const metrics={fontSize:[],radius:[],gap:[],textColor:[],background:[]};
    nodes.forEach(function(el){
      const cs=getComputedStyle(el),selector=selectorFor(el);
      const fs=Math.round((parseFloat(cs.fontSize)||0)*10)/10;if(fs)metrics.fontSize.push({value:fs,selector:selector});
      const br=Math.round((parseFloat(cs.borderRadius)||0)*10)/10;if(br)metrics.radius.push({value:br,selector:selector});
      const gp=Math.round((parseFloat(cs.gap)||0)*10)/10;if(gp)metrics.gap.push({value:gp,selector:selector});
      if(cs.color)metrics.textColor.push({value:cs.color,selector:selector});
      if(cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)')metrics.background.push({value:cs.backgroundColor,selector:selector});
    });
    const groups={},issues=[];
    Object.keys(metrics).forEach(function(key){
      groups[key]=frequencySummary(metrics[key]);
      const common=groups[key][0];
      groups[key].forEach(function(row){
        if(common&&row.count<=2&&groups[key].length>3)issues.push({type:key,value:row.value,count:row.count,selectors:row.selectors,suggested:common.value,message:key+' '+row.value+' est rare ; valeur dominante : '+common.value});
      });
    });
    lastConsistency={groups:groups,issues:issues.slice(0,100),scan:{total:scan.total,inspected:scan.inspected,truncated:scan.truncated}};
    emit('design-consistency',lastConsistency);
  }

  function makeRepairSuggestions() {
    repairSuggestions=[];
    let n=0;
    (lastAuditIssues||[]).forEach(function(issue){
      let action=null,description='';
      if(issue.type==='touch-target'){action={styles:{'min-width':'44px','min-height':'44px'}};description='Porter la zone tactile à au moins 44 × 44 px.'}
      if(issue.type==='text-clipped'){action={styles:{'white-space':'normal','overflow':'visible','text-overflow':'clip'}};description='Autoriser le texte à revenir à la ligne et supprimer le clipping.'}
      if(issue.type==='accessible-name'){action={accessibility:true};description='Créer un nom accessible depuis le texte ou le titre existant.'}
      if(issue.type==='overflow-x'&&issue.selector==='html'){action={bodyStyles:{'max-width':'100vw','overflow-x':'hidden'}};description='Bloquer le débordement horizontal global.'}
      if(!action)return;
      repairSuggestions.push({id:'repair-'+(++n),selector:issue.selector,type:issue.type,severity:issue.severity,description:description,action:action});
    });
    emit('repair-suggestions',{items:repairSuggestions});
  }

  function applyRepairInternal(proposal) {
    if(!proposal)return false;
    let el=null;try{el=proposal.selector==='html'?document.documentElement:document.querySelector(proposal.selector)}catch(_){}
    if(!el)return false;
    const target=proposal.action&&proposal.action.bodyStyles?document.body:el;
    const st=remember(target);if(!st)return false;
    if(proposal.action.styles||proposal.action.bodyStyles){
      st.advancedAdjusted=true;st.advancedStyles=st.advancedStyles||{};
      Object.assign(st.advancedStyles,proposal.action.styles||proposal.action.bodyStyles||{});
    }
    if(proposal.action.accessibility){
      st.accessibilityAdjusted=true;
      st.accessibilityLabel=String(el.textContent||el.getAttribute('title')||'Action').trim().slice(0,80)||'Action';
    }
    applyState(target,st,false);return true;
  }

  function previewRepair(id) {
    const proposal=repairSuggestions.find(function(x){return x.id===id});if(!proposal)return;
    if(repairPreviewSnapshot)loadSnapshot(repairPreviewSnapshot,false);
    repairPreviewSnapshot=snapshot();
    applyRepairInternal(proposal);updateOverlay();emit('repair-preview',{id:id});
  }

  function clearRepairPreview() {
    if(!repairPreviewSnapshot)return;
    const snap=repairPreviewSnapshot;repairPreviewSnapshot=null;loadSnapshot(snap,false);updateOverlay();emit('repair-preview-cleared',{});
  }

  function applyRepair(id) {
    const proposal=repairSuggestions.find(function(x){return x.id===id});if(!proposal)return;
    if(repairPreviewSnapshot){const snap=repairPreviewSnapshot;repairPreviewSnapshot=null;loadSnapshot(snap,false)}
    if(applyRepairInternal(proposal)){commitHistory();updateOverlay();auditInterface();makeRepairSuggestions()}
  }

  function cloneStateForComponent(state) {
    return {
      width:state.width,height:state.height,resized:!!state.resized,
      fontSize:state.fontSize,fontFamily:state.fontFamily,fontWeight:state.fontWeight,fontStyle:state.fontStyle,
      textDecoration:state.textDecoration,textAlign:state.textAlign,letterSpacing:state.letterSpacing,lineHeight:state.lineHeight,
      fontAdjusted:!!state.fontAdjusted,color:state.color,backgroundColor:state.backgroundColor,borderColor:state.borderColor,
      colorAdjusted:!!state.colorAdjusted,backgroundAdjusted:!!state.backgroundAdjusted,borderAdjusted:!!state.borderAdjusted,
      zIndex:state.zIndex,zAdjusted:!!state.zAdjusted,layoutAdjusted:!!state.layoutAdjusted,layout:Object.assign({},state.layout||{}),
      tokenStyles:Object.assign({},state.tokenStyles||{}),advancedAdjusted:!!state.advancedAdjusted,advancedStyles:Object.assign({},state.advancedStyles||{}),
      accessibilityAdjusted:!!state.accessibilityAdjusted,accessibilityLabel:state.accessibilityLabel||'',
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
    state.tokenStyles=Object.assign({},saved.tokenStyles||{});state.advancedAdjusted=!!saved.advancedAdjusted;state.advancedStyles=Object.assign({},saved.advancedStyles||{});
    state.accessibilityAdjusted=!!saved.accessibilityAdjusted;state.accessibilityLabel=saved.accessibilityLabel||'';
    state.animationAdjusted=!!saved.animationAdjusted;state.animation=Object.assign({property:'all',duration:180,easing:'ease',delay:0},saved.animation||{});
    state.responsive=cloneResponsive(saved.responsive);
    applyState(element,state,false);
  }

  function testComponentIntegrity() {
    const results=[];
    Object.keys(components).sort().forEach(function(name){
      const component=components[name]||{};
      const instances=Array.isArray(component.instances)?component.instances:[];
      const variants=component.variants||{};
      const issues=[];
      if(!Array.isArray(component.states)||!component.states.length)issues.push('Aucun état de base enregistré.');
      if(!instances.length)issues.push('Aucune instance liée.');
      instances.forEach(function(selectors,groupIndex){
        if(!Array.isArray(selectors)||selectors.length!==component.states.length){
          issues.push('Instance '+(groupIndex+1)+' : nombre d’objets différent de la définition.');
        }
        (selectors||[]).forEach(function(sel,index){
          let el=null;try{el=document.querySelector(sel)}catch(_){}
          if(!el)issues.push('Instance '+(groupIndex+1)+' : cible introuvable '+sel+'.');
          else{
            const r=el.getBoundingClientRect();
            if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)&&(r.width<44||r.height<44)){
              issues.push('Instance '+(groupIndex+1)+' : cible interactive < 44 px ('+Math.round(r.width)+'×'+Math.round(r.height)+').');
            }
          }
          if(component.states[index]&&component.states[index].componentDetached)issues.push('Instance '+(groupIndex+1)+' : élément détaché inattendu.');
        });
      });
      Object.keys(variants).forEach(function(variantName){
        const variant=variants[variantName];
        if(!Array.isArray(variant)||variant.length!==component.states.length){
          issues.push('Variante "'+variantName+'" incomplète : '+(Array.isArray(variant)?variant.length:0)+' / '+component.states.length+' états.');
        }
      });
      results.push({
        name:name,
        instances:instances.length,
        variants:Object.keys(variants).length,
        ok:issues.length===0,
        issues:issues
      });
    });
    emit('component-tests',{
      results:results,
      summary:{
        tested:results.length,
        failed:results.filter(function(x){return !x.ok}).length,
        issues:results.reduce(function(n,x){return n+x.issues.length},0)
      }
    });
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

  function applyTokenToSelection(kind) {
    if(!selected)return;
    selectionElements().forEach(function(el){
      const st=remember(el);if(!st||st.locked)return;
      if(kind==='primary'){st.colorAdjusted=true;st.color='var(--ais-color-primary)'}
      if(kind==='surface'){st.backgroundAdjusted=true;st.backgroundColor='var(--ais-color-surface)'}
      if(kind==='title'){st.fontAdjusted=true;st.fontSize=Number(designTokens.textTitle)||20}
      if(kind==='radius'){st.tokenStyles=st.tokenStyles||{};st.tokenStyles['border-radius']='var(--ais-radius-card)'}
      if(kind==='spacing'&&el.parentElement){
        const parent=el.parentElement,pst=remember(parent);
        pst.layoutAdjusted=true;pst.layout=pst.layout||{};pst.layout.gap='var(--ais-space)';applyState(parent,pst,false);
      }
      applyState(el,st,false);
    });
    commitHistory();updateOverlay();
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

  function buildForcedStateStyle() {
    let style=document.getElementById('ve-forced-state-style');
    if(!style){style=document.createElement('style');style.id='ve-forced-state-style';document.head.appendChild(style)}
    const chunks=[];
    function walkRules(rules){
      Array.from(rules||[]).forEach(function(rule){
        if(rule.cssRules){try{walkRules(rule.cssRules)}catch(_){};return}
        if(!rule.selectorText||!rule.style)return;
        [
          [':hover','.ais-state-hover'],
          [':active','.ais-state-active'],
          [':focus-visible','.ais-state-focus'],
          [':focus','.ais-state-focus'],
          [':disabled','.ais-state-disabled']
        ].forEach(function(pair){
          if(rule.selectorText.indexOf(pair[0])<0)return;
          const selector=rule.selectorText.split(',').map(function(s){return s.replaceAll(pair[0],pair[1])}).join(',');
          chunks.push(selector+'{'+rule.style.cssText+'}');
        });
      });
    }
    Array.from(document.styleSheets||[]).forEach(function(sheet){try{walkRules(sheet.cssRules)}catch(_){}});
    touched.forEach(function(state){
      const selector=state&&state.selector;
      if(!selector)return;
      const stateStyles=state.stateStyles||{};
      [['hover','ais-state-hover'],['active','ais-state-active'],['focus','ais-state-focus'],['disabled','ais-state-disabled']].forEach(function(pair){
        const values=stateStyles[pair[0]]||{};
        const decl=[];
        if(values.color)decl.push('color:'+values.color+'!important');
        if(values.backgroundColor)decl.push('background-color:'+values.backgroundColor+'!important');
        if(values.borderColor)decl.push('border-color:'+values.borderColor+'!important');
        if(values.opacity!==undefined&&values.opacity!=='')decl.push('opacity:'+Math.max(0,Math.min(1,Number(values.opacity)))+'!important');
        if(decl.length)chunks.push(selector+'.'+pair[1]+'{'+decl.join(';')+'}');
      });
    });
    chunks.push('.ais-state-focus{outline:2px solid #6f49f5!important;outline-offset:2px!important}');
    chunks.push('.ais-state-disabled{opacity:.5!important;filter:grayscale(.25)}');
    style.textContent=chunks.join('\n');
  }

  function setInteractiveState(stateName) {
    activeInteractiveState=String(stateName||'normal');
    buildForcedStateStyle();
    if(!selected)return;
    selectionElements().forEach(function(el){
      if(el.dataset.aisOriginalDisabled===undefined&&'disabled' in el)el.dataset.aisOriginalDisabled=el.disabled?'1':'0';
      if(el.dataset.aisOriginalAriaDisabled===undefined)el.dataset.aisOriginalAriaDisabled=el.getAttribute('aria-disabled')||'';
      el.classList.remove('ais-state-hover','ais-state-active','ais-state-focus','ais-state-disabled');
      if(activeInteractiveState==='hover')el.classList.add('ais-state-hover');
      if(activeInteractiveState==='active')el.classList.add('ais-state-active');
      if(activeInteractiveState==='focus'){el.classList.add('ais-state-focus');if(el.focus)try{el.focus({preventScroll:true})}catch(_){}}
      if(activeInteractiveState==='disabled'){
        el.classList.add('ais-state-disabled');
        if('disabled' in el)el.disabled=true;
        else el.setAttribute('aria-disabled','true');
      }else{
        if('disabled' in el&&el.dataset.aisOriginalDisabled!==undefined)el.disabled=el.dataset.aisOriginalDisabled==='1';
        const originalAria=el.dataset.aisOriginalAriaDisabled;
        if(originalAria)el.setAttribute('aria-disabled',originalAria);
        else el.removeAttribute('aria-disabled');
      }
    });
    buildForcedStateStyle();
    updateOverlay();
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
    let node=sourceEl,link=null;
    while(node&&node!==document.body){
      const selector=selectorFor(node);
      if(prototypeLinks[selector]){link=prototypeLinks[selector];break}
      node=node.parentElement;
    }
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
      scanVisibleElements(700).items.forEach(function(el){
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
      const st=remember(el);
      if(!st)return;
      st.tokenStyles=st.tokenStyles||{};
      if(issue.type==='touch-target'){
        st.tokenStyles['min-width']='44px';
        st.tokenStyles['min-height']='44px';
        fixed.push(issue);
      }
      if(issue.type==='text-clipped'){
        st.tokenStyles['white-space']='normal';
        st.tokenStyles['overflow']='visible';
        st.tokenStyles['text-overflow']='clip';
        fixed.push(issue);
      }
      if(issue.type==='overflow-x'){
        st.tokenStyles['max-width']='100vw';
        st.tokenStyles['overflow-x']='hidden';
        fixed.push(issue);
      }
      if(issue.type==='accessible-name'){
        const text=String(el.textContent||el.getAttribute('title')||'Action').trim().slice(0,80);
        st.accessibilityAdjusted=true;
        st.accessibilityLabel=text||'Action';
        fixed.push(issue);
      }
      applyState(el,st,false);
    });
    if(fixed.length)commitHistory();
    updateOverlay();
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

  function compositeRgb(top,bottom) {
    if(!top)return bottom;
    if(!bottom)return top;
    const ta=Math.max(0,Math.min(1,Number(top.a)));
    const ba=Math.max(0,Math.min(1,Number(bottom.a)));
    const outA=ta+ba*(1-ta);
    if(outA<=0)return {r:255,g:255,b:255,a:0};
    return {
      r:(top.r*ta+bottom.r*ba*(1-ta))/outA,
      g:(top.g*ta+bottom.g*ba*(1-ta))/outA,
      b:(top.b*ta+bottom.b*ba*(1-ta))/outA,
      a:outA
    };
  }

  function resolvedBackground(element) {
    const chain=[];
    let node=element;
    while(node&&node.nodeType===1){chain.unshift(node);node=node.parentElement}
    let color={r:255,g:255,b:255,a:1};
    let complex=false;
    chain.forEach(function(item){
      const cs=getComputedStyle(item);
      if(cs.backgroundImage&&cs.backgroundImage!=='none')complex=true;
      const bg=parseRgb(cs.backgroundColor);
      if(bg&&bg.a>0)color=compositeRgb(bg,color);
    });
    return {color:color,complex:complex};
  }

  function wcagTextThreshold(fontSize,fontWeight) {
    const size=Math.max(0,Number(fontSize)||0);
    const weight=String(fontWeight||'').toLowerCase()==='bold'?700:(parseInt(fontWeight,10)||400);
    const large=size>=24||(size>=18.6667&&weight>=700);
    return {large:large,aa:large?3:4.5,aaa:large?4.5:7};
  }

  function auditInterface() {
    const issues = [];
    const spacingUnit=Math.max(1,Number(designTokens.spacingUnit)||8);
    const scan=scanVisibleElements(750);
    const nodes=scan.items;

    if (document.documentElement.scrollWidth > innerWidth + 2) {
      issues.push({severity:'error',type:'overflow-x',selector:'html',message:'La page dépasse horizontalement le viewport de '+Math.round(document.documentElement.scrollWidth-innerWidth)+' px.',fixable:true});
    }

    const interactive = [];
    const focusable=[];
    const contrastStats={tested:0,aaFailures:0,aaaFailures:0,uncertain:0};
    nodes.forEach(function (el) {
      const r=el.getBoundingClientRect();
      const cs=getComputedStyle(el);
      const selector=selectorFor(el);
      const role=el.getAttribute('role')||'';
      const isInteractive=/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)||role==='button'||role==='link';
      const tabindex=el.getAttribute('tabindex');
      const isFocusable=isInteractive||(tabindex!==null&&Number(tabindex)>=0);

      if (el.children.length===0 && String(el.textContent||'').trim()) {
        const clipped=(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2) &&
          (/(hidden|clip)/.test(cs.overflow+cs.overflowX+cs.overflowY)||cs.whiteSpace==='nowrap');
        if(clipped)issues.push({severity:'error',type:'text-clipped',selector:selector,message:'Texte potentiellement coupé dans '+selector+'.',fixable:true});

        const fg=parseRgb(cs.color),bgInfo=resolvedBackground(el);
        if(fg&&bgInfo&&bgInfo.color){
          if(bgInfo.complex){
            contrastStats.uncertain+=1;
            issues.push({severity:'info',type:'contrast-complex-bg',selector:selector,message:'Contraste à vérifier manuellement : le texte repose sur une image ou un dégradé.',fixable:false});
          }else{
            contrastStats.tested+=1;
            const bg=bgInfo.color;
            const effectiveFg=fg.a<1?compositeRgb(fg,bg):fg;
            const ratio=contrastRatio(effectiveFg,bg);
            const threshold=wcagTextThreshold(parseFloat(cs.fontSize),cs.fontWeight);
            if(ratio<threshold.aaa)contrastStats.aaaFailures+=1;
            if(ratio<threshold.aa){
              contrastStats.aaFailures+=1;
              issues.push({
                severity:'warning',type:'contrast',selector:selector,
                message:'Contraste '+ratio.toFixed(2)+':1 · WCAG AA exige '+threshold.aa.toFixed(1)+':1'+(threshold.large?' pour ce grand texte':'')+' · AAA '+threshold.aaa.toFixed(1)+':1.',
                fixable:false,ratio:Math.round(ratio*100)/100,aaMinimum:threshold.aa,aaaMinimum:threshold.aaa,largeText:threshold.large
              });
            }
          }
        }
      }

      if(isInteractive){
        interactive.push({el:el,rect:r,selector:selector});
        const accessible=String(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.getAttribute('title')||el.textContent||el.value||'').trim();
        if(!accessible)issues.push({severity:'error',type:'accessible-name',selector:selector,message:'Contrôle interactif sans nom accessible.',fixable:true});
        if(r.width<44||r.height<44)issues.push({severity:'warning',type:'touch-target',selector:selector,message:'Zone tactile '+Math.round(r.width)+' × '+Math.round(r.height)+' px, sous 44 × 44.',fixable:true});
        if(r.top<safeArea.top-1||r.left<safeArea.left-1||r.right>innerWidth-safeArea.right+1||r.bottom>innerHeight-safeArea.bottom+1){
          issues.push({severity:'error',type:'safe-area',selector:selector,message:'Élément interactif en dehors de la zone sûre.',fixable:false});
        }
      }

      if(isFocusable)focusable.push({el:el,selector:selector,tabindex:tabindex===null?0:Number(tabindex)||0});
      if(tabindex!==null&&Number(tabindex)>0)issues.push({severity:'warning',type:'tab-order',selector:selector,message:'tabindex positif ('+tabindex+') : ordre clavier potentiellement artificiel.',fixable:false});

      const margins=[parseFloat(cs.marginLeft)||0,parseFloat(cs.marginRight)||0,parseFloat(cs.marginTop)||0,parseFloat(cs.marginBottom)||0];
      margins.forEach(function(v){
        if(v>0&&Math.abs(v/spacingUnit-Math.round(v/spacingUnit))>.16){
          issues.push({severity:'info',type:'spacing-token',selector:selector,message:'Espacement '+Math.round(v*10)/10+' px hors grille '+spacingUnit+' px.',fixable:false});
        }
      });
    });

    if(focusable.length>0&&!focusable.some(function(x){return x.el===document.activeElement})){
      issues.push({severity:'info',type:'keyboard-navigation',selector:'body',message:focusable.length+' éléments sont accessibles au clavier. Utilise le mode Focus pour vérifier leur parcours.',fixable:false});
    }

    for(let i=0;i<interactive.length&&i<100;i+=1){
      for(let j=i+1;j<interactive.length&&j<100;j+=1){
        const a=interactive[i],b=interactive[j];
        if(a.el.contains(b.el)||b.el.contains(a.el))continue;
        const iw=Math.max(0,Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left));
        const ih=Math.max(0,Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top));
        const area=iw*ih;
        const minArea=Math.min(a.rect.width*a.rect.height,b.rect.width*b.rect.height);
        if(area>0&&minArea>0&&area/minArea>.25){
          issues.push({severity:'warning',type:'overlap',selector:a.selector,message:'Chevauchement important avec '+b.selector+'.',fixable:false});
        }
      }
    }

    const seen=new Set();
    const deduped=issues.filter(function(issue){
      const key=issue.type+'|'+issue.selector+'|'+issue.message;
      if(seen.has(key))return false;seen.add(key);return true;
    });
    const order={error:0,warning:1,info:2};
    deduped.sort(function(a,b){return order[a.severity]-order[b.severity]});
    lastAuditIssues=deduped.slice(0,160);
    emit('audit',{issues:lastAuditIssues,summary:{
      errors:lastAuditIssues.filter(function(i){return i.severity==='error'}).length,
      warnings:lastAuditIssues.filter(function(i){return i.severity==='warning'}).length,
      info:lastAuditIssues.filter(function(i){return i.severity==='info'}).length,
      fixable:lastAuditIssues.filter(function(i){return i.fixable}).length,
      scannedNodes:nodes.length,
      totalNodes:scan.total,
      scanTruncated:scan.truncated,
      contrastTested:contrastStats.tested,
      contrastAaFailures:contrastStats.aaFailures,
      contrastAaaFailures:contrastStats.aaaFailures,
      contrastUncertain:contrastStats.uncertain
    }});
    makeRepairSuggestions();
  }


  function applyEnvironment(payload) {
    environment = {
      fontScale: Math.max(.75,Math.min(2,Number(payload.fontScale)||1)),
      displayScale: Math.max(.75,Math.min(1.6,Number(payload.displayScale)||1)),
      darkMode: !!payload.darkMode,
      keyboardHeight: Math.max(0,Math.min(innerHeight*.75,Number(payload.keyboardHeight)||0))
    };
    let style=document.getElementById('ve-environment-style');
    if(!style){style=document.createElement('style');style.id='ve-environment-style';document.head.appendChild(style);}
    style.textContent=
      'html{-webkit-text-size-adjust:'+Math.round(environment.fontScale*100)+'% !important;text-size-adjust:'+Math.round(environment.fontScale*100)+'% !important;color-scheme:'+(environment.darkMode?'dark':'light')+';}'+
      'body{zoom:'+environment.displayScale+';}'+
      (environment.keyboardHeight>0?'html,body{height:calc(100vh - '+environment.keyboardHeight+'px)!important;overflow:auto!important;}':'');
    document.documentElement.dataset.aisTheme=environment.darkMode?'dark':'light';

    let keyboard=document.getElementById('ve-keyboard-sim');
    if(environment.keyboardHeight>0){
      if(!keyboard){keyboard=document.createElement('div');keyboard.id='ve-keyboard-sim';keyboard.setAttribute('aria-hidden','true');document.documentElement.appendChild(keyboard)}
      keyboard.style.cssText='position:fixed!important;left:0!important;right:0!important;bottom:0!important;height:'+environment.keyboardHeight+'px!important;z-index:2147483000!important;background:linear-gradient(#d8d9df,#c7c8cf)!important;border-top:1px solid #aaa!important;pointer-events:none!important;';
      keyboard.innerHTML='<div style="height:34px;display:grid;place-items:center;color:#555;font:700 11px system-ui">Clavier Android simulé · '+Math.round(environment.keyboardHeight)+' px</div>';
    }else if(keyboard)keyboard.remove();

    reflowResponsive();
    emit('environment',{environment:Object.assign({},environment)});
  }


  function selectionPath(element) {
    const path = [];
    let node = element;
    let guard = 0;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && guard < 10) {
      if (!isEditorNode(node)) {
        path.unshift({
          selector: selectorFor(node),
          title: layerTitle(node),
          tag: node.tagName.toLowerCase()
        });
      }
      node = node.parentElement;
      guard += 1;
    }
    return path;
  }

  function selectedContrastPayload(element){
    if(!element||element.children.length!==0||!String(element.textContent||'').trim())return {available:false};
    const cs=getComputedStyle(element);
    const fg=parseRgb(cs.color),bgInfo=resolvedBackground(element);
    if(!fg||!bgInfo||!bgInfo.color)return {available:false};
    const threshold=wcagTextThreshold(parseFloat(cs.fontSize),cs.fontWeight);
    if(bgInfo.complex){
      return {
        available:true,uncertain:true,
        aaMinimum:threshold.aa,aaaMinimum:threshold.aaa,largeText:threshold.large,
        fontSize:parseFloat(cs.fontSize)||0,fontWeight:cs.fontWeight||''
      };
    }
    const bg=bgInfo.color;
    const effectiveFg=fg.a<1?compositeRgb(fg,bg):fg;
    const ratio=contrastRatio(effectiveFg,bg);
    return {
      available:true,uncertain:false,
      ratio:Math.round(ratio*100)/100,
      aaMinimum:threshold.aa,aaaMinimum:threshold.aaa,
      passesAA:ratio>=threshold.aa,
      passesAAA:ratio>=threshold.aaa,
      largeText:threshold.large,
      fontSize:parseFloat(cs.fontSize)||0,
      fontWeight:cs.fontWeight||''
    };
  }

  function rgbHex(rgb){
    function part(value){return Math.max(0,Math.min(255,Math.round(Number(value)||0))).toString(16).padStart(2,'0')}
    return '#'+part(rgb.r)+part(rgb.g)+part(rgb.b);
  }

  function mixedRgb(a,b,t){
    return {r:a.r+(b.r-a.r)*t,g:a.g+(b.g-a.g)*t,b:a.b+(b.b-a.b)*t,a:1};
  }

  function contrastColorProposal(element,level){
    if(!element||activeInteractiveState!=='normal')return {ok:false,error:'La correction automatique s’applique à l’état normal.'};
    if(element.children.length!==0||!String(element.textContent||'').trim())return {ok:false,error:'Sélectionne un élément de texte simple.'};
    const cs=getComputedStyle(element);
    const fg=parseRgb(cs.color),bgInfo=resolvedBackground(element);
    if(!fg||!bgInfo||!bgInfo.color)return {ok:false,error:'Couleurs impossibles à analyser.'};
    if(bgInfo.complex)return {ok:false,error:'Le fond contient une image ou un dégradé : correction automatique désactivée.'};
    const bg=bgInfo.color;
    const current=fg.a<1?compositeRgb(fg,bg):fg;
    const threshold=wcagTextThreshold(parseFloat(cs.fontSize),cs.fontWeight);
    const normalizedLevel=String(level||'AA').toUpperCase()==='AAA'?'AAA':'AA';
    const target=normalizedLevel==='AAA'?threshold.aaa:threshold.aa;
    const currentRatio=contrastRatio(current,bg);
    if(currentRatio>=target)return {ok:true,level:normalizedLevel,target:target,currentRatio:currentRatio,color:rgbHex(current),alreadyPasses:true};

    const ends=[{r:0,g:0,b:0,a:1},{r:255,g:255,b:255,a:1}];
    const candidates=[];
    ends.forEach(function(end){
      if(contrastRatio(end,bg)<target)return;
      let lo=0,hi=1;
      for(let i=0;i<28;i+=1){
        const mid=(lo+hi)/2;
        if(contrastRatio(mixedRgb(current,end,mid),bg)>=target)hi=mid;
        else lo=mid;
      }
      const candidate=mixedRgb(current,end,hi);
      const distance=Math.pow(candidate.r-current.r,2)+Math.pow(candidate.g-current.g,2)+Math.pow(candidate.b-current.b,2);
      candidates.push({color:rgbHex(candidate),ratio:contrastRatio(candidate,bg),distance:distance,mix:hi});
    });
    candidates.sort(function(a,b){return a.distance-b.distance||a.mix-b.mix});
    if(!candidates.length)return {ok:false,error:'Aucune correction de contraste sûre trouvée.'};
    return {ok:true,level:normalizedLevel,target:target,currentRatio:currentRatio,color:candidates[0].color,ratio:candidates[0].ratio,alreadyPasses:false};
  }

  function clearContrastPreview(){
    if(!contrastPreview)return;
    const item=contrastPreview;
    contrastPreview=null;
    if(item.element&&item.element.style){
      if(item.value)item.element.style.setProperty('color',item.value,item.priority||'');
      else item.element.style.removeProperty('color');
    }
    updateOverlay();
    emit('contrast-proposal',{active:false});
  }

  function previewContrastFix(level){
    if(!selected)return;
    clearContrastPreview();
    const proposal=contrastColorProposal(selected,level);
    if(!proposal.ok){emit('contrast-proposal',proposal);return}
    if(proposal.alreadyPasses){emit('contrast-proposal',Object.assign({active:false},proposal));return}
    contrastPreview={
      element:selected,
      value:selected.style.getPropertyValue('color'),
      priority:selected.style.getPropertyPriority('color'),
      proposal:proposal
    };
    selected.style.setProperty('color',proposal.color,'important');
    updateOverlay();
    emit('contrast-proposal',Object.assign({active:true},proposal));
  }

  function applyContrastFix(){
    if(!contrastPreview||!contrastPreview.element)return;
    const item=contrastPreview;
    const element=item.element,proposal=item.proposal;
    contrastPreview=null;
    if(item.value)element.style.setProperty('color',item.value,item.priority||'');
    else element.style.removeProperty('color');
    const state=remember(element);
    if(!state||state.locked)return;
    state.color=proposal.color;
    state.colorAdjusted=true;
    applyState(element,state,false);
    commitHistory();
    updateOverlay();
    emit('contrast-proposal',{active:false,applied:true,color:proposal.color,level:proposal.level,ratio:proposal.ratio,target:proposal.target});
  }

  function mediaAssetSummary(){
    const byPath=new Map();
    touched.forEach(function(state){
      if(!state||!state.mediaAdjusted||!state.mediaAssetPath)return;
      const key=String(state.mediaAssetPath);
      if(!byPath.has(key))byPath.set(key,{path:key,name:state.mediaName||'asset'});
    });
    return Array.from(byPath.values()).sort(function(a,b){return String(a.name).localeCompare(String(b.name))});
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
      selectionPath: selectionPath(selected),
      responsive: cloneResponsive(state.responsive),
      responsiveEffective: effectiveResponsive(state),
      activeBreakpoint: viewportBreakpoint(),
      editingBreakpoint: editingBreakpoint,
      parentLayout: parentLayoutPayload(selected),
      safeArea: Object.assign({}, safeArea),
      environment: Object.assign({}, environment),
      advancedStyles: Object.assign({}, state.advancedStyles || {}),
      advancedAdjusted: !!state.advancedAdjusted,
      mediaAdjusted: !!state.mediaAdjusted,
      mediaKind: state.mediaKind || mediaKindForElement(selected),
      mediaName: state.mediaName || '',
      mediaAssetPath: state.mediaAssetPath || '',
      mediaFit: state.mediaFit || 'contain',
      mediaPositionX: mediaPercent(state.mediaPositionX,50),
      mediaPositionY: mediaPercent(state.mediaPositionY,50),
      mediaAssets: mediaAssetSummary(),
      contrast: selectedContrastPayload(selected),
      svgEditable: mediaKindForElement(selected)==='svg'&&!state.mediaAdjusted,
      svgTintAdjusted: !!state.svgTintAdjusted,
      svgTintColor: state.svgTintColor || '#000000',
      svgTintMode: state.svgTintMode || 'both',
      boxModel: (function(){
        var cs=getComputedStyle(selected);
        return {
          margin:{top:parseFloat(cs.marginTop)||0,right:parseFloat(cs.marginRight)||0,bottom:parseFloat(cs.marginBottom)||0,left:parseFloat(cs.marginLeft)||0},
          padding:{top:parseFloat(cs.paddingTop)||0,right:parseFloat(cs.paddingRight)||0,bottom:parseFloat(cs.paddingBottom)||0,left:parseFloat(cs.paddingLeft)||0}
        };
      })(),
      animation: Object.assign({}, state.animation || {}),
      animationAdjusted: !!state.animationAdjusted,
      componentName: state.componentName || '',
      componentInstance: !!state.componentInstance,
      prototypeTarget: state.prototypeTarget || '',
      interactiveState: activeInteractiveState,
      stateStyles: JSON.parse(JSON.stringify(state.stateStyles || {hover:{},active:{},focus:{},disabled:{}})),
      activeStateStyle: Object.assign({}, (state.stateStyles&&state.stateStyles[activeInteractiveState]) || {}),
      tokens: Object.assign({}, designTokens),
      components: componentSummary(),
      css: cssText(),
      grid: grid
    };
  }

  function syncAnchorPins(cfg,count) {
    outline.classList.toggle('ve-single-selection',count===1);
    outline.querySelectorAll('.ve-anchor-pin').forEach(function(pin){
      const axis=pin.dataset.anchorAxis;
      const value=pin.dataset.anchorValue;
      const activeValue=axis==='h'?(cfg&&cfg.hAnchor):(cfg&&cfg.vAnchor);
      pin.classList.toggle('active',count===1&&activeValue===value);
      pin.setAttribute('aria-pressed',count===1&&activeValue===value?'true':'false');
    });
  }

  function hideConstraintLines(){
    constraintLines.forEach(function(line){line.style.display='none'});
  }

  function syncConstraintLines(element,cfg,count,rect){
    hideConstraintLines();
    if(count!==1||!element||!cfg||!cfg.enabled||!rect)return;
    const state=remember(element);
    if(!state)return;
    const bounds=responsiveBounds(element,state);
    const byKind={};
    constraintLines.forEach(function(line){byKind[line.dataset.kind]=line});

    function showH(kind,left,right,y){
      const line=byKind[kind];if(!line)return;
      line.style.display='block';
      line.style.left=Math.round(Math.min(left,right))+'px';
      line.style.top=Math.round(y)+'px';
      line.style.width=Math.max(0,Math.round(Math.abs(right-left)))+'px';
    }
    function showV(kind,top,bottom,x){
      const line=byKind[kind];if(!line)return;
      line.style.display='block';
      line.style.left=Math.round(x)+'px';
      line.style.top=Math.round(Math.min(top,bottom))+'px';
      line.style.height=Math.max(0,Math.round(Math.abs(bottom-top)))+'px';
    }

    const cy=rect.top+rect.height/2;
    const cx=rect.left+rect.width/2;
    if(cfg.hAnchor==='left'||cfg.hAnchor==='stretch')showH('left',bounds.left,rect.left,cy);
    if(cfg.hAnchor==='right'||cfg.hAnchor==='stretch')showH('right',rect.right,bounds.right,cy);
    if(cfg.vAnchor==='top'||cfg.vAnchor==='stretch')showV('top',bounds.top,rect.top,cx);
    if(cfg.vAnchor==='bottom'||cfg.vAnchor==='stretch')showV('bottom',rect.bottom,bounds.bottom,cx);
    if(cfg.hAnchor==='center'){
      const line=byKind['center-x'];line.style.display='block';
      line.style.left=Math.round(bounds.left+bounds.width/2)+'px';
      line.style.top=Math.round(bounds.top)+'px';
      line.style.height=Math.max(0,Math.round(bounds.height))+'px';
    }
    if(cfg.vAnchor==='center'){
      const line=byKind['center-y'];line.style.display='block';
      line.style.left=Math.round(bounds.left)+'px';
      line.style.top=Math.round(bounds.top+bounds.height/2)+'px';
      line.style.width=Math.max(0,Math.round(bounds.width))+'px';
    }
  }

  function hideBoxModelVisuals(){
    outline.classList.remove('ve-box-model-visible');
    boxMarginRing.style.display='none';
    boxPaddingRing.style.display='none';
  }

  function boxValues(element){
    if(!element)return null;
    const cs=getComputedStyle(element);
    return {
      margin:{top:parseFloat(cs.marginTop)||0,right:parseFloat(cs.marginRight)||0,bottom:parseFloat(cs.marginBottom)||0,left:parseFloat(cs.marginLeft)||0},
      padding:{top:parseFloat(cs.paddingTop)||0,right:parseFloat(cs.paddingRight)||0,bottom:parseFloat(cs.paddingBottom)||0,left:parseFloat(cs.paddingLeft)||0}
    };
  }

  function syncBoxModelVisuals(element,count,rect){
    if(!boxModelVisible||count!==1||!element||!rect){hideBoxModelVisuals();return}
    const values=boxValues(element);
    outline.classList.add('ve-box-model-visible');
    outline.querySelectorAll('.ve-box-handle').forEach(function(handle){
      const kind=handle.dataset.boxKind,side=handle.dataset.side;
      const value=Math.round(values[kind][side]*10)/10;
      handle.textContent=(kind==='margin'?'M ':'P ')+value;
      handle.title=(kind==='margin'?'Marge ':'Padding ')+side+' : '+value+' px · glisser pour modifier';
    });

    boxMarginRing.style.display='block';
    boxMarginRing.style.left=(rect.left-values.margin.left)+'px';
    boxMarginRing.style.top=(rect.top-values.margin.top)+'px';
    boxMarginRing.style.width=(rect.width+values.margin.left+values.margin.right)+'px';
    boxMarginRing.style.height=(rect.height+values.margin.top+values.margin.bottom)+'px';
    boxMarginRing.style.borderWidth=[
      Math.max(0,values.margin.top)+'px',Math.max(0,values.margin.right)+'px',
      Math.max(0,values.margin.bottom)+'px',Math.max(0,values.margin.left)+'px'
    ].join(' ');

    boxPaddingRing.style.display='block';
    boxPaddingRing.style.left=rect.left+'px';
    boxPaddingRing.style.top=rect.top+'px';
    boxPaddingRing.style.width=rect.width+'px';
    boxPaddingRing.style.height=rect.height+'px';
    boxPaddingRing.style.borderWidth=[
      Math.max(0,values.padding.top)+'px',Math.max(0,values.padding.right)+'px',
      Math.max(0,values.padding.bottom)+'px',Math.max(0,values.padding.left)+'px'
    ].join(' ');
  }

  function setBoxModel(payload){
    if(!active||!selected)return false;
    const kind=payload&&payload.kind==='margin'?'margin':'padding';
    const side=String(payload&&payload.side||'');
    if(['top','right','bottom','left'].indexOf(side)<0)return false;
    const value=Math.max(0,Number(payload&&payload.value)||0);
    const prop=kind+'-'+side;
    selectionElements().forEach(function(el){
      const st=remember(el);if(!st||st.locked)return;
      st.advancedAdjusted=true;st.advancedStyles=st.advancedStyles||{};
      st.advancedStyles[prop]=(Math.round(value*10)/10)+'px';
      applyState(el,st,false);
    });
    updateOverlay();
    if(payload.commit!==false)commitHistory();
    emit('box-model-changed',{kind:kind,side:side,value:value});
    return true;
  }

  function updateOverlay() {
    if (!active || !selected || !document.documentElement.contains(selected)) {
      outline.style.display = 'none';
      constraintBadge.style.display = 'none';
      altTargetOutline.style.display = 'none';
      altMeasureLabel.style.display = 'none';
      clearSecondaryOutlines();
      syncAnchorPins(null,0);
      hideConstraintLines();
      hideBoxModelVisuals();
      if(mediaFocalHandle)mediaFocalHandle.style.display='none';
      targetLabel.textContent = 'Clique un élément';
      metrics.textContent = 'X — · Y — · L — · H —';
      emit('state', currentPayload());
      return;
    }

    const state = remember(selected);
    if (!state || state.deleted) {
      outline.style.display = 'none';
      constraintBadge.style.display = 'none';
      if(mediaFocalHandle)mediaFocalHandle.style.display='none';
      emit('state', currentPayload());
      return;
    }

    const rect = selected.getBoundingClientRect();
    const count = selectionElements().length;
    const groupRect = count > 1 ? selectionBounds() : rect;
    const cfg = effectiveResponsive(state);
    syncAnchorPins(cfg,count);
    syncConstraintLines(selected,cfg,count,groupRect);
    syncBoxModelVisuals(selected,count,groupRect);
    constraintBadge.style.display = 'block';
    constraintBadge.style.left = Math.max(4, groupRect.left) + 'px';
    constraintBadge.style.top = Math.max(4, groupRect.top - 25) + 'px';
    const hIcon = cfg.hAnchor === 'left' ? '←' : cfg.hAnchor === 'right' ? '→' : cfg.hAnchor === 'center' ? '↔' : cfg.hAnchor === 'stretch' ? '⇆' : '·';
    const vIcon = cfg.vAnchor === 'top' ? '↑' : cfg.vAnchor === 'bottom' ? '↓' : cfg.vAnchor === 'center' ? '↕' : cfg.vAnchor === 'stretch' ? '⇅' : '·';
    constraintBadge.textContent = hIcon + ' ' + vIcon + ' · ' + viewportBreakpoint();
    outline.style.display = 'block';
    outline.style.left = groupRect.left + 'px';
    outline.style.top = groupRect.top + 'px';
    outline.style.width = groupRect.width + 'px';
    outline.style.height = groupRect.height + 'px';
    if(mediaFocalHandle){
      const showFocal=count===1&&!!state.mediaAdjusted&&!!state.mediaSource;
      mediaFocalHandle.style.display=showFocal?'flex':'none';
      if(showFocal){
        mediaFocalHandle.style.left=mediaPercent(state.mediaPositionX,50)+'%';
        mediaFocalHandle.style.top=mediaPercent(state.mediaPositionY,50)+'%';
      }
    }
    syncSecondaryOutlines();
    targetLabel.textContent = count > 1 ? (count + ' objets sélectionnés') : state.selector;
    metrics.textContent = 'X ' + Math.round(groupRect.left) + ' · Y ' + Math.round(groupRect.top) +
      ' · L ' + Math.round(groupRect.width) + ' · H ' + Math.round(groupRect.height) +
      (count > 1 ? ' · sélection multiple' : ' · texte ' + Math.round(state.fontSize * 10) / 10 + ' px');
    emit('state', currentPayload());
  }

  function setMarqueeMode(value) {
    marqueeMode = !!value;
    document.body.classList.toggle('ve-marquee-mode', marqueeMode);
    if (!marqueeMode && marqueeDrag) {
      marqueeDrag = null;
      marqueeBox.style.display = 'none';
    }
    emit('marquee-mode',{active:marqueeMode});
  }

  function marqueeRectFromPoints(x1,y1,x2,y2) {
    const left=Math.min(x1,x2), top=Math.min(y1,y2);
    const right=Math.max(x1,x2), bottom=Math.max(y1,y2);
    return {left:left,top:top,right:right,bottom:bottom,width:right-left,height:bottom-top};
  }

  function updateMarqueeBox(rect) {
    marqueeBox.style.display='block';
    marqueeBox.style.left=Math.round(rect.left)+'px';
    marqueeBox.style.top=Math.round(rect.top)+'px';
    marqueeBox.style.width=Math.round(rect.width)+'px';
    marqueeBox.style.height=Math.round(rect.height)+'px';
  }

  function marqueeCandidates(rect) {
    const raw=[];
    Array.from(document.body.querySelectorAll('*')).some(function(el){
      if(raw.length>=500)return true;
      if(isEditorNode(el)||/^SCRIPT|STYLE|LINK|META|NOSCRIPT$/i.test(el.tagName))return false;
      const cs=getComputedStyle(el);
      const r=el.getBoundingClientRect();
      if(cs.display==='none'||cs.visibility==='hidden'||r.width<2||r.height<2)return false;
      const cx=r.left+r.width/2, cy=r.top+r.height/2;
      if(cx<rect.left||cx>rect.right||cy<rect.top||cy>rect.bottom)return false;
      let target=el;
      const interactive=el.closest&&el.closest('button,a,input,select,textarea,[role="button"],svg');
      if(interactive&&document.body.contains(interactive))target=interactive;
      if(!raw.includes(target))raw.push(target);
      return false;
    });
    return raw.filter(function(el){
      return !raw.some(function(other){return other!==el&&el.contains(other)});
    }).slice(0,80);
  }

  function startMarquee(event) {
    marqueeDrag={
      pointerId:event.pointerId,
      startX:event.clientX,
      startY:event.clientY,
      additive:!!event.shiftKey
    };
    if(!marqueeDrag.additive){
      selectedSet.clear();
      selected=null;
      clearSecondaryOutlines();
      updateOverlay();
    }
    updateMarqueeBox(marqueeRectFromPoints(event.clientX,event.clientY,event.clientX,event.clientY));
  }

  function updateMarquee(event) {
    if(!marqueeDrag||event.pointerId!==marqueeDrag.pointerId)return false;
    updateMarqueeBox(marqueeRectFromPoints(marqueeDrag.startX,marqueeDrag.startY,event.clientX,event.clientY));
    return true;
  }

  function finishMarquee(event) {
    if(!marqueeDrag||event.pointerId!==marqueeDrag.pointerId)return false;
    const rect=marqueeRectFromPoints(marqueeDrag.startX,marqueeDrag.startY,event.clientX,event.clientY);
    const additive=marqueeDrag.additive;
    marqueeDrag=null;
    marqueeBox.style.display='none';
    if(rect.width<3&&rect.height<3){
      if(!additive){selectedSet.clear();selected=null;updateOverlay();emitLayers()}
      return true;
    }
    const items=marqueeCandidates(rect);
    if(!additive)selectedSet.clear();
    items.forEach(function(el){remember(el);selectedSet.add(el)});
    selected=items.length?items[items.length-1]:(selectedSet.values().next().value||null);
    updateOverlay();
    emitLayers();
    emit('marquee-selection',{count:selectedSet.size,selectors:selectionElements().map(selectorFor).filter(Boolean)});
    return true;
  }

  function select(element, additive) {
    if(contrastPreview&&contrastPreview.element!==element)clearContrastPreview();
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
    clearSpacingVisuals();
    if(isolationActive)refreshIsolation();
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

  function resizeSnapshots(items) {
    return items.map(function(element){
      const rect=element.getBoundingClientRect();
      return {element:element,rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};
    });
  }

  function scaleSelectionToRect(snapshots,startBounds,targetBounds) {
    if(!snapshots||!snapshots.length||!startBounds)return;
    const startW=Math.max(1,startBounds.width);
    const startH=Math.max(1,startBounds.height);
    const targetW=Math.max(1,targetBounds.width);
    const targetH=Math.max(1,targetBounds.height);
    const sx=targetW/startW;
    const sy=targetH/startH;

    snapshots.forEach(function(item){
      const element=item.element;
      const state=remember(element);
      if(!state||state.locked)return;
      const r=item.rect;
      const targetLeft=targetBounds.left+(r.left-startBounds.left)*sx;
      const targetTop=targetBounds.top+(r.top-startBounds.top)*sy;
      state.resized=true;
      state.width=Math.max(1,snapGrid(r.width*sx));
      state.height=Math.max(1,snapGrid(r.height*sy));
      if(state.responsive&&state.responsive.enabled){
        const cfg=editableResponsive(state,editingBreakpoint);
        cfg.widthMode='fixed';
        cfg.heightMode='fixed';
      }
      applyState(element,state,false);
      const current=element.getBoundingClientRect();
      moveResponsiveState(element,state,targetLeft-current.left,targetTop-current.top);
    });
  }

  function adjustSize(dw, dh, commit, proportional) {
    if (!active || !selected) return;
    const items=selectionElements();
    if(items.some(function(element){const st=remember(element);return !st||st.locked}))return;

    if(items.length>1){
      const bounds=selectionBounds();
      const snapshots=resizeSnapshots(items);
      let width=Math.max(1,bounds.width+dw);
      let height=Math.max(1,bounds.height+dh);
      if(proportional){
        const ratio=Math.max(.0001,bounds.width/Math.max(1,bounds.height));
        if(Math.abs(dw/Math.max(1,bounds.width))>=Math.abs(dh/Math.max(1,bounds.height)))height=width/ratio;
        else width=height*ratio;
      }
      scaleSelectionToRect(snapshots,bounds,{left:bounds.left,top:bounds.top,width:width,height:height,right:bounds.left+width,bottom:bounds.top+height});
      updateOverlay();
      if(commit!==false)commitHistory();
      return;
    }

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

  function finishInlineTextEdit(commit) {
    if(!inlineTextEdit)return false;
    const edit=inlineTextEdit;
    inlineTextEdit=null;
    const element=edit.element;
    if(commit){
      const state=remember(element);
      if(state&&state.textEditable&&!state.locked){
        state.textContent=String(element.textContent||'');
        state.textAdjusted=true;
        applyState(element,state,false);
        commitHistory();
        emit('inline-text-edit',{active:false,committed:true,text:state.textContent,selector:state.selector});
      }
    }else{
      element.textContent=edit.originalText;
      emit('inline-text-edit',{active:false,committed:false,selector:selectorFor(element)});
    }
    if(edit.hadContentEditable===null)element.removeAttribute('contenteditable');
    else element.setAttribute('contenteditable',edit.hadContentEditable);
    element.removeAttribute('data-ais-inline-editing');
    document.body.classList.remove('ve-inline-text-editing');
    updateOverlay();
    return true;
  }

  function beginInlineTextEdit(element) {
    if(!active||!element||isEditorNode(element))return false;
    if(inlineTextEdit&&inlineTextEdit.element===element)return true;
    if(inlineTextEdit)finishInlineTextEdit(true);
    const state=remember(element);
    if(!state||state.locked||!state.textEditable)return false;
    select(element,false);
    inlineTextEdit={
      element:element,
      originalText:String(element.textContent||''),
      hadContentEditable:element.getAttribute('contenteditable')
    };
    element.setAttribute('contenteditable','true');
    element.setAttribute('data-ais-inline-editing','1');
    document.body.classList.add('ve-inline-text-editing');
    element.focus({preventScroll:true});
    try{
      const range=document.createRange();
      range.selectNodeContents(element);
      const sel=window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }catch(_){}
    emit('inline-text-edit',{active:true,selector:state.selector,text:inlineTextEdit.originalText});
    return true;
  }

  function mediaPercent(value,fallback){
    const n=Number(value);
    return Math.max(0,Math.min(100,Number.isFinite(n)?n:(fallback===undefined?50:fallback)));
  }

  function rememberSvgTintStyle(node,prop){
    if(!node||!node.style)return;
    let record=svgTintOriginals.get(node);
    if(!record){record={};svgTintOriginals.set(node,record)}
    if(Object.prototype.hasOwnProperty.call(record,prop))return;
    record[prop]={value:node.style.getPropertyValue(prop),priority:node.style.getPropertyPriority(prop)};
  }

  function clearSvgTint(element){
    if(!element)return;
    [element].concat(Array.from(element.querySelectorAll?element.querySelectorAll('*'):[])).forEach(function(node){
      const record=svgTintOriginals.get(node);
      if(!record||!node.style)return;
      Object.keys(record).forEach(function(prop){
        const saved=record[prop]||{};
        if(saved.value)node.style.setProperty(prop,saved.value,saved.priority||'');
        else node.style.removeProperty(prop);
      });
      svgTintOriginals.delete(node);
    });
  }

  function svgPaintVisible(value){
    value=String(value||'').trim().toLowerCase();
    return value&&value!=='none'&&value!=='transparent'&&value!=='rgba(0, 0, 0, 0)'&&value!=='rgba(0,0,0,0)';
  }

  function applySvgTint(element,state){
    if(!element||String(element.tagName||'').toLowerCase()!=='svg')return;
    clearSvgTint(element);
    if(!state||!state.svgTintAdjusted)return;
    const color=String(state.svgTintColor||'#000000');
    const mode=['fill','stroke','both'].indexOf(state.svgTintMode)>=0?state.svgTintMode:'both';
    rememberSvgTintStyle(element,'color');
    element.style.setProperty('color',color,'important');
    const shapes=Array.from(element.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line,text'));
    shapes.forEach(function(node){
      const computed=getComputedStyle(node);
      if((mode==='fill'||mode==='both')&&svgPaintVisible(computed.fill)){
        rememberSvgTintStyle(node,'fill');
        node.style.setProperty('fill',color,'important');
      }
      if((mode==='stroke'||mode==='both')&&svgPaintVisible(computed.stroke)){
        rememberSvgTintStyle(node,'stroke');
        node.style.setProperty('stroke',color,'important');
      }
    });
  }

  function mediaKindForElement(element){
    const tag=String(element&&element.tagName||'').toLowerCase();
    if(tag==='img')return 'img';
    if(tag==='image')return 'svg-image';
    if(tag==='svg')return 'svg';
    return 'background';
  }

  function restoreMediaOriginal(element,state){
    if(!element||!state)return;
    const reg=registry.get(state.selector);
    if(!reg)return;
    const tag=String(element.tagName||'').toLowerCase();
    ['background-image','background-size','background-position','background-repeat','object-fit'].forEach(function(prop){restoreOriginalProp(state.selector,prop)});
    if(tag==='img'){
      if(reg.originalSrc!==null)element.setAttribute('src',reg.originalSrc);else element.removeAttribute('src');
    }else if(tag==='image'){
      if(reg.originalHref!==null){element.setAttribute('href',reg.originalHref);element.setAttributeNS('http://www.w3.org/1999/xlink','href',reg.originalHref);}
      else{element.removeAttribute('href');element.removeAttributeNS('http://www.w3.org/1999/xlink','href');}
    }else if(tag==='svg'&&reg.originalSvgMarkup!==null){
      element.innerHTML=reg.originalSvgMarkup;
      if(reg.originalSvgViewBox!==null)element.setAttribute('viewBox',reg.originalSvgViewBox);else element.removeAttribute('viewBox');
    }
  }

  function setMediaAsset(payload){
    if(!active||!selected||selectionElements().length!==1){emit('media-error',{message:'Sélectionne un seul objet.'});return}
    const source=String(payload&&payload.source||'');
    if(!source){emit('media-error',{message:'Image invalide.'});return}
    const state=remember(selected);
    if(!state||state.locked)return;
    state.mediaAdjusted=true;
    state.mediaKind=mediaKindForElement(selected);
    state.mediaSource=source;
    state.mediaAssetPath=String(payload&&payload.path||'');
    state.mediaName=String(payload&&payload.name||'image');
    state.mediaFit=['contain','cover','fill','none'].indexOf(String(payload&&payload.fit||''))>=0?String(payload.fit):state.mediaFit||'contain';
    state.mediaPositionX=mediaPercent(payload&&payload.positionX,50);
    state.mediaPositionY=mediaPercent(payload&&payload.positionY,50);
    applyState(selected,state,false);
    updateOverlay();
    commitHistory();
    emit('media-updated',{kind:state.mediaKind,name:state.mediaName,fit:state.mediaFit});
  }

  function setMediaFit(value){
    if(!active||!selected)return;
    const state=remember(selected);
    if(!state||!state.mediaAdjusted)return;
    const fit=['contain','cover','fill','none'].indexOf(String(value))>=0?String(value):'contain';
    state.mediaFit=fit;
    applyState(selected,state,false);
    updateOverlay();
    commitHistory();
    emit('media-updated',{kind:state.mediaKind,name:state.mediaName,fit:fit});
  }

  function setMediaPosition(payload){
    if(!active||!selected)return;
    const state=remember(selected);
    if(!state||!state.mediaAdjusted)return;
    if(payload&&payload.x!==undefined)state.mediaPositionX=mediaPercent(payload.x,0);
    if(payload&&payload.y!==undefined)state.mediaPositionY=mediaPercent(payload.y,0);
    applyState(selected,state,false);
    updateOverlay();
    commitHistory();
    emit('media-updated',{kind:state.mediaKind,name:state.mediaName,fit:state.mediaFit,positionX:state.mediaPositionX,positionY:state.mediaPositionY});
  }

  function setSvgTint(payload){
    if(!active||!selected||selectionElements().length!==1)return;
    const state=remember(selected);
    if(!state||state.locked||mediaKindForElement(selected)!=='svg'||state.mediaAdjusted){
      emit('svg-tint-error',{message:'Sélectionne un SVG inline non remplacé.'});return
    }
    const enabled=payload&&payload.enabled!==false;
    state.svgTintAdjusted=enabled;
    if(payload&&payload.color)state.svgTintColor=String(payload.color);
    if(payload&&['fill','stroke','both'].indexOf(payload.mode)>=0)state.svgTintMode=payload.mode;
    applyState(selected,state,false);
    updateOverlay();
    commitHistory();
    emit('svg-tint-updated',{enabled:state.svgTintAdjusted,color:state.svgTintColor,mode:state.svgTintMode});
  }

  function resetMediaAsset(){
    if(!active||!selected)return;
    const state=remember(selected);
    if(!state||!state.mediaAdjusted)return;
    restoreMediaOriginal(selected,state);
    state.mediaAdjusted=false;
    state.mediaKind='';
    state.mediaSource='';
    state.mediaAssetPath='';
    state.mediaName='';
    state.mediaFit='contain';
    state.mediaPositionX=50;
    state.mediaPositionY=50;
    applyState(selected,state,false);
    updateOverlay();
    commitHistory();
    emit('media-updated',{reset:true});
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

  function clearSpacingVisuals() {
    if(spacingVisualTimer){clearTimeout(spacingVisualTimer);spacingVisualTimer=null}
    spacingVisuals.forEach(function(item){item.line.style.display='none';item.label.style.display='none'});
  }

  function showSpacingVisuals(rect,spaces) {
    clearSpacingVisuals();
    function show(direction,gap){
      if(!gap||!Number.isFinite(Number(gap.gap)))return;
      const value=Math.max(0,Number(gap.gap)||0);
      const item=spacingVisuals.find(function(x){return x.direction===direction});
      if(!item)return;
      const line=item.line,label=item.label;
      line.style.display='block';label.style.display='block';label.textContent=Math.round(value)+' px';

      if(direction==='left'){
        line.style.left=Math.round(rect.left-value)+'px';
        line.style.top=Math.round(rect.top+rect.height/2)+'px';
        line.style.width=Math.round(value)+'px';
        label.style.left=Math.round(rect.left-value/2-14)+'px';
        label.style.top=Math.round(rect.top+rect.height/2-18)+'px';
      }
      if(direction==='right'){
        line.style.left=Math.round(rect.right)+'px';
        line.style.top=Math.round(rect.top+rect.height/2)+'px';
        line.style.width=Math.round(value)+'px';
        label.style.left=Math.round(rect.right+value/2-14)+'px';
        label.style.top=Math.round(rect.top+rect.height/2-18)+'px';
      }
      if(direction==='top'){
        line.style.left=Math.round(rect.left+rect.width/2)+'px';
        line.style.top=Math.round(rect.top-value)+'px';
        line.style.height=Math.round(value)+'px';
        label.style.left=Math.round(rect.left+rect.width/2+6)+'px';
        label.style.top=Math.round(rect.top-value/2-7)+'px';
      }
      if(direction==='bottom'){
        line.style.left=Math.round(rect.left+rect.width/2)+'px';
        line.style.top=Math.round(rect.bottom)+'px';
        line.style.height=Math.round(value)+'px';
        label.style.left=Math.round(rect.left+rect.width/2+6)+'px';
        label.style.top=Math.round(rect.bottom+value/2-7)+'px';
      }
    }
    show('left',spaces.left);
    show('right',spaces.right);
    show('top',spaces.top);
    show('bottom',spaces.bottom);
    spacingVisualTimer=setTimeout(clearSpacingVisuals,6500);
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

    showSpacingVisuals(rect,{left:left,right:right,top:top,bottom:bottom});
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
    if(activeInteractiveState!=='normal'&&['hover','active','focus','disabled'].indexOf(activeInteractiveState)>=0){
      state.stateStyles=state.stateStyles||{hover:{},active:{},focus:{},disabled:{}};
      const target=state.stateStyles[activeInteractiveState]||(state.stateStyles[activeInteractiveState]={});
      if(kind==='color')target.color=String(value||'');
      if(kind==='background')target.backgroundColor=String(value||'');
      if(kind==='border')target.borderColor=String(value||'');
      buildForcedStateStyle();
      updateOverlay();
      commitHistory();
      emit('state-style-updated',{state:activeInteractiveState,styles:Object.assign({},target)});
      return;
    }
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

  function setInteractiveStateStyle(payload){
    if(!active||!selected)return;
    const state=remember(selected);
    if(!state||state.locked)return;
    const name=String(payload&&payload.state||activeInteractiveState||'normal');
    if(name==='normal')return;
    if(['hover','active','focus','disabled'].indexOf(name)<0)return;
    state.stateStyles=state.stateStyles||{hover:{},active:{},focus:{},disabled:{}};
    const target=state.stateStyles[name]||(state.stateStyles[name]={});
    if(payload&&payload.opacity!==undefined)target.opacity=Math.max(0,Math.min(1,Number(payload.opacity)));
    if(payload&&payload.reset)state.stateStyles[name]={};
    buildForcedStateStyle();
    updateOverlay();
    commitHistory();
    emit('state-style-updated',{state:name,styles:Object.assign({},state.stateStyles[name]||{})});
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
    if(isolationActive){
      isolationActive=false;
      clearIsolation();
      emit('isolation',{active:false,count:0});
    }
    clearSecondaryOutlines();
    hideGuides();
    updateOverlay();
    commitHistory();
    emitLayers();
  }

  function exportProject() {
    return {
      format: 'app-layout-project',
      version: 7,
      exportedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight, safeArea: Object.assign({}, safeArea), breakpoint: viewportBreakpoint() },
      editingBreakpoint: editingBreakpoint,
      environment: Object.assign({}, environment),
      designTokens: Object.assign({}, designTokens),
      components: JSON.parse(JSON.stringify(components)),
      prototypeLinks: JSON.parse(JSON.stringify(prototypeLinks)),
      selectionGroups: JSON.parse(JSON.stringify(selectionGroups)),
      snapshot: snapshot(),
      css: cssText()
    };
  }

  function importProject(project) {
    if (!project || (project.format !== 'app-layout-project' && project.format !== 'radio-layout-project')) return false;
    if (project.viewport && project.viewport.safeArea) setSafeArea(project.viewport.safeArea);
    if (project.editingBreakpoint) setEditingBreakpoint(project.editingBreakpoint);
    if (project.environment) applyEnvironment(project.environment);
    if (project.designTokens) applyDesignTokens(project.designTokens);
    components = project.components ? JSON.parse(JSON.stringify(project.components)) : {};
    prototypeLinks = project.prototypeLinks ? JSON.parse(JSON.stringify(project.prototypeLinks)) : {};
    selectionGroups = project.selectionGroups ? JSON.parse(JSON.stringify(project.selectionGroups)) : {};
    emitComponents();
    emit('prototype',{links:Object.assign({},prototypeLinks)});
    emitSelectionGroups();
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
    marqueeDrag = null;
    canvasPan = null;
    spaceHeld = false;
    marqueeBox.style.display = 'none';
    document.body.classList.remove('ve-active','ve-space-pan','ve-canvas-panning');
    outline.style.display = 'none';
    constraintBadge.style.display = 'none';
    hideConstraintLines();
    hideBoxModelVisuals();
    if(inlineTextEdit)finishInlineTextEdit(true);
    clearAltMeasure();
    hideDragMeasure();
    clearSpacingVisuals();
    clearSecondaryOutlines();
    hideGuides();
    emit('state', currentPayload());
  }

  window.addEventListener('pointermove',function(event){
    if(!isEditorNode(event.target))lastPointerPoint={x:event.clientX,y:event.clientY};
  },true);

  function droppedImageFile(event){
    const files=event&&event.dataTransfer&&event.dataTransfer.files?Array.from(event.dataTransfer.files):[];
    return files.find(function(file){
      return file&&file.size>0&&file.size<=24*1024*1024&&(/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name||'')||String(file.type||'').indexOf('image/')===0);
    })||null;
  }

  window.addEventListener('dragover',function(event){
    if(!active)return;
    const file=droppedImageFile(event);
    if(!file)return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    document.body.classList.add('ve-media-drop-ready');
  },true);

  window.addEventListener('dragleave',function(event){
    if(!event.relatedTarget||event.relatedTarget===document.documentElement)document.body.classList.remove('ve-media-drop-ready');
  },true);

  window.addEventListener('drop',function(event){
    if(!active)return;
    const file=droppedImageFile(event);
    if(!file)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.body.classList.remove('ve-media-drop-ready');
    let target=document.elementFromPoint(event.clientX,event.clientY)||event.target;
    if(!target||isEditorNode(target))target=selected;
    if(target&&!isEditorNode(target))select(target,false);
    if(!selected){emit('media-error',{message:'Dépose l’image sur un élément de l’interface.'});return}
    const selector=selectorFor(selected);
    const reader=new FileReader();
    reader.onerror=function(){emit('media-error',{message:'Lecture du fichier déposé impossible.'})};
    reader.onload=function(){
      const dataUrl=String(reader.result||'');
      if(!dataUrl.startsWith('data:image/')){emit('media-error',{message:'Le fichier déposé n’est pas une image prise en charge.'});return}
      emit('media-drop',{selector:selector,name:file.name||'image',type:file.type||'',size:file.size||0,dataUrl:dataUrl});
    };
    reader.readAsDataURL(file);
  },true);

  window.addEventListener('dblclick',function(event){
    if(!active||isEditorNode(event.target))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginInlineTextEdit(event.target);
  },true);

  window.addEventListener('pointerdown', function (event) {
    if (!active || isEditorNode(event.target)) return;
    if(inlineTextEdit&&inlineTextEdit.element){
      if(event.target===inlineTextEdit.element||inlineTextEdit.element.contains(event.target))return;
      finishInlineTextEdit(true);
    }
    if(event.detail>=2){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(beginInlineTextEdit(event.target))return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (spaceHeld) {
      canvasPan={pointerId:event.pointerId,x:event.clientX,y:event.clientY};
      document.body.classList.add('ve-canvas-panning');
      emit('canvas-pan-start',{});
      return;
    }
    if (marqueeMode || event.ctrlKey || event.metaKey) {
      startMarquee(event);
      return;
    }
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
      lastDy: 0,
      axisLock: null,
      startSnapshot: snapshot(),
      startBounds: selectionElements().length>1 ? selectionBounds() : selected.getBoundingClientRect()
    };
    updateDragMeasure(event);
  }, true);

  window.addEventListener('pointermove', function (event) {
    if (!active) return;
    if (canvasPan && event.pointerId===canvasPan.pointerId) {
      event.preventDefault();
      const dx=event.clientX-canvasPan.x;
      const dy=event.clientY-canvasPan.y;
      canvasPan.x=event.clientX;
      canvasPan.y=event.clientY;
      emit('canvas-pan',{dx:dx,dy:dy});
      return;
    }
    if (updateMarquee(event)) { event.preventDefault(); return; }
    if (!drag || event.pointerId !== drag.pointerId || !selected) return;
    event.preventDefault();
    let rawDx = event.clientX - drag.x;
    let rawDy = event.clientY - drag.y;
    if(event.shiftKey){
      if(!drag.axisLock)drag.axisLock=Math.abs(rawDx)>=Math.abs(rawDy)?'x':'y';
      if(drag.axisLock==='x')rawDy=0;
      else rawDx=0;
    }else{
      drag.axisLock=null;
    }
    const totalDx = snapGrid(rawDx);
    const totalDy = snapGrid(rawDy);
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
    if (smartGuidesEnabled && !event.altKey) smartSnapSelection();
    else hideGuides();
    updateDragMeasure(event);
    updateOverlay();
  }, true);

  function clearAltMeasure() {
    altTargetOutline.style.display = 'none';
    altMeasureLabel.style.display = 'none';
  }

  function hideDragMeasure() {
    dragMeasureLabel.style.display='none';
  }

  function updateDragMeasure(event) {
    if(!drag||!selected)return hideDragMeasure();
    const r=selectionElements().length>1?selectionBounds():selected.getBoundingClientRect();
    const start=drag.startBounds||r;
    const dx=Math.round(r.left-start.left);
    const dy=Math.round(r.top-start.top);
    dragMeasureLabel.style.display='block';
    dragMeasureLabel.style.left=Math.min(innerWidth-235,Math.max(6,(event&&event.clientX||r.right)+12))+'px';
    dragMeasureLabel.style.top=Math.min(innerHeight-42,Math.max(6,(event&&event.clientY||r.bottom)+12))+'px';
    dragMeasureLabel.textContent='ΔX '+(dx>=0?'+':'')+dx+' · ΔY '+(dy>=0?'+':'')+dy+
      (drag.axisLock?' · axe '+drag.axisLock.toUpperCase():'')+
      ' · X '+Math.round(r.left)+' · Y '+Math.round(r.top)+' · '+Math.round(r.width)+'×'+Math.round(r.height);
    emit('drag-measure',{dx:dx,dy:dy,x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)});
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
    if (!active) return;
    if (canvasPan && event.pointerId===canvasPan.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      canvasPan=null;
      document.body.classList.remove('ve-canvas-panning');
      emit('canvas-pan-end',{});
      return;
    }
    if (finishMarquee(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = null;
    hideGuides();
    hideDragMeasure();
    updateOverlay();
    commitHistory();
  }, true);

  outline.querySelectorAll('.ve-box-handle').forEach(function(handle){
    handle.addEventListener('pointerdown',function(event){
      if(!active||!selected||selectionElements().length!==1)return;
      event.preventDefault();event.stopPropagation();
      const kind=handle.dataset.boxKind,side=handle.dataset.side;
      const values=boxValues(selected);
      boxDrag={
        pointerId:event.pointerId,
        kind:kind,
        side:side,
        startX:event.clientX,
        startY:event.clientY,
        startValue:values[kind][side],
        startSnapshot:snapshot()
      };
      handle.setPointerCapture&&handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',function(event){
      if(!boxDrag||event.pointerId!==boxDrag.pointerId)return;
      event.preventDefault();event.stopPropagation();
      const dx=event.clientX-boxDrag.startX,dy=event.clientY-boxDrag.startY;
      let delta=0;
      if(boxDrag.kind==='margin'){
        if(boxDrag.side==='left')delta=-dx;
        if(boxDrag.side==='right')delta=dx;
        if(boxDrag.side==='top')delta=-dy;
        if(boxDrag.side==='bottom')delta=dy;
      }else{
        if(boxDrag.side==='left')delta=dx;
        if(boxDrag.side==='right')delta=-dx;
        if(boxDrag.side==='top')delta=dy;
        if(boxDrag.side==='bottom')delta=-dy;
      }
      setBoxModel({kind:boxDrag.kind,side:boxDrag.side,value:Math.max(0,boxDrag.startValue+delta),commit:false});
    });
    handle.addEventListener('pointerup',function(event){
      if(!boxDrag||event.pointerId!==boxDrag.pointerId)return;
      event.preventDefault();event.stopPropagation();
      boxDrag=null;
      commitHistory();
      updateOverlay();
    });
  });

  outline.querySelectorAll('.ve-anchor-pin').forEach(function(pin){
    pin.addEventListener('pointerdown',function(event){
      event.preventDefault();
      event.stopPropagation();
    });
    pin.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      if(!active||!selected||selectionElements().length!==1)return;
      const axis=pin.dataset.anchorAxis;
      const value=pin.dataset.anchorValue;
      const payload={enabled:true,breakpoint:editingBreakpoint};
      if(axis==='h')payload.hAnchor=value;
      else payload.vAnchor=value;
      setResponsiveConfig(payload);
      emit('constraint-direct',{axis:axis,value:value,breakpoint:editingBreakpoint});
    });
  });

  if(mediaFocalHandle){
    mediaFocalHandle.addEventListener('pointerdown',function(event){
      if(!active||!selected||selectionElements().length!==1)return;
      const state=remember(selected);
      if(!state||state.locked||!state.mediaAdjusted)return;
      event.preventDefault();
      event.stopPropagation();
      mediaFocalDrag={pointerId:event.pointerId,startSnapshot:snapshot()};
      mediaFocalHandle.setPointerCapture&&mediaFocalHandle.setPointerCapture(event.pointerId);
    });
    mediaFocalHandle.addEventListener('pointermove',function(event){
      if(!mediaFocalDrag||event.pointerId!==mediaFocalDrag.pointerId||!selected)return;
      event.preventDefault();
      event.stopPropagation();
      const state=remember(selected);
      if(!state||state.locked||!state.mediaAdjusted)return;
      const rect=outline.getBoundingClientRect();
      if(rect.width<1||rect.height<1)return;
      state.mediaPositionX=mediaPercent((event.clientX-rect.left)/rect.width*100,50);
      state.mediaPositionY=mediaPercent((event.clientY-rect.top)/rect.height*100,50);
      applyState(selected,state,false);
      updateOverlay();
      emit('media-updated',{kind:state.mediaKind,name:state.mediaName,fit:state.mediaFit,positionX:state.mediaPositionX,positionY:state.mediaPositionY,positionOnly:true});
    });
    mediaFocalHandle.addEventListener('pointerup',function(event){
      if(!mediaFocalDrag||event.pointerId!==mediaFocalDrag.pointerId)return;
      event.preventDefault();
      event.stopPropagation();
      mediaFocalDrag=null;
      commitHistory();
    });
    mediaFocalHandle.addEventListener('pointercancel',function(event){
      if(!mediaFocalDrag||event.pointerId!==mediaFocalDrag.pointerId)return;
      event.stopPropagation();
      const snap=mediaFocalDrag.startSnapshot;
      mediaFocalDrag=null;
      if(snap)loadSnapshot(snap);
    });
  }

  outline.querySelectorAll('.ve-handle').forEach(function (handle) {
    handle.addEventListener('pointerdown', function (event) {
      if (!active || !selected) return;
      event.preventDefault();
      event.stopPropagation();
      const items=selectionElements();
      if(!items.length)return;
      const locked=items.some(function(element){const state=remember(element);return !state||state.locked});
      if(locked)return;
      const bounds=items.length>1?selectionBounds():selected.getBoundingClientRect();
      resizeDrag = {
        pointerId: event.pointerId,
        handle: handle.dataset.handle,
        startX: event.clientX,
        startY: event.clientY,
        startSnapshot: snapshot(),
        startBounds: {
          left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom,
          width:bounds.width,height:bounds.height
        },
        snapshots: resizeSnapshots(items),
        preserveRatio: items.length===1 && Math.abs(bounds.width-bounds.height)<=Math.max(4,Math.min(bounds.width,bounds.height)*0.12)
      };
      handle.setPointerCapture && handle.setPointerCapture(event.pointerId);
      clearSpacingVisuals();
    });

    handle.addEventListener('pointermove', function (event) {
      if (!resizeDrag || event.pointerId !== resizeDrag.pointerId || !selected) return;
      event.preventDefault();
      const h=resizeDrag.handle;
      const start=resizeDrag.startBounds;
      const dx=event.clientX-resizeDrag.startX;
      const dy=event.clientY-resizeDrag.startY;
      let left=start.left,right=start.right,top=start.top,bottom=start.bottom;

      const fromCenter=!!event.altKey;
      if(h.indexOf('w')>=0){
        left=start.left+dx;
        if(fromCenter)right=start.right-dx;
      }
      if(h.indexOf('e')>=0){
        right=start.right+dx;
        if(fromCenter)left=start.left-dx;
      }
      if(h.indexOf('n')>=0){
        top=start.top+dy;
        if(fromCenter)bottom=start.bottom-dy;
      }
      if(h.indexOf('s')>=0){
        bottom=start.bottom+dy;
        if(fromCenter)top=start.top-dy;
      }

      if(right-left<1){
        if(fromCenter){
          const cx=start.left+start.width/2;left=cx-.5;right=cx+.5;
        }else if(h.indexOf('w')>=0)left=right-1;
        else right=left+1;
      }
      if(bottom-top<1){
        if(fromCenter){
          const cy=start.top+start.height/2;top=cy-.5;bottom=cy+.5;
        }else if(h.indexOf('n')>=0)top=bottom-1;
        else bottom=top+1;
      }

      let width=right-left;
      let height=bottom-top;
      if(event.shiftKey||resizeDrag.preserveRatio){
        const ratio=Math.max(.0001,start.width/Math.max(1,start.height));
        const relW=Math.abs(width-start.width)/Math.max(1,start.width);
        const relH=Math.abs(height-start.height)/Math.max(1,start.height);
        if(relW>=relH)height=width/ratio;
        else width=height*ratio;
        if(fromCenter){
          const cx=start.left+start.width/2;
          const cy=start.top+start.height/2;
          left=cx-width/2;right=cx+width/2;
          top=cy-height/2;bottom=cy+height/2;
        }else{
          left=h.indexOf('w')>=0?start.right-width:start.left;
          top=h.indexOf('n')>=0?start.bottom-height:start.top;
          right=left+width;
          bottom=top+height;
        }
      }

      const target={left:left,top:top,right:right,bottom:bottom,width:width,height:height};
      scaleSelectionToRect(resizeDrag.snapshots,start,target);
      updateOverlay();

      dragMeasureLabel.style.display='block';
      dragMeasureLabel.style.left=Math.min(innerWidth-170,Math.max(6,event.clientX+12))+'px';
      dragMeasureLabel.style.top=Math.min(innerHeight-42,Math.max(6,event.clientY+12))+'px';
      dragMeasureLabel.textContent='L '+Math.round(width)+' · H '+Math.round(height)+' · '+Math.round(width/Math.max(1,start.width)*100)+' %'+(fromCenter?' · centre':'');
      emit('resize-measure',{width:Math.round(width),height:Math.round(height),scaleX:width/Math.max(1,start.width),scaleY:height/Math.max(1,start.height),count:resizeDrag.snapshots.length,fromCenter:fromCenter});
    });

    handle.addEventListener('pointerup', function (event) {
      if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
      event.preventDefault();
      resizeDrag = null;
      hideDragMeasure();
      updateOverlay();
      commitHistory();
    });
  });

  window.addEventListener('click', function(event){
    if(active||isEditorNode(event.target))return;
    const source=event.target&&event.target.closest?event.target.closest('*'):event.target;
    if(source&&runPrototypeTarget(source)){event.preventDefault();event.stopImmediatePropagation()}
  },true);

  window.addEventListener('click', function (event) {
    if (!active || isEditorNode(event.target)) return;
    if(inlineTextEdit&&inlineTextEdit.element&&(event.target===inlineTextEdit.element||inlineTextEdit.element.contains(event.target)))return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function cancelActiveInteraction() {
    const kind=drag?'move':(resizeDrag?'resize':'');
    const snap=drag&&drag.startSnapshot?drag.startSnapshot:(resizeDrag&&resizeDrag.startSnapshot?resizeDrag.startSnapshot:null);
    if(!snap)return false;
    drag=null;
    resizeDrag=null;
    hideGuides();
    hideDragMeasure();
    clearSpacingVisuals();
    loadSnapshot(snap);
    emit('interaction-cancelled',{kind:kind});
    return true;
  }

  function handleKeyboard(event) {
    if (!active) return false;

    const key = event.key;
    if(inlineTextEdit){
      if(key==='Escape'){
        event.preventDefault();
        finishInlineTextEdit(false);
        return true;
      }
      if(key==='Enter'&&!event.shiftKey){
        event.preventDefault();
        finishInlineTextEdit(true);
        return true;
      }
      if(key==='Tab'){
        finishInlineTextEdit(true);
        return false;
      }
      return false;
    }
    const modifier = event.ctrlKey || event.metaKey;

    if (key === ' ' && !modifier && !event.altKey) {
      event.preventDefault();
      spaceHeld = true;
      document.body.classList.add('ve-space-pan');
      emit('canvas-pan-ready',{active:true});
      return true;
    }

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
    if (modifier && key.toLowerCase() === 'a') {
      event.preventDefault();
      selectRelated(event.shiftKey?'similar':'siblings');
      return true;
    }
    if (modifier && key === ']') {
      event.preventDefault();
      setSelectionZ('front');
      return true;
    }
    if (modifier && key === '[') {
      event.preventDefault();
      setSelectionZ('back');
      return true;
    }
    if (modifier && event.altKey && key.toLowerCase() === 'c' && selected) {
      event.preventDefault();
      copySelectionStyle();
      return true;
    }
    if (modifier && event.altKey && key.toLowerCase() === 'v' && styleClipboard) {
      event.preventDefault();
      pasteSelectionStyle();
      return true;
    }
    if (modifier && key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelection();
      return true;
    }
    if (modifier && key.toLowerCase() === 'c' && selected) {
      event.preventDefault();
      copySelection();
      return true;
    }
    if (modifier && key.toLowerCase() === 'v' && clipboardNodes.length) {
      event.preventDefault();
      pasteSelection();
      return true;
    }
    if (key === 'Escape' && cancelActiveInteraction()) {
      event.preventDefault();
      return true;
    }
    if (key === 'Escape' && (marqueeMode || marqueeDrag)) {
      event.preventDefault();
      marqueeDrag = null;
      marqueeBox.style.display = 'none';
      setMarqueeMode(false);
      return true;
    }
    if ((key === 'Delete' || key === 'Backspace') && selected) {
      event.preventDefault();
      deleteSelected();
      return true;
    }
    if (key === 'Tab') {
      event.preventDefault();
      cycleOverlapSelection(event.shiftKey?-1:1);
      return true;
    }
    if (!selected || !key.startsWith('Arrow')) return false;

    if (event.altKey) {
      event.preventDefault();
      if (key === 'ArrowUp') navigateSelection('parent');
      if (key === 'ArrowDown') navigateSelection('child');
      if (key === 'ArrowLeft') navigateSelection('prev');
      if (key === 'ArrowRight') navigateSelection('next');
      return true;
    }

    event.preventDefault();
    const moveStep = Math.max(1,Number(nudgeStep)||1) * (modifier ? 10 : 1);
    if (event.shiftKey) {
      if (key === 'ArrowLeft') adjustSize(-moveStep, 0, false);
      if (key === 'ArrowRight') adjustSize(moveStep, 0, false);
      if (key === 'ArrowUp') adjustSize(0, -moveStep, false);
      if (key === 'ArrowDown') adjustSize(0, moveStep, false);
    } else {
      if (key === 'ArrowLeft') adjustMove(-moveStep, 0, false);
      if (key === 'ArrowRight') adjustMove(moveStep, 0, false);
      if (key === 'ArrowUp') adjustMove(0, -moveStep, false);
      if (key === 'ArrowDown') adjustMove(0, moveStep, false);
    }
    queueKeyboardCommit();
    return true;
  }

  window.addEventListener('keydown', function (event) {
    if (handleKeyboard(event)) event.stopImmediatePropagation();
  }, true);

  window.addEventListener('keyup', function (event) {
    if (!active) return;
    if (event.key === ' ') {
      spaceHeld=false;
      canvasPan=null;
      document.body.classList.remove('ve-space-pan','ve-canvas-panning');
      emit('canvas-pan-ready',{active:false});
      emit('canvas-pan-end',{});
      return;
    }
    if (!event.key.startsWith('Arrow')) return;
    flushKeyboardCommit();
  }, true);

  window.addEventListener('wheel', function(event){
    if(!active || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    emit('canvas-zoom',{delta:event.deltaY<0?0.1:-0.1});
  }, {capture:true,passive:false});

  window.addEventListener('resize', function () {
    if (responsiveResizeTimer) clearTimeout(responsiveResizeTimer);
    responsiveResizeTimer = setTimeout(function () {
      responsiveResizeTimer = null;
      reflowResponsive();
      if(layoutDiagnostics.length)analyzeLayoutDiagnostics('screen');
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
    if (data.type === 'interaction-cancel') cancelActiveInteraction();
    if (data.type === 'keyboard-commit') flushKeyboardCommit();
    if (data.type === 'responsive-set') setResponsiveConfig(payload);
    if (data.type === 'breakpoint-edit') setEditingBreakpoint(payload.breakpoint);
    if (data.type === 'responsive-capture') captureResponsiveRules();
    if (data.type === 'safe-area') setSafeArea(payload);
    if (data.type === 'preferences') {
      if (payload.defaultResponsive !== undefined) defaultResponsive = !!payload.defaultResponsive;
      if (payload.smartGuides !== undefined) smartGuidesEnabled = !!payload.smartGuides;
      if (payload.guideThreshold !== undefined) guideThreshold = Math.max(1, Math.min(20, Number(payload.guideThreshold) || 5));
      if (payload.nudgeStep !== undefined) nudgeStep = Math.max(1, Math.min(50, Number(payload.nudgeStep) || 1));
      if (!smartGuidesEnabled) hideGuides();
    }
    if (data.type === 'custom-guides') {
      customGuides={
        x:Array.isArray(payload.x)?payload.x.map(Number).filter(Number.isFinite):[],
        y:Array.isArray(payload.y)?payload.y.map(Number).filter(Number.isFinite):[]
      };
      emit('custom-guides',{x:customGuides.x.slice(),y:customGuides.y.slice()});
    }
    if (data.type === 'layout-guides') {
      layoutGuidesX=(Array.isArray(payload.x)?payload.x:[]).map(function(item){
        if(typeof item==='number')return {value:item,label:'Grille de colonnes'};
        return {value:Number(item&&item.value),label:String(item&&item.label||'Grille de colonnes')};
      }).filter(function(item){return Number.isFinite(item.value)});
      emit('layout-guides',{count:layoutGuidesX.length});
    }
    if (data.type === 'font-size') adjustFont(Number(payload.delta) || 0);
    if (data.type === 'set-size') setExactSize(payload.width, payload.height, !!payload.keepRatio);
    if (data.type === 'set-position') setExactPosition(payload.x, payload.y);
    if (data.type === 'align') alignSelected(String(payload.mode || ''));
    if (data.type === 'text-style') setTextProperty(String(payload.kind || ''), payload.value);
    if (data.type === 'text-content') setTextContent(payload.value);
    if (data.type === 'media-set') setMediaAsset(payload);
    if (data.type === 'media-fit') setMediaFit(payload.value);
    if (data.type === 'media-position') setMediaPosition(payload);
    if (data.type === 'media-reset') resetMediaAsset();
    if (data.type === 'svg-tint') setSvgTint(payload);
    if (data.type === 'inline-text-edit') {
      if(payload.active===false)finishInlineTextEdit(payload.commit!==false);
      else if(selected)beginInlineTextEdit(selected);
    }
    if (data.type === 'lock') toggleLock(payload.value);
    if (data.type === 'measure-spacing') measureSpacing();
    if (data.type === 'get-layers') emitLayers();
    if (data.type === 'select-selector') selectBySelector(payload.selector, !!payload.additive);
    if (data.type === 'navigate-selection') navigateSelection(String(payload.direction || ''));
    if (data.type === 'cycle-selection') cycleOverlapSelection(payload.direction);
    if (data.type === 'selection-copy') copySelection();
    if (data.type === 'style-copy') copySelectionStyle();
    if (data.type === 'style-paste') pasteSelectionStyle();
    if (data.type === 'selection-related') selectRelated(String(payload.mode||'siblings'));
    if (data.type === 'layers-bulk') bulkLayerAction(String(payload.action||''));
    if (data.type === 'selection-paste') pasteSelection();
    if (data.type === 'selection-duplicate') duplicateSelection();
    if (data.type === 'selection-z') setSelectionZ(String(payload.mode || 'front'));
    if (data.type === 'marquee-mode') setMarqueeMode(!!payload.active);
    if (data.type === 'layer-lock') setLayerLock(payload.selector, payload.value);
    if (data.type === 'layer-hidden') setLayerHidden(payload.selector, payload.value);
    if (data.type === 'parent-layout') setParentLayout(payload);
    if (data.type === 'auto-layout') inferAutoLayout(!!payload.apply);
    if (data.type === 'smart-constraints') inferSmartConstraints(!!payload.apply);
    if (data.type === 'advanced-style') setAdvancedStyles(payload.styles || {});
    if (data.type === 'box-model') setBoxModel(payload);
    if (data.type === 'box-model-visible') { boxModelVisible=payload.active!==false; updateOverlay(); }
    if (data.type === 'design-consistency') analyzeDesignConsistency();
    if (data.type === 'layout-diagnostic') analyzeLayoutDiagnostics(payload.scope||'screen');
    if (data.type === 'layout-diagnostic-clear') clearLayoutDiagnostics();
    if (data.type === 'layout-diagnostic-apply') applyLayoutDiagnostic(payload.id);
    if (data.type === 'layout-diagnostic-apply-all') applyAllLayoutDiagnostics();
    if (data.type === 'repair-suggest') makeRepairSuggestions();
    if (data.type === 'repair-preview') previewRepair(payload.id);
    if (data.type === 'repair-preview-clear') clearRepairPreview();
    if (data.type === 'repair-apply') applyRepair(payload.id);
    if (data.type === 'distribute') distributeSelection(String(payload.mode || ''), payload.gap);
    if (data.type === 'audit') auditInterface();
    if (data.type === 'audit-fix') autoFixAudit();
    if (data.type === 'environment-set') applyEnvironment(payload);
    if (data.type === 'tokens-set') applyDesignTokens(payload);
    if (data.type === 'token-apply') applyTokenToSelection(String(payload.kind||''));
    if (data.type === 'animation-set') setAnimation(payload);
    if (data.type === 'interactive-state') setInteractiveState(payload.state);
    if (data.type === 'interactive-state-style') setInteractiveStateStyle(payload);
    if (data.type === 'contrast-preview') previewContrastFix(payload.level);
    if (data.type === 'contrast-preview-clear') clearContrastPreview();
    if (data.type === 'contrast-fix-apply') applyContrastFix();
    if (data.type === 'stress-test') stressTest(payload.mode);
    if (data.type === 'component-create') createComponent(payload.name);
    if (data.type === 'component-link') linkComponentInstance(payload.name);
    if (data.type === 'component-update') updateComponentFromSelection(payload.name);
    if (data.type === 'component-delete') deleteComponent(payload.name);
    if (data.type === 'component-variant-save') saveComponentVariant(payload.name,payload.variant);
    if (data.type === 'component-variant-apply') applyComponentVariant(payload.name,payload.variant,!!payload.allInstances);
    if (data.type === 'get-components') emitComponents();
    if (data.type === 'test-components') testComponentIntegrity();
    if (data.type === 'get-css-cascade') inspectCssCascade();
    if (data.type === 'get-selection-groups') emitSelectionGroups();
    if (data.type === 'selection-group-create') createSelectionGroup(payload.name);
    if (data.type === 'selection-group-select') selectSelectionGroup(payload.name);
    if (data.type === 'selection-group-delete') deleteSelectionGroup(payload.name);
    if (data.type === 'isolate-selection') isolateSelection(payload.active);
    if (data.type === 'prototype-set') setPrototypeLink(payload);
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
    setMediaPosition: setMediaPosition,
    setSvgTint: setSvgTint,
    toggleLock: toggleLock,
    measureSpacing: measureSpacing,
    emitLayers: emitLayers,
    navigateSelection: navigateSelection,
    cycleOverlapSelection: cycleOverlapSelection,
    cancelActiveInteraction: cancelActiveInteraction,
    setResponsiveConfig: setResponsiveConfig,
    setBoxModel: setBoxModel,
    beginInlineTextEdit: beginInlineTextEdit,
    finishInlineTextEdit: finishInlineTextEdit,
    copySelection: copySelection,
    copySelectionStyle: copySelectionStyle,
    pasteSelectionStyle: pasteSelectionStyle,
    selectRelated: selectRelated,
    bulkLayerAction: bulkLayerAction,
    pasteSelection: pasteSelection,
    duplicateSelection: duplicateSelection,
    setSelectionZ: setSelectionZ,
    smartSnapSelection: smartSnapSelection,
    setMarqueeMode: setMarqueeMode,
    setCustomGuides: function(value){
      value=value||{};
      customGuides={x:Array.isArray(value.x)?value.x.slice():[],y:Array.isArray(value.y)?value.y.slice():[]};
    },
    setParentLayout: setParentLayout,
    inferAutoLayout: inferAutoLayout,
    inferSmartConstraints: inferSmartConstraints,
    setAdvancedStyles: setAdvancedStyles,
    analyzeDesignConsistency: analyzeDesignConsistency,
    makeRepairSuggestions: makeRepairSuggestions,
    previewRepair: previewRepair,
    clearRepairPreview: clearRepairPreview,
    applyRepair: applyRepair,
    distributeSelection: distributeSelection,
    auditInterface: auditInterface,
    autoFixAudit: autoFixAudit,
    applyEnvironment: applyEnvironment,
    applyDesignTokens: applyDesignTokens,
    applyTokenToSelection: applyTokenToSelection,
    setAnimation: setAnimation,
    setInteractiveState: setInteractiveState,
    setInteractiveStateStyle: setInteractiveStateStyle,
    previewContrastFix: previewContrastFix,
    clearContrastPreview: clearContrastPreview,
    applyContrastFix: applyContrastFix,
    stressTest: stressTest,
    createComponent: createComponent,
    linkComponentInstance: linkComponentInstance,
    updateComponentFromSelection: updateComponentFromSelection,
    saveComponentVariant: saveComponentVariant,
    applyComponentVariant: applyComponentVariant,
    createSelectionGroup: createSelectionGroup,
    selectSelectionGroup: selectSelectionGroup,
    deleteSelectionGroup: deleteSelectionGroup,
    isolateSelection: isolateSelection,
    setPrototypeLink: setPrototypeLink,
    setVisualStyle: setVisualStyle,
    adjustZ: adjustZ,
    setZ: setZ,
    state: currentPayload
  };

  applyDesignTokens(designTokens);
  buildForcedStateStyle();
  emit('ready', { hosted: hosted });
  if (hosted) setTimeout(enable, 80);
})();