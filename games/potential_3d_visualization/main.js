/* ====================================================================
   Electric Potential Visualization
   Left  (2D): equipotentials + field lines + particle under F = qE
   Right (3D): potential surface h(x,y) = V(x,y), particle under gravity
   The two motions agree (small-slope) when q/m = g (both set to 1 here)
   ==================================================================== */

// ---------------------- Constants / world ----------------------
const WORLD = { min: -10, max: 10 };
const WORLD_SIZE = WORLD.max - WORLD.min;
const K = 4.0;             // Coulomb constant (scaled)
const SOFT = 0.35;         // softening radius (avoid singularity)
const V_CLAMP = 8;         // clamp for color/height
const HEIGHT_SCALE = 0.35; // 3D height scale
const GRAVITY = 1.0;
const DT = 1/120;
const SUBSTEPS = 2;
const PART_MASS = 1.0;

// ---------------------- State ----------------------
const state = {
  charges: [],
  particles: [],
  explosions: [],   // visual annihilation effects, see spawnExplosion()
  mode: 'pos',  // 'pos' | 'neg' | 'part' | 'none'
  qMag: 1.0,
  qPart: 1.0,
  vx0: 0.0,
  vy0: 0.0,
  running: false,
  showField: true,
  showEqui: true,
  showPColor: true,
  showTrail: true,
  drag: null,
};

// ---------------------- Physics ----------------------
function potential(x, y) {
  let V = 0;
  for (const c of state.charges) {
    const dx = x - c.x, dy = y - c.y;
    const r = Math.sqrt(dx*dx + dy*dy + SOFT*SOFT);
    V += K * c.q / r;
  }
  return V;
}
function field(x, y) {
  let Ex = 0, Ey = 0;
  for (const c of state.charges) {
    const dx = x - c.x, dy = y - c.y;
    const r2 = dx*dx + dy*dy + SOFT*SOFT;
    const r = Math.sqrt(r2);
    const r3 = r2 * r;
    Ex += K * c.q * dx / r3;
    Ey += K * c.q * dy / r3;
  }
  return [Ex, Ey];
}
function clampV(v) { return Math.max(-V_CLAMP, Math.min(V_CLAMP, v)); }

// ---------------------- Explosions ----------------------
function spawnExplosion(x, y) {
  const COLORS = ['#ff6040', '#ffcc44', '#ff8820', '#ffffff', '#ffaa30'];
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    state.explosions.push({
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0,
      maxLife: 0.25 + Math.random() * 0.25,
      r: 2 + Math.random() * 3,
      color: COLORS[i % COLORS.length],
    });
  }
}

function stepExplosions(dt) {
  for (let i = state.explosions.length - 1; i >= 0; i--) {
    const e = state.explosions[i];
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.life += dt;
    if (e.life >= e.maxLife) state.explosions.splice(i, 1);
  }
}

function drawExplosions2D() {
  for (const e of state.explosions) {
    const t = e.life / e.maxLife;
    const [sx, sy] = worldToScreen(e.x, e.y);
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(sx, sy, e.r * (1 - 0.4 * t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ========================================================================
// 2D view
// ========================================================================
const cvs = document.getElementById('canvas2d');
const ctx = cvs.getContext('2d');
let W = 0, H = 0;

function resize2D() {
  const rect = cvs.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cvs.width = Math.floor(rect.width * dpr);
  cvs.height = Math.floor(rect.height * dpr);
  cvs.style.width = rect.width + 'px';
  cvs.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  W = rect.width; H = rect.height;
  potentialBufferDirty = true;
}

function worldToScreen(x, y) {
  const s = Math.min(W, H) / WORLD_SIZE;
  return [W/2 + x*s, H/2 - y*s];
}
function screenToWorld(sx, sy) {
  const s = Math.min(W, H) / WORLD_SIZE;
  return [(sx - W/2)/s, -(sy - H/2)/s];
}

// Potential background — light theme (white = 0, red = high, blue = low)
let potentialImage = null;
let potentialImageSize = null;
let potentialBufferDirty = true;
const PIXEL_STEP = 3;

function renderPotentialField() {
  const w = Math.floor(W), h = Math.floor(H);
  if (w === 0 || h === 0) return;
  const sw = Math.max(2, Math.floor(w / PIXEL_STEP));
  const sh = Math.max(2, Math.floor(h / PIXEL_STEP));
  const img = ctx.createImageData(sw, sh);
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const sx = (i + 0.5) * (w / sw);
      const sy = (j + 0.5) * (h / sh);
      const [wx, wy] = screenToWorld(sx, sy);
      const v = potential(wx, wy);
      const t = Math.max(-1, Math.min(1, v / V_CLAMP));
      const boost = Math.sign(t) * Math.pow(Math.abs(t), 0.55);
      // light theme: white background, tint toward red (+) or blue (−)
      let r, g, b;
      if (boost >= 0) {
        r = 255;
        g = 255 - 130 * boost;
        b = 255 - 100 * boost;
      } else {
        r = 255 - 110 * -boost;
        g = 255 -  70 * -boost;
        b = 255;
      }
      const idx = (j*sw + i) * 4;
      img.data[idx  ] = r;
      img.data[idx+1] = g;
      img.data[idx+2] = b;
      img.data[idx+3] = 255;
    }
  }
  potentialImage = img;
  potentialImageSize = {w: sw, h: sh, targetW: w, targetH: h};
  potentialBufferDirty = false;
}

function drawPotentialBg() {
  if (!state.showPColor || state.charges.length === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (potentialBufferDirty || !potentialImage) renderPotentialField();
  const off = document.createElement('canvas');
  off.width = potentialImageSize.w;
  off.height = potentialImageSize.h;
  off.getContext('2d').putImageData(potentialImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, potentialImageSize.targetW, potentialImageSize.targetH);
}

// Equipotentials via marching squares
function drawEquipotential() {
  if (!state.showEqui || state.charges.length === 0) return;
  const levels = [-6, -4, -2.5, -1.5, -0.8, -0.4, 0.4, 0.8, 1.5, 2.5, 4, 6];
  const N = 80;
  const xs = new Float32Array(N+1);
  const ys = new Float32Array(N+1);
  for (let i = 0; i <= N; i++) {
    xs[i] = WORLD.min + (WORLD.max - WORLD.min) * i / N;
    ys[i] = WORLD.min + (WORLD.max - WORLD.min) * i / N;
  }
  const grid = new Float32Array((N+1)*(N+1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) grid[j*(N+1)+i] = potential(xs[i], ys[j]);
  }
  ctx.lineWidth = 1;
  for (const level of levels) {
    const a = 0.30 + 0.06*Math.min(3,Math.abs(level));
    ctx.strokeStyle = level >= 0 ? `rgba(170,40,60,${a})` : `rgba(40,80,170,${a})`;
    ctx.beginPath();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v00 = grid[j*(N+1)+i];
        const v10 = grid[j*(N+1)+i+1];
        const v01 = grid[(j+1)*(N+1)+i];
        const v11 = grid[(j+1)*(N+1)+i+1];
        let c = 0;
        if (v00 > level) c |= 1;
        if (v10 > level) c |= 2;
        if (v11 > level) c |= 4;
        if (v01 > level) c |= 8;
        if (c === 0 || c === 15) continue;
        const interp = (vA, vB, xA, yA, xB, yB) => {
          const t = (level - vA) / (vB - vA);
          return [xA + t*(xB-xA), yA + t*(yB-yA)];
        };
        const xL = xs[i], xR = xs[i+1], yB = ys[j], yT = ys[j+1];
        const edges = {
          top:    () => interp(v01, v11, xL, yT, xR, yT),
          bottom: () => interp(v00, v10, xL, yB, xR, yB),
          left:   () => interp(v00, v01, xL, yB, xL, yT),
          right:  () => interp(v10, v11, xR, yB, xR, yT),
        };
        let segs = [];
        switch (c) {
          case 1: case 14: segs = [['bottom','left']]; break;
          case 2: case 13: segs = [['bottom','right']]; break;
          case 3: case 12: segs = [['left','right']]; break;
          case 4: case 11: segs = [['top','right']]; break;
          case 6: case 9:  segs = [['top','bottom']]; break;
          case 7: case 8:  segs = [['top','left']]; break;
          case 5:          segs = [['top','left'], ['bottom','right']]; break;
          case 10:         segs = [['top','right'], ['bottom','left']]; break;
        }
        for (const [eA, eB] of segs) {
          const [waX, waY] = edges[eA]();
          const [wbX, wbY] = edges[eB]();
          const [saX, saY] = worldToScreen(waX, waY);
          const [sbX, sbY] = worldToScreen(wbX, wbY);
          ctx.moveTo(saX, saY);
          ctx.lineTo(sbX, sbY);
        }
      }
    }
    ctx.stroke();
  }
}

// Field-line streamlines
function drawFieldLines() {
  if (!state.showField || state.charges.length === 0) return;
  ctx.strokeStyle = 'rgba(60,70,100,0.55)';
  ctx.lineWidth = 1.1;
  const NLINES = 16;
  const STEPS = 500;
  const STEP_LEN = 0.07;
  const sources = state.charges.filter(c => c.q > 0);
  const startList = sources.length > 0 ? sources : state.charges;
  const reverse = sources.length === 0;
  for (const src of startList) {
    for (let k = 0; k < NLINES; k++) {
      const ang = 2*Math.PI*k/NLINES;
      let x = src.x + 0.4*Math.cos(ang);
      let y = src.y + 0.4*Math.sin(ang);
      ctx.beginPath();
      let [sx, sy] = worldToScreen(x, y);
      ctx.moveTo(sx, sy);
      for (let s = 0; s < STEPS; s++) {
        let [Ex, Ey] = field(x, y);
        const mag = Math.sqrt(Ex*Ex + Ey*Ey);
        if (mag < 1e-6) break;
        Ex /= mag; Ey /= mag;
        if (reverse) { Ex = -Ex; Ey = -Ey; }
        x += Ex * STEP_LEN;
        y += Ey * STEP_LEN;
        if (x < WORLD.min || x > WORLD.max || y < WORLD.min || y > WORLD.max) break;
        let near = false;
        for (const c of state.charges) {
          const dx = x - c.x, dy = y - c.y;
          if (dx*dx + dy*dy < 0.15*0.15) { near = true; break; }
        }
        [sx, sy] = worldToScreen(x, y);
        ctx.lineTo(sx, sy);
        if (near) break;
      }
      ctx.stroke();
    }
  }
  // arrow heads
  ctx.fillStyle = 'rgba(60,70,100,0.85)';
  for (const src of startList) {
    for (let k = 0; k < NLINES; k++) {
      const ang = 2*Math.PI*k/NLINES;
      let x = src.x + 1.4*Math.cos(ang);
      let y = src.y + 1.4*Math.sin(ang);
      if (x < WORLD.min+0.3 || x > WORLD.max-0.3 || y < WORLD.min+0.3 || y > WORLD.max-0.3) continue;
      let [Ex, Ey] = field(x, y);
      const mag = Math.sqrt(Ex*Ex + Ey*Ey);
      if (mag < 0.05) continue;
      Ex /= mag; Ey /= mag;
      if (reverse) { Ex = -Ex; Ey = -Ey; }
      const [sx, sy] = worldToScreen(x, y);
      const arrowSize = 5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(-Ey, Ex));
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize*0.6, arrowSize*0.5);
      ctx.lineTo(-arrowSize*0.6, -arrowSize*0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawCharges2D() {
  for (const c of state.charges) {
    const [sx, sy] = worldToScreen(c.x, c.y);
    const r = 9 + 4*Math.min(1.5, Math.abs(c.q));
    const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, r);
    if (c.q > 0) {
      grad.addColorStop(0, '#ffd0d8'); grad.addColorStop(0.5, '#e35468'); grad.addColorStop(1, '#a32f43');
    } else {
      grad.addColorStop(0, '#d6e3ff'); grad.addColorStop(0.5, '#5b8edd'); grad.addColorStop(1, '#2a55a8');
    }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2*Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.q > 0 ? '+' : '−', sx, sy);
  }
}

function drawParticles2D() {
  for (const p of state.particles) {
    if (state.showTrail && p.trail.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(200,130,20,0.7)';
      ctx.lineWidth = 1.4;
      const [s0x, s0y] = worldToScreen(p.trail[0].x, p.trail[0].y);
      ctx.moveTo(s0x, s0y);
      for (let i = 1; i < p.trail.length; i++) {
        const [tsx, tsy] = worldToScreen(p.trail[i].x, p.trail[i].y);
        ctx.lineTo(tsx, tsy);
      }
      ctx.stroke();
    }
    const [sx, sy] = worldToScreen(p.x, p.y);
    const r = 7;
    const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, r);
    grad.addColorStop(0, '#fff3d8'); grad.addColorStop(0.6, '#e8a830'); grad.addColorStop(1, '#a07012');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2*Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    // force vector during simulation
    if (state.running) {
      const [Ex, Ey] = field(p.x, p.y);
      const fx = p.q * Ex, fy = p.q * Ey;
      const fmag = Math.sqrt(fx*fx + fy*fy);
      if (fmag > 1e-3) {
        const len = Math.min(30, fmag*8);
        const [ex_, ey_] = [fx/fmag, fy/fmag];
        ctx.strokeStyle = 'rgba(200,90,20,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + ex_*len, sy - ey_*len);
        ctx.stroke();
      }
    }
  }
  if (state.drag) {
    const [s0x, s0y] = worldToScreen(state.drag.x0, state.drag.y0);
    const [s1x, s1y] = worldToScreen(state.drag.x1, state.drag.y1);
    ctx.strokeStyle = '#c07a18';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e8a830';
    ctx.beginPath(); ctx.arc(s0x, s0y, 5, 0, 2*Math.PI); ctx.fill();
  }
}

function drawAxes() {
  // grid
  ctx.strokeStyle = 'rgba(40,60,100,0.06)';
  ctx.lineWidth = 1;
  for (let i = WORLD.min; i <= WORLD.max; i += 2) {
    const [gx, _] = worldToScreen(i, 0);
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    const [__, gy] = worldToScreen(0, i);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  // main axes
  ctx.strokeStyle = 'rgba(40,60,100,0.18)';
  ctx.lineWidth = 1;
  const [cx, cy] = worldToScreen(0, 0);
  ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  ctx.stroke();
}

function render2D() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  drawPotentialBg();
  drawAxes();
  drawFieldLines();
  drawEquipotential();
  drawCharges2D();
  drawParticles2D();
  drawExplosions2D();
}

// ---------------------- 2D interaction ----------------------
cvs.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = cvs.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const [wx, wy] = screenToWorld(sx, sy);
  if (state.mode === 'pos') {
    state.charges.push({x: wx, y: wy, q: state.qMag});
    potentialBufferDirty = true; rebuildSurface();
  } else if (state.mode === 'neg') {
    state.charges.push({x: wx, y: wy, q: -state.qMag});
    potentialBufferDirty = true; rebuildSurface();
  } else if (state.mode === 'part') {
    state.drag = {x0: wx, y0: wy, x1: wx, y1: wy};
  }
});
cvs.addEventListener('mousemove', (e) => {
  if (!state.drag) return;
  const rect = cvs.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const [wx, wy] = screenToWorld(sx, sy);
  state.drag.x1 = wx; state.drag.y1 = wy;
  // live-update the v0 sliders so user sees what they're setting
  const dragVx = (state.drag.x1 - state.drag.x0) * 1.5;
  const dragVy = (state.drag.y1 - state.drag.y0) * 1.5;
  if (Math.hypot(dragVx, dragVy) > 0.05) {
    state.vx0 = Math.max(-5, Math.min(5, dragVx));
    state.vy0 = Math.max(-5, Math.min(5, dragVy));
    $('vx0').value = state.vx0.toFixed(1);
    $('vy0').value = state.vy0.toFixed(1);
    $('vx0-val').textContent = state.vx0.toFixed(1);
    $('vy0-val').textContent = state.vy0.toFixed(1);
  }
});
cvs.addEventListener('mouseup', (e) => {
  if (state.mode !== 'part' || !state.drag) { state.drag = null; return; }
  const dragVx = (state.drag.x1 - state.drag.x0) * 1.5;
  const dragVy = (state.drag.y1 - state.drag.y0) * 1.5;
  // If the user actually dragged, use the drag velocity; else use the slider values.
  const dragged = Math.hypot(dragVx, dragVy) > 0.05;
  const vx = dragged ? dragVx : state.vx0;
  const vy = dragged ? dragVy : state.vy0;
  addParticle(state.drag.x0, state.drag.y0, vx, vy, state.qPart);
  state.drag = null;
});
cvs.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = cvs.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const [wx, wy] = screenToWorld(sx, sy);
  // try deleting nearest charge first
  let best = -1, bestD = 0.7*0.7;
  for (let i = 0; i < state.charges.length; i++) {
    const dx = state.charges[i].x - wx, dy = state.charges[i].y - wy;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  if (best >= 0) {
    state.charges.splice(best, 1);
    potentialBufferDirty = true; rebuildSurface();
    return;
  }
  // else delete nearest particle
  best = -1; bestD = 0.7*0.7;
  for (let i = 0; i < state.particles.length; i++) {
    const dx = state.particles[i].x - wx, dy = state.particles[i].y - wy;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  if (best >= 0) {
    removeParticle(best);
  }
});

function addParticle(x, y, vx, vy, q) {
  state.particles.push({
    x, y, vx, vy, q, m: PART_MASS,
    x0: x, y0: y, vx0: vx, vy0: vy,
    trail: [{x, y}],
  });
  ensureParticleMeshes();
}

// Remove a single particle (and its mesh + trail) at index idx.
function removeParticle(idx) {
  if (idx < 0 || idx >= state.particles.length) return;
  state.particles.splice(idx, 1);
  if (particleMeshes[idx]) {
    scene.remove(particleMeshes[idx]);
    particleMeshes[idx].geometry.dispose();
    particleMeshes[idx].material.dispose();
    particleMeshes.splice(idx, 1);
  }
  if (trailLines[idx]) {
    scene.remove(trailLines[idx].line);
    trailLines[idx].line.geometry.dispose();
    trailLines[idx].line.material.dispose();
    trailLines.splice(idx, 1);
  }
}

// ========================================================================
// 3D view (Three.js)
// ========================================================================
const container3d = document.getElementById('canvas3d');
let scene, camera, renderer, controls;
let surfaceMesh, surfaceGeom, surfaceMat, wireframeMesh;
const chargeMeshes = [];
const particleMeshes = [];
const trailLines = [];
const SURF_N = 110;
let surfaceDirty = false;   // coalesce rebuildSurface() calls to once per frame

function init3D() {
  const rect = container3d.getBoundingClientRect();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6fb);
  scene.fog = new THREE.Fog(0xf4f6fb, 35, 70);

  camera = new THREE.PerspectiveCamera(45, rect.width/rect.height, 0.1, 200);
  camera.position.set(14, 14, 16);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(rect.width, rect.height);
  renderer.setClearColor(0xf4f6fb, 1);
  container3d.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dl = new THREE.DirectionalLight(0xffffff, 0.85);
  dl.position.set(12, 18, 8);
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xa0c0ff, 0.35);
  dl2.position.set(-10, 10, -8);
  scene.add(dl2);

  surfaceGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SURF_N, SURF_N);
  surfaceGeom.rotateX(-Math.PI/2);
  surfaceMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shininess: 25,
    flatShading: false,
  });
  surfaceMesh = new THREE.Mesh(surfaceGeom, surfaceMat);
  scene.add(surfaceMesh);

  // Shared-geometry wireframe overlay: when surfaceGeom vertices move,
  // the wireframe updates automatically — no WireframeGeometry rebuild needed.
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x8a96b8, wireframe: true,
    transparent: true, opacity: 0.25,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  wireframeMesh = new THREE.Mesh(surfaceGeom, wireMat);
  scene.add(wireframeMesh);

  // base plane for reference
  const basePlaneGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  basePlaneGeom.rotateX(-Math.PI/2);
  const basePlaneMat = new THREE.MeshBasicMaterial({color: 0xe1e6f3, transparent: true, opacity: 0.6, side: THREE.DoubleSide});
  const basePlane = new THREE.Mesh(basePlaneGeom, basePlaneMat);
  basePlane.position.y = -5;
  scene.add(basePlane);

  // grid on base plane
  const gridHelper = new THREE.GridHelper(WORLD_SIZE, 10, 0xb6c0d8, 0xd8def0);
  gridHelper.position.y = -4.99;
  scene.add(gridHelper);

  rebuildSurface();
}

function rebuildSurface() {
  if (!surfaceGeom) return;
  const pos = surfaceGeom.attributes.position;
  let colors = surfaceGeom.attributes.color;
  if (!colors) {
    colors = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    surfaceGeom.setAttribute('color', colors);
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const worldY2D = -z;
    const V = clampV(potential(x, worldY2D));
    pos.setY(i, V * HEIGHT_SCALE);
    const t = V / V_CLAMP;
    const boost = Math.sign(t) * Math.pow(Math.abs(t), 0.55);
    // light-theme surface colors (white→red, white→blue)
    let r, g, b;
    if (boost >= 0) {
      r = 1.00; g = 1.0 - 0.55*boost; b = 1.0 - 0.45*boost;
    } else {
      r = 1.0 - 0.50*-boost; g = 1.0 - 0.30*-boost; b = 1.00;
    }
    colors.setXYZ(i, r, g, b);
  }
  pos.needsUpdate = true;
  colors.needsUpdate = true;
  surfaceGeom.computeVertexNormals();
  // wireframeMesh shares surfaceGeom — pos.needsUpdate is enough
  refreshChargeMeshes();
  ensureParticleMeshes();
}

function refreshChargeMeshes() {
  for (const m of chargeMeshes) {
    scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
  }
  chargeMeshes.length = 0;
  for (const c of state.charges) {
    const radius = 0.3 + 0.15*Math.min(2, Math.abs(c.q));
    const geom = new THREE.SphereGeometry(radius, 24, 18);
    const color = c.q > 0 ? 0xd44056 : 0x3873d4;
    const mat = new THREE.MeshPhongMaterial({color, emissive: color, emissiveIntensity: 0.25, shininess: 60});
    const mesh = new THREE.Mesh(geom, mat);
    const V = clampV(potential(c.x, c.y));
    mesh.position.set(c.x, V * HEIGHT_SCALE + (c.q > 0 ? radius*1.2 : -radius*1.2), -c.y);
    scene.add(mesh);
    chargeMeshes.push({mesh, charge: c});
  }
}

function ensureParticleMeshes() {
  while (particleMeshes.length > state.particles.length) {
    const m = particleMeshes.pop();
    scene.remove(m); m.geometry.dispose(); m.material.dispose();
    const line = trailLines.pop();
    if (line) { scene.remove(line.line); line.line.geometry.dispose(); line.line.material.dispose(); }
  }
  while (particleMeshes.length < state.particles.length) {
    const geom = new THREE.SphereGeometry(0.28, 22, 18);
    const mat = new THREE.MeshPhongMaterial({color: 0xe8a830, emissive: 0xc07a18, emissiveIntensity: 0.3, shininess: 80});
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    particleMeshes.push(mesh);
    const trailGeom = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({color: 0xc07a18, transparent: true, opacity: 0.85});
    const line = new THREE.Line(trailGeom, trailMat);
    scene.add(line);
    trailLines.push({line, points: []});
  }
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    const V = clampV(potential(p.x, p.y));
    particleMeshes[i].position.set(p.x, V*HEIGHT_SCALE + 0.28, -p.y);
  }
}

function updateParticleMeshes() {
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    const V = clampV(potential(p.x, p.y));
    const y3d = V * HEIGHT_SCALE + 0.28;
    particleMeshes[i].position.set(p.x, y3d, -p.y);
    if (state.showTrail) {
      const tl = trailLines[i];
      tl.points.push(p.x, y3d, -p.y);
      if (tl.points.length > 2000*3) tl.points.splice(0, tl.points.length - 2000*3);
      tl.line.geometry.dispose();
      tl.line.geometry = new THREE.BufferGeometry();
      tl.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(tl.points, 3));
      tl.line.visible = true;
    } else {
      trailLines[i].line.visible = false;
    }
  }
}

function resize3D() {
  const rect = container3d.getBoundingClientRect();
  if (renderer && rect.width > 0 && rect.height > 0) {
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
  }
}

// ========================================================================
// Physics integration
// ========================================================================
function stepPhysics(dt) {
  // Iterate backwards so we can splice particles out when they leave the world.
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    // 2D: a = (q/m) E.  3D-equivalent (small slope): a = -g ∇V = -g ∇h.
    // With q/m = g = 1 the two motions are identical.
    const [Ex, Ey] = field(p.x, p.y);
    const ax = (p.q / p.m) * Ex;
    const ay = (p.q / p.m) * Ey;
    p.vx += ax * dt;
    p.vy += ay * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    // collisions with charges
    //   • +q particle meets −q charge → annihilation: both are destroyed
    //   • everything else             → soft elastic bounce
    let annihilated = false;
    for (let ci = state.charges.length - 1; ci >= 0; ci--) {
      const c = state.charges[ci];
      const dx = p.x - c.x, dy = p.y - c.y;
      const r2 = dx*dx + dy*dy;
      const RMIN = 0.4;
      if (r2 < RMIN*RMIN && r2 > 1e-6) {
        if (p.q > 0 && c.q < 0) {
          spawnExplosion(p.x, p.y);
          state.charges.splice(ci, 1);
          removeParticle(i);
          annihilated = true;
          break;
        }
        const r = Math.sqrt(r2);
        const overlap = RMIN - r;
        p.x += (dx/r) * overlap;
        p.y += (dy/r) * overlap;
        const vDotN = p.vx * (dx/r) + p.vy * (dy/r);
        if (vDotN < 0) {
          p.vx -= 1.8 * vDotN * (dx/r);
          p.vy -= 1.8 * vDotN * (dy/r);
          p.vx *= 0.8; p.vy *= 0.8;
        }
      }
    }
    if (annihilated) {
      potentialBufferDirty = true;
      surfaceDirty = true;
      continue;
    }
    // outer boundary: particle escapes the simulation and vanishes
    if (p.x < WORLD.min || p.x > WORLD.max || p.y < WORLD.min || p.y > WORLD.max) {
      removeParticle(i);
      continue;
    }
    if (state.showTrail) {
      p.trail.push({x: p.x, y: p.y});
      if (p.trail.length > 2000) p.trail.shift();
    }
  }
}

// ========================================================================
// Main loop
// ========================================================================
function animate() {
  requestAnimationFrame(animate);
  if (state.running) {
    for (let s = 0; s < SUBSTEPS; s++) stepPhysics(DT);
    stepExplosions(1/60);
  }
  if (surfaceDirty) {
    rebuildSurface();
    surfaceDirty = false;
  }
  render2D();
  updateParticleMeshes();
  if (controls) controls.update();
  if (renderer) renderer.render(scene, camera);
}

// ========================================================================
// UI bindings
// ========================================================================
const $ = (id) => document.getElementById(id);
const MODE_BTN = {pos:'mode-pos', neg:'mode-neg', part:'mode-part'};
function setMode(m) {
  state.mode = m;
  for (const id of Object.values(MODE_BTN)) $(id).classList.remove('active');
  if (MODE_BTN[m]) $(MODE_BTN[m]).classList.add('active');
  cvs.style.cursor = (m === 'none') ? 'default' : 'crosshair';
}
$('mode-pos').onclick = () => setMode('pos');
$('mode-neg').onclick = () => setMode('neg');
$('mode-part').onclick = () => setMode('part');

$('q-mag').oninput = (e) => { state.qMag = parseFloat(e.target.value); $('q-mag-val').textContent = state.qMag.toFixed(1); };
$('qp').oninput = (e) => {
  state.qPart = parseFloat(e.target.value);
  $('qp-val').textContent = (state.qPart >= 0 ? '+' : '') + state.qPart.toFixed(1);
};
$('vx0').oninput = (e) => {
  state.vx0 = parseFloat(e.target.value);
  $('vx0-val').textContent = state.vx0.toFixed(1);
};
$('vy0').oninput = (e) => {
  state.vy0 = parseFloat(e.target.value);
  $('vy0-val').textContent = state.vy0.toFixed(1);
};

$('btn-play').onclick = () => {
  state.running = !state.running;
  $('btn-play').textContent = state.running ? '❚❚ pause' : '▶ start';
  $('btn-play').classList.toggle('running', state.running);
};
$('btn-reset').onclick = () => {
  for (const p of state.particles) {
    p.x = p.x0; p.y = p.y0;
    p.vx = p.vx0; p.vy = p.vy0;
    p.trail = [{x: p.x, y: p.y}];
  }
  for (const tl of trailLines) { tl.points = []; tl.line.geometry.dispose(); tl.line.geometry = new THREE.BufferGeometry(); }
};
$('btn-clear-field').onclick = () => {
  state.charges.length = 0;
  potentialBufferDirty = true;
  rebuildSurface();
};
$('btn-clear-parts').onclick = () => {
  while (state.particles.length > 0) removeParticle(state.particles.length - 1);
};

$('show-field').onchange = (e) => { state.showField = e.target.checked; };
$('show-equi').onchange  = (e) => { state.showEqui  = e.target.checked; };
$('show-pcolor').onchange = (e) => { state.showPColor = e.target.checked; };
$('show-trail').onchange = (e) => {
  state.showTrail = e.target.checked;
  if (!state.showTrail) {
    for (const p of state.particles) p.trail = [];
    for (const t of trailLines) { t.points = []; t.line.geometry.dispose(); t.line.geometry = new THREE.BufferGeometry(); }
  }
};

$('preset-dipole').onclick = () => {
  state.charges = [{x:-3, y:0, q:1.5}, {x:3, y:0, q:-1.5}];
  potentialBufferDirty = true; rebuildSurface();
};
$('preset-quad').onclick = () => {
  state.charges = [
    {x:-3, y:-3, q: 1.2},
    {x: 3, y: 3, q: 1.2},
    {x:-3, y: 3, q:-1.2},
    {x: 3, y:-3, q:-1.2},
  ];
  potentialBufferDirty = true; rebuildSurface();
};
// Uniform field: two dense parallel rows of opposite charges,
// like a parallel-plate capacitor. The interior region between the rows
// has nearly constant E (in the -y direction here, since the +row is at the top).
$('preset-uniform').onclick = () => {
  state.charges = [];
  const N = 13;
  const x0 = -8, x1 = 8;
  const qEach = 0.45;
  for (let i = 0; i < N; i++) {
    const x = x0 + (x1 - x0) * i / (N - 1);
    state.charges.push({x, y:  5, q:  qEach});   // top row: positive
    state.charges.push({x, y: -5, q: -qEach});   // bottom row: negative
  }
  potentialBufferDirty = true; rebuildSurface();
};

setMode('pos');
function start() {
  resize2D();
  init3D();
  resize3D();
  // initial dipole so the user sees something immediately
  state.charges.push({x:-3, y:0, q:1.5});
  state.charges.push({x: 3, y:0, q:-1.5});
  potentialBufferDirty = true;
  rebuildSurface();
  animate();
}
window.addEventListener('resize', () => { resize2D(); resize3D(); });
window.addEventListener('load', start);
