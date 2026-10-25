export class AttitudeIndication {
  /**
   * @param {HTMLCanvasElement} canvas - 132×132 像素的 canvas 元素
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.canvas.width = 132;
    this.canvas.height = 132;
    this.centerX = 66;
    this.centerY = 66;
    this.radius = 64;        // 仪表圆半径
    this.pitchScale = 3.0;   // 俯仰每度对应像素
  }

  /**
   * 更新姿态仪显示
   * @param {number} pitch - 俯仰角（度），抬头为正
   * @param {number} roll  - 横滚角（度），右滚为正
   */
  updateDisplay(pitch, roll) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    const r = this.radius;
    const scale = this.pitchScale;

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
}