export class SimulatedJoystick {
    /**
     * 构造一个模拟摇杆
     * @param {HTMLCanvasElement} canvas - 用于绘制和交互的 canvas 元素
     * @param {Object} [options] - 可选配置
     * @param {Function} [options.onChange] - 坐标变化时的回调，参数为 {x, y}
     */
    constructor(canvas, options = {}) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._onChange = options.onChange || null;

        // 当前坐标（在 -40 到 +40 范围内）
        this._coordX = 0;
        this._coordY = 0;

        // 状态：false = 不操作（空闲），true = 操作（跟踪鼠标）
        this._isOperating = false;

        // 宽窄区域比例
        // 中间 -20~+20 范围（坐标跨度40）占 canvas 的 60%
        // 两端 -40~-20 和 +20~+40（各跨度20）各占 canvas 的 20%
        this._narrowRatio = 0.20;
        this._wideRatio = 0.60;

        // 绑定事件处理函数（便于后续可能的清理）
        this._handleClick = this._handleClick.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleMouseLeave = this._handleMouseLeave.bind(this);

        // 注册事件
        this._canvas.addEventListener('click', this._handleClick);
        this._canvas.addEventListener('mousemove', this._handleMouseMove);
        this._canvas.addEventListener('mouseleave', this._handleMouseLeave);

        // 初始绘制
        this._render();
    }

    /**
     * 获取当前所选坐标
     * 返回一个对象 { x: number, y: number }，x 和 y 的范围均为 [-40, 40]
     * 保留一位小数精度，适合模拟摇杆场景
     */
    getCoord() {
        return {
            x: Math.round(this._coordX * 10) / 10,
            y: Math.round(this._coordY * 10) / 10
        };
    }

    /**
     * 销毁实例，移除事件监听（可选调用）
     */
    destroy() {
        this._canvas.removeEventListener('click', this._handleClick);
        this._canvas.removeEventListener('mousemove', this._handleMouseMove);
        this._canvas.removeEventListener('mouseleave', this._handleMouseLeave);
    }

    // ============ 坐标映射（私有方法） ============

    /**
     * 将单个轴的像素坐标转换为逻辑坐标
     * 使用分段线性映射：两端窄、中间宽
     * @param {number} pixel - 像素位置
     * @param {number} totalSize - canvas 总尺寸（宽度或高度）
     * @param {boolean} isYAxis - 是否为 Y 轴（Y 轴需要翻转方向）
     * @returns {number} 逻辑坐标，范围 [-40, 40]
     */
    _pixelToCoord(pixel, totalSize, isYAxis) {
        const narrowPixels = totalSize * this._narrowRatio;
        const widePixels = totalSize * this._wideRatio;
        const narrowStart = narrowPixels;
        const narrowEnd = narrowPixels + widePixels;

        let coord;
        if (pixel <= narrowStart) {
            // 窄区域（负端）：像素 [0, narrowStart] → 坐标 [-40, -20]（X轴）或 [+40, +20]（Y轴）
            const t = pixel / narrowStart;
            coord = -40 + t * 20;
        } else if (pixel <= narrowEnd) {
            // 宽区域（中间）：像素 [narrowStart, narrowEnd] → 坐标 [-20, +20]
            const t = (pixel - narrowStart) / widePixels;
            coord = -20 + t * 40;
        } else {
            // 窄区域（正端）：像素 [narrowEnd, totalSize] → 坐标 [+20, +40]
            const t = (pixel - narrowEnd) / narrowPixels;
            coord = 20 + t * 20;
        }

        // Y 轴：屏幕像素从上到下增大，但逻辑坐标从上到下减小，需要翻转
        if (isYAxis) {
            coord = -coord;
        }

        // Clamp 到有效范围
        return Math.max(-40, Math.min(40, coord));
    }

    /**
     * 将逻辑坐标转换为单个轴的像素坐标
     * @param {number} coord - 逻辑坐标，范围 [-40, 40]
     * @param {number} totalSize - canvas 总尺寸
     * @param {boolean} isYAxis - 是否为 Y 轴
     * @returns {number} 像素位置
     */
    _coordToPixel(coord, totalSize, isYAxis) {
        // Y 轴翻转
        const c = isYAxis ? -coord : coord;
        const narrowPixels = totalSize * this._narrowRatio;
        const widePixels = totalSize * this._wideRatio;

        let pixel;
        if (c <= -20) {
            // 窄区域（负端）：坐标 [-40, -20] → 像素 [0, narrowPixels]
            const t = (c + 40) / 20;
            pixel = t * narrowPixels;
        } else if (c <= 20) {
            // 宽区域（中间）：坐标 [-20, +20] → 像素 [narrowPixels, narrowPixels + widePixels]
            const t = (c + 20) / 40;
            pixel = narrowPixels + t * widePixels;
        } else {
            // 窄区域（正端）：坐标 [+20, +40] → 像素 [narrowPixels + widePixels, totalSize]
            const t = (c - 20) / 20;
            pixel = narrowPixels + widePixels + t * narrowPixels;
        }

        return Math.max(0, Math.min(totalSize, pixel));
    }

    /**
     * 获取逻辑坐标对应的画布像素坐标
     * @returns {{ px: number, py: number }}
     */
    _getPixelPosition() {
        const w = this._canvas.width;
        const h = this._canvas.height;
        return {
            px: this._coordToPixel(this._coordX, w, false),
            py: this._coordToPixel(this._coordY, h, true)
        };
    }

    // ============ 事件处理（私有方法） ============

    /**
     * 从鼠标事件中提取 canvas 像素坐标
     */
    _getMousePixel(event) {
        const rect = this._canvas.getBoundingClientRect();
        const scaleX = this._canvas.width / rect.width;
        const scaleY = this._canvas.height / rect.height;
        return {
            pixelX: (event.clientX - rect.left) * scaleX,
            pixelY: (event.clientY - rect.top) * scaleY
        };
    }

    /**
     * 点击事件：切换操作状态
     */
    _handleClick(event) {
        const { pixelX, pixelY } = this._getMousePixel(event);

        // 检查点击是否在 canvas 有效范围内
        if (pixelX < 0 || pixelX > this._canvas.width ||
            pixelY < 0 || pixelY > this._canvas.height) {
            return;
        }

        // 切换状态
        this._isOperating = !this._isOperating;

        if (this._isOperating) {
            // 切换到"操作"状态：立即更新坐标到点击位置
            this._coordX = this._pixelToCoord(pixelX, this._canvas.width, false);
            this._coordY = this._pixelToCoord(pixelY, this._canvas.height, true);
            this._canvas.classList.add('active');
        } else {
            // 切换到"不操作"状态：坐标保持在最后位置
            this._canvas.classList.remove('active');
        }

        this._render();
        this._notifyChange();
    }

    /**
     * 鼠标移动事件：在"操作"状态下更新坐标
     */
    _handleMouseMove(event) {
        if (!this._isOperating) {
            return;
        }

        const { pixelX, pixelY } = this._getMousePixel(event);

        // 仅当鼠标在 canvas 范围内时更新（范围外的移动忽略）
        if (pixelX < 0 || pixelX > this._canvas.width ||
            pixelY < 0 || pixelY > this._canvas.height) {
            return;
        }

        this._coordX = this._pixelToCoord(pixelX, this._canvas.width, false);
        this._coordY = this._pixelToCoord(pixelY, this._canvas.height, true);

        this._render();
        this._notifyChange();
    }

    /**
     * 鼠标离开 canvas：在"操作"状态下坐标保持最后值
     */
    _handleMouseLeave() {
        // 不需要额外操作，坐标已保持在最后在 canvas 内的位置
        // 如果需要在离开时触发回调，可以在这里处理
    }

    /**
     * 通知外部坐标变化
     */
    _notifyChange() {
        if (this._onChange) {
            this._onChange(this.getCoord());
        }
        // 同时更新页面上的显示（如果存在对应的 DOM 元素）
        this._updateExternalDisplay();
    }

    /**
     * 更新外部显示元素（如果页面中存在）
     */
    _updateExternalDisplay() {
        const coord = this.getCoord();
        const elX = document.getElementById('coordX');
        const elY = document.getElementById('coordY');
        const statusDot = document.getElementById('statusDot');
        const statusLabel = document.getElementById('statusLabel');

        if (elX) elX.textContent = coord.x.toFixed(1);
        if (elY) elY.textContent = coord.y.toFixed(1);
        if (statusDot) {
            statusDot.className = 'status-dot ' + (this._isOperating ? 'operating' : 'idle');
        }
        if (statusLabel) {
            statusLabel.textContent = this._isOperating ? '操作中' : '待命';
        }
    }

    // ============ 绘制（私有方法） ============

    /**
     * 完整重绘 canvas
     */
    _render() {
        const ctx = this._ctx;
        const w = this._canvas.width;
        const h = this._canvas.height;
        const centerX = w / 2;
        const centerY = h / 2;
        const narrowPixelsX = w * this._narrowRatio;
        const widePixelsX = w * this._wideRatio;
        const narrowPixelsY = h * this._narrowRatio;
        const widePixelsY = h * this._wideRatio;

        // 清空画布
        ctx.clearRect(0, 0, w, h);

        // 背景色
        ctx.fillStyle = '#fafaf8';
        ctx.fillRect(0, 0, w, h);

        // --- 绘制宽窄区域背景区分 ---
        // 宽区域（中间）使用略亮的背景
        ctx.fillStyle = 'rgba(200, 220, 240, 0.18)';
        ctx.fillRect(narrowPixelsX, narrowPixelsY, widePixelsX, widePixelsY);

        // --- 绘制宽窄区域分界线（虚线） ---
        ctx.save();
        ctx.strokeStyle = 'rgba(150, 160, 180, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = 0;

        // 垂直分界线（在坐标 X=-20 和 X=+20 处）
        const xNeg20 = this._coordToPixel(-20, w, false);
        const xPos20 = this._coordToPixel(20, w, false);
        ctx.beginPath();
        ctx.moveTo(xNeg20, 0);
        ctx.lineTo(xNeg20, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xPos20, 0);
        ctx.lineTo(xPos20, h);
        ctx.stroke();

        // 水平分界线（在坐标 Y=+20 和 Y=-20 处，注意 Y 轴翻转）
        const yPos20 = this._coordToPixel(20, h, true);
        const yNeg20 = this._coordToPixel(-20, h, true);
        ctx.beginPath();
        ctx.moveTo(0, yPos20);
        ctx.lineTo(w, yPos20);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, yNeg20);
        ctx.lineTo(w, yNeg20);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.restore();

        // --- 绘制刻度标记 ---
        const tickCoords = [-40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40];
        const tickLength = 7;

        // X 轴刻度
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        for (const tc of tickCoords) {
            const px = this._coordToPixel(tc, w, false);
            ctx.beginPath();
            ctx.moveTo(px, centerY - tickLength);
            ctx.lineTo(px, centerY + tickLength);
            ctx.stroke();
        }

        // Y 轴刻度
        for (const tc of tickCoords) {
            const py = this._coordToPixel(tc, h, true);
            ctx.beginPath();
            ctx.moveTo(centerX - tickLength, py);
            ctx.lineTo(centerX + tickLength, py);
            ctx.stroke();
        }

        // --- 绘制坐标轴 ---
        ctx.save();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.8;
        ctx.fillStyle = '#444';

        // X 轴（水平线）
        ctx.beginPath();
        ctx.moveTo(8, centerY);
        ctx.lineTo(w - 8, centerY);
        ctx.stroke();

        // X 轴箭头（向右）
        ctx.beginPath();
        ctx.moveTo(w - 8, centerY);
        ctx.lineTo(w - 18, centerY - 6);
        ctx.lineTo(w - 18, centerY + 6);
        ctx.closePath();
        ctx.fill();

        // Y 轴（垂直线）
        ctx.beginPath();
        ctx.moveTo(centerX, h - 8);
        ctx.lineTo(centerX, 8);
        ctx.stroke();

        // Y 轴箭头（向上）
        ctx.beginPath();
        ctx.moveTo(centerX, 8);
        ctx.lineTo(centerX - 6, 18);
        ctx.lineTo(centerX + 6, 18);
        ctx.closePath();
        ctx.fill();

        // 原点标记
        ctx.fillStyle = '#444';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // --- 绘制刻度标签 ---
        ctx.fillStyle = '#555';
        ctx.font = '11px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelCoords = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
        const labelCoordsY = [-40, -30, -20, -10, 0, 10, 20, 30, 40];

        // X 轴标签（在轴下方）
        for (const lc of labelCoords) {
            const px = this._coordToPixel(lc, w, false);
            ctx.fillText(String(lc), px, centerY + tickLength + 3);
        }

        // Y 轴标签（在轴左侧）
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const lc of labelCoordsY) {
            const py = this._coordToPixel(lc, h, true);
            ctx.fillText(String(lc), centerX - tickLength - 4, py);
        }

        // --- 绘制当前选择位置指示器 ---
        const { px, py } = this._getPixelPosition();
        const indicatorRadius = 9;
        const isOp = this._isOperating;
        const mainColor = isOp ? '#e53935' : '#43a047';
        const glowColor = isOp ? 'rgba(229, 57, 53, 0.45)' : 'rgba(67, 160, 71, 0.45)';
        const innerColor = isOp ? '#ff6f6f' : '#76d275';

        ctx.save();

        // 光晕
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(px, py, indicatorRadius + 6, 0, Math.PI * 2);
        ctx.fill();

        // 外圈
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, indicatorRadius, 0, Math.PI * 2);
        ctx.stroke();

        // 填充
        ctx.fillStyle = innerColor;
        ctx.beginPath();
        ctx.arc(px, py, indicatorRadius - 1.5, 0, Math.PI * 2);
        ctx.fill();

        // 中心小白点
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // 十字准线（操作状态下更明显）
        if (isOp) {
            ctx.strokeStyle = 'rgba(229, 57, 53, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            // 水平虚线
            ctx.beginPath();
            ctx.moveTo(px - indicatorRadius - 4, py);
            ctx.lineTo(px + indicatorRadius + 4, py);
            ctx.stroke();
            // 垂直虚线
            ctx.beginPath();
            ctx.moveTo(px, py - indicatorRadius - 4);
            ctx.lineTo(px, py + indicatorRadius + 4);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();

        // --- 绘制坐标数值标签（在指示器旁边） ---
        const coord = this.getCoord();
        const labelText = `(${coord.x.toFixed(1)}, ${coord.y.toFixed(1)})`;
        ctx.fillStyle = '#333';
        ctx.font = 'bold 12px "SF Mono", "Consolas", "Monaco", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        // 根据指示器位置调整标签偏移方向，避免超出画布
        let labelOffsetX = indicatorRadius + 8;
        let labelOffsetY = -indicatorRadius - 4;
        if (px > w - 100) {
            labelOffsetX = -indicatorRadius - 8;
            ctx.textAlign = 'right';
        }
        if (py < 30) {
            labelOffsetY = indicatorRadius + 16;
            ctx.textBaseline = 'top';
        }
        ctx.fillText(labelText, px + labelOffsetX, py + labelOffsetY);

        // --- 绘制标题 ---
        /*
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.font = '11px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('坐标范围: -40 ~ +40 | 中央 -20~+20 为高精度区', w - 12, h - 8);
        */
        // 更新外部显示
        this._updateExternalDisplay();
    }
}
