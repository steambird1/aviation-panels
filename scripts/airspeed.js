/**
 * AirspeedIndication - 飞机空速表
 *
 * 在 132×132 像素的 canvas 上绘制圆形空速表，包含：
 * - 圆形表盘边缘
 * - 0~300 节的弧形刻度（从右侧 3 点钟方向顺时针展开 300°）
 * - 速度指针
 * - 中间靠上的马赫数显示窗（3 位数字）
 * - 中间靠下的速度显示窗（3 位整数，最后一位带滚动效果表现小数）
 * - 选定速度的三角形游标（在边缘弧线上运动，颜色可动态切换）
 */
export class AirspeedIndication {
    /**
     * @param {HTMLCanvasElement} canvas - 132×132 像素的 canvas DOM 对象
     */
    constructor(canvas) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            throw new Error('AirspeedIndication 需要接收一个有效的 canvas DOM 对象');
        }

        /** @type {HTMLCanvasElement} */
        this.canvas = canvas;

        /** @type {CanvasRenderingContext2D} */
        this.ctx = canvas.getContext('2d');

        // ---- 几何常量（圆心、半径等） ----
        this.cx = 66; // 圆心 X（132/2）
        this.cy = 66; // 圆心 Y（132/2）
        this.outerRadius = 60; // 表盘外圈半径
        this.tickOuterR = 58; // 刻度线外端半径
        this.tickInnerRMajor = 47; // 主刻度内端半径
        this.tickInnerRMinor = 52; // 次刻度内端半径
        this.labelRadius = 39; // 数字标注所在半径
        this.pointerLength = 50; // 指针长度（从圆心到尖端）
        this.pointerTailLength = 14; // 指针尾部长度
        this.cursorOuterR = 59.5; // 游标尖角半径
        this.cursorInnerR = 54.5; // 游标底边半径
        this.cursorHalfWidth = 3.8; // 游标半宽（度）

        // ---- 显示窗位置 ----
        // 马赫数显示窗（中间靠上）
        this.machWinW = 34;
        this.machWinH = 13;
        this.machWinX = this.cx - this.machWinW / 2;
        this.machWinY = this.cy - 22; // 圆心上方

        // 速度显示窗（中间靠下）
        this.speedWinW = 46;
        this.speedWinH = 17;
        this.speedWinX = this.cx - this.speedWinW / 2;
        this.speedWinY = this.cy + 6; // 圆心下方

        // ---- 状态 ----
        this.currentSpeed = 0;
        this.currentMach = 0;
        this.selectedValue = null; // 选定速度值（null 表示不显示游标）
        this.selectedColor = '#ff2d78'; // 游标默认颜色（玫红）

        // ---- 初始绘制 ----
        this._drawFull(0, 0, null);
    }

    // ================================================================
    //  公开方法
    // ================================================================

    /**
     * 更新空速表显示。
     *
     * @param {number} speed - 当前速度值（节，0~300）
     * @param {number} mach - 当前马赫数值（取小数点后三位显示）
     * @param {object} selected - 选定速度配置
     * @param {number|null|undefined} selected.value - 当前选定速度。若为 null/undefined 则不显示游标
     * @param {string|null|undefined} selected.color - 游标颜色。若为 null/undefined 则保持当前颜色
     */
    updateDisplay(speed, mach, selected) {
        // 更新速度与马赫
        this.currentSpeed = Math.max(0, Math.min(300, Number(speed) || 0));
        this.currentMach = Math.max(0, Number(mach) || 0);

        // 处理 selected 参数
        if (selected && typeof selected === 'object') {
            // value
            if ('value' in selected) {
                if (selected.value === null || selected.value === undefined) {
                    this.selectedValue = null;
                } else {
                    this.selectedValue = Math.max(0, Math.min(300, Number(selected.value) || 0));
                }
            }
            // color
            if ('color' in selected && selected.color !== null && selected.color !== undefined) {
                this.selectedColor = String(selected.color);
            }
        }

        // 重绘整个表盘
        this._drawFull(this.currentSpeed, this.currentMach, this.selectedValue);
    }

    // ================================================================
    //  内部绘制方法
    // ================================================================

    /**
     * 完整绘制表盘。
     * @param {number} speed
     * @param {number} mach
     * @param {number|null} selectedVal
     */
    _drawFull(speed, mach, selectedVal) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // 清除画布
        ctx.clearRect(0, 0, w, h);

        // 1. 表盘背景
        this._drawDialFace();

        // 2. 刻度线与数字标注
        this._drawScales();

        // 3. 彩色弧带（可选：速度范围色带）
        this._drawColorBands();

        // 4. 马赫数显示窗
        this._drawMachWindow(mach);

        // 5. 速度显示窗（带滚动小数效果）
        this._drawSpeedWindow(speed);

        // 6. 三角形游标（选定速度）
        if (selectedVal !== null && selectedVal !== undefined) {
            this._drawCursor(selectedVal, this.selectedColor);
        }

        // 7. 速度指针
        this._drawPointer(speed);

        // 8. 中心轴盖
        this._drawCenterCap();

        // 9. 外圈边框（最后绘制，覆盖在所有元素之上）
        this._drawOuterBezel();
    }

    /**
     * 绘制表盘底色。
     */
    _drawDialFace() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;
        const r = this.outerRadius;

        // 主体深色盘面
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#111118';
        ctx.fill();

        // 微妙的径向渐变，增加立体感
        const grad = ctx.createRadialGradient(cx - 8, cy - 10, r * 0.1, cx, cy, r);
        grad.addColorStop(0, '#1e1e2a');
        grad.addColorStop(0.7, '#111118');
        grad.addColorStop(1, '#0a0a10');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    /**
     * 绘制外圈装饰边框。
     */
    _drawOuterBezel() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;
        const r = this.outerRadius;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#4a4a58';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 内圈细线
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1.8, 0, Math.PI * 2);
        ctx.strokeStyle = '#333340';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 外圈细线
        ctx.beginPath();
        ctx.arc(cx, cy, r + 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 绘制刻度线和数字标注。
     * 0 节在 3 点钟（canvas 角度 0°），顺时针到 300 节（canvas 角度 300°）。
     */
    _drawScales() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        ctx.save();
        ctx.translate(cx, cy);

        // 刻度从 0 到 300，步长 10 节
        for (let speed = 0; speed <= 300; speed += 10) {
            // canvas 角度（度）：0°=3点钟，顺时针增加
            const angleDeg = speed; // 0→0°, 300→300°
            const angleRad = this._degToRad(angleDeg);

            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);

            // 判断是否为主刻度（0, 50, 100, 150, 200, 250, 300）
            const isMajor = (speed % 50 === 0);

            const innerR = isMajor ? this.tickInnerRMajor : this.tickInnerRMinor;
            const outerR = this.tickOuterR;

            const x1 = cosA * innerR;
            const y1 = sinA * innerR;
            const x2 = cosA * outerR;
            const y2 = sinA * outerR;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = isMajor ? '#e8e8f0' : '#9999aa';
            ctx.lineWidth = isMajor ? 1.8 : 0.9;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // 数字标注（0, 50, 100, 150, 200, 250, 300）
        const labelSpeeds = [0, 50, 100, 150, 200, 250, 300];
        ctx.fillStyle = '#e0e0ea';
        ctx.font = 'bold 9px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const speed of labelSpeeds) {
            const angleDeg = speed;
            const angleRad = this._degToRad(angleDeg);
            const lx = Math.cos(angleRad) * this.labelRadius;
            const ly = Math.sin(angleRad) * this.labelRadius;

            // 微调个别标签位置避免与显示窗重叠
            let offsetX = 0;
            let offsetY = 0;
            if (speed === 150) {
                // 150 在底部（6点钟），略微下移
                offsetY = 3;
            }

            ctx.fillText(String(speed), lx + offsetX, ly + offsetY);
        }

        ctx.restore();
    }

    /**
     * 绘制速度范围色带（可选装饰）。
     * 例如：绿色安全区、黄色注意区、红色警告区。
     */
    _drawColorBands() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        ctx.save();
        ctx.translate(cx, cy);

        // 在刻度内侧绘制细色带
        const bandOuterR = this.tickInnerRMinor - 1;
        const bandInnerR = bandOuterR - 4;
        const bandMidR = (bandOuterR + bandInnerR) / 2;

        // 绿色区：0~200 节（安全范围）
        this._drawArcBand(0, 200, bandOuterR, bandInnerR, 'rgba(100,220,140,0.35)');
        // 黄色区：200~260 节（注意范围）
        this._drawArcBand(200, 260, bandOuterR, bandInnerR, 'rgba(255,210,60,0.40)');
        // 红色区：260~300 节（警告范围）
        this._drawArcBand(260, 300, bandOuterR, bandInnerR, 'rgba(255,70,70,0.45)');

        ctx.restore();
    }

    /**
     * 绘制一段弧形色带。
     * @param {number} speedFrom - 起始速度
     * @param {number} speedTo - 结束速度
     * @param {number} outerR - 外半径
     * @param {number} innerR - 内半径
     * @param {string} color - 颜色
     */
    _drawArcBand(speedFrom, speedTo, outerR, innerR, color) {
        const ctx = this.ctx;
        const angleFrom = this._degToRad(speedFrom);
        const angleTo = this._degToRad(speedTo);

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, outerR, angleFrom, angleTo);
        ctx.arc(0, 0, innerR, angleTo, angleFrom, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    /**
     * 绘制速度指针。
     * @param {number} speed
     */
    _drawPointer(speed) {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;
        const angleDeg = Math.max(0, Math.min(300, speed));
        const angleRad = this._degToRad(angleDeg);

        ctx.save();
        ctx.translate(cx, cy);

        const tipX = Math.cos(angleRad) * this.pointerLength;
        const tipY = Math.sin(angleRad) * this.pointerLength;
        const tailX = -Math.cos(angleRad) * this.pointerTailLength;
        const tailY = -Math.sin(angleRad) * this.pointerTailLength;

        // 指针阴影
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        // 指针主体（细长三角形状）
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        // 指针两侧（在尖端附近较窄，靠近圆心处较宽）
        const perpAngle = angleRad + Math.PI / 2;
        const baseWidth = 3.5; // 圆心处半宽
        const tipWidth = 1.0; // 尖端处半宽

        // 使用贝塞尔曲线或简单多边形
        const bx1 = Math.cos(perpAngle) * baseWidth;
        const by1 = Math.sin(perpAngle) * baseWidth;
        const bx2 = -Math.cos(perpAngle) * baseWidth;
        const by2 = -Math.sin(perpAngle) * baseWidth;

        const tx1 = Math.cos(perpAngle) * tipWidth;
        const ty1 = Math.sin(perpAngle) * tipWidth;
        const tx2 = -Math.cos(perpAngle) * tipWidth;
        const ty2 = -Math.sin(perpAngle) * tipWidth;

        ctx.moveTo(tipX + tx1, tipY + ty1);
        ctx.lineTo(bx1, by1);
        ctx.lineTo(tailX, tailY);
        ctx.lineTo(bx2, by2);
        ctx.lineTo(tipX + tx2, tipY + ty2);
        ctx.closePath();
        ctx.fillStyle = '#f8f8ff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.restore();

        // 指针中线（红色细线，增加可读性）
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tailX, tailY);
        ctx.strokeStyle = 'rgba(220,40,40,0.7)';
        ctx.lineWidth = 0.9;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.restore();
    }

    /**
     * 绘制中心轴盖（小圆盘，遮挡指针根部）。
     */
    _drawCenterCap() {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;

        ctx.save();
        // 外层暗色环
        ctx.beginPath();
        ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a24';
        ctx.fill();
        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // 内层亮色圆
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ccccdd';
        ctx.fill();

        // 高光点
        ctx.beginPath();
        ctx.arc(cx - 1.2, cy - 1.5, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
        ctx.restore();
    }

    /**
     * 绘制三角形选定速度游标。
     * @param {number} speed - 选定速度值
     * @param {string} color - 游标颜色
     */
    _drawCursor(speed, color) {
        const ctx = this.ctx;
        const cx = this.cx;
        const cy = this.cy;
        const angleDeg = Math.max(0, Math.min(300, speed));
        const angleRad = this._degToRad(angleDeg);

        ctx.save();
        ctx.translate(cx, cy);

        // 游标三角形：尖角朝外（指向刻度），底边靠近圆心
        const tipR = this.cursorOuterR;
        const baseR = this.cursorInnerR;
        const halfW = this.cursorHalfWidth; // 底边半宽（角度偏移量，度）

        const tipX = Math.cos(angleRad) * tipR;
        const tipY = Math.sin(angleRad) * tipR;

        const baseAngle1 = this._degToRad(angleDeg - halfW);
        const baseAngle2 = this._degToRad(angleDeg + halfW);
        const baseX1 = Math.cos(baseAngle1) * baseR;
        const baseY1 = Math.sin(baseAngle1) * baseR;
        const baseX2 = Math.cos(baseAngle2) * baseR;
        const baseY2 = Math.sin(baseAngle2) * baseR;

        // 阴影
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX1, baseY1);
        ctx.lineTo(baseX2, baseY2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();

        // 游标内侧小高光
        ctx.beginPath();
        ctx.moveTo(
            Math.cos(angleRad) * (tipR - 1.5),
            Math.sin(angleRad) * (tipR - 1.5)
        );
        ctx.lineTo(
            Math.cos(baseAngle1) * (baseR + 1),
            Math.sin(baseAngle1) * (baseR + 1)
        );
        ctx.lineTo(
            Math.cos(baseAngle2) * (baseR + 1),
            Math.sin(baseAngle2) * (baseR + 1)
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fill();

        ctx.restore();
    }

    /**
     * 绘制马赫数显示窗（中间靠上，3 位数字）。
     * @param {number} mach - 马赫数值
     */
    _drawMachWindow(mach) {
        const ctx = this.ctx;
        const wx = this.machWinX;
        const wy = this.machWinY;
        const ww = this.machWinW;
        const wh = this.machWinH;
        const radius = 4;

        ctx.save();

        // 裁剪圆角矩形
        this._roundRectClip(wx, wy, ww, wh, radius);

        // 背景
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(wx, wy, ww, wh);

        // 内边框
        ctx.strokeStyle = '#444455';
        ctx.lineWidth = 1;
        this._strokeRoundRect(wx, wy, ww, wh, radius);

        // 马赫标签（小字）
        ctx.fillStyle = '#777788';
        ctx.font = '6px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('MACH', wx + ww / 2, wy + 1.5);

        // 三位数字（马赫小数部分 × 1000）
        const machDigits = Math.round(mach * 1000) % 1000;
        const machStr = String(machDigits).padStart(3, '0');

        ctx.fillStyle = '#e0ffe0';
        ctx.font = 'bold 11px "SF Mono", "Consolas", "Monaco", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(machStr, wx + ww / 2, wy + wh / 2 + 1.5);

        ctx.restore();
    }

    /**
     * 绘制速度显示窗（中间靠下，3 位整数 + 最后一位滚动效果）。
     * @param {number} speed - 速度值
     */
    _drawSpeedWindow(speed) {
        const ctx = this.ctx;
        const wx = this.speedWinX;
        const wy = this.speedWinY;
        const ww = this.speedWinW;
        const wh = this.speedWinH;
        const radius = 5;

        ctx.save();

        // 裁剪圆角矩形
        this._roundRectClip(wx, wy, ww, wh, radius);

        // 背景
        ctx.fillStyle = '#08080f';
        ctx.fillRect(wx, wy, ww, wh);

        // 内边框
        ctx.strokeStyle = '#4a4a58';
        ctx.lineWidth = 1.2;
        this._strokeRoundRect(wx, wy, ww, wh, radius);

        // "SPD" 小标签
        ctx.fillStyle = '#777788';
        ctx.font = '5.5px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('SPD', wx + ww / 2, wy + 1);

        // ---- 数字显示 ----
        const speedInt = Math.floor(speed);
        const speedFrac = speed - speedInt; // 小数部分 0~0.999...
        const intStr = String(Math.min(999, speedInt)).padStart(3, '0'); // "078", "123" 等

        const digitFontSize = 13;
        const digitFont = `bold ${digitFontSize}px "SF Mono", "Consolas", "Monaco", monospace`;
        ctx.font = digitFont;
        ctx.textBaseline = 'middle';

        // 计算每个数字位的 X 中心
        const totalDigitsWidth = digitFontSize * 0.65 * 3; // 3 位数字的估计总宽度
        const startX = wx + ww / 2 - totalDigitsWidth / 2 + (digitFontSize * 0.65) / 2;
        const digitStep = digitFontSize * 0.65; // 每个数字位之间的间距
        const digitCenterY = wy + wh / 2 + 1.5; // 数字垂直中心（微调）

        // 绘制前两位数字（正常显示）
        ctx.fillStyle = '#e8ffe8';
        for (let i = 0; i < 2; i++) {
            const dx = startX + i * digitStep;
            ctx.fillText(intStr[i], dx, digitCenterY);
        }

        // 绘制最后一位数字（带滚动效果）
        const lastDigit = parseInt(intStr[2], 10);
        const nextDigit = (lastDigit + 1) % 10;
        const offsetY = speedFrac * digitFontSize; // 向上偏移量

        // 当前数字：向上偏移
        const curY = digitCenterY - offsetY;
        ctx.fillStyle = '#e8ffe8';
        ctx.fillText(String(lastDigit), startX + 2 * digitStep, curY);

        // 下一个数字：从下方进入
        const nextY = curY + digitFontSize;
        if (nextY < wy + wh + digitFontSize) {
            // 仅在可能可见时绘制
            ctx.fillStyle = '#b0d0b0'; // 稍微暗一点，模拟即将进入的数字
            ctx.fillText(String(nextDigit), startX + 2 * digitStep, nextY);
        }

        // 在最后一位数字上方绘制微妙的"即将滚入"提示
        if (speedFrac > 0.85) {
            // 当前数字即将滚出，上方数字的底部可能可见
            const prevY = curY - digitFontSize;
            if (prevY > wy - digitFontSize) {
                const prevDigit = (lastDigit - 1 + 10) % 10;
                ctx.fillStyle = 'rgba(180,210,180,0.5)';
                ctx.fillText(String(prevDigit), startX + 2 * digitStep, prevY);
            }
        }

        ctx.restore();
    }

    // ================================================================
    //  工具方法
    // ================================================================

    /**
        * 将角度（度）转换为弧度。
        * Canvas 中 0°=3点钟，顺时针增加。
        * @param {number} deg
        * @returns {number}
        */
    _degToRad(deg) {
        return deg * (Math.PI / 180);
    }

    /**
        * 创建圆角矩形裁剪区域。
        */
    _roundRectClip(x, y, w, h, r) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.clip();
    }

    /**
        * 描边圆角矩形。
        */
    _strokeRoundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.stroke();
    }
}
