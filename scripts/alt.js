export class AltitudeIndication {
    /**
     * @param {HTMLCanvasElement} canvasEl - 132×132 像素的 canvas DOM 对象
     */
    constructor(canvasEl) {
        if (!canvasEl || !(canvasEl instanceof HTMLCanvasElement)) {
            throw new Error('AltitudeIndication 需要传入一个有效的 canvas DOM 对象');
        }

        /** @type {HTMLCanvasElement} */
        this.canvas = canvasEl;
        /** @type {CanvasRenderingContext2D} */
        this.ctx = canvasEl.getContext('2d');

        // 确保 canvas 尺寸为 132×132
        if (this.canvas.width !== 132 || this.canvas.height !== 132) {
            this.canvas.width = 132;
            this.canvas.height = 132;
        }

        // --- 内部状态 ---
        /** @type {number} 当前高度值（英尺） */
        this.altitude = 0;
        /** @type {number} 修正海压（英寸汞柱） */
        this.qnh = 29.92;
        /** @type {number|null} 选定高度值，null 表示不显示游标 */
        this.selectedAlt = null;
        /** @type {string} 游标颜色 */
        this.selectedColor = '#ff3388';

        // --- 固定几何参数（132×132 画布） ---
        this.cx = 66; // 圆心 X
        this.cy = 66; // 圆心 Y
        this.outerRadius = 60; // 表盘外圆半径
        this.tickOuterR = 58; // 刻度外缘半径
        this.tickInnerR = 50; // 主刻度内缘半径
        this.subTickInnerR = 52; // 小刻度内缘半径
        this.labelR = 44.5; // 刻度数字中心半径
        this.pointerTipR = 47; // 指针尖端半径
        this.pointerBaseR = 8; // 指针根部半径（中心 hub 上方）
        this.hubRadius = 7.5; // 中心 hub 半径
        this.bugR = 57.5; // 游标三角形尖端半径
        this.bugBaseR = 62.5; // 游标三角形底边半径
        this.bugHalfWidth = 4.5; // 游标半宽

        // 高度选择窗参数
        this.altWinW = 52;
        this.altWinH = 15;
        this.altWinCX = this.cx;
        this.altWinCY = this.cy - 22; // 中间偏上

        // 修正海压窗参数
        this.qnhWinW = 38;
        this.qnhWinH = 12;
        this.qnhWinCX = this.cx;
        this.qnhWinCY = this.cy + 16; // 中间偏下


        // 游标参数（替换原有的 bugR / bugBaseR）
        this.bugTipR = 58;        // 尖端半径（靠近外缘）
        this.bugBaseR = 51;       // 底边半径（靠近圆心）
        this.bugHalfWidth = 4.5;

        // 首次渲染
        this._render();
    }

    /**
     * 更新高度表显示。
     * 调用此方法后才会更新 canvas 上的图像。
     *
     * @param {number} alt - 当前高度值（英尺）
     * @param {number} qnh - 修正海压（如 29.92，单位英寸汞柱）
     * @param {{ value: number|null|undefined, color: string|null|undefined }} selected - 选定高度配置
     *        - value: 选定高度值，null/undefined 则不显示游标
     *        - color: 游标颜色，null/undefined 则保持当前颜色不变
     */
    updateDisplay(alt, qnh, selected) {
        // 更新高度
        if (typeof alt === 'number' && !isNaN(alt)) {
            this.altitude = Math.max(0, Math.round(alt));
        }

        // 更新修正海压
        if (typeof qnh === 'number' && !isNaN(qnh)) {
            this.qnh = Math.max(0, qnh);
        }

        // 更新选定高度游标
        if (selected && typeof selected === 'object') {
            if ('value' in selected) {
                const sv = selected.value;
                if (sv === null || sv === undefined || (typeof sv === 'number' && isNaN(sv))) {
                    this.selectedAlt = null;
                } else if (typeof sv === 'number') {
                    this.selectedAlt = Math.max(0, Math.round(sv));
                }
            }
            if ('color' in selected) {
                const sc = selected.color;
                if (sc !== null && sc !== undefined && typeof sc === 'string' && sc.trim() !== '') {
                    this.selectedColor = sc;
                }
                // 如果 color 为 null/undefined，保持当前颜色不变
            }
        }

        // 重绘
        this._render();
    }

    // ==================== 内部渲染方法 ====================

    /** 完整重绘高度表 */
    _render() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;

        // 清除画布
        ctx.clearRect(0, 0, W, H);

        // 1. 绘制表盘背景
        this._drawDialBackground();

        // 2. 绘制刻度线和数字
        this._drawTickMarks();

        // 3. 绘制指针
        this._drawPointer();

        // 4. 绘制中心 hub
        this._drawHub();

        // 5. 绘制高度选择窗
        this._drawAltitudeWindow();

        // 6. 绘制修正海压窗
        this._drawQNHWindow();

        // 7. 绘制选定高度三角形游标
        if (this.selectedAlt !== null) {
            this._drawSelectedBug();
        }
    }

    /** 绘制表盘圆形背景 */
    _drawDialBackground() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        // 外圈阴影环
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, this.outerRadius + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a22';
        ctx.fill();

        // 外圈边框
        ctx.beginPath();
        ctx.arc(cx, cy, this.outerRadius + 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#4a4a58';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 主表盘背景
        const bgGrad = ctx.createRadialGradient(cx - 3, cy - 4, this.outerRadius * 0.3, cx, cy, this
        .outerRadius);
        bgGrad.addColorStop(0, '#3c3c48');
        bgGrad.addColorStop(0.7, '#2a2a34');
        bgGrad.addColorStop(1, '#1e1e28');
        ctx.beginPath();
        ctx.arc(cx, cy, this.outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = bgGrad;
        ctx.fill();

        // 内圈微妙的渐变环（模拟玻璃下的阴影）
        ctx.beginPath();
        ctx.arc(cx, cy, this.outerRadius - 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, this.outerRadius - 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    /** 绘制刻度标记和数字（0-9，从顶部顺时针均匀分布） */
    _drawTickMarks() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        // 10 个主刻度，从顶部（12点钟）开始顺时针
        for (let i = 0; i < 10; i++) {
            const angleDeg = -90 + i * 36;          // i 对应的角度
            const angleRad = (angleDeg * Math.PI) / 180;
            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);

            // 绘制主刻度线
            const xInner = cx + this.tickInnerR * cosA;
            const yInner = cy + this.tickInnerR * sinA;
            const xOuter = cx + this.tickOuterR * cosA;
            const yOuter = cy + this.tickOuterR * sinA;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xInner, yInner);
            ctx.lineTo(xOuter, yOuter);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.lineCap = 'round';
            ctx.stroke();

            // 刻度数字
            const labelX = cx + this.labelR * cosA;
            const labelY = cy + this.labelR * sinA;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px "SF Mono","Cascadia Code","Consolas","Menlo",monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i), labelX, labelY);
            ctx.restore();
        }

        // 绘制主刻度之间的小刻度（共 4 条 × 10 个区间）
        for (let i = 0; i < 10; i++) {
            const startAngleDeg = -90 + i * 36;
            // 下一个主刻度的角度，处理 9→0 的跨越
            const nextAngleDeg = (i === 9) ? 270 : -90 + (i + 1) * 36;

            // 每个区间分成 5 等份，取中间 4 等分点
            for (let s = 1; s <= 4; s++) {
                const t = s / 5;   // 0.2, 0.4, 0.6, 0.8
                let subAngleDeg;
                if (i === 9) {
                    // 区间从 234° 到 270°（数学角度，保持连续性）
                    subAngleDeg = startAngleDeg + t * 36;
                } else {
                    subAngleDeg = startAngleDeg + t * 36;
                }
                const subAngleRad = (subAngleDeg * Math.PI) / 180;
                const subCos = Math.cos(subAngleRad);
                const subSin = Math.sin(subAngleRad);

                const sxInner = cx + this.subTickInnerR * subCos;
                const syInner = cy + this.subTickInnerR * subSin;
                const sxOuter = cx + this.tickOuterR * subCos;
                const syOuter = cy + this.tickOuterR * subSin;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(sxInner, syInner);
                ctx.lineTo(sxOuter, syOuter);
                ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                ctx.lineWidth = 0.7;
                ctx.lineCap = 'round';
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    /** 获取最后三位数字对应的角度（弧度），从顶部顺时针 */
    _getPointerAngleRad(lastThreeDigits) {
        // lastThreeDigits: 0-999，对应表盘 0-9 刻度（0-900 英尺，步长 100）
        // 指针精确位置 = lastThreeDigits / 1000 * 360° 从顶部顺时针
        const fraction = (lastThreeDigits % 1000) / 1000;
        const angleDegFromTop = fraction * 360;
        // Canvas 中 0° 在 3 点钟方向，顶部是 -90°（或 270°）
        const canvasAngleDeg = -90 + angleDegFromTop;
        return (canvasAngleDeg * Math.PI) / 180;
    }

    /** 绘制高度指针 */
                /**
     * 绘制高度指针（沿 X 轴正方向，尖端指向表盘外缘）
     */
    _drawPointer() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        const lastThree = this.altitude % 1000;
        const angleRad = this._getPointerAngleRad(lastThree);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);

        // 沿 X 轴正方向绘制指针：尖端在右侧（正 X），根部在左侧（负 X）
        const tipX = this.pointerTipR;       // 尖端 X
        const baseX = -this.pointerBaseR;    // 根部 X
        const halfW = 3.5;                   // 主体半宽
        const baseHalfW = 4.5;               // 根部半宽
        const midX = tipX * 0.55;            // 收缩点 X

        ctx.beginPath();
        ctx.moveTo(tipX, 0);
        ctx.lineTo(midX, -halfW);
        ctx.lineTo(baseX, -baseHalfW);
        ctx.lineTo(baseX, baseHalfW);
        ctx.lineTo(midX, halfW);
        ctx.closePath();

        // 填充渐变
        const ptrGrad = ctx.createLinearGradient(tipX, 0, baseX, 0);
        ptrGrad.addColorStop(0, '#ffffff');
        ptrGrad.addColorStop(0.6, '#f0f0f0');
        ptrGrad.addColorStop(1, '#d0d0d8');
        ctx.fillStyle = ptrGrad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 0.6;
        ctx.stroke();

        // 中心细线
        ctx.beginPath();
        ctx.moveTo(tipX - 3, 0);
        ctx.lineTo(baseX + 3, 0);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.4;
        ctx.stroke();

        ctx.restore();
    }

    /** 绘制中心 hub */
    _drawHub() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        // 外层阴影
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, this.hubRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        // 主体
        const hubGrad = ctx.createRadialGradient(cx - 1, cy - 1.5, this.hubRadius * 0.2, cx, cy, this.hubRadius);
        hubGrad.addColorStop(0, '#5a5a68');
        hubGrad.addColorStop(0.6, '#3a3a44');
        hubGrad.addColorStop(1, '#1e1e28');
        ctx.beginPath();
        ctx.arc(cx, cy, this.hubRadius, 0, Math.PI * 2);
        ctx.fillStyle = hubGrad;
        ctx.fill();

        // 边框
        ctx.beginPath();
        ctx.arc(cx, cy, this.hubRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 内圈高光
        ctx.beginPath();
        ctx.arc(cx - 0.8, cy - 1, this.hubRadius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();

        ctx.restore();
    }

    /** 绘制中间靠上的高度选择窗 */
    _drawAltitudeWindow() {
        const ctx = this.ctx;
        const cx = this.altWinCX;
        const cy = this.altWinCY;
        const hw = this.altWinW / 2;
        const hh = this.altWinH / 2;

        const alt = this.altitude;
        const lastThree = alt % 1000;
        const tenDigit = Math.floor((alt % 100) / 10); // 十位数字
        const hundredDigit = Math.floor((alt % 1000) / 100); // 百位数字
        const thousandDigit = Math.floor((alt % 10000) / 1000); // 千位数字
        const tenThousandsDigit = Math.floor(alt / 10000); // 万位数字
        const hasTenThousands = alt >= 10000;
        const hasThousands = alt >= 1000;
        const hasHundreds = alt >= 100;

        // 滚动位值：十位 * 10，显示 00-90
        const rollingValue = alt % 100; // 显示最后两位数字 00-99;

        // 窗口背景
        const winX = cx - hw;
        const winY = cy - hh;
        const winW = this.altWinW;
        const winH = this.altWinH;

        ctx.save();

        // 窗口阴影
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(winX + 1, winY + 1, winW, winH);

        // 窗口主体背景
        const winBgGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
        winBgGrad.addColorStop(0, '#1a1a24');
        winBgGrad.addColorStop(0.5, '#15151e');
        winBgGrad.addColorStop(1, '#1a1a24');
        ctx.fillStyle = winBgGrad;
        ctx.fillRect(winX, winY, winW, winH);

        // 窗口边框
        ctx.strokeStyle = '#5a5a6a';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(winX, winY, winW, winH);

        // 内边框（微妙高光）
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(winX + 0.5, winY + 0.5, winW - 1, winH - 1);

        // 数字位参数
        const digitW = 10; // 每个数字位宽度
        const digitH = 12; // 数字位高度
        const digitGap = 2; // 数字位间距
        const totalDigitsWidth = digitW * 4 + digitGap * 3; // 4 个位 + 3 个间距 = 46px
        const startX = cx - totalDigitsWidth / 2;
        const digitCY = cy;

        // 绘制每个数字位的背景分隔
        for (let d = 0; d < 4; d++) {
            const dx = startX + d * (digitW + digitGap);
            const dy = digitCY - digitH / 2;

            // 每个数字位的微细背景
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(dx, dy, digitW, digitH);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 0.4;
            ctx.strokeRect(dx, dy, digitW, digitH);
        }

        // --- 绘制数字 ---
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px "SF Mono","Cascadia Code","Consolas","Menlo",monospace';

        // 位 0：万位
        const x0 = startX + digitW / 2;
        if (hasTenThousands) {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(tenThousandsDigit), x0, digitCY);
        } else {
            // 绿色实心长方形（与数字同样大小）
            const greenX = startX;
            const greenY = digitCY - digitH / 2;
            const greenW = digitW;
            const greenH = digitH;
            ctx.fillStyle = '#22cc44';
            ctx.fillRect(greenX + 1, greenY + 1.5, greenW - 2, greenH - 3);
            // 微妙的边框
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(greenX + 1, greenY + 1.5, greenW - 2, greenH - 3);
        }

        // 位 1：千位
        const x1 = startX + (digitW + digitGap) + digitW / 2;
        const displayThousand = hasThousands ? String(thousandDigit) : '0';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayThousand, x1, digitCY);

        // 位 2：百位
        const x2 = startX + 2 * (digitW + digitGap) + digitW / 2;
        const displayHundred = hasHundreds ? String(hundredDigit) : '0';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayHundred, x2, digitCY);

        // 位 3：滚动位（00-90）
        const x3 = startX + 3 * (digitW + digitGap) + digitW / 2;
        const rollingStr = String(rollingValue).padStart(2, '0');
        ctx.fillStyle = '#ffffff';
        ctx.fillText(rollingStr, x3, digitCY);

        // 滚动位的微滚筒效果 - 上下边缘渐隐
        const rollX3 = startX + 3 * (digitW + digitGap);
        const rollY3 = digitCY - digitH / 2;
        // 顶部渐隐条
        const topFade = ctx.createLinearGradient(rollX3, rollY3, rollX3, rollY3 + 3);
        topFade.addColorStop(0, 'rgba(21,21,30,0.95)');
        topFade.addColorStop(1, 'rgba(21,21,30,0)');
        ctx.fillStyle = topFade;
        ctx.fillRect(rollX3, rollY3, digitW, 3);

        // 底部渐隐条
        const botFade = ctx.createLinearGradient(rollX3, rollY3 + digitH - 3, rollX3, rollY3 + digitH);
        botFade.addColorStop(0, 'rgba(21,21,30,0)');
        botFade.addColorStop(1, 'rgba(21,21,30,0.95)');
        ctx.fillStyle = botFade;
        ctx.fillRect(rollX3, rollY3 + digitH - 3, digitW, 3);

        ctx.restore();
    }

    /** 绘制中间靠下的修正海压显示窗 */
    _drawQNHWindow() {
        const ctx = this.ctx;
        const cx = this.qnhWinCX;
        const cy = this.qnhWinCY;
        const hw = this.qnhWinW / 2;
        const hh = this.qnhWinH / 2;

        const winX = cx - hw;
        const winY = cy - hh;
        const winW = this.qnhWinW;
        const winH = this.qnhWinH;

        ctx.save();

        // 窗口阴影
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(winX + 0.8, winY + 0.8, winW, winH);

        // 窗口主体背景
        const winBgGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
        winBgGrad.addColorStop(0, '#1a1a24');
        winBgGrad.addColorStop(0.5, '#15151e');
        winBgGrad.addColorStop(1, '#1a1a24');
        ctx.fillStyle = winBgGrad;
        ctx.fillRect(winX, winY, winW, winH);

        // 窗口边框
        ctx.strokeStyle = '#5a5a6a';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(winX, winY, winW, winH);

        // 内边框高光
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(winX + 0.5, winY + 0.5, winW - 1, winH - 1);

        // QNH 数值
        const qnhStr = this.qnh.toFixed(2);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8.5px "SF Mono","Cascadia Code","Consolas","Menlo",monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(qnhStr, cx, cy);

        // 微小的 "IN" 标签在右侧（如果空间允许）
        ctx.fillStyle = 'rgba(200,200,210,0.7)';
        ctx.font = '5px "Segoe UI","Helvetica Neue",Arial,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('IN', cx + hw - 10, cy - 1);

        ctx.restore();
    }

    /** 绘制选定高度三角形游标（在刻度外缘弧线上） */
                /**
        * 绘制选定高度三角形游标（尖端指向圆心，即沿 X 轴负方向）
        */
        _drawSelectedBug() {
        if (this.selectedAlt === null) return;

        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        const lastThree = this.selectedAlt % 1000;
        const angleRad = this._getPointerAngleRad(lastThree);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);

        // 三角形尖端指向正 X 轴（外缘），底边在负 X 轴方向（内侧）
        const tipX = 58;       // 尖端半径，靠近表盘外缘
        const baseX = 51;      // 底边半径，在内侧
        const halfW = 4.5;     // 底边半宽

        ctx.beginPath();
        ctx.moveTo(tipX, 0);
        ctx.lineTo(baseX, -halfW);
        ctx.lineTo(baseX, halfW);
        ctx.closePath();

        ctx.fillStyle = this.selectedColor;
        ctx.shadowColor = this.selectedColor;
        ctx.shadowBlur = 3;
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.7;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
    }

}
