// Default target site. Can be changed in the extension popup / options page.
const DEFAULT_TARGET = "https://kinokino.win";
const BUTTON_ID = "kp-watch-button";
const STYLE_ID = "kp-watch-style";

// Matches /film/484791/ and /series/123456/ (with or without trailing parts).
const PATH_RE = /^\/(film|series)\/(\d+)/;

// If the "Буду смотреть" row is not found within this time, show a floating button instead.
const FALLBACK_DELAY = 4000;

// Press-in effect: max tilt (deg) toward the point under the cursor and depth (px) of the dip.
const PRESS_TILT = 9;
const PRESS_DEPTH = 4;

let target = DEFAULT_TARGET;
let lastHref = "";
let pageOpenedAt = Date.now();

// Fine grain for the frosted-glass look.
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E" +
  "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E" +
  "%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E" +
  "%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CSS = `
#${BUTTON_ID} {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 52px;
  padding: 0 28px;
  margin-left: 8px;
  border-radius: 999px;
  overflow: hidden;
  isolation: isolate;
  color: #fff;
  font: 600 16px/1 "Graphik Kinopoisk LC Web", Arial, sans-serif;
  text-decoration: none;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  background: linear-gradient(135deg, rgba(255, 110, 20, 0.82), rgba(235, 60, 0, 0.82));
  border: 1px solid rgba(255, 180, 110, 0.7);
  backdrop-filter: blur(14px) saturate(170%);
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 4px 18px rgba(255, 90, 0, 0.4);
  transition: box-shadow .4s, border-color .4s, background .4s;
  cursor: pointer;
  vertical-align: middle;
  will-change: transform;
  --x: 50%;
  --y: 50%;
}
/* Frosted glass: milky haze + grain, fades in on hover. */
#${BUTTON_ID}::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    ${NOISE},
    linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.06));
  background-size: 140px 140px, 100% 100%;
  mix-blend-mode: soft-light;
  opacity: 0;
  transition: opacity .45s ease;
}
/* Pressed spot under the cursor: a soft shadowed dip with diffused light around it. */
#${BUTTON_ID}::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(38px circle at var(--x) var(--y), rgba(90, 20, 0, 0.28), rgba(90, 20, 0, 0) 100%),
    radial-gradient(150px circle at var(--x) var(--y), rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0) 70%);
  opacity: 0;
  transition: opacity .45s ease;
}
#${BUTTON_ID}:hover {
  background: linear-gradient(135deg, rgba(255, 120, 35, 0.72), rgba(240, 70, 0, 0.72));
  border-color: rgba(255, 230, 200, 0.75);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -6px 14px rgba(120, 30, 0, 0.25),
    0 3px 12px rgba(255, 90, 0, 0.45);
}
#${BUTTON_ID}:hover::before,
#${BUTTON_ID}:hover::after { opacity: 1; }
#${BUTTON_ID}.kp-watch-floating {
  position: fixed;
  right: 24px;
  bottom: 24px;
  margin: 0;
  z-index: 2147483647;
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function buildUrl() {
  const m = location.pathname.match(PATH_RE);
  if (!m) return null;
  return `${target}/${m[1]}/${m[2]}/`;
}

// Finds the row with "Буду смотреть" and the "..." button. Returns the last item of that row.
function findAnchor() {
  const candidates = document.querySelectorAll("button, a");
  let folderBtn = null;
  for (const el of candidates) {
    if (el.id === BUTTON_ID) continue;
    if (/Буду смотреть/i.test(el.textContent) && el.textContent.length < 40) {
      folderBtn = el;
      break;
    }
  }
  if (!folderBtn) return null;

  // Walk up until we reach a container that also holds the "..." button after this one.
  let node = folderBtn;
  for (let i = 0; i < 6 && node.parentElement; i++) {
    const parent = node.parentElement;
    let last = parent.lastElementChild;
    if (last && last.id === BUTTON_ID) last = last.previousElementSibling;
    if (last && last !== node &&
        (last.matches("button, [role=button]") || last.querySelector("button, [role=button]"))) {
      return last;
    }
    node = parent;
  }
  return null;
}

function createButton() {
  const btn = document.createElement("a");
  btn.id = BUTTON_ID;
  btn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>' +
    "<span>Смотреть</span>";

  // Current and target values, smoothed every frame for fluid motion.
  const cur = { rx: 0, ry: 0, z: 0, x: 50, y: 50 };
  const goal = { rx: 0, ry: 0, z: 0, x: 50, y: 50 };
  let frame = 0;

  function tick() {
    let moving = false;
    for (const k in cur) {
      cur[k] += (goal[k] - cur[k]) * 0.18;
      if (Math.abs(goal[k] - cur[k]) > 0.02) moving = true;
    }
    btn.style.transform =
      `perspective(500px) rotateX(${cur.rx.toFixed(2)}deg) rotateY(${cur.ry.toFixed(2)}deg) ` +
      `translateZ(${cur.z.toFixed(2)}px)`;
    btn.style.setProperty("--x", `${cur.x.toFixed(1)}%`);
    btn.style.setProperty("--y", `${cur.y.toFixed(1)}%`);
    frame = moving ? requestAnimationFrame(tick) : 0;
  }

  function start() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  // The side under the cursor tilts away from the viewer, as if pressed by a finger.
  btn.addEventListener("mousemove", (e) => {
    const r = btn.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    goal.ry = nx * PRESS_TILT;
    goal.rx = -ny * PRESS_TILT * 0.6;
    goal.z = -PRESS_DEPTH;
    goal.x = (nx + 1) * 50;
    goal.y = (ny + 1) * 50;
    start();
  });

  btn.addEventListener("mouseleave", () => {
    goal.rx = 0;
    goal.ry = 0;
    goal.z = 0;
    start();
  });

  return btn;
}

function update() {
  const url = buildUrl();
  let btn = document.getElementById(BUTTON_ID);

  if (!url) {
    if (btn) btn.remove();
    return;
  }

  injectStyle();
  if (!btn) btn = createButton();
  btn.href = url;

  const anchor = findAnchor();
  if (anchor) {
    btn.classList.remove("kp-watch-floating");
    if (anchor.nextElementSibling !== btn) anchor.after(btn);
  } else if (Date.now() - pageOpenedAt > FALLBACK_DELAY) {
    btn.classList.add("kp-watch-floating");
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
  }
}

// Kinopoisk is a single-page app: the URL changes and the page re-renders without a reload.
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    pageOpenedAt = Date.now();
    const old = document.getElementById(BUTTON_ID);
    if (old) old.remove();
  }
  update();
}, 500);

chrome.storage.sync.get({ target: DEFAULT_TARGET }, (data) => {
  target = data.target;
  update();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.target) {
    target = changes.target.newValue || DEFAULT_TARGET;
    update();
  }
});
