/* ---------- Figma-style select handles ---------- */

const handlePositions = ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br'];

document.querySelectorAll('.hover-select').forEach((el) => {
  handlePositions.forEach((pos) => {
    const handle = document.createElement('span');
    handle.className = `handle handle-${pos}`;
    el.appendChild(handle);
  });

  const badge = document.createElement('span');
  badge.className = 'size-badge';
  el.appendChild(badge);
});

/* Shows each selectable box's real authored size (unaffected by canvas zoom,
   since offsetWidth/Height are measured before the canvas's own transform is
   applied) — same idea as Figma's dimension label on a selected frame. */
function updateSizeBadges() {
  document.querySelectorAll('.hover-select').forEach((el) => {
    const badge = el.querySelector(':scope > .size-badge');
    if (badge) badge.textContent = `${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}`;
  });
}

/* ---------- Canvas state ---------- */

const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const canvasGrid = document.getElementById('canvas-grid');
const zoomIndicator = document.getElementById('zoom-indicator');
const frames = [...document.querySelectorAll('.frame')];

const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const GAP = 100;
const GRID_SIZE = 32;

const view = { x: 0, y: 0, scale: 1 };
let topZ = 1;

/* Keeps the canvas from being panned into an empty void — at least a strip
   of content stays visible on every edge no matter how far you pan. */
const PAN_MARGIN = 120;

function getContentBounds() {
  return frames.reduce(
    (acc, frame) => {
      const left = parseFloat(frame.style.left) || 0;
      const top = parseFloat(frame.style.top) || 0;
      return {
        minX: Math.min(acc.minX, left),
        minY: Math.min(acc.minY, top),
        maxX: Math.max(acc.maxX, left + frame.offsetWidth),
        maxY: Math.max(acc.maxY, top + frame.offsetHeight),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function clampPan() {
  const bounds = getContentBounds();
  if (!isFinite(bounds.minX)) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const contentLeft = view.x + bounds.minX * view.scale;
  const contentRight = view.x + bounds.maxX * view.scale;
  const contentTop = view.y + bounds.minY * view.scale;
  const contentBottom = view.y + bounds.maxY * view.scale;

  if (contentRight < PAN_MARGIN) view.x += PAN_MARGIN - contentRight;
  if (contentLeft > vw - PAN_MARGIN) view.x -= contentLeft - (vw - PAN_MARGIN);
  if (contentBottom < PAN_MARGIN) view.y += PAN_MARGIN - contentBottom;
  if (contentTop > vh - PAN_MARGIN) view.y -= contentTop - (vh - PAN_MARGIN);
}

function applyTransform() {
  clampPan();
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  zoomIndicator.textContent = `${Math.round(view.scale * 100)}%`;
  document.documentElement.style.setProperty('--zoom-scale', view.scale);
  updateCursorScreenPos();
  drawRulers();
}

function zoomAt(clientX, clientY, nextScale) {
  nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  const ratio = nextScale / view.scale;
  view.x = clientX - (clientX - view.x) * ratio;
  view.y = clientY - (clientY - view.y) * ratio;
  view.scale = nextScale;
  applyTransform();
}

/* ---------- Rulers ---------- */

const rulerH = document.getElementById('ruler-h');
const rulerV = document.getElementById('ruler-v');
const RULER_SIZE = 24;

// Picks a "nice" spacing (1/2/5 × a power of ten) for the labeled ticks,
// same idea Figma/design tools use so labels never crowd at any zoom level.
function niceStep(rawStep) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step;
  if (normalized < 2) step = 1;
  else if (normalized < 5) step = 2;
  else step = 5;
  return step * magnitude;
}

function drawRulerAxis(ctx, canvasEl, isHorizontal, viewOffset, length, tickColor, textColor, fontFamily) {
  const dpr = window.devicePixelRatio || 1;
  const w = isHorizontal ? length : RULER_SIZE;
  const h = isHorizontal ? RULER_SIZE : length;

  if (canvasEl.width !== Math.round(w * dpr) || canvasEl.height !== Math.round(h * dpr)) {
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    canvasEl.style.width = `${w}px`;
    canvasEl.style.height = `${h}px`;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = textColor;
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 1;

  // Aim for roughly 80 screen px between labeled ticks, in canvas units.
  const step = niceStep(80 / view.scale);
  const minorStep = step / 5;

  const canvasStart = (0 - viewOffset) / view.scale;
  const canvasEnd = (length - viewOffset) / view.scale;
  const startTick = Math.floor(canvasStart / minorStep) * minorStep;

  for (let v = startTick; v <= canvasEnd; v += minorStep) {
    const screenPos = v * view.scale + viewOffset;
    const isMajor = Math.abs(Math.round(v / step) * step - v) < minorStep / 2;

    ctx.beginPath();
    if (isHorizontal) {
      ctx.moveTo(screenPos + 0.5, isMajor ? 10 : 16);
      ctx.lineTo(screenPos + 0.5, RULER_SIZE);
    } else {
      ctx.moveTo(isMajor ? 10 : 16, screenPos + 0.5);
      ctx.lineTo(RULER_SIZE, screenPos + 0.5);
    }
    ctx.stroke();

    if (isMajor) {
      const label = String(Math.round(v));
      if (isHorizontal) {
        ctx.fillText(label, screenPos + 3, 4);
      } else {
        ctx.save();
        ctx.translate(9, screenPos + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
}

function drawRulers() {
  const rootStyle = getComputedStyle(document.documentElement);
  const tickColor = rootStyle.getPropertyValue('--toolbar-divider').trim();
  const textColor = rootStyle.getPropertyValue('--text-faint').trim();
  const fontFamily = getComputedStyle(document.body).fontFamily;

  drawRulerAxis(rulerH.getContext('2d'), rulerH, true, view.x, window.innerWidth, tickColor, textColor, fontFamily);
  drawRulerAxis(rulerV.getContext('2d'), rulerV, false, view.y, window.innerHeight, tickColor, textColor, fontFamily);
}

window.addEventListener('resize', drawRulers);

function layoutFrames() {
  const PICTURE_GAP = 24;
  const picture = document.querySelector('.frame-picture');
  picture.style.left = '0px';
  picture.style.top = `${GAP}px`;

  const intro = document.querySelector('.frame-intro');
  intro.style.left = '0px';
  intro.style.top = `${GAP + picture.offsetHeight + PICTURE_GAP}px`;
  let y = GAP + picture.offsetHeight + PICTURE_GAP + intro.offsetHeight + GAP;

  // Video frames sit in one horizontal row instead of stacking vertically.
  const mediaFrames = [...document.querySelectorAll('.frame-media')];
  let x = 0;
  let mediaRowHeight = 0;
  mediaFrames.forEach((frame) => {
    frame.style.left = `${x}px`;
    frame.style.top = `${y}px`;
    x += frame.offsetWidth + GAP;
    mediaRowHeight = Math.max(mediaRowHeight, frame.offsetHeight);
  });
  y += mediaRowHeight + GAP;

  // About Me, Experience and Credits form one row; Socials sits below About Me.
  const aboutInfo = document.querySelector('.frame-about-info');
  const aboutExperience = document.querySelector('.frame-about-experience');
  const credits = document.querySelector('.frame-credits');
  const socials = document.querySelector('.frame-socials');

  aboutInfo.style.left = '0px';
  aboutInfo.style.top = `${y}px`;

  aboutExperience.style.left = `${aboutInfo.offsetWidth + GAP}px`;
  aboutExperience.style.top = `${y}px`;

  credits.style.left = `${aboutInfo.offsetWidth + GAP + aboutExperience.offsetWidth + GAP}px`;
  credits.style.top = `${y}px`;

  socials.style.left = '0px';
  socials.style.top = `${y + aboutInfo.offsetHeight + GAP}px`;
}

function defaultScaleForViewport() {
  const vw = window.innerWidth;
  if (vw < 640) return 0.3;
  if (vw < 1024) return 0.6;
  return 1;
}

function resetView() {
  // Mobile uses the exact same layout as desktop, just zoomed out further
  // (see defaultScaleForViewport()) to fit the whole thing on a small screen.
  view.scale = defaultScaleForViewport();

  // Anchored from the top-left corner with a fixed margin — not centered.
  view.x = isMobileLayout() ? 48 : 140;
  view.y = 40;
  applyTransform();
}

/* Videos report height 0 until their metadata loads, which throws off every
   frame stacked after them — wait for real dimensions before laying out. */
function waitForMedia(el) {
  return new Promise((resolve) => {
    if (el.tagName === 'VIDEO') {
      if (el.readyState >= 1) return resolve();
      el.addEventListener('loadedmetadata', resolve, { once: true });
      el.addEventListener('error', resolve, { once: true });
    } else {
      if (el.complete) return resolve();
      el.addEventListener('load', resolve, { once: true });
      el.addEventListener('error', resolve, { once: true });
    }
  });
}

const mediaReady = Promise.all(
  [...document.querySelectorAll('.section-bg-img')].map(waitForMedia)
);
const mediaTimeout = new Promise((resolve) => setTimeout(resolve, 3000));

Promise.race([mediaReady, mediaTimeout]).then(() => {
  layoutFrames();
  resetView();
  updateSizeBadges();
  requestAnimationFrame(() => {
    document.body.classList.add('ready');
    document.querySelectorAll('.section-bg-img').forEach((el) => el.classList.add('in-view'));
  });

  // Hover doesn't really exist on touch, so show the collaborator cursor
  // unconditionally on mobile instead of waiting for a hover that won't come.
  // Starts on the first video rather than the intro's "Try dragging me
  // around" — dragging isn't the point of that message on a touch canvas.
  if (isMobileLayout()) {
    setActiveCursorSection(document.querySelector('.frame-media'));
  }
});

/* ---------- Wheel: pan and cmd/ctrl+wheel zoom ---------- */

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();

  if (e.metaKey || e.ctrlKey) {
    const zoomFactor = Math.exp(-e.deltaY * 0.0025);
    zoomAt(e.clientX, e.clientY, view.scale * zoomFactor);
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    applyTransform();
  }
}, { passive: false });

/* ---------- Keyboard shortcuts ---------- */

window.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;

  if (cmd && e.key === '0') {
    e.preventDefault();
    resetView();
  } else if (cmd && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, view.scale * 1.2);
  } else if (cmd && e.key === '-') {
    e.preventDefault();
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, view.scale / 1.2);
  }

  if (e.code === 'Space' && !e.repeat) {
    viewport.classList.add('space-pan');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    viewport.classList.remove('space-pan');
  }
});

/* ---------- Drag: move a frame, pan the canvas, or select a frame ---------- */
/* Also handles two-finger pinch-to-zoom / pan on touch devices, since a
   smaller default zoom on phones needs a way to zoom back in. */

let dragState = null;
let selectedFrame = null;

/* Below this width the frames stack into one full-width column (see the
   mobile media query in style.css) instead of the free-form desktop layout —
   panning and pinch-zoom still work the same, only frame-dragging doesn't. */
function isMobileLayout() {
  return window.innerWidth < 640;
}

const activePointers = new Map();
let pinchState = null;

function pointersList() {
  return [...activePointers.values()];
}

function distanceBetween(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpointOf(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function cancelDragState() {
  if (!dragState) return;
  if (dragState.frame) dragState.frame.classList.remove('dragging');
  viewport.classList.remove('panning');
  document.body.classList.remove('is-dragging');
  dragState = null;
}

function selectFrame(frame) {
  if (selectedFrame === frame) return;
  if (selectedFrame) selectedFrame.classList.remove('selected');
  selectedFrame = frame;
  if (selectedFrame) selectedFrame.classList.add('selected');
}

viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    // A real two-finger gesture — safe to capture immediately, there's no
    // link underneath a pinch to worry about.
    viewport.setPointerCapture(e.pointerId);
    cancelDragState();
    const [p1, p2] = pointersList();
    pinchState = {
      initialDistance: distanceBetween(p1, p2),
      initialScale: view.scale,
      initialMid: midpointOf(p1, p2),
      initialViewX: view.x,
      initialViewY: view.y,
    };
    return;
  }

  if (activePointers.size > 2) return;

  const frameEl = e.target.closest('.frame');
  const spaceHeld = viewport.classList.contains('space-pan');
  const mode = frameEl && !spaceHeld ? 'frame' : 'pan';

  dragState = {
    mode,
    frame: frameEl,
    startClientX: e.clientX,
    startClientY: e.clientY,
    originLeft: frameEl ? parseFloat(frameEl.style.left) || 0 : 0,
    originTop: frameEl ? parseFloat(frameEl.style.top) || 0 : 0,
    originViewX: view.x,
    originViewY: view.y,
    moved: false,
    pointerId: e.pointerId,
  };
  // Pointer capture is deferred until the gesture is confirmed as a drag
  // (see pointermove below). Capturing here unconditionally would swallow
  // the native click on any link/button under the cursor in some browsers,
  // which is why links were working "only sometimes".
});

viewport.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (pinchState) {
    const pts = pointersList();
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const newDistance = distanceBetween(p1, p2);
    const newMid = midpointOf(p1, p2);
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, pinchState.initialScale * (newDistance / pinchState.initialDistance))
    );

    const canvasPointX = (pinchState.initialMid.x - pinchState.initialViewX) / pinchState.initialScale;
    const canvasPointY = (pinchState.initialMid.y - pinchState.initialViewY) / pinchState.initialScale;

    view.scale = nextScale;
    view.x = newMid.x - canvasPointX * nextScale;
    view.y = newMid.y - canvasPointY * nextScale;
    applyTransform();
    return;
  }

  if (!dragState || dragState.pointerId !== e.pointerId) return;

  const dx = e.clientX - dragState.startClientX;
  const dy = e.clientY - dragState.startClientY;

  // Dragging a frame to reposition it is a desktop-only interaction — on
  // mobile the same gesture just pans the canvas instead, same as dragging
  // empty space.
  const movesFrame = dragState.mode === 'frame' && !isMobileLayout();

  if (!dragState.moved && Math.hypot(dx, dy) > 4) {
    dragState.moved = true;
    viewport.setPointerCapture(e.pointerId);
    document.body.classList.add('is-dragging');
    if (movesFrame) {
      dragState.frame.style.zIndex = ++topZ;
      dragState.frame.classList.add('dragging');
    } else {
      viewport.classList.add('panning');
    }
  }

  if (!dragState.moved) return;

  if (movesFrame) {
    dragState.frame.style.left = `${dragState.originLeft + dx / view.scale}px`;
    dragState.frame.style.top = `${dragState.originTop + dy / view.scale}px`;
  } else {
    view.x = dragState.originViewX + dx;
    view.y = dragState.originViewY + dy;
    applyTransform();
  }
});

function endDrag(e) {
  activePointers.delete(e.pointerId);

  if (pinchState) {
    if (activePointers.size < 2) pinchState = null;
    return;
  }

  if (!dragState || dragState.pointerId !== e.pointerId) return;

  if (!dragState.moved) {
    selectFrame(dragState.mode === 'frame' ? dragState.frame : null);
  }

  cancelDragState();
}

viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

/* ---------- Collaborator-style cursor tag ----------
   Mimics another person's cursor appearing on the canvas: it shows up at a
   random spot within the hovered frame (not tracking the real cursor), and
   occasionally drifts to a new random spot while you keep hovering. */

const cursorSections = document.querySelectorAll('[data-cursor-text]');
const cursorTag = document.getElementById('cursor-tag');
const cursorText = cursorTag.querySelector('.cursor-tag-text');
const cursorCaret = cursorTag.querySelector('.cursor-tag-caret');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let activeSection = null;
let typeTimer = null;
let wanderTimer = null;
let cursorCanvasPos = null;

function randomPointInView(frame) {
  // For video sections, confine the tag to the actual video box — the
  // passed-in frame also includes the caption row above it.
  const targetEl = frame.querySelector('.media-frame') || frame;
  const rect = targetEl.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  const width = Math.max(right - left, 0);
  const height = Math.max(bottom - top, 0);

  // Random along the bottom or left edge only, staying inset from the edge
  // rather than drifting outside the frame.
  const inset = 16;
  const t = 0.1 + Math.random() * 0.8;
  const roll = Math.random();

  let point;
  if (roll < 0.5) { // bottom
    point = { x: left + width * t, y: bottom - inset };
  } else { // left
    point = { x: left + inset, y: top + height * t };
  }

  // The speech bubble grows to the right of this anchor (up to its
  // max-width: min(360px, 55vw) in CSS), not centered on it — keep the
  // anchor far enough from the right edge that the bubble never gets clipped
  // by the viewport, mirroring that same cap plus a little room for the
  // arrow/margin. A flat desktop-sized constant here would exceed a narrow
  // mobile viewport outright and clamp every point to the far left.
  const BUBBLE_SAFE_MARGIN = Math.min(360, window.innerWidth * 0.55) + 20;
  point.x = Math.min(point.x, window.innerWidth - BUBBLE_SAFE_MARGIN);
  return point;
}

function moveTagTo(frame) {
  const { x, y } = randomPointInView(frame);
  // Stored in canvas-space (not screen-space) so the tag can be
  // repositioned to stay put on the canvas as the user pans/zooms.
  cursorCanvasPos = { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
  updateCursorScreenPos();
}

function updateCursorScreenPos() {
  if (!cursorCanvasPos) return;
  const x = cursorCanvasPos.x * view.scale + view.x;
  const y = cursorCanvasPos.y * view.scale + view.y;
  // Stays a constant, readable size regardless of canvas zoom — same idea as
  // the caption/badge counter-scaling — instead of shrinking along with a
  // small default mobile zoom to the point of being illegible.
  cursorTag.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function scheduleWander(frame) {
  clearTimeout(wanderTimer);
  const delay = 2200 + Math.random() * 2200;
  wanderTimer = setTimeout(() => {
    if (activeSection !== frame) return;
    moveTagTo(frame);
    scheduleWander(frame);
  }, delay);
}

function setActiveCursorSection(section) {
  // "Try dragging me around" doesn't apply on mobile (frame-dragging is
  // disabled there — see isMobileLayout() elsewhere), so skip it entirely.
  if (isMobileLayout() && section && section.classList.contains('frame-intro')) {
    section = null;
  }
  if (section === activeSection) return;
  activeSection = section;
  clearTimeout(wanderTimer);

  if (!section) {
    cursorTag.classList.remove('is-active');
    cursorCanvasPos = null;
    return;
  }

  cursorTag.style.setProperty('--cursor-color', section.dataset.cursorColor || '#111111');
  cursorTag.style.setProperty('--cursor-text-color', section.dataset.cursorTextColor || '#ffffff');
  moveTagTo(section);
  cursorTag.classList.add('is-active');
  typeMessage(section.dataset.cursorText || '');

  if (!prefersReducedMotion) scheduleWander(section);
}

function typeMessage(text, speed = 22) {
  clearInterval(typeTimer);
  cursorText.textContent = '';

  if (prefersReducedMotion) {
    cursorText.textContent = text;
    cursorCaret.classList.add('hidden');
    return;
  }

  cursorCaret.classList.remove('hidden');
  let i = 0;
  typeTimer = setInterval(() => {
    cursorText.textContent += text[i];
    i += 1;
    if (i >= text.length) {
      clearInterval(typeTimer);
      cursorCaret.classList.add('hidden');
    }
  }, speed);
}

cursorSections.forEach((section) => {
  section.addEventListener('mouseenter', () => setActiveCursorSection(section));
  section.addEventListener('mouseleave', () => {
    if (activeSection === section) setActiveCursorSection(null);
  });
});

/* ---------- Toolbar: theme, help ---------- */

const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

const MOON_ICON = '<path d="M8.75715 1.50578H9.05228C8.08753 2.3679 7.46741 3.52789 7.29972 4.7841C7.13203 6.04032 7.42736 7.31333 8.13439 8.38186C8.84141 9.45039 9.91542 10.2469 11.1697 10.6328C12.424 11.0188 13.7793 10.9699 15 10.4946C14.5304 11.5811 13.763 12.5247 12.7795 13.2247C11.796 13.9247 10.6334 14.3549 9.41568 14.4692C8.19795 14.5836 6.97077 14.3779 5.86506 13.8741C4.75934 13.3703 3.81656 12.5873 3.13729 11.6087C2.45801 10.63 2.06772 9.49231 2.00805 8.31703C1.94837 7.14175 2.22155 5.97294 2.79844 4.93526C3.37533 3.89758 4.23429 3.02997 5.28371 2.42497C6.33312 1.81998 7.53362 1.50028 8.75715 1.5V1.50578Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
const SUN_ICON = '<circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.3V2.8M8 13.2V14.7M2.4 8H1M15 8H13.6M3.5 3.5L4.5 4.5M11.5 11.5L12.5 12.5M12.5 3.5L11.5 4.5M4.5 11.5L3.5 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.innerHTML = theme === 'light' ? SUN_ICON : MOON_ICON;
  try {
    localStorage.setItem('theme', theme);
  } catch (e) {}
}

applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// Fits every frame into the viewport at once, same idea as Figma's
// "zoom to fit" — scales and pans so the full content bounds are visible.
function zoomToFit() {
  const bounds = getContentBounds();
  if (!isFinite(bounds.minX)) return;

  const margin = 80;
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const availableWidth = window.innerWidth - margin * 2;
  const availableHeight = window.innerHeight - margin * 2;

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(availableWidth / contentWidth, availableHeight / contentHeight))
  );

  view.scale = scale;
  view.x = margin - bounds.minX * scale + (availableWidth - contentWidth * scale) / 2;
  view.y = margin - bounds.minY * scale + (availableHeight - contentHeight * scale) / 2;
  applyTransform();
}

const zoomFitBtn = document.getElementById('zoom-fit-btn');
let isFitted = false;

zoomFitBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleZoomMenu(false);

  if (isFitted) {
    resetView();
  } else {
    zoomToFit();
  }
  isFitted = !isFitted;

  zoomFitBtn.setAttribute('aria-label', isFitted ? 'Zoom to 100%' : 'Zoom to fit');
  zoomFitBtn.title = isFitted ? 'Zoom to 100%' : 'Zoom to fit all elements';
});

const zoomControl = document.getElementById('zoom-control');
const zoomMenu = document.getElementById('zoom-menu');

function toggleZoomMenu(show) {
  zoomMenu.toggleAttribute('hidden', !show);
  zoomControl.setAttribute('aria-expanded', String(show));
}

zoomControl.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleZoomMenu(zoomMenu.hasAttribute('hidden'));
});

zoomMenu.querySelectorAll('.zoom-menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    const action = item.dataset.zoom;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    if (action === 'reset') resetView();
    else if (action === 'in') zoomAt(cx, cy, view.scale * 1.2);
    else if (action === 'out') zoomAt(cx, cy, view.scale / 1.2);
    else zoomAt(cx, cy, parseFloat(action));

    toggleZoomMenu(false);
  });
});

document.addEventListener('click', (e) => {
  if (!zoomMenu.hasAttribute('hidden') && !zoomMenu.contains(e.target) && !zoomControl.contains(e.target)) {
    toggleZoomMenu(false);
  }
});
