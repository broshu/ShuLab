(() => {
    const canvas = document.getElementById("motionCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const $ = id => document.getElementById(id);
    const ui = {
        polarity: $("polarityToggle"), speed: $("speedInput"), angle: $("angleInput"),
        speedLbl: $("speedLabel"), angleLbl: $("angleLabel"),
        start: $("startButton"), reset: $("resetMotionButton"),
        sStat: $("speedStat"), fStat: $("forceStat"), tStat: $("timeStat"),
        fieldBtns: $("fieldTypeButtons")
    };

    const C = {
        hRatio: 0.5, minH: 360, maxH: 520,
        mass: 1,
        dtMax: 0.04, margin: 18, pathMax: 1200,
        vScale: 0.4, fScale: 0.38,
        mHitR: 14,       // M point hit radius
        soft: 800         // softening for point charges
    };

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const n2 = v => v.toFixed(2);

    /* ── Field types ── */
    // Each field type defines: fieldAt(x,y), drawFieldBg(), sourceCharges (for display)
    const fieldTypes = {
        uniform: {
            label: "匀强电场",
            E: { x: 28, y: 0 },
            fieldAt(x, y) { return { x: this.E.x, y: this.E.y }; },
            drawBg() { drawUniformField(this.E); },
            srcCharges() { return []; }
        },
        same: {
            label: "等量同种电荷",
            q1: 1, q2: 1,
            pos1() { return { x: canvas.width * 0.35, y: canvas.height * 0.5 }; },
            pos2() { return { x: canvas.width * 0.65, y: canvas.height * 0.5 }; },
            srcCharges() { return [{ ...this.pos1(), q: this.q1 }, { ...this.pos2(), q: this.q2 }]; },
            fieldAt(x, y) { return pointChargeField(x, y, this.srcCharges()); },
            drawBg() {
                const ch = this.srcCharges();
                drawPointChargeFieldLines(ch);
                drawChargeMarker(ch[0], "+", "#f45b69");
                drawChargeMarker(ch[1], "+", "#f45b69");
            }
        },
        opposite: {
            label: "等量异种电荷",
            q1: 1, q2: -1,
            pos1() { return { x: canvas.width * 0.3, y: canvas.height * 0.5 }; },
            pos2() { return { x: canvas.width * 0.7, y: canvas.height * 0.5 }; },
            srcCharges() { return [{ ...this.pos1(), q: this.q1 }, { ...this.pos2(), q: this.q2 }]; },
            fieldAt(x, y) { return pointChargeField(x, y, this.srcCharges()); },
            drawBg() {
                const ch = this.srcCharges();
                drawPointChargeFieldLines(ch);
                drawChargeMarker(ch[0], "+", "#f45b69");
                drawChargeMarker(ch[1], "−", "#2d7ff9");
            }
        },
        pointPos: {
            label: "正点电荷",
            q: 1,
            center() { return { x: canvas.width * 0.5, y: canvas.height * 0.5 }; },
            srcCharges() { return [{ ...this.center(), q: this.q }]; },
            fieldAt(x, y) { return pointChargeField(x, y, this.srcCharges()); },
            drawBg() {
                const ch = this.srcCharges();
                drawPointChargeFieldLines(ch);
                drawChargeMarker(ch[0], "+", "#f45b69");
            }
        },
        pointNeg: {
            label: "负点电荷",
            q: -1,
            center() { return { x: canvas.width * 0.5, y: canvas.height * 0.5 }; },
            srcCharges() { return [{ ...this.center(), q: this.q }]; },
            fieldAt(x, y) { return pointChargeField(x, y, this.srcCharges()); },
            drawBg() {
                const ch = this.srcCharges();
                drawPointChargeFieldLines(ch);
                drawChargeMarker(ch[0], "−", "#2d7ff9");
            }
        }
    };

    /* ── State ── */
    const s = {
        q: 1, speed: parseFloat(ui.speed?.value || "140"),
        angleDeg: parseFloat(ui.angle?.value || "18"),
        mPos: { x: 0, y: 0 },   // M point position (draggable)
        pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
        path: [], running: false, time: 0, lastT: null,
        fieldType: "uniform",
        draggingM: false,
        explosion: null   // { x, y, t0, particles, done }
    };

    const currentField = () => fieldTypes[s.fieldType];
    const fieldAt = (x, y) => currentField().fieldAt(x, y);
    const accel = () => {
        const e = fieldAt(s.pos.x, s.pos.y);
        return { x: s.q * e.x / C.mass, y: s.q * e.y / C.mass };
    };
    const fMag = () => {
        const e = fieldAt(s.pos.x, s.pos.y);
        return Math.hypot(e.x, e.y);
    };
    const defaultM = () => ({ x: canvas.width * 0.16, y: canvas.height * 0.72 });
    const inBounds = p => p.x > C.margin && p.y > C.margin && p.x < canvas.width - C.margin && p.y < canvas.height - C.margin;

    /* ── Point charge field helpers ── */
    function pointChargeField(x, y, charges) {
        let ex = 0, ey = 0;
        for (const c of charges) {
            const dx = x - c.x, dy = y - c.y;
            const r2 = dx * dx + dy * dy + C.soft;
            const inv = 1 / Math.pow(r2, 1.5);
            ex += c.q * dx * inv * 5e5;
            ey += c.q * dy * inv * 5e5;
        }
        return { x: ex, y: ey };
    }

    function traceFieldLine(start, sign, charges) {
        const path = [start];
        let cur = { ...start };
        const step = 5;
        for (let i = 0; i < 1200; i++) {
            const e = pointChargeField(cur.x, cur.y, charges);
            const m = Math.hypot(e.x, e.y);
            if (m < 1e-6) break;
            cur = { x: cur.x + (e.x / m) * sign * step, y: cur.y + (e.y / m) * sign * step };
            path.push(cur);
            if (cur.x < 2 || cur.x > canvas.width - 2 || cur.y < 2 || cur.y > canvas.height - 2) break;
            if (charges.some(c => Math.hypot(cur.x - c.x, cur.y - c.y) < 14)) break;
        }
        return path;
    }

    /* ── Drawing helpers ── */
    function resize() {
        const w = canvas.parentElement.getBoundingClientRect().width;
        const h = clamp(Math.round(w * C.hRatio), C.minH, C.maxH);
        canvas.width = w; canvas.height = h;
        canvas.style.width = "100%"; canvas.style.height = `${h}px`;
    }

    function syncInputs() {
        s.speed = parseFloat(ui.speed.value) || 0;
        s.angleDeg = parseFloat(ui.angle.value) || 0;
        ui.speedLbl.textContent = s.speed.toFixed(0);
        ui.angleLbl.textContent = `${s.angleDeg.toFixed(0)}°`;
        ui.polarity.textContent = s.q >= 0 ? "正电荷" : "负电荷";
    }

    function resetMotion() {
        s.running = false; s.lastT = null; s.time = 0; s.explosion = null;
        s.pos = { ...s.mPos };
        const rad = s.angleDeg * Math.PI / 180;
        s.vel = { x: s.speed * Math.cos(rad), y: -s.speed * Math.sin(rad) };
        s.path = [{ ...s.mPos }];
        ui.start.textContent = "开始";
        draw(); updateStats();
    }

    function drawArrow(from, to, color) {
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.save(); ctx.translate(to.x, to.y); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, 4.8); ctx.lineTo(-8, -4.8); ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    function drawSmallArrow(from, dir, color) {
        const to = { x: from.x + dir.x * 12, y: from.y + dir.y * 12 };
        const a = Math.atan2(dir.y, dir.x);
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(from.x - dir.x * 12, from.y - dir.y * 12); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.save(); ctx.translate(to.x, to.y); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 3.6); ctx.lineTo(-6, -3.6); ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    function drawBg() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        g.addColorStop(0, "rgba(244,247,255,0.95)");
        g.addColorStop(1, "rgba(230,238,252,0.9)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /* ── Uniform field drawing ── */
    function drawUniformField(E) {
        const m = Math.hypot(E.x, E.y);
        if (m < 1e-3) return;
        const dir = { x: E.x / m, y: E.y / m };
        const perp = { x: -dir.y, y: dir.x };
        const half = Math.max(canvas.width, canvas.height) * 0.65;
        ctx.lineWidth = 1.3; ctx.strokeStyle = "rgba(15,44,86,0.35)";

        for (let i = -3; i <= 3; i++) {
            const ox = perp.x * 86 * i + canvas.width / 2;
            const oy = perp.y * 86 * i + canvas.height / 2;
            const a = { x: ox - dir.x * half, y: oy - dir.y * half };
            const b = { x: ox + dir.x * half, y: oy + dir.y * half };
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const segs = Math.floor(half / 90);
            for (let j = 1; j <= segs * 2; j++) {
                const t = j / (segs * 2);
                const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
                drawSmallArrow({ x: px, y: py }, dir, "rgba(15,44,86,0.5)");
            }
        }
    }

    /* ── Point charge field line drawing ── */
    function drawPointChargeFieldLines(charges) {
        ctx.lineWidth = 1.2;
        for (const c of charges) {
            const n = Math.max(12, Math.round(Math.abs(c.q) * 14));
            for (let i = 0; i < n; i++) {
                const a = (2 * Math.PI * i) / n;
                const start = { x: c.x + Math.cos(a) * 18, y: c.y + Math.sin(a) * 18 };
                const path = traceFieldLine(start, c.q >= 0 ? 1 : -1, charges);
                if (path.length < 2) continue;
                const ordered = c.q >= 0 ? path : path.slice().reverse();

                const g = ctx.createLinearGradient(
                    ordered[0].x, ordered[0].y,
                    ordered[ordered.length - 1].x, ordered[ordered.length - 1].y
                );
                g.addColorStop(0, "rgba(244,91,105,0.6)");
                g.addColorStop(1, "rgba(45,127,249,0.6)");
                ctx.strokeStyle = g;
                ctx.beginPath();
                ctx.moveTo(ordered[0].x, ordered[0].y);
                for (let k = 1; k < ordered.length; k++) ctx.lineTo(ordered[k].x, ordered[k].y);
                ctx.stroke();

                // Arrow at midpoint
                if (ordered.length > 8) {
                    const mid = Math.floor(ordered.length / 2);
                    const ang = Math.atan2(ordered[mid].y - ordered[mid - 1].y, ordered[mid].x - ordered[mid - 1].x);
                    ctx.save(); ctx.translate(ordered[mid].x, ordered[mid].y); ctx.rotate(ang);
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 3.6); ctx.lineTo(-6, -3.6);
                    ctx.closePath(); ctx.fillStyle = "rgba(40,60,90,0.6)"; ctx.fill();
                    ctx.restore();
                }
            }
        }
    }

    function drawChargeMarker(pos, label, color) {
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = 10;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, pos.x, pos.y);
        ctx.restore();
    }

    /* ── Explosion system ── */
    const EXPLODE_DURATION = 4.0;
    const COLLIDE_R = 18;

    function spawnExplosion(x, y) {
        const W = canvas.width, H = canvas.height;
        const diag = Math.hypot(W, H);
        const particles = [];

        // Wave 1 — massive core burst (250 particles)
        for (let i = 0; i < 250; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 700;
            const size = 2 + Math.random() * 8;
            const life = 0.8 + Math.random() * 2.6;
            const r = Math.random();
            const hue = r < 0.35 ? (350 + Math.random() * 25)    // red
                      : r < 0.7  ? (15 + Math.random() * 35)     // orange-yellow
                      :            (40 + Math.random() * 20);     // bright yellow
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size, life, maxLife: life, hue,
                spark: Math.random() < 0.4,
                ember: false, shard: false
            });
        }

        // Wave 2 — slow embers that linger (80 particles)
        for (let i = 0; i < 80; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 120;
            particles.push({
                x: x + (Math.random() - 0.5) * 60,
                y: y + (Math.random() - 0.5) * 60,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.5 + Math.random() * 4,
                life: 1.5 + Math.random() * 2.2,
                maxLife: 3.7, hue: 20 + Math.random() * 30,
                spark: true, ember: true, shard: false
            });
        }

        // Wave 3 — screen-edge shards that crack outward (40 big chunks)
        for (let i = 0; i < 40; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 300 + Math.random() * 500;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 6 + Math.random() * 14,
                life: 1.0 + Math.random() * 1.5,
                maxLife: 2.5, hue: 0,
                spark: false, ember: false, shard: true
            });
        }

        // Multiple shockwave rings at different speeds
        const rings = [];
        for (let r = 0; r < 3; r++) {
            rings.push({ speed: (0.8 + r * 0.5) * diag, width: 14 - r * 4, delay: r * 0.12 });
        }

        // Generate cracks from impact point to edges
        const cracks = [];
        const nCracks = 10 + Math.floor(Math.random() * 6);
        for (let i = 0; i < nCracks; i++) {
            const angle = Math.random() * Math.PI * 2;
            const len = diag * (0.3 + Math.random() * 0.7);
            const pts = [{ x, y }];
            let cx = x, cy = y;
            const segs = 8 + Math.floor(Math.random() * 10);
            for (let j = 0; j < segs; j++) {
                const segLen = len / segs;
                const wobble = (Math.random() - 0.5) * 0.6;
                cx += Math.cos(angle + wobble) * segLen;
                cy += Math.sin(angle + wobble) * segLen;
                pts.push({ x: cx, y: cy });
            }
            cracks.push({ pts, width: 1.5 + Math.random() * 3, delay: Math.random() * 0.3 });
        }

        return {
            x, y, t0: performance.now() / 1000,
            particles, rings, cracks,
            flash: 1, burnOut: 0
        };
    }

    function checkCollision() {
        const charges = currentField().srcCharges();
        for (const c of charges) {
            if (c.q * s.q >= 0) continue;
            const dist = Math.hypot(s.pos.x - c.x, s.pos.y - c.y);
            if (dist < COLLIDE_R) {
                s.running = false;
                s.explosion = spawnExplosion((s.pos.x + c.x) / 2, (s.pos.y + c.y) / 2);
                ui.start.textContent = "重新开始";
                requestAnimationFrame(explosionLoop);
                return true;
            }
        }
        return false;
    }

    function updateExplosion(dt) {
        const ex = s.explosion;
        ex.flash = Math.max(0, ex.flash - dt * 1.2);
        // burnOut grows from 0→1 after 1.5s, darkens the whole screen
        const elapsed = performance.now() / 1000 - ex.t0;
        ex.burnOut = clamp((elapsed - 1.5) / 2.0, 0, 1);
        for (const p of ex.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.shard) {
                p.vx *= 0.94; p.vy *= 0.94;
            } else {
                p.vx *= 0.98; p.vy *= 0.98;
                p.vy += (p.ember ? 30 : 80) * dt;
            }
            p.life -= dt;
        }
    }

    function drawExplosion() {
        const ex = s.explosion;
        if (!ex) return;
        const W = canvas.width, H = canvas.height;
        const elapsed = performance.now() / 1000 - ex.t0;

        // ── Heavy screen shake (longer & stronger) ──
        const shakeAmp = Math.max(0, 30 * (1 - elapsed / 1.5));
        if (shakeAmp > 0.3) {
            ctx.save();
            ctx.translate(
                (Math.random() - 0.5) * shakeAmp * 2,
                (Math.random() - 0.5) * shakeAmp * 2
            );
        }

        // ── Blinding white flash ──
        if (ex.flash > 0) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, ex.flash);
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        // ── Multiple shockwave rings ──
        for (const ring of ex.rings) {
            const rt = elapsed - ring.delay;
            if (rt < 0 || rt > 1.2) continue;
            const t = rt / 1.2;
            const ringR = t * ring.speed * 0.6;
            const alpha = (1 - t) * 0.7;
            ctx.save();
            ctx.strokeStyle = `rgba(255,220,80,${alpha.toFixed(3)})`;
            ctx.lineWidth = ring.width * (1 - t * 0.5);
            ctx.beginPath();
            ctx.arc(ex.x, ex.y, ringR, 0, Math.PI * 2);
            ctx.stroke();
            // hot white inner edge
            ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.7).toFixed(3)})`;
            ctx.lineWidth = ring.width * 0.3 * (1 - t);
            ctx.beginPath();
            ctx.arc(ex.x, ex.y, ringR * 0.92, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // ── Massive central fireball ──
        const fbT = clamp(elapsed / 2.0, 0, 1);
        if (fbT < 1) {
            const fbR = 50 + fbT * 200;
            const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, fbR);
            const a1 = ((1 - fbT) ** 1.5).toFixed(3);
            const a2 = ((1 - fbT) ** 2 * 0.6).toFixed(3);
            grad.addColorStop(0,   `rgba(255,255,220,${a1})`);
            grad.addColorStop(0.2, `rgba(255,200,60,${a1})`);
            grad.addColorStop(0.5, `rgba(255,80,10,${a2})`);
            grad.addColorStop(1,   `rgba(180,20,0,0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(ex.x, ex.y, fbR, 0, Math.PI * 2);
            ctx.fill();
        }

        // ── Screen cracks (dark jagged lines) ──
        for (const crack of ex.cracks) {
            const ct = clamp((elapsed - crack.delay) / 0.15, 0, 1);
            if (ct <= 0) continue;
            const nPts = Math.ceil(crack.pts.length * ct);
            const fade = clamp(1 - (elapsed - 1.8) / 1.5, 0, 1);
            if (fade <= 0) continue;
            ctx.save();
            ctx.globalAlpha = fade * 0.9;
            // glow behind crack
            ctx.strokeStyle = "rgba(255,160,40,0.6)";
            ctx.lineWidth = crack.width + 4;
            ctx.beginPath();
            ctx.moveTo(crack.pts[0].x, crack.pts[0].y);
            for (let i = 1; i < nPts; i++) ctx.lineTo(crack.pts[i].x, crack.pts[i].y);
            ctx.stroke();
            // dark crack line
            ctx.strokeStyle = "rgba(10,0,0,0.85)";
            ctx.lineWidth = crack.width;
            ctx.beginPath();
            ctx.moveTo(crack.pts[0].x, crack.pts[0].y);
            for (let i = 1; i < nPts; i++) ctx.lineTo(crack.pts[i].x, crack.pts[i].y);
            ctx.stroke();
            ctx.restore();
        }

        // ── Particles ──
        for (const p of ex.particles) {
            if (p.life <= 0) continue;
            const alpha = clamp(p.life / p.maxLife, 0, 1);

            if (p.shard) {
                // Dark shards with fiery edge
                const sz = p.size * (0.4 + alpha * 0.6);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate(Math.atan2(p.vy, p.vx));
                // glow
                ctx.shadowColor = "rgba(255,100,20,0.8)";
                ctx.shadowBlur = 12;
                ctx.fillStyle = `rgba(30,10,5,${(alpha * 0.9).toFixed(3)})`;
                ctx.fillRect(-sz, -sz * 0.4, sz * 2, sz * 0.8);
                ctx.restore();
                continue;
            }

            const r = p.size * (p.spark ? (0.6 + alpha * 0.4) : alpha);
            ctx.save();
            ctx.globalAlpha = alpha;
            if (p.spark || p.ember) {
                ctx.shadowColor = `hsl(${p.hue},100%,70%)`;
                ctx.shadowBlur = p.ember ? 14 : 10;
            }
            ctx.fillStyle = `hsl(${p.hue},${p.spark ? 100 : 90}%,${p.spark ? 82 : 58}%)`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
            ctx.fill();
            // Extra bright core for sparks
            if (p.spark && alpha > 0.3) {
                ctx.fillStyle = "#fff";
                ctx.globalAlpha = alpha * 0.6;
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(0.3, r * 0.4), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // ── Burning screen edges (vignette fire) ──
        const burnT = clamp((elapsed - 0.3) / 1.0, 0, 1);
        if (burnT > 0) {
            const burnFade = clamp(1 - (elapsed - 2.5) / 1.2, 0, 1);
            const ba = (burnT * burnFade * 0.7).toFixed(3);
            // Dark corners
            const edgeGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.55);
            edgeGrad.addColorStop(0, `rgba(0,0,0,0)`);
            edgeGrad.addColorStop(0.6, `rgba(40,5,0,${(ba * 0.5).toFixed ? (ba * 0.5).toFixed(3) : 0})`);
            edgeGrad.addColorStop(1, `rgba(0,0,0,${ba})`);
            ctx.fillStyle = edgeGrad;
            ctx.fillRect(0, 0, W, H);
        }

        // ── Final burn-to-black ──
        if (ex.burnOut > 0) {
            ctx.save();
            ctx.globalAlpha = ex.burnOut * 0.85;
            ctx.fillStyle = "#0a0000";
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        if (shakeAmp > 0.3) ctx.restore();
    }

    function explosionLoop(ts) {
        const ex = s.explosion;
        if (!ex) return;
        const elapsed = ts / 1000 - ex.t0;
        if (elapsed > EXPLODE_DURATION) {
            s.explosion = null;
            draw();
            return;
        }
        updateExplosion(0.016);
        drawBg();
        currentField().drawBg();
        drawPath();
        drawExplosion();
        requestAnimationFrame(explosionLoop);
    }

    /* ── Main drawing ── */
    function drawPath() {
        if (s.path.length < 2) return;
        ctx.save(); ctx.strokeStyle = "rgba(15,44,86,0.85)";
        ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.path[0].x, s.path[0].y);
        for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
        ctx.stroke(); ctx.restore();
    }

    function drawMarkers() {
        const mp = s.mPos;
        // M point - draw with a ring to show it's draggable
        ctx.save();
        ctx.fillStyle = s.draggingM ? "rgba(15,44,86,0.3)" : "rgba(15,44,86,0.12)";
        ctx.beginPath(); ctx.arc(mp.x, mp.y, C.mHitR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(15,44,86,0.4)"; ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(mp.x, mp.y, C.mHitR, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#0f2c56";
        ctx.beginPath(); ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.font = "bold 13px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText("M", mp.x - 10, mp.y - 14);
        ctx.restore();

        // Current particle position
        ctx.fillStyle = "#0f2c56";
        ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(s.q >= 0 ? "+" : "−", s.pos.x, s.pos.y);
        ctx.fillStyle = "#0f2c56"; ctx.font = "13px sans-serif";
        ctx.textAlign = "left"; ctx.fillText("N", s.pos.x + 10, s.pos.y - 10);
    }

    function drawVecs() {
        drawArrow(s.pos, {
            x: s.pos.x + s.vel.x * C.vScale,
            y: s.pos.y + s.vel.y * C.vScale
        }, "rgba(45,127,249,0.9)");
        const a = accel();
        drawArrow(s.pos, {
            x: s.pos.x + a.x * C.mass * C.fScale,
            y: s.pos.y + a.y * C.mass * C.fScale
        }, "rgba(244,91,105,0.95)");
    }

    function draw() {
        drawBg();
        currentField().drawBg();
        drawPath();
        drawVecs();
        drawMarkers();
    }

    function updateStats() {
        ui.sStat.textContent = n2(Math.hypot(s.vel.x, s.vel.y));
        ui.fStat.textContent = n2(Math.abs(s.q) * fMag());
        ui.tStat.textContent = n2(s.time);
    }

    /* ── Simulation ── */
    function step(dt) {
        const a = accel();
        s.vel.x += a.x * dt; s.vel.y += a.y * dt;
        s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt;
        s.time += dt;
        s.path.push({ ...s.pos });
        if (s.path.length > C.pathMax) s.path.shift();
        if (checkCollision()) return;
        if (!inBounds(s.pos)) { s.running = false; ui.start.textContent = "重新开始"; }
    }

    function loop(ts) {
        if (!s.running) return;
        if (!s.lastT) s.lastT = ts;
        step(Math.min((ts - s.lastT) / 1000, C.dtMax));
        s.lastT = ts;
        draw(); updateStats();
        if (s.running) requestAnimationFrame(loop);
    }

    function toggleRun() {
        if (!inBounds(s.pos) || ui.start.textContent === "重新开始") resetMotion();
        if (s.running) { s.running = false; ui.start.textContent = "继续"; return; }
        s.running = true; s.lastT = null;
        ui.start.textContent = "暂停";
        requestAnimationFrame(loop);
    }

    /* ── M point dragging ── */
    function toCanvas(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * canvas.width, y: (e.clientY - r.top) / r.height * canvas.height };
    }

    canvas.addEventListener("pointerdown", e => {
        const p = toCanvas(e);
        if (Math.hypot(p.x - s.mPos.x, p.y - s.mPos.y) < C.mHitR + 4) {
            s.draggingM = true;
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = "grabbing";
        }
    });

    canvas.addEventListener("pointermove", e => {
        if (!s.draggingM) {
            // Show grab cursor when hovering M
            const p = toCanvas(e);
            if (Math.hypot(p.x - s.mPos.x, p.y - s.mPos.y) < C.mHitR + 4) {
                canvas.style.cursor = "grab";
            } else {
                canvas.style.cursor = "";
            }
            return;
        }
        const p = toCanvas(e);
        s.mPos.x = clamp(p.x, C.margin, canvas.width - C.margin);
        s.mPos.y = clamp(p.y, C.margin, canvas.height - C.margin);
        if (!s.running) resetMotion();
        else draw();
    });

    const stopDrag = e => {
        if (s.draggingM) {
            s.draggingM = false;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            canvas.style.cursor = "";
            draw();
        }
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);

    /* ── Field type switching ── */
    ui.fieldBtns.addEventListener("click", e => {
        const btn = e.target.closest(".field-type-btn");
        if (!btn) return;
        const type = btn.dataset.type;
        if (!fieldTypes[type] || type === s.fieldType) return;
        ui.fieldBtns.querySelectorAll(".field-type-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        s.fieldType = type;
        resetMotion();
    });

    /* ── Controls ── */
    ui.speed.addEventListener("input", () => { syncInputs(); resetMotion(); });
    ui.angle.addEventListener("input", () => { syncInputs(); resetMotion(); });
    ui.polarity.addEventListener("click", () => { s.q *= -1; syncInputs(); resetMotion(); });
    ui.start.addEventListener("click", toggleRun);
    ui.reset.addEventListener("click", resetMotion);
    window.addEventListener("resize", () => {
        const oldW = canvas.width, oldH = canvas.height;
        resize();
        // Scale M position with canvas
        if (oldW && oldH) {
            s.mPos.x *= canvas.width / oldW;
            s.mPos.y *= canvas.height / oldH;
        }
        resetMotion();
    });

    /* ── Init ── */
    resize();
    s.mPos = defaultM();
    syncInputs();
    resetMotion();
})();
