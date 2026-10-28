/**
 * 飞机垂直速度表（Vertical Speed Indicator, VSI）
 * 纯 Canvas 2D 实现，表盘尺寸固定 132 × 132 像素。
 *
 * 表盘角度约定（canvas 角度制：0° 指向正右方，角度沿顺时针方向增大）：
 *   · 0 刻度位于表盘左侧正中（9 点钟方向，即 180°）
 *   · 上升段（v ≥ 0）位于上半圆：由 180° 沿顺时针转到 360°，数值 0 → +8000
 *   · 下降段（v < 0）位于下半圆：由 180° 沿逆时针转到 0°，数值 0 → -8000
 *   · 两段关于水平中心线严格对称
 *   · 8000 之后留 5% 半圆（9°）的空白，因此刻度/指针都不会出现在正右方附近
 *
 * 刻度分段（段内刻度线均匀，段间按下列角度分配）：
 *   0~500       : 65°      ← 低速率区放大，便于读数
 *   500~1000    : 30.29°   ← 以下三段由原 20% / 25% / 20% / 5% 等比压缩而来
 *   1000~2000   : 37.86°
 *   2000~4000   : 30.29°
 *   4000~8000   : 7.57°
 *   8000 之后   : 9°（半圆的 5%）留空
 * 压缩方式：半圆 180° 中先扣除 65° 与末尾 9° 留空，剩余 106° 按 20 : 25 : 20 : 5 分配。
 */
(function (global) {
    'use strict';

    /* ---------------- 常量 ---------------- */

    const SIZE = 132;                       // 画布边长（像素）
    const CENTER = SIZE / 2;                // 圆心
    const VS_MAX = 8000;                    // 表盘量程，|v| 超出后指针停在 8000
    const ZERO_DEG = 180;                   // 0 刻度所在角度
    const SEMI = 180;                       // 半圆对应的角度

    const END_GAP_DEG = 9;                  // 8000 之后留空的角度（半圆的 5%）

    // 0~500 段放大到 65°；其余段把剩余角度按原权重等比压缩
    const FIRST_DEG = 65;
    const REST_DEG = SEMI - FIRST_DEG - END_GAP_DEG;   // 106°
    const REST_W = [20, 25, 20, 5];                    // 原占比权重，合计 70
    const REST_W_SUM = REST_W.reduce((a, b) => a + b, 0);

    // 刻度分段：lo/hi 为值域，deg 为该段占用的角度，pct 为其占半圆的比例，step 为段内细分步长
    const SEGMENTS = [
        { lo: 0,    hi: 500,  deg: FIRST_DEG, step: 100  },
        { lo: 500,  hi: 1000, deg: 0,         step: 100  },
        { lo: 1000, hi: 2000, deg: 0,         step: 200  },
        { lo: 2000, hi: 4000, deg: 0,         step: 500  },
        { lo: 4000, hi: 8000, deg: 0,         step: 2000 },
        // 8000 之后 END_GAP_DEG 留空，不绘制任何刻度
    ];
    for (let i = 1; i < SEGMENTS.length; i++) {
        SEGMENTS[i].deg = REST_DEG * REST_W[i - 1] / REST_W_SUM;
    }
    for (const s of SEGMENTS) s.pct = s.deg / SEMI;

    // 需要标注数字的刻度，text 为表盘写法（单位：1000 英尺/分钟）
    // dr：数字所在半径的修正量。4000 与 8000 在盘面上仅相距 7.6°，把 8000 外挪避免数字粘连
    const LABELS = [
        { v: 0,    text: '0',  dr: 0 },
        { v: 500,  text: '.5', dr: 0 },
        { v: 1000, text: '1',  dr: 0 },
        { v: 2000, text: '2',  dr: 0 },
        { v: 4000, text: '4',  dr: 0 },
        { v: 8000, text: '8',  dr: 5 },
    ];

    // 各元素的半径（由外向内）
    const R = {
        dial:     62,   // 仪表外轮廓圆
        tickOut:  57,   // 刻度线外端
        tickInMj: 44,   // 主刻度线内端
        tickInMn: 52,   // 次刻度线内端
        number:   37,   // 数字中心
        tcasOut:  31,   // TCAS 弧外缘
        tcasIn:   26,   // TCAS 弧内缘
        needle:   52,   // 指针针尖
        curTip:   54,   // 机械游标尖端（指向刻度）
        curBase:  61.5, // 机械游标底边（贴着外轮廓内侧）
        curHalf:  4.2,  // 机械游标底边半宽
    };

    const COLOR = {
        dialBg:    '#0e1113',   // 表盘背景
        ring:      '#7c858c',   // 外轮廓
        scale:     '#f2f4f5',   // 刻度线与数字
        needle:    '#ffffff',   // 指针
        hub:       '#0e1113',   // 指针中心轴
        tcasIdle:  '#1b1f22',   // TCAS 弧底色（与表盘背景有细微区别）
        tcasRed:   '#ff3b30',   // TCAS 红色段
        tcasGreen: '#32d74b',   // TCAS 绿色段
        curFace:   '#e6eaed',   // 机械游标金属面
        curEdge:   '#2b3134',   // 机械游标描边
        curSlot:   '#8d969c',   // 机械游标上的凹槽
    };

    /* ---------------- 数值 → 角度 ---------------- */

    const DEG = Math.PI / 180;

    /** 把垂直速度限制在 ±8000 之内 */
    function clampValue(v) {
        if (!(typeof v === 'number' && isFinite(v))) return 0;
        return v < -VS_MAX ? -VS_MAX : (v > VS_MAX ? VS_MAX : v);
    }

    /**
     * |v| → 半圆内的比例位置 [0, 0.95]，段内线性、段间按 pct 分配
     */
    function fraction(u) {
        const a = Math.min(Math.abs(u), VS_MAX);
        let base = 0;
        for (let i = 0; i < SEGMENTS.length; i++) {
            const s = SEGMENTS[i];
            if (a <= s.hi) return base + s.pct * (a - s.lo) / (s.hi - s.lo);
            base += s.pct;
        }
        return base; // 0.95（8000 处）
    }

    /**
     * 垂直速度 → 表盘角度（弧度，canvas 角度制）
     */
    function angleOf(v) {
        const f = fraction(v);
        const deg = v >= 0 ? ZERO_DEG + f * SEMI : ZERO_DEG - f * SEMI;
        return deg * DEG;
    }

    /* ---------------- 垂直速度表 ---------------- */

    class VerticalSpeedIndication {

        /**
         * @param {HTMLCanvasElement} canvas 表盘画布（会被强制设为 132 × 132）
         */
        constructor(canvas) {
            if (!canvas || typeof canvas.getContext !== 'function') {
                throw new Error('VerticalSpeedIndication: 需要一个 canvas DOM 对象');
            }
            this.canvas = canvas;
            canvas.width = SIZE;
            canvas.height = SIZE;
            this.ctx = canvas.getContext('2d');

            this.vspd = 0;
            this.tcas = null;
            this.cursor = null;

            this.updateDisplay(0, null);
        }

        /**
         * 在调用此类数据更新函数后，才更新 canvas 上的图像。
         *
         * @param {number} vspd 当前垂直速度值（上升为正，下降为负）
         * @param {{ red: {lo: number, hi:number}[], green: {lo: number, hi:number}[] } | null} tcas
         *        tcas 显示，lo 与 hi 表示每段的范围，格式与 vspd 相同。保证给出的范围不重叠。
         *        若本参数为 null，则清空 tcas 显示区域。
         * @param {number|null} [cursor] 可选，机械游标要指示的垂直速度值（同样按 ±8000 限幅）；
         *        省略时沿用上一次设定的位置，传 null 则隐藏游标。
         */
        updateDisplay(vspd, tcas, cursor) {
            this.vspd = clampValue(vspd);
            this.tcas = (tcas && (tcas.red || tcas.green)) ? tcas : null;
            if (cursor !== undefined) this.cursor = this._normCursor(cursor);
            this._render();
        }

        /**
         * 设置机械游标（表盘外圈的手动参考标记）位置，并立即重绘。
         * @param {number|null} value 游标对应的垂直速度值；null 表示不显示游标
         */
        setCursor(value) {
            this.cursor = this._normCursor(value);
            this._render();
        }

        _normCursor(value) {
            if (value === null || value === undefined) return null;
            return clampValue(value);
        }

        /* ----- 绘制主流程 ----- */

        _render() {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.save();
            this._drawDial();
            this._drawTcas();
            this._drawTicks();
            this._drawNumbers();
            this._drawCursor();
            this._drawNeedle();
            ctx.restore();
        }

        /** 圆形仪表外轮廓与表盘背景 */
        _drawDial() {
            const ctx = this.ctx;
            ctx.beginPath();
            ctx.arc(CENTER, CENTER, R.dial, 0, Math.PI * 2);
            ctx.fillStyle = COLOR.dialBg;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = COLOR.ring;
            ctx.stroke();
        }

        /** TCAS 指示弧：数字内侧的一段粗弧，无显示时仅保留与背景略有色差的底弧 */
        _drawTcas() {
            const ctx = this.ctx;
            const rMid = (R.tcasOut + R.tcasIn) / 2;
            const width = R.tcasOut - R.tcasIn;

            ctx.lineWidth = width;
            ctx.lineCap = 'butt';

            // 底弧：覆盖整个刻度范围（两端各留 5% 半圆空白）
            ctx.beginPath();
            ctx.arc(CENTER, CENTER, rMid, angleOf(-VS_MAX), angleOf(VS_MAX));
            ctx.strokeStyle = COLOR.tcasIdle;
            ctx.stroke();

            if (!this.tcas) return;

            // 先画绿色安全区，再画红色避让区（红色在上方，提示更醒目）
            const groups = [
                { list: this.tcas.green, color: COLOR.tcasGreen },
                { list: this.tcas.red,   color: COLOR.tcasRed },
            ];
            for (const g of groups) {
                if (!g.list) continue;
                ctx.strokeStyle = g.color;
                for (const seg of g.list) {
                    if (!seg) continue;
                    const lo = clampValue(seg.lo);
                    const hi = clampValue(seg.hi);
                    if (Math.min(lo, hi) === Math.max(lo, hi)) continue;
                    ctx.beginPath();
                    ctx.arc(CENTER, CENTER, rMid, angleOf(Math.min(lo, hi)), angleOf(Math.max(lo, hi)));
                    ctx.stroke();
                }
            }
        }

        /** 刻度线：分段各自均匀，主刻度（有数字的）更长更粗 */
        _drawTicks() {
            const ctx = this.ctx;
            ctx.strokeStyle = COLOR.scale;
            ctx.lineCap = 'butt';

            for (const sign of [1, -1]) {          // 上升段 / 下降段
                for (const seg of SEGMENTS) {
                    for (let v = seg.lo; v <= seg.hi; v += seg.step) {
                        if (v === 0 && sign === -1) continue;   // 0 刻度只画一次
                        const major = LABELS.some(l => l.v === v);
                        const a = angleOf(sign * v);
                        const cos = Math.cos(a), sin = Math.sin(a);
                        const r1 = R.tickOut;
                        const r2 = major ? R.tickInMj : R.tickInMn;
                        ctx.lineWidth = major ? 2 : 1;
                        ctx.beginPath();
                        ctx.moveTo(CENTER + cos * r1, CENTER + sin * r1);
                        ctx.lineTo(CENTER + cos * r2, CENTER + sin * r2);
                        ctx.stroke();
                    }
                }
            }
        }

        /** 刻度数字：上升段与下降段内容相同、关于水平中心线对称 */
        _drawNumbers() {
            const ctx = this.ctx;
            ctx.fillStyle = COLOR.scale;
            ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const sign of [1, -1]) {
                for (const l of LABELS) {
                    if (l.v === 0 && sign === -1) continue;     // 0 只写一次
                    const a = angleOf(sign * l.v);
                    const r = R.number + (l.dr || 0);
                    ctx.fillText(l.text, CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r);
                }
            }
        }

        /** 机械游标：骑在外圈刻度上的可设定参考标记，尖端指向刻度 */
        _drawCursor() {
            if (this.cursor === null) return;
            const ctx = this.ctx;
            const a = angleOf(this.cursor);
            const dx = Math.cos(a), dy = Math.sin(a);   // 径向（指向刻度）
            const px = -dy, py = dx;                    // 切向

            const tip = R.curTip, base = R.curBase, half = R.curHalf;
            const tx = CENTER + dx * tip,          ty = CENTER + dy * tip;
            const ax = CENTER + dx * base + px * half, ay = CENTER + dy * base + py * half;
            const bx = CENTER + dx * base - px * half, by = CENTER + dy * base - py * half;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(tx, ty);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.fillStyle = COLOR.curFace;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = COLOR.curEdge;
            ctx.stroke();

            // 中间的凹槽，做出金属薄片的机械质感
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo((ax + bx) / 2, (ay + by) / 2);
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = COLOR.curSlot;
            ctx.stroke();
        }

        /** 指针：从圆心指向当前垂直速度，超过 ±8000 时停在 8000 */
        _drawNeedle() {
            const ctx = this.ctx;
            const a = angleOf(this.vspd);
            const dx = Math.cos(a), dy = Math.sin(a);   // 径向
            const px = -dy, py = dx;                   // 切向
            const tip = R.needle, back = 10, halfBase = 3, halfTip = 0.9;

            const ax = CENTER + px * halfBase - dx * back;
            const ay = CENTER + py * halfBase - dy * back;
            const bx = CENTER - px * halfBase - dx * back;
            const by = CENTER - py * halfBase - dy * back;
            const cx2 = CENTER - px * halfTip + dx * tip;
            const cy2 = CENTER - py * halfTip + dy * tip;
            const dx2 = CENTER + px * halfTip + dx * tip;
            const dy2 = CENTER + py * halfTip + dy * tip;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(dx2, dy2);
            ctx.lineTo(cx2, cy2);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.fillStyle = COLOR.needle;
            ctx.fill();

            // 中心轴
            ctx.beginPath();
            ctx.arc(CENTER, CENTER, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = COLOR.hub;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = COLOR.needle;
            ctx.stroke();
        }
    }

    /* ---------------- 导出 ---------------- */
    if (typeof module !== 'undefined' && module.exports) module.exports = VerticalSpeedIndication;
    global.VerticalSpeedIndication = VerticalSpeedIndication;

})(typeof window !== 'undefined' ? window : globalThis);
