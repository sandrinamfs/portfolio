/* ---------- Figma-style select handles ---------- */

const handlePositions = ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br'];

document.querySelectorAll('.hover-select').forEach((el) => {
  handlePositions.forEach((pos) => {
    const handle = document.createElement('span');
    handle.className = `handle handle-${pos}`;
    el.appendChild(handle);
  });
});

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

function applyTransform() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  canvasGrid.style.backgroundPosition = `${view.x}px ${view.y}px`;
  canvasGrid.style.backgroundSize = `${GRID_SIZE * view.scale}px ${GRID_SIZE * view.scale}px`;
  zoomIndicator.textContent = `${Math.round(view.scale * 100)}%`;
}

function zoomAt(clientX, clientY, nextScale) {
  nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  const ratio = nextScale / view.scale;
  view.x = clientX - (clientX - view.x) * ratio;
  view.y = clientY - (clientY - view.y) * ratio;
  view.scale = nextScale;
  applyTransform();
}

function layoutFrames() {
  const stack = [
    document.querySelector('.frame-intro'),
    ...document.querySelectorAll('.frame-media'),
    document.querySelector('.frame-about-info'),
    document.querySelector('.frame-about-experience'),
  ];

  let y = GAP;
  stack.forEach((frame) => {
    frame.style.left = '0px';
    frame.style.top = `${y}px`;
    y += frame.offsetHeight + GAP;
  });
}

function defaultScaleForViewport() {
  const vw = window.innerWidth;
  if (vw < 640) return 0.3;
  if (vw < 1024) return 0.7;
  return 1;
}

function resetView() {
  const vw = window.innerWidth;
  const frameWidth = document.querySelector('.frame-media').offsetWidth;

  view.scale = defaultScaleForViewport();
  view.x = (vw - frameWidth * view.scale) / 2;
  view.y = 24;
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
  requestAnimationFrame(() => {
    document.querySelectorAll('.section-bg-img').forEach((el) => el.classList.add('in-view'));
  });
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

  if (!dragState.moved && Math.hypot(dx, dy) > 4) {
    dragState.moved = true;
    viewport.setPointerCapture(e.pointerId);
    document.body.classList.add('is-dragging');
    if (dragState.mode === 'frame') {
      dragState.frame.style.zIndex = ++topZ;
      dragState.frame.classList.add('dragging');
    } else {
      viewport.classList.add('panning');
    }
  }

  if (!dragState.moved) return;

  if (dragState.mode === 'frame') {
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

function randomPointInView(frame) {
  const rect = frame.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  const width = Math.max(right - left, 0);
  const height = Math.max(bottom - top, 0);

  return {
    x: left + width * (0.15 + Math.random() * 0.5),
    y: top + height * (0.15 + Math.random() * 0.5),
  };
}

function moveTagTo(frame) {
  const { x, y } = randomPointInView(frame);
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
  if (section === activeSection) return;
  activeSection = section;
  clearTimeout(wanderTimer);

  if (!section) {
    cursorTag.classList.remove('is-active');
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

/* ---------- Toolbar: tools, theme, help ---------- */

const toolPointer = document.getElementById('tool-pointer');
const toolHand = document.getElementById('tool-hand');

function setActiveTool(tool) {
  toolPointer.classList.toggle('is-active', tool === 'pointer');
  toolHand.classList.toggle('is-active', tool === 'hand');
  toolPointer.setAttribute('aria-pressed', String(tool === 'pointer'));
  toolHand.setAttribute('aria-pressed', String(tool === 'hand'));
}

toolPointer.addEventListener('click', () => setActiveTool('pointer'));
toolHand.addEventListener('click', () => setActiveTool('hand'));

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

const helpBtn = document.getElementById('help-btn');
const helpPopover = document.getElementById('help-popover');

function toggleHelp(show) {
  helpPopover.toggleAttribute('hidden', !show);
  helpBtn.setAttribute('aria-expanded', String(show));
}

helpBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleZoomMenu(false);
  toggleHelp(helpPopover.hasAttribute('hidden'));
});

document.addEventListener('click', (e) => {
  if (!helpPopover.hasAttribute('hidden') && !helpPopover.contains(e.target) && e.target !== helpBtn) {
    toggleHelp(false);
  }
});

const zoomControl = document.getElementById('zoom-control');
const zoomMenu = document.getElementById('zoom-menu');

function toggleZoomMenu(show) {
  zoomMenu.toggleAttribute('hidden', !show);
  zoomControl.setAttribute('aria-expanded', String(show));
}

zoomControl.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHelp(false);
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
