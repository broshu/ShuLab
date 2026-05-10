(() => {
    const canvas = document.getElementById("fieldCanvas");
    const ctx = canvas.getContext("2d");

    const ui = {
        controls: document.getElementById("chargeControls"),
        resetBtn: document.getElementById("resetButton"),
        equipToggle: document.getElementById("equipToggle"),
        addBtn: document.getElementById("addChargeButton")
    };

    const C = {
        heightRatio: 0.6, minH: 420, maxH: 620,
        radius: 12, hitR: 18, pad: 18,
        step: 6, grid: 40, soft: 36, arrow: 7,
        equipStep: 18, equipLevels: 8
    };

    const MARCH = {
        1: [["left","top"]],    2: [["top","right"]],   3: [["left","right"]],
        4: [["right","bottom"]], 5: [["top","right"],["left","bottom"]],
        6: [["top","bottom"]],  7: [["left","bottom"]], 8: [["bottom","left"]],
        9: [["top","bottom"]],  10:[["top","left"],["right","bottom"]],
        11:[["right","bottom"]],12:[["left","right"]],  13:[["top","right"]],
        14:[["left","top"]]
    };

    const state = {
        charges: [
            { id: "A", x: 0, y: 0, q: 1 },
            { id: "B", x: 0, y: 0, q: -1 }
        ],
        drag: null
    };

    const views = [];
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const fmtQ = q => `${q >= 0 ? "+" : "−"}${Math.abs(q).toFixed(1)}`;
    const chargeId = i => i < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i] : `Q${i + 1}`;

    /* ── Canvas sizing ── */
    function resize(keepPos = true) {
        const rect = canvas.parentElement.getBoundingClientRect();
        const prevW = canvas.width || rect.width;
        const prevH = canvas.height || rect.height || C.minH;
        const w = rect.width;
        const h = clamp(Math.round(w * C.heightRatio), C.minH, C.maxH);
        canvas.width = w; canvas.height = h;
        canvas.style.width = "100%"; canvas.style.height = `${h}px`;
        if (keepPos && prevW && prevH) {
            const sx = w / prevW, sy = h / prevH;
            state.charges.forEach(c => { c.x *= sx; c.y *= sy; });
        }
    }

    function placeDefaults() {
        const [a, b] = state.charges;
        if (a) { a.x = canvas.width * 0.35; a.y = canvas.height * 0.5; }
        if (b) { b.x = canvas.width * 0.65; b.y = canvas.height * 0.5; }
    }

    function distributeExtra() {
        const extra = state.charges.slice(2);
        if (!extra.length) return;
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const r = Math.min(canvas.width, canvas.height) * 0.28;
        extra.forEach((c, i) => {
            const a = (2 * Math.PI * i) / extra.length - Math.PI / 2;
            c.x = clamp(cx + Math.cos(a) * r, C.pad, canvas.width - C.pad);
            c.y = clamp(cy + Math.sin(a) * r, C.pad, canvas.height - C.pad);
        });
    }

    /* ── UI panels ── */
    function updatePanel(i) {
        const c = state.charges[i], v = views[i];
        if (!c || !v) return;
        v.slider.value = Math.abs(c.q).toFixed(1);
        v.val.textContent = fmtQ(c.q);
        v.pol.textContent = c.q >= 0 ? "正极" : "负极";
        v.pol.classList.toggle("negative", c.q < 0);
        v.dot.classList.toggle("positive", c.q >= 0);
        v.dot.classList.toggle("negative", c.q < 0);
    }
    const syncUI = () => state.charges.forEach((_, i) => updatePanel(i));

    function makePanel(c, i) {
        const el = document.createElement("div");
        el.className = "charge-panel";
        el.innerHTML = `
            <div class="panel-header">
                <span class="dot"></span>
                <div><p class="label">电荷 ${c.id}</p><p class="small">拖拽画布中的圆点</p></div>
                <button class="polarity-button"></button>
            </div>
            <label class="slider-row">
                <span>电量强度</span>
                <input type="range" min="0.2" max="3" step="0.1">
                <span class="value"></span>
            </label>`;

        const dot = el.querySelector(".dot");
        const pol = el.querySelector(".polarity-button");
        const slider = el.querySelector("input");
        const val = el.querySelector(".value");

        pol.addEventListener("click", () => { c.q *= -1; updatePanel(i); draw(); });
        slider.addEventListener("input", () => {
            c.q = (c.q >= 0 ? 1 : -1) * parseFloat(slider.value);
            updatePanel(i); draw();
        });

        views[i] = { dot, pol, slider, val };
        updatePanel(i);
        return el;
    }

    function renderPanels() {
        ui.controls.innerHTML = "";
        views.length = 0;
        state.charges.forEach((c, i) => ui.controls.appendChild(makePanel(c, i)));
    }

    /* ── Physics ── */
    function fieldAt(x, y) {
        let ex = 0, ey = 0;
        for (const c of state.charges) {
            const dx = x - c.x, dy = y - c.y;
            const r2 = dx * dx + dy * dy + C.soft;
            const inv = 1 / Math.pow(r2, 1.5);
            ex += c.q * dx * inv;
            ey += c.q * dy * inv;
        }
        return { x: ex, y: ey };
    }

    function potentialAt(x, y) {
        let v = 0;
        for (const c of state.charges) {
            const dx = x - c.x, dy = y - c.y;
            v += c.q / Math.sqrt(dx * dx + dy * dy + C.soft);
        }
        return v;
    }

    const nearCharge = p => state.charges.some(c => Math.hypot(p.x - c.x, p.y - c.y) < C.radius + 2);

    /* ── Field line tracing ── */
    function traceLine(start, sign) {
        const path = [start];
        let cur = { ...start };
        for (let i = 0; i < 2400; i++) {
            const e = fieldAt(cur.x, cur.y);
            const m = Math.hypot(e.x, e.y);
            if (m < 1e-6) break;
            cur = { x: cur.x + (e.x / m) * sign * C.step, y: cur.y + (e.y / m) * sign * C.step };
            path.push(cur);
            if (cur.x < 2 || cur.x > canvas.width - 2 || cur.y < 2 || cur.y > canvas.height - 2 || nearCharge(cur)) break;
        }
        return path;
    }

    function genLines() {
        const lines = [];
        for (const c of state.charges) {
            const n = Math.max(12, Math.round(Math.abs(c.q) * 12));
            const off = (Math.PI / n) * 0.3;
            for (let i = 0; i < n; i++) {
                const a = (2 * Math.PI * i) / n + off;
                const start = { x: c.x + Math.cos(a) * C.hitR, y: c.y + Math.sin(a) * C.hitR };
                const path = traceLine(start, c.q >= 0 ? 1 : -1);
                lines.push(c.q >= 0 ? path : path.slice().reverse());
            }
        }
        return lines;
    }

    /* ── Equipotential (marching squares) ── */
    function potGrid() {
        const s = C.equipStep;
        const cols = Math.ceil(canvas.width / s) + 1;
        const rows = Math.ceil(canvas.height / s) + 1;
        const vals = new Array(cols * rows);
        let min = Infinity, max = -Infinity;
        for (let j = 0; j < rows; j++)
            for (let i = 0; i < cols; i++) {
                const v = potentialAt(i * s, j * s);
                vals[j * cols + i] = v;
                if (v < min) min = v;
                if (v > max) max = v;
            }
        return { vals, cols, rows, min, max, step: s, maxAbs: Math.max(Math.abs(min), Math.abs(max)) };
    }

    function isoLevels(min, max) {
        const ma = Math.max(Math.abs(min), Math.abs(max));
        if (ma < 1e-4) return [];
        const s = ma / C.equipLevels;
        const lvs = [];
        for (let i = -C.equipLevels; i <= C.equipLevels; i++) if (i !== 0) lvs.push(i * s);
        lvs.push(0);
        return lvs.sort((a, b) => a - b);
    }

    function marchSquares(g, iso) {
        const segs = [], { vals, cols, rows, step: s } = g;
        const lerp = (p1, p2, v1, v2) => {
            const t = (iso - v1) / (v2 - v1 || 1e-6);
            return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
        };
        for (let j = 0; j < rows - 1; j++)
            for (let i = 0; i < cols - 1; i++) {
                const idx = j * cols + i;
                const v = [vals[idx], vals[idx + 1], vals[idx + cols + 1], vals[idx + cols]];
                let mask = 0;
                if (v[0] >= iso) mask |= 1;
                if (v[1] >= iso) mask |= 2;
                if (v[2] >= iso) mask |= 4;
                if (v[3] >= iso) mask |= 8;
                if (mask === 0 || mask === 15) continue;
                const o = { x: i * s, y: j * s };
                const edges = {
                    top:    lerp(o, { x: o.x + s, y: o.y }, v[0], v[1]),
                    right:  lerp({ x: o.x + s, y: o.y }, { x: o.x + s, y: o.y + s }, v[1], v[2]),
                    bottom: lerp({ x: o.x + s, y: o.y + s }, { x: o.x, y: o.y + s }, v[2], v[3]),
                    left:   lerp({ x: o.x, y: o.y + s }, { x: o.x, y: o.y }, v[3], v[0])
                };
                (MARCH[mask] || []).forEach(([a, b]) => segs.push([edges[a], edges[b]]));
            }
        return segs;
    }

    /* ── Drawing ── */
    function drawGrid() {
        ctx.strokeStyle = "rgba(12,50,90,0.06)";
        ctx.lineWidth = 1;
        for (let x = C.grid; x < canvas.width; x += C.grid) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = C.grid; y < canvas.height; y += C.grid) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }
    }

    function drawLines(lines) {
        ctx.lineWidth = 1.4;
        for (const path of lines) {
            if (path.length < 2) continue;
            const g = ctx.createLinearGradient(path[0].x, path[0].y, path.at(-1).x, path.at(-1).y);
            g.addColorStop(0, "rgba(244,91,105,0.85)");
            g.addColorStop(1, "rgba(45,127,249,0.85)");
            ctx.strokeStyle = g;
            ctx.beginPath();
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
            ctx.stroke();
            if (path.length > 8) {
                const m = Math.floor(path.length / 2);
                const a = Math.atan2(path[m].y - path[m - 1].y, path[m].x - path[m - 1].x);
                ctx.save();
                ctx.translate(path[m].x, path[m].y);
                ctx.rotate(a);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-C.arrow, C.arrow * 0.6);
                ctx.lineTo(-C.arrow, -C.arrow * 0.6);
                ctx.closePath();
                ctx.fillStyle = "rgba(40,60,90,0.85)";
                ctx.fill();
                ctx.restore();
            }
        }
    }

    function drawEquip() {
        if (!ui.equipToggle.checked) return;
        const g = potGrid();
        const lvs = isoLevels(g.min, g.max);
        for (const lv of lvs) {
            const segs = marchSquares(g, lv);
            if (!segs.length) continue;
            const ratio = Math.min(Math.abs(lv) / (g.maxAbs || 1), 1);
            const alpha = 0.25 + 0.35 * (1 - ratio);
            ctx.lineWidth = lv === 0 ? 1.6 : 1;
            ctx.strokeStyle = lv === 0
                ? "rgba(24,36,60,0.6)"
                : lv > 0 ? `rgba(138,108,255,${alpha.toFixed(3)})` : `rgba(56,198,217,${alpha.toFixed(3)})`;
            for (const [p1, p2] of segs) {
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            }
        }
    }

    function drawCharges() {
        for (let i = 0; i < state.charges.length; i++) {
            const c = state.charges[i];
            const color = c.q >= 0 ? "#f45b69" : "#2d7ff9";
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = state.drag === i ? 16 : 10;
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(c.x, c.y, C.radius, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.beginPath(); ctx.arc(c.x, c.y, C.radius + 2, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(c.q >= 0 ? "+" : "−", c.x, c.y);
            ctx.fillStyle = "rgba(12,26,48,0.85)"; ctx.font = "11px sans-serif";
            ctx.textBaseline = "bottom";
            ctx.fillText(c.id, c.x, c.y - C.radius - 4);
            ctx.restore();
        }
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid();
        drawLines(genLines());
        drawEquip();
        drawCharges();
    }

    /* ── Dragging ── */
    function toCanvas(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * canvas.width, y: (e.clientY - r.top) / r.height * canvas.height };
    }

    canvas.addEventListener("pointerdown", e => {
        const p = toCanvas(e);
        const i = state.charges.findIndex(c => Math.hypot(p.x - c.x, p.y - c.y) < C.hitR);
        if (i !== -1) { state.drag = i; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener("pointermove", e => {
        if (state.drag === null) return;
        const p = toCanvas(e);
        state.charges[state.drag].x = clamp(p.x, C.pad, canvas.width - C.pad);
        state.charges[state.drag].y = clamp(p.y, C.pad, canvas.height - C.pad);
        draw();
    });
    const stopDrag = e => {
        if (state.drag !== null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        state.drag = null;
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    canvas.addEventListener("pointerleave", stopDrag);

    /* ── Controls ── */
    ui.resetBtn.addEventListener("click", () => {
        state.charges.forEach((c, i) => { c.q = i === 1 ? -1 : 1; });
        placeDefaults(); distributeExtra();
        ui.equipToggle.checked = false; syncUI(); draw();
    });
    ui.equipToggle.addEventListener("change", draw);
    ui.addBtn.addEventListener("click", () => {
        const i = state.charges.length;
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const a = (i - 1) * (Math.PI / 3) - Math.PI / 2;
        const spread = Math.min(canvas.width, canvas.height) * 0.18 + i * 6;
        state.charges.push({
            id: chargeId(i),
            x: clamp(cx + Math.cos(a) * spread, C.pad, canvas.width - C.pad),
            y: clamp(cy + Math.sin(a) * spread, C.pad, canvas.height - C.pad),
            q: 1
        });
        renderPanels(); draw();
    });

    window.addEventListener("resize", () => { resize(true); draw(); });

    /* ── Init ── */
    resize(false);
    placeDefaults();
    renderPanels();
    ui.equipToggle.checked = false;
    syncUI();
    draw();
})();
