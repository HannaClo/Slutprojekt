// =========================================================
// Out of order :: main.js
//
// En PixiJS-canvas ligger bakom sidan och ritar två saker:
//   1. ett fält av prickar som pekaren knuffar och som klick skickar krusningar genom
//   2. en generativ bild i varje världsruta
//
// Struktur:
//   setup -> färger -> input -> prickfält -> motiv -> frame-loop
// =========================================================


// ---------- Setup ----------

const app = new PIXI.Application();
await app.init({
  resizeTo: window,
  backgroundAlpha: 0,           // genomskinlig, sidans bakgrund syns igenom
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById("stage").appendChild(app.canvas);

// Två lager: ritas i den här ordningen, så rutorna täcker prickarna
const fieldLayer = new PIXI.Graphics();
const artLayer = new PIXI.Graphics();
app.stage.addChild(fieldLayer, artLayer);

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;


// ---------- Färger ----------
// Läses från CSS-variablerna så att canvasen alltid matchar sidan.

const colours = {};

function readColours() {
  const css = getComputedStyle(document.documentElement);
  for (const name of ["ink", "muted", "accent", "tile"]) {
    colours[name] = new PIXI.Color(css.getPropertyValue(`--${name}`).trim()).toNumber();
  }
}

readColours();


// ---------- Input ----------

const pointer = { x: -9999, y: -9999 };
const ripples = [];   // varje klick lägger till en: { x, y, born }

window.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});

window.addEventListener("pointerdown", (e) => {
  ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() });
});

// Varje ruta har ett hover-värde som mjukt rör sig mellan 0 och 1
// Varje ruta har också sin världsfärg (--c i HTML:en)
const tiles = [...document.querySelectorAll(".tile")].map((el) => {
  const tile = {
    box: el.querySelector(".art"),
    colour: new PIXI.Color(getComputedStyle(el).getPropertyValue("--c").trim()).toNumber(),
    motif: el.querySelector(".art").dataset.motif,
    hover: 0,
    target: 0,
  };
  el.addEventListener("pointerenter", () => { tile.target = 1; });
  el.addEventListener("pointerleave", () => { tile.target = 0; });
  return tile;
});


// ---------- Dot field ----------
// Varje prick har en hemposition och en nuvarande position.
// Krafter knuffar bort den, en fjäder drar hem den igen.

const SPACING = 28;
const PUSH_RADIUS = 150;
const RIPPLE_SPEED = 500;     // pixlar per sekund
const RIPPLE_LIFE = 2000;     // millisekunder

let dots = [];

function buildField() {
  dots = [];
  for (let x = SPACING / 2; x < window.innerWidth; x += SPACING) {
    for (let y = SPACING / 2; y < window.innerHeight; y += SPACING) {
      dots.push({ homeX: x, homeY: y, x, y, vx: 0, vy: 0 });
    }
  }
}

// Knuffa en prick bort från en punkt, hårdare ju närmare den är
function pushAway(dot, fromX, fromY, radius, strength) {
  const dx = dot.x - fromX;
  const dy = dot.y - fromY;
  const distance = Math.hypot(dx, dy) || 1;
  if (distance < radius) {
    const force = (1 - distance / radius) * strength;
    dot.vx += (dx / distance) * force;
    dot.vy += (dy / distance) * force;
  }
}

function updateField(now) {
  // Glöm krusningar som har bleknat bort
  while (ripples.length && now - ripples[0].born > RIPPLE_LIFE) ripples.shift();

  for (const dot of dots) {
    pushAway(dot, pointer.x, pointer.y, PUSH_RADIUS, 1.2);

    // En krusning är en ring som växer; bara prickar nära ringen knuffas
    for (const ripple of ripples) {
      const age = now - ripple.born;
      const ringRadius = (age / 1000) * RIPPLE_SPEED;
      const fromRing = Math.abs(Math.hypot(dot.x - ripple.x, dot.y - ripple.y) - ringRadius);
      if (fromRing < 20) pushAway(dot, ripple.x, ripple.y, ringRadius + 20, 3 * (1 - age / RIPPLE_LIFE));
    }

    // Fjädra hem, med friktion så att den lugnar sig
    dot.vx = (dot.vx + (dot.homeX - dot.x) * 0.06) * 0.82;
    dot.vy = (dot.vy + (dot.homeY - dot.y) * 0.06) * 0.82;
    dot.x += dot.vx;
    dot.y += dot.vy;
  }
}

function drawField() {
  fieldLayer.clear();

  // Prickar som vilar i grått, prickar i rörelse i accentfärgen
  const moving = [];
  for (const dot of dots) {
    const offset = Math.abs(dot.x - dot.homeX) + Math.abs(dot.y - dot.homeY);
    if (offset > 3) moving.push(dot);
    else fieldLayer.rect(dot.x - 1, dot.y - 1, 2, 2);
  }
  fieldLayer.fill({ color: colours.muted, alpha: 0.4 });

  for (const dot of moving) fieldLayer.rect(dot.x - 1.5, dot.y - 1.5, 3, 3);
  fieldLayer.fill(colours.accent);
}

buildField();
window.addEventListener("resize", buildField);


// ---------- Motiv ----------
// En ritfunktion per värld. De tar alla samma argument:
//   g       Graphics-lagret att rita i
//   x, y    rutans övre vänstra hörn på skärmen
//   w, h    rutans storlek
//   t       tid i sekunder
//   hover   0 (vilar) till 1 (pekaren på rutan)
//   c       världens färg

// En liten slumpgenerator med fast frö, så att prickarna ser likadana ut varje gång
function seededRandom(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const random = seededRandom(7);
const scatterPoints = Array.from({ length: 48 }, () => ({ x: random(), y: random(), phase: random() * 6.28 }));

// En enkel gubbe av streck: huvud, kropp, armar och ben. sway rör armar och ben.
function figure(g, cx, cy, size, sway, colour, alpha, t) {
  const head = size * 0.09;
  const neck = cy - size * 0.3 + head;
  const hip = cy + size * 0.05;
  const wave = Math.sin(t * 1.6);

  g.circle(cx, cy - size * 0.3, head).stroke({ width: 2, color: colour, alpha });
  g.moveTo(cx, neck).lineTo(cx, hip);                                                        // kropp
  g.moveTo(cx, neck + size * 0.06).lineTo(cx - size * 0.2 - sway, cy - size * 0.02 + wave * size * 0.04);   // vänster arm
  g.moveTo(cx, neck + size * 0.06).lineTo(cx + size * 0.2 + sway, cy - size * 0.02 - wave * size * 0.04);   // höger arm
  g.moveTo(cx, hip).lineTo(cx - size * 0.1 - sway * 0.3, cy + size * 0.32);                  // vänster ben
  g.moveTo(cx, hip).lineTo(cx + size * 0.1 + sway * 0.3, cy + size * 0.32);                  // höger ben
  g.stroke({ width: 2, color: colour, alpha });
}

const motifs = {
  // Gravitation: partiklar faller mot golvet. På hover vänder tyngdkraften och de faller uppåt.
  gravity(g, x, y, w, h, t, hover, c) {
    for (const p of scatterPoints) {
      const fall = (t * 0.35 + p.phase / 6.28) % 1;
      const eased = fall * fall;                               // accelererar som av tyngdkraft
      const down = y + h * 0.1 + eased * h * 0.8;
      const up = y + h * 0.9 - eased * h * 0.8;
      const py = down + (up - down) * hover;
      const px = x + w * (0.1 + 0.8 * p.x) + Math.sin(t + p.phase) * 3;
      g.circle(px, py, 2.5);
    }
    g.fill({ color: c, alpha: 0.9 });

    // Golv där de landar (och tak när det är vänt)
    g.rect(x + w * 0.1, y + h * 0.9, w * 0.8, 1.5).fill({ color: c, alpha: 1 - hover });
    g.rect(x + w * 0.1, y + h * 0.1, w * 0.8, 1.5).fill({ color: c, alpha: hover });
  },

  // Vatten: vågor som blir högre och snabbare på hover
  water(g, x, y, w, h, t, hover, c) {
    const lines = 8, steps = 48;
    const amp = h * (0.02 + hover * 0.045);
    const speed = 1.2 + hover * 1.8;

    for (let k = 0; k < lines; k++) {
      const baseY = y + h * (0.2 + (0.6 * k) / (lines - 1));
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const py = baseY + Math.sin(u * 9 + t * speed + k * 0.7) * amp + Math.sin(u * 4 - t * speed * 0.6 + k) * amp * 0.6;
        if (i === 0) g.moveTo(x + w * 0.08, py);
        else g.lineTo(x + w * (0.08 + 0.84 * u), py);
      }
      g.stroke({ width: 1.5, color: c, alpha: 0.35 + 0.65 * (k / (lines - 1)) });
    }
  },

  // Friktion: en kula glider nedför en backe. På hover tar friktionen tag och kulan hackar.
  friction(g, x, y, w, h, t, hover, c) {
    const x0 = x + w * 0.1, y0 = y + h * 0.3;
    const x1 = x + w * 0.9, y1 = y + h * 0.78;

    // Backen, med korta streck under som ytan
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2, color: c });
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      g.moveTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u).lineTo(x0 + (x1 - x0) * u - 6, y0 + (y1 - y0) * u + 8);
    }
    g.stroke({ width: 1, color: c, alpha: 0.4 });

    // Kulan: utan friktion accelererar den, med friktion är den långsammare och hackar
    const s = (t * 0.22) % 1;
    const free = s * s;
    const grip = s * 0.4 + Math.sin(s * 40) * 0.01 * hover;
    const pos = free + (grip - free) * hover;
    const bx = x0 + (x1 - x0) * pos, by = y0 + (y1 - y0) * pos;

    for (let k = 1; k <= 6; k++) {                              // svans
      const q = Math.max(0, pos - k * 0.03);
      g.circle(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - 8, 6 - k * 0.7).fill({ color: c, alpha: 0.5 - k * 0.07 });
    }
    g.circle(bx, by - 8, 7).fill(colours.ink);
  },

  // Skugga: en gubbe och dess skugga. Skuggan svajar mer och mer på hover.
  shadow(g, x, y, w, h, t, hover, c) {
    const size = Math.min(w, h) * 0.85;
    const cx = x + w / 2, cy = y + h * 0.5;
    const drift = Math.sin(t * 1.3) * size * (0.04 + hover * 0.12);

    figure(g, cx + size * 0.12 + drift, cy + size * 0.02, size, drift * 1.6, c, 0.7, t * 0.8 + 1);   // skuggan
    figure(g, cx, cy, size, 0, colours.ink, 1, t);                                                   // personen
  },
};

function drawTiles(time) {
  artLayer.clear();

  for (const tile of tiles) {
    tile.hover += (tile.target - tile.hover) * 0.1;

    // Var på skärmen är rutan just nu? Hoppa över den om den är utanför bild.
    const r = tile.box.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;

    artLayer.rect(r.left, r.top, r.width, r.height).fill(colours.tile);
    motifs[tile.motif](artLayer, r.left, r.top, r.width, r.height, time, tile.hover, tile.colour);
  }
}


// ---------- Frame-loop ----------

let time = 0;

app.ticker.add((ticker) => {
  const anyHover = tiles.some((tile) => tile.target > 0);
  if (!reduceMotion || anyHover) time += ticker.deltaMS / 1000;

  const now = performance.now();
  updateField(now);
  drawField();
  drawTiles(time);
});