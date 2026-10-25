export class AttitudeIndication {
  /**
   * @param {HTMLCanvasElement} canvas - 132×132 像素的 canvas 元素
   * @param {object} [options]
   * @param {string} [options.flightDirectorColor] - 飞行指引杆颜色
   * @param {number} [options.flightDirectorPitchLimit] - 俯仰指引最大偏差（度）
   * @param {number} [options.flightDirectorRollLimit] - 横滚指引最大偏差（度）
   * @param {number} [options.flightDirectorRollScale] - 横滚偏差每度对应像素
   * @param {number} [options.flightDirectorBarLength] - 指引杆长度（像素）
   * @param {number} [options.flightDirectorBarThickness] - 指引杆粗细（像素）
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.canvas.width = 132;
    this.canvas.height = 132;
    this.centerX = 66;
    this.centerY = 66;
    this.radius = 64;        // 仪表圆半径
    this.pitchScale = 3.0;   // 俯仰每度对应像素

    // ---- 飞行指引（十字指引杆）参数 ----
    this.flightDirectorColor = options.flightDirectorColor || '#FFD54F';
    this.flightDirectorPitchLimit = options.flightDirectorPitchLimit ?? 14;
    this.flightDirectorRollLimit = options.flightDirectorRollLimit ?? 26;
    this.flightDirectorRollScale = options.flightDirectorRollScale ?? 1.5;
    this.flightDirectorBarLength = options.flightDirectorBarLength ?? 36;
    this.flightDirectorBarThickness = options.flightDirectorBarThickness ?? 4;
  }

  /**
   * 更新姿态仪显示
   * @param {number} pitch - 俯仰角（度），抬头为正
   * @param {number} roll  - 横滚角（度），右滚为正
   * @param {null|boolean|object} [flightDirector]
   *   飞行指引数据。传 null / false / { visible: false } 时不显示指引。
   *   - { targetPitch, targetRoll }：目标姿态角，指引杆会根据目标与当前姿态的偏差移动
   *   - { pitch, roll }：targetPitch / targetRoll 的简写
   *   - { pitchOffset, rollOffset }：直接给出偏差角（度），向上 / 向右为正
   *   - color：可选，覆盖指引杆颜色
   *   - visible：可选，设为 false 可临时隐藏
   */
  updateDisplay(pitch, roll, flightDirector = null) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    const r = this.radius;
    const scale = this.pitchScale;
    const fd = this._resolveFlightDirector(flightDirector, pitch, roll);

    // 清除画布
    ctx.clearRect(0, 0, 132, 132);

    // ---- 圆形裁剪区域 ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // ---- 旋转坐标系（背景与俯仰刻度随横滚转动） ----
    ctx.save();
    ctx.translate(cx, cy);
    const rollRad = (roll * Math.PI) / 180;
    ctx.rotate(-rollRad); // 右滚时地平线逆时针倾斜

    const offsetY = pitch * scale; // 抬头时地平线下移

    // 天空（蓝色）与地面（棕色）
    const LARGE = 200;
    ctx.fillStyle = '#1E90FF';
    ctx.fillRect(-LARGE, -LARGE, LARGE * 2, LARGE + offsetY);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-LARGE, offsetY, LARGE * 2, LARGE - offsetY);

    // ---- 俯仰刻度线（随背景一起旋转平移） ----
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    const maxR = r;
    const minR = -r;

    for (let deg = -90; deg <= 90; deg += 5) {
      const worldPitch = deg;
      const y = (worldPitch + pitch) * scale; // 该刻度线在仪表上的 Y 坐标
      if (y < minR - 10 || y > maxR + 10) continue;

      const isMajor = deg % 10 === 0;
      const lineWidth = isMajor ? 30 : 15;
      const lineThickness = isMajor ? 2 : 1;
      const tickHeight = isMajor ? 4 : 2;

      ctx.beginPath();
      ctx.lineWidth = lineThickness;
      ctx.moveTo(-lineWidth, y);
      ctx.lineTo(lineWidth, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-lineWidth, y - tickHeight);
      ctx.lineTo(-lineWidth, y + tickHeight);
      ctx.moveTo(lineWidth, y - tickHeight);
      ctx.lineTo(lineWidth, y + tickHeight);
      ctx.stroke();

       // ----- 添加俯仰刻度数字 -----
      if (isMajor) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 只显示绝对值，无需标注正负
        const label = String(Math.abs(deg));
        ctx.fillText(label, 0, y);
      }
    }

    ctx.restore(); // 恢复至未旋转状态

    // ---- 飞行指引十字杆（固定于仪表坐标，不随横滚旋转） ----
    if (fd) {
      this._drawFlightDirector(fd);
    }

    // ---- 中心固定飞机符号（不旋转） ----
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    // 水平机翼
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();
    // 垂直线
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
    // 中心小圆
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ---- 顶部横滚指示器（固定弧线 + 可移动三角） ----
    ctx.save();
    ctx.translate(cx, cy);

    const rollR = 56;                     // 弧线半径
    const maxRoll = 60;                   // 指示器最大刻度 ±60°
    const startAngle = (-90 - maxRoll) * Math.PI / 180;
    const endAngle = (-90 + maxRoll) * Math.PI / 180;

    // 弧线
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, rollR, startAngle, endAngle);
    ctx.stroke();

    // 刻度短线
    for (let deg = -maxRoll; deg <= maxRoll; deg += 10) {
      const rad = (-90 + deg) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const isMajor = deg % 30 === 0;
      const innerR = isMajor ? rollR - 4 : rollR - 1;
      const outerR = rollR + (isMajor ? 6 : 4);
      ctx.beginPath();
      ctx.moveTo(cos * innerR, sin * innerR);
      ctx.lineTo(cos * outerR, sin * outerR);
      ctx.stroke();
    }

    // 三角形指针（随 roll 沿弧线移动）
    let pointerAngle = (-90 - roll) * Math.PI / 180;
    // 限制在弧线范围内
    pointerAngle = Math.max(startAngle, Math.min(endAngle, pointerAngle));

    const pointerR = rollR + 3;
    const triSize = 6;
    const pCos = Math.cos(pointerAngle);
    const pSin = Math.sin(pointerAngle);

    const tipX = pCos * (pointerR + triSize);
    const tipY = pSin * (pointerR + triSize);
    const baseX = pCos * pointerR;
    const baseY = pSin * pointerR;
    // 垂直于径向的方向
    const perpX = -pSin;
    const perpY = pCos;
    const half = 4;
    const bx1 = baseX + perpX * half;
    const by1 = baseY + perpY * half;
    const bx2 = baseX - perpX * half;
    const by2 = baseY - perpY * half;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(bx2, by2);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // 恢复横滚指示器坐标系
    ctx.restore(); // 恢复裁剪

    // ---- 仪表圆形外框 ----
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 将飞行指引输入整理为内部偏差数据。
   * - pitch / roll 视为目标姿态，自动换算为相对当前姿态的偏差
   * - pitchOffset / rollOffset 可直接指定偏差（度，向上 / 向右为正）
   */
  _resolveFlightDirector(input, pitch, roll) {
    if (!input || input === false || input.visible === false || input.enabled === false) {
      return null;
    }

    const source = input === true ? {} : input;
    const targetPitch = source.targetPitch ?? source.pitch;
    const targetRoll = source.targetRoll ?? source.roll;
    let pitchError = 0;
    let rollError = 0;

    if (source.pitchOffset !== undefined && source.pitchOffset !== null) {
      pitchError = Number(source.pitchOffset);
    } else if (targetPitch !== undefined && targetPitch !== null) {
      pitchError = Number(targetPitch) - Number(pitch);
    }

    if (source.rollOffset !== undefined && source.rollOffset !== null) {
      rollError = Number(source.rollOffset);
    } else if (targetRoll !== undefined && targetRoll !== null) {
      rollError = this._shortestAngleDelta(Number(targetRoll), Number(roll));
    }

    if (!Number.isFinite(pitchError)) pitchError = 0;
    if (!Number.isFinite(rollError)) rollError = 0;

    return {
      pitchError: this._clamp(
        pitchError,
        -this.flightDirectorPitchLimit,
        this.flightDirectorPitchLimit
      ),
      rollError: this._clamp(
        rollError,
        -this.flightDirectorRollLimit,
        this.flightDirectorRollLimit
      ),
      color: typeof source.color === 'string' && source.color.trim()
        ? source.color
        : this.flightDirectorColor,
    };
  }

  /**
   * 绘制两根十字飞行指引杆。
   * 水平杆随俯仰偏差上下移动，垂直杆随横滚偏差左右移动。
   */
  _drawFlightDirector(fd) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    const length = this.flightDirectorBarLength;
    const thickness = this.flightDirectorBarThickness;
    const half = length / 2;
    const capLength = 8;
    const capThickness = 2.5;

    // 限制指引杆中心位置，避免杆体超出仪表圆
    const maxOffset = this.radius - half - capLength / 2 - 1;
    const barX = cx + this._clamp(
      fd.rollError * this.flightDirectorRollScale,
      -maxOffset,
      maxOffset
    );
    const barY = cy + this._clamp(
      -fd.pitchError * this.pitchScale,
      -maxOffset,
      maxOffset
    );

    const mainSegments = [
      [barX - half, barY, barX + half, barY],
      [barX, barY - half, barX, barY + half],
    ];
    const capSegments = [
      [barX - half, barY - capLength / 2, barX - half, barY + capLength / 2],
      [barX + half, barY - capLength / 2, barX + half, barY + capLength / 2],
      [barX - capLength / 2, barY - half, barX + capLength / 2, barY - half],
      [barX - capLength / 2, barY + half, barX + capLength / 2, barY + half],
    ];

    const paint = (segments, lineWidth, strokeStyle, glow = false) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.shadowBlur = glow ? 4 : 0;
      ctx.shadowColor = glow ? fd.color : 'transparent';
      segments.forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });
    };

    ctx.save();
    ctx.lineCap = 'round';

    // 深色描边保证在天空/地面背景上都有足够对比度
    paint(mainSegments, thickness + 3, 'rgba(6, 8, 12, 0.9)');
    paint(capSegments, capThickness + 2.5, 'rgba(6, 8, 12, 0.9)');

    // 彩色指引杆
    paint(mainSegments, thickness, fd.color, true);
    paint(capSegments, capThickness, fd.color, true);

    ctx.restore();
  }

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _shortestAngleDelta(target, current) {
    let delta = (Number(target) - Number(current)) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  }
}