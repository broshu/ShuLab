(() => {
    const canvas = document.getElementById("fieldMapCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    /* ── Config ── */
    const CFG = {
        hRatio: 0.58, minH: 400, maxH: 620,
        soft: 600,                // 3D softening
        chargeR: 14,              // screen px
        hitR: 22,
        step: 5, lineMax: 2000,
        arrowHead: 7,
        gridStep: 50, gridHalf: 240,
        handleR: 16, handleRing: 36, handleMargin: 50
    };
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    /* ── State ── */
    const state = {
        charges: [
            { id: "A", x: -90, y: 0, z: 0, q: 1 },
            { id: "B", x:  90, y: 0, z: 0, q: -1 }
        ],
        cam: { az: 0.45, el: 0.65 },
        scale: 1,
        drag: null,
        handle: { dragging: false, dx: 0, dy: 0, _az: 0, _el: 0, _m: null }
    };

    /* ── Canvas sizing ── */
    function resize() {
        const w = canvas.parentElement.getBoundingClientRect().width;
        const h = clamp(Math.round(w * CFG.hRatio), CFG.minH, CFG.maxH);
        canvas.width = w; canvas.height = h;
        canvas.style.width = "100%"; canvas.style.height = `${h}px`;
        state.scale = Math.min(w, h) / 340;
    }

    /* ── 3D projection (world → screen) ── */
    function proj(wx, wy, wz) {
        const { az, el } = state.cam;
        const ca = Math.cos(az), sa = Math.sin(az);
        const ce = Math.cos(el), se = Math.sin(el);
        const x1 = wx * ca - wy * sa;
        const y1 = wx * sa + wy * ca;
        const x2 = x1;
        const y2 = y1 * ce - wz * se;
        const z2 = y1 * se + wz * ce;
        const s = state.scale;
        return { sx: canvas.width / 2 + x2 * s, sy: canvas.height / 2 - z2 * s, depth: y2 };
    }

    /* Unproject screen → world z=0 plane */
    function unproj(sx, sy) {
        const { az, el } = state.cam;
        const ca = Math.cos(az), sa = Math.sin(az);
        const se = Math.sin(el);
        if (Math.abs(se) < 0.02) return null;
        const s = state.scale;
        const A = (sx - canvas.width / 2) / s;
        const B = (canvas.height / 2 - sy) / s;
        const bse = B / se;
        return { x: ca * A + sa * bse, y: -sa * A + ca * bse, z: 0 };
    }

    /* ── 3D Physics ── */
    function fieldAt(x, y, z) {
        let ex = 0, ey = 0, ez = 0;
        for (const c of state.charges) {
            const dx = x - c.x, dy = y - c.y, dz = z - c.z;
            const r2 = dx * dx + dy * dy + dz * dz + CFG.soft;
            const inv = 1 / Math.pow(r2, 1.5);
            ex += c.q * dx * inv;
            ey += c.q * dy * inv;
            ez += c.q * dz * inv;
        }
        return { x: ex, y: ey, z: ez };
    }

    const nearQ = p => state.charges.some(c =>
        Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < 14);

    /* ── 3D Field line tracing ── */
    function trace(start, sign) {
        const path = [start];
        let cur = { ...start };
        for (let i = 0; i < CFG.lineMax; i++) {
            const e = fieldAt(cur.x, cur.y, cur.z);
            const m = Math.hypot(e.x, e.y, e.z);
            if (m < 1e-8) break;
            cur = {
                x: cur.x + (e.x / m) * sign * CFG.step,
                y: cur.y + (e.y / m) * sign * CFG.step,
                z: cur.z + (e.z / m) * sign * CFG.step
            };
            path.push(cur);
            if (Math.hypot(cur.x, cur.y, cur.z) > 600) break;
            if (nearQ(cur)) break;
        }
        return path;
    }

    function genLines() {
        const lines = [];
        const R = 18;
        for (const c of state.charges) {
            const nEq  = Math.max(10, Math.round(Math.abs(c.q) * 10));
            const nRing = Math.max(6,  Math.round(Math.abs(c.q) * 6));
            // Equatorial ring (z = 0)
            for (let i = 0; i < nEq; i++) {
                const t = (2 * Math.PI * i) / nEq;
                const s = { x: c.x + Math.cos(t) * R, y: c.y + Math.sin(t) * R, z: c.z };
                const p = trace(s, c.q >= 0 ? 1 : -1);
                lines.push(c.q >= 0 ? p : p.slice().reverse());
            }
            // Upper ring (+40°)
            const zOff = R * Math.sin(0.70);
            const rOff = R * Math.cos(0.70);
            for (let i = 0; i < nRing; i++) {
                const t = (2 * Math.PI * i) / nRing;
                const s = { x: c.x + Math.cos(t) * rOff, y: c.y + Math.sin(t) * rOff, z: c.z + zOff };
                const p = trace(s, c.q >= 0 ? 1 : -1);
                lines.push(c.q >= 0 ? p : p.slice().reverse());
            }
            // Lower ring (−40°)
            for (let i = 0; i < nRing; i++) {
                const t = (2 * Math.PI * i) / nRing;
                const s = { x: c.x + Math.cos(t) * rOff, y: c.y + Math.sin(t) * rOff, z: c.z - zOff };
                const p = trace(s, c.q >= 0 ? 1 : -1);
                lines.push(c.q >= 0 ? p : p.slice().reverse());
            }
        }
        return lines;
    }

    /* ── Drawing ── */
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid();
        drawAxes();
        drawFieldLines();
        drawCharges();
        drawHandle();
    }

    function drawGrid() {
        const half = CFG.gridHalf, step = CFG.gridStep;
        ctx.strokeStyle = "rgba(12,50,90,0.08)";
        ctx.lineWidth = 1;
        for (let v = -half; v <= half; v += step) {
            let a = proj(-half, v, 0), b = proj(half, v, 0);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
            a = proj(v, -half, 0); b = proj(v, half, 0);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
    }

    function drawAxes() {
        const L = 70, o = proj(0, 0, 0);
        const axes = [
            { p: proj(L, 0, 0), c: "rgba(244,91,105,0.6)", l: "X" },
            { p: proj(0, L, 0), c: "rgba(76,175,80,0.6)",  l: "Y" },
            { p: proj(0, 0, L), c: "rgba(45,127,249,0.6)",  l: "Z" }
        ];
        for (const { p, c, l } of axes) {
            ctx.strokeStyle = c; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(p.sx, p.sy); ctx.stroke();
            ctx.fillStyle = c; ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(l, p.sx + (p.sx - o.sx) * 0.15, p.sy + (p.sy - o.sy) * 0.15);
        }
    }

    function drawFieldLines() {
        const lines = genLines();
        ctx.lineWidth = 1.3;
        for (const path of lines) {
            if (path.length < 2) continue;
            const sp = path.map(p => proj(p.x, p.y, p.z));
            const g = ctx.createLinearGradient(
                sp[0].sx, sp[0].sy, sp[sp.length - 1].sx, sp[sp.length - 1].sy);
            g.addColorStop(0, "rgba(244,91,105,0.78)");
            g.addColorStop(1, "rgba(45,127,249,0.78)");
            ctx.strokeStyle = g;
            ctx.beginPath();
            ctx.moveTo(sp[0].sx, sp[0].sy);
            for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].sx, sp[i].sy);
            ctx.stroke();
            if (sp.length > 8) {
                const m = Math.floor(sp.length / 2);
                const a = Math.atan2(sp[m].sy - sp[m - 1].sy, sp[m].sx - sp[m - 1].sx);
                ctx.save(); ctx.translate(sp[m].sx, sp[m].sy); ctx.rotate(a);
                ctx.beginPath(); ctx.moveTo(0, 0);
                ctx.lineTo(-CFG.arrowHead, CFG.arrowHead * 0.6);
                ctx.lineTo(-CFG.arrowHead, -CFG.arrowHead * 0.6);
                ctx.closePath(); ctx.fillStyle = "rgba(40,60,90,0.7)"; ctx.fill();
                ctx.restore();
            }
        }
    }

    function drawCharges() {
        const sorted = state.charges.map((c, i) => ({ c, i, ...proj(c.x, c.y, c.z) }))
            .sort((a, b) => a.depth - b.depth);
        for (const { c, sx, sy } of sorted) {
            const col = c.q >= 0 ? "#f45b69" : "#2d7ff9";
            ctx.save();
            ctx.shadowColor = col; ctx.shadowBlur = 12;
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(sx, sy, CFG.chargeR, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.beginPath(); ctx.arc(sx, sy, CFG.chargeR + 2, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(c.q >= 0 ? "+" : "−", sx, sy);
            ctx.fillStyle = "rgba(12,26,48,0.85)"; ctx.font = "11px sans-serif";
            ctx.textBaseline = "bottom";
            ctx.fillText(c.id, sx, sy - CFG.chargeR - 4);
            ctx.restore();
        }
    }

    /* ── Joystick handle ── */
    const hCenter = () => ({ x: canvas.width - CFG.handleMargin, y: canvas.height - CFG.handleMargin });

    function drawHandle() {
        const hc = hCenter(), h = state.handle;
        const kx = hc.x + h.dx, ky = hc.y + h.dy;
        ctx.save();
        // Ring bg
        ctx.globalAlpha = 0.2; ctx.fillStyle = "#0f2c56";
        ctx.beginPath(); ctx.arc(hc.x, hc.y, CFG.handleRing, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(15,44,86,0.35)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hc.x, hc.y, CFG.handleRing, 0, Math.PI * 2); ctx.stroke();
        // Cross
        ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hc.x - CFG.handleRing + 5, hc.y); ctx.lineTo(hc.x + CFG.handleRing - 5, hc.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hc.x, hc.y - CFG.handleRing + 5); ctx.lineTo(hc.x, hc.y + CFG.handleRing - 5); ctx.stroke();
        // Knob
        const grd = ctx.createRadialGradient(kx - 2, ky - 2, 1, kx, ky, CFG.handleR);
        grd.addColorStop(0, "#fff"); grd.addColorStop(1, "rgba(180,200,230,0.95)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(kx, ky, CFG.handleR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(15,44,86,0.45)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(kx, ky, CFG.handleR, 0, Math.PI * 2); ctx.stroke();
        // Arrows
        ctx.fillStyle = "rgba(15,44,86,0.4)";
        for (let i = 0; i < 4; i++) {
            ctx.save(); ctx.translate(kx, ky); ctx.rotate((Math.PI / 2) * i);
            ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-4, -4); ctx.lineTo(4, -4);
            ctx.closePath(); ctx.fill(); ctx.restore();
        }
        // Label
        ctx.fillStyle = "rgba(15,44,86,0.45)"; ctx.font = "11px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText("旋转视角", hc.x, hc.y + CFG.handleRing + 5);
        ctx.restore();
    }

    /* ── Pointer interaction ── */
    function evtPos(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * canvas.width,
                 y: (e.clientY - r.top) / r.height * canvas.height };
    }
    function hitH(sp) {
        const hc = hCenter();
        return Math.hypot(sp.x - (hc.x + state.handle.dx), sp.y - (hc.y + state.handle.dy)) < CFG.handleR + 6;
    }

    canvas.addEventListener("pointerdown", e => {
        const sp = evtPos(e);
        canvas.setPointerCapture(e.pointerId);
        // Handle?
        if (hitH(sp)) {
            const h = state.handle;
            h.dragging = true; h._az = state.cam.az; h._el = state.cam.el; h._m = { ...sp };
            canvas.style.cursor = "grabbing";
            return;
        }
        // Charge?
        for (let i = 0; i < state.charges.length; i++) {
            const p = proj(state.charges[i].x, state.charges[i].y, state.charges[i].z);
            if (Math.hypot(sp.x - p.sx, sp.y - p.sy) < CFG.hitR) {
                state.drag = i; return;
            }
        }
    });

    canvas.addEventListener("pointermove", e => {
        const sp = evtPos(e);
        const h = state.handle;
        if (h.dragging) {
            const dx = sp.x - h._m.x, dy = sp.y - h._m.y;
            const dist = Math.hypot(dx, dy);
            const maxD = CFG.handleRing - CFG.handleR * 0.5;
            h.dx = dist > maxD ? (dx / dist) * maxD : dx;
            h.dy = dist > maxD ? (dy / dist) * maxD : dy;
            state.cam.az  = h._az  + dx * 0.008;
            state.cam.el  = clamp(h._el - dy * 0.008, 0.1, 1.5);
            draw(); return;
        }
        if (state.drag !== null) {
            const wp = unproj(sp.x, sp.y);
            if (wp) { state.charges[state.drag].x = wp.x; state.charges[state.drag].y = wp.y; }
            draw();
        }
    });

    const stop = e => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        state.drag = null;
        if (state.handle.dragging) {
            state.handle.dragging = false;
            state.handle.dx = 0; state.handle.dy = 0;
            canvas.style.cursor = ""; draw();
        }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);

    canvas.addEventListener("mousemove", e => {
        if (state.handle.dragging || state.drag !== null) return;
        const sp = evtPos(e);
        if (hitH(sp)) { canvas.style.cursor = "grab"; return; }
        const on = state.charges.some(c => {
            const p = proj(c.x, c.y, c.z);
            return Math.hypot(sp.x - p.sx, sp.y - p.sy) < CFG.hitR;
        });
        canvas.style.cursor = on ? "pointer" : "";
    });

    /* ── Init ── */
    window.addEventListener("resize", () => { resize(); draw(); });
    resize();
    draw();
})();
