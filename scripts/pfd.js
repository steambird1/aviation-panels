/**
 * pfd.js — 主飞行显示器（PFD）姿态区域
 *
 * 画布尺寸固定为 207 × 253。
 * 顶部 50 px 为信息区，内含 FMA（飞行模式通告）：2 行 × 4 栏，每行 18 px；
 *   第一行绿色、第二行青色，最后一栏两行均为白色；
 *   第一行任意栏或最后一栏任意行发生变化（含清空）时在该栏该行加框，3 s 后自动消失。
 * 信息区之下依次为转向刻度与姿态仪；
 * 姿态仪显示为「操场形」：中段矩形 + 上下两个半圆拼接而成。
 *
 * 在原姿态仪（att.js）基础上新增 / 修改：
 *   a) 机翼标识：由两个「L」旋转 90° 得到，固定在画面上，不随姿态仪移动，用于标识姿态仪的显示位置；
 *   b) 俯仰刻度改为非线性：0~10° 占用原先 0~20° 的刻度空间（放大 2 倍），其余区间比例不变，刻度线同理；
 *   c) 顶部转向指示：沿上半圆外侧自对称轴起对称绘制长短相间的刻度线（5° 小刻度 / 10° 大刻度，不标数值），
 *      并在姿态仪内侧贴着圆形轮廓显示三角形，使其沿刻度线的指示与倾斜角一致；
 *   d) 「姿态仪不可用」故障指示：整个姿态仪不绘制，仅保留机翼标识与转向刻度，并在姿态仪显示上半边绘制黄色加框的 ATT；
 *   e) 所有文字使用 Courier New 字体。
 *
 * 姿态球按真实俯仰角自由平移，不做裁剪，因此大俯仰角时不会「卡住」；
 * 地平线移出显示范围后由 _drawHorizonBand() 在对应边缘保留蓝色 / 棕色色带指示天空 / 地面方向。
 */

const DEG = Math.PI / 180;
const FONT = '"Courier New", Courier, monospace';

export class PrimaryFlightDisplay {
  /**
   * @param {HTMLCanvasElement} canvas - 207×253 像素的 canvas 元素
   * @param {object} [options]
   * @param {string} [options.flightDirectorColor] - 飞行指引杆颜色
   * @param {number} [options.flightDirectorPitchLimit] - 俯仰指引最大偏差（度）
   * @param {number} [options.flightDirectorRollLimit] - 横滚指引最大偏差（度）
   * @param {number} [options.flightDirectorBarLength] - 指引线长度（像素）
   * @param {number} [options.flightDirectorBarThickness] - 指引线粗细（像素）
   * @param {number} [options.infoAreaHeight] - 顶部预留给其它信息的高度（像素，默认 50）
   * @param {number} [options.attitudeRadius] - 姿态仪半圆半径（默认 74，姿态仪宽 = 2R）
   * @param {boolean} [options.horizonBand] - 地平线移出画面时是否保留天空 / 地面方向色带（默认 true）
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // ---------- 画布：固定 207 × 253 ----------
    this.width = 207;
    this.height = 253;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // ---------- 顶部信息区：留给其它信息，不参与姿态仪绘制 ----------
    this.infoAreaHeight = options.infoAreaHeight ?? 50; // 顶部预留高度（像素）

    // ---------- FMA（飞行模式通告）：信息区内 2 行 × 4 栏 ----------
    this.fmaRows = 2;
    this.fmaColumns = 4;
    this.fmaRowHeight = options.fmaRowHeight ?? 18;   // 每行高 18 px（固定）
    this.fmaRowGap = options.fmaRowGap ?? 6;          // 行间空隙，保证上下两框不贴合
    this.fmaFontSize = options.fmaFontSize ?? 12;     // 基准字号，过长时自动缩小
    this.fmaBoxDuration = options.fmaBoxDuration ?? 3000; // 变更加框持续时间（ms）
    this.fmaBoxInsetX = 2;                            // 框相对栏位的内缩（框大小与文本无关）
    this.fmaBoxInsetY = 1;

    // 两行在信息区内垂直居中：行高 18 + 间隙 6 → 共 42，上下各留 4
    const rowsTotal =
      this.fmaRows * this.fmaRowHeight + (this.fmaRows - 1) * this.fmaRowGap;
    const fmaTop = (this.infoAreaHeight - rowsTotal) / 2;
    this.fmaRowY = [];
    for (let r = 0; r < this.fmaRows; r += 1) {
      this.fmaRowY.push(fmaTop + r * (this.fmaRowHeight + this.fmaRowGap));
    }

    this.fma = this._emptyFma();          // 当前显示的文字
    this._fmaBoxUntil = this._emptyFma(0); // 各单元格加框的到期时间戳
    this._fmaInitialized = false;         // 首次赋值不触发加框

    // ---------- 顶部转向刻度 ----------
    this.rollScaleMax = 60;   // 刻度范围 ±60°
    this.bankTickGap = 2;     // 刻度起点与圆形轮廓的间隙
    this.bankTickLong = 10;   // 大刻度（10°）长度
    this.bankTickShort = 5;   // 小刻度（5°）长度

    // ---------- 姿态仪：操场形 = 中段矩形 + 上下两个半圆 ----------
    // 整体下移：顶部依次为信息区 → 转向刻度 → 姿态仪，姿态仪尽可能占满剩余高度
    this.cx = this.width / 2;                    // 103.5 对称轴
    this.radius = options.attitudeRadius ?? 74;  // 半圆半径（姿态仪宽 = 148）
    this.topArcY =
      this.infoAreaHeight + this.bankTickGap + this.bankTickLong + 2 + this.radius; // 138
    this.straight = Math.max(                    // 37：中段矩形高（姿态仪总高 = 185）
      8,
      this.height - 4 - (this.topArcY - this.radius) - this.radius * 2
    );
    this.bottomArcY = this.topArcY + this.straight;              // 175 下半圆圆心
    this.cy = (this.topArcY + this.bottomArcY) / 2;              // 156.5 操场形几何中心
    this.halfHeight = this.radius + this.straight / 2;           // 92.5 半高

    // ---------- 俯仰刻度（非线性）----------
    this.pitchScale = 3.0;    // 基准比例：每度 3 像素（原姿态仪比例）
    this.expandLimit = 10;    // 0~expandLimit 度为放大区间
    this.expandFactor = 2;    // 该区间占用原先 0~20° 的刻度空间（放大 2 倍）
    this.horizonMargin = 14;  // 大俯仰时保留的天空 / 地面方向色带宽度（像素）
    this.horizonBand = options.horizonBand ?? true; // 地平线移出画面时保留对侧色带

    // ---------- 机翼标识（不随姿态仪移动）----------
    // 整体跨度需小于飞行指引杆长度，故向对称轴内收
    this.wingRoot = 24;       // 翼根（L 的顶部）距对称轴的距离
    this.wingSpan = 21;       // 翼展：L 的竖笔长度
    this.wingTip = 7;         // 翼尖：L 的横笔长度（位于翼展横线之下）

    // ---------- 转向指示三角形（姿态仪内侧，贴着圆形轮廓）----------
    this.rollPointerOuter = 3;        // 三角顶点与轮廓的间隙
    this.rollPointerInner = 18;       // 三角形高度
    this.rollPointerHalfWidth = 6.5;  // 三角形底边半宽

    // ---------- 颜色 ----------
    this.colors = {
      background: '#0A0C10',
      sky: '#1E90FF',
      ground: '#8B4513',
      horizon: '#FFFFFF',
      ladder: '#FFFFFF',
      ladderShadow: 'rgba(0, 0, 0, 0.75)',
      outline: '#9AA0A6',
      bankScale: '#FFFFFF',
      rollPointer: '#FFFFFF',
      rollPointerShadow: 'rgba(0, 0, 0, 0.85)',
      wing: '#FFFFFF',
      wingShadow: 'rgba(0, 0, 0, 0.9)',
      aircraft: '#FFA500',
      fail: '#FFCC00',
      fmaGreen: '#00E676',   // FMA 第一行
      fmaCyan: '#00E5FF',    // FMA 第二行
      fmaWhite: '#FFFFFF',   // FMA 最后一栏
    };

    // ---------- 飞行指引（十字指引杆）----------
    this.flightDirectorColor = options.flightDirectorColor || '#FFD54F';
    this.flightDirectorPitchLimit = options.flightDirectorPitchLimit ?? 15;
    this.flightDirectorRollLimit = options.flightDirectorRollLimit ?? 15;
    this.flightDirectorBarLength = options.flightDirectorBarLength ?? 104;
    this.flightDirectorBarThickness = options.flightDirectorBarThickness ?? 3;
  }

  /**
   * 更新 PFD 显示
   * @param {number} pitch - 俯仰角（度），抬头为正
   * @param {number} roll  - 横滚角（度），右滚为正
   * @param {object} [options]
   * @param {null|boolean|object} [options.flightDirector] - 飞行指引数据，null / false 时不显示
   * @param {boolean} [options.attitudeFailure] - true 时姿态仪不可用（显示 ATT 故障旗）
   * @param {boolean} [options.attitudeAvailable] - 设为 false 等价于 attitudeFailure = true
   * @param {string[][]|{rows: string[][]}} [options.fma] - FMA 文字，2 行 × 4 栏；
   *        省略时保持上一次的内容。第一行任意栏、或最后一栏任意行发生变化（含清空）时加框 3 s
   */
  updateDisplay(pitch, roll, options = {}) {
    const opts = this._normalizeOptions(options);
    const ctx = this.ctx;
    const now = Date.now();

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.width, this.height);

    // ---- 顶部 FMA（不属于姿态仪显示，任何情况下都绘制）----
    if (opts.fma !== undefined) this._applyFma(opts.fma, now);
    this._drawFma(now);

    if (!opts.attitudeFailure) {
      // ---- 姿态仪本体（天空 / 地面 / 俯仰刻度）----
      this._drawAttitudeBall(pitch, roll);

      // ---- 中心固定飞机符号 ----
      this._drawAircraftSymbol();

      // ---- 飞行指引 ----
      const fd = this._resolveFlightDirector(opts.flightDirector, pitch, roll);
      if (fd) this._drawFlightDirector(fd);

      // ---- 转向指示三角形（贴着圆形轮廓，位于姿态仪内侧）----
      this._drawRollPointer(roll);

      // ---- 姿态仪轮廓（操场形）----
      this._drawOutline();
    }

    // ---- 机翼标识：任何情况下都绘制，且不随姿态仪移动 ----
    this._drawWingSymbol();

    // ---- 顶部转向刻度：任何情况下都绘制（不属于姿态仪显示）----
    this._drawBankScale();

    // ---- 姿态仪不可用 ----
    if (opts.attitudeFailure) {
      this._drawAttitudeFlag();
    }

    // 保存本帧状态，用于在加框到期时自动重绘（即使外部不再调用 updateDisplay）
    this._lastFrame = { pitch, roll, options: opts };
    this._scheduleFmaRefresh(now);
  }

  /**
   * 单独设置 FMA 文字（不改姿态），用于只更新通告的场景。
   * @param {string[][]|{rows: string[][]}} rows - 2 行 × 4 栏
   */
  setFma(rows) {
    this._applyFma(rows, Date.now());
    if (this._lastFrame) {
      this.updateDisplay(this._lastFrame.pitch, this._lastFrame.roll, this._lastFrame.options);
    }
    this._scheduleFmaRefresh(Date.now());
  }

  /** 生成 rows × columns 的空矩阵（fill 为初始值） */
  _emptyFma(fill = '') {
    const out = [];
    for (let r = 0; r < this.fmaRows; r += 1) {
      const row = [];
      for (let c = 0; c < this.fmaColumns; c += 1) row.push(fill);
      out.push(row);
    }
    return out;
  }

  /** 将外部传入的 FMA 数据整理为 rows × columns 的字符串矩阵 */
  _normalizeFma(input) {
    const source = Array.isArray(input)
      ? input
      : input && Array.isArray(input.rows)
        ? input.rows
        : null;
    const out = this._emptyFma();
    for (let r = 0; r < this.fmaRows; r += 1) {
      for (let c = 0; c < this.fmaColumns; c += 1) {
        const value = source && source[r] ? source[r][c] : '';
        out[r][c] = value === undefined || value === null ? '' : String(value);
      }
    }
    return out;
  }

  /**
   * 应用 FMA 文字，并在需要的位置触发加框。
   * 触发条件：第一行任意栏，或最后一栏任意行的内容发生变化（清空为空串同样算变更）。
   */
  _applyFma(input, now) {
    const rows = this._normalizeFma(input);
    const lastCol = this.fmaColumns - 1;
    for (let r = 0; r < this.fmaRows; r += 1) {
      for (let c = 0; c < this.fmaColumns; c += 1) {
        const next = rows[r][c];
        const changed = this.fma[r][c] !== next;
        this.fma[r][c] = next;
        if (changed && this._fmaInitialized && (r === 0 || c === lastCol)) {
          this._fmaBoxUntil[r][c] = now + this.fmaBoxDuration;
        }
      }
    }
    this._fmaInitialized = true;
  }

  /**
   * 绘制 FMA：信息区均分为 4 栏，2 行各 18 px。
   * 第一行绿色、第二行青色，最后一栏两行均为白色。
   * 需要加框的单元格按固定尺寸描边（与文本长度无关），并裁剪在栏位内，不影响其它区域。
   */
  _drawFma(now) {
    const ctx = this.ctx;
    const colWidth = this.width / this.fmaColumns;
    const lastCol = this.fmaColumns - 1;

    for (let r = 0; r < this.fmaRows; r += 1) {
      const y = this.fmaRowY[r];
      const rowColor = r === 0 ? this.colors.fmaGreen : this.colors.fmaCyan;
      for (let c = 0; c < this.fmaColumns; c += 1) {
        const x = c * colWidth;
        const text = this.fma[r][c];

        ctx.save();
        // 文字与框都裁剪在本栏本行内，绝不越界影响相邻栏位或下方区域
        ctx.beginPath();
        ctx.rect(x, y, colWidth, this.fmaRowHeight);
        ctx.clip();

        if (text) {
          const maxWidth = colWidth - this.fmaBoxInsetX * 2 - 3;
          ctx.font = `bold ${this._fitFontSize(ctx, text, maxWidth)}px ${FONT}`;
          ctx.fillStyle = c === lastCol ? this.colors.fmaWhite : rowColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x + colWidth / 2, y + this.fmaRowHeight / 2 + 0.5);
        }

        if (this._fmaBoxUntil[r][c] > now) {
          ctx.strokeStyle = this.colors.fmaWhite;
          ctx.lineWidth = 1;
          ctx.strokeRect(
            x + this.fmaBoxInsetX + 0.5,
            y + this.fmaBoxInsetY + 0.5,
            colWidth - this.fmaBoxInsetX * 2 - 1,
            this.fmaRowHeight - this.fmaBoxInsetY * 2 - 1
          );
        }
        ctx.restore();
      }
    }
  }

  /** 在不超过 maxWidth 的前提下返回可用字号（按 0.5 px 递减） */
  _fitFontSize(ctx, text, maxWidth) {
    let size = this.fmaFontSize;
    ctx.font = `bold ${size}px ${FONT}`;
    while (size > 7 && ctx.measureText(text).width > maxWidth) {
      size -= 0.5;
      ctx.font = `bold ${size}px ${FONT}`;
    }
    return size;
  }

  /** 在最近的加框到期时刻自动重绘一次，使方框按时消失 */
  _scheduleFmaRefresh(now) {
    if (typeof setTimeout !== 'function') return;
    let next = Infinity;
    for (let r = 0; r < this.fmaRows; r += 1) {
      for (let c = 0; c < this.fmaColumns; c += 1) {
        const t = this._fmaBoxUntil[r][c];
        if (t > now && t < next) next = t;
      }
    }
    if (next === Infinity) return;
    if (this._fmaTimer) clearTimeout(this._fmaTimer);
    this._fmaTimer = setTimeout(() => {
      this._fmaTimer = null;
      if (this._lastFrame) {
        const { pitch, roll, options } = this._lastFrame;
        this.updateDisplay(pitch, roll, options);
      }
    }, Math.max(20, next - now + 30));
  }

  /**
   * 绘制姿态仪本体：天空、地面、地平线与非均匀俯仰刻度。
   * 全部内容裁剪在「操场形」区域内，并随横滚角一起旋转。
   *
   * 地平线按真实俯仰角平移，不做任何裁剪：俯仰再大，刻度与数值也持续滚动，不会「卡住」。
   * 地平线移出显示范围后整个球变为单色，此时在对侧边缘补一条渐变色带，
   * 用对应方向的蓝色 / 棕色继续指示天空 / 地面的方向（色带不含地平线，不会被误读为地平线）。
   */
  _drawAttitudeBall(pitch, roll) {
    const ctx = this.ctx;
    const horizonY = this._pitchOffset(pitch); // 真实地平线位置（不裁剪）
    const rollRad = roll * DEG;
    // 沿「世界下方向」从球心到操场形轮廓的距离（横滚后长轴相对该方向倾斜）
    const extent =
      this.radius + (this.straight / 2) * Math.abs(Math.cos(rollRad));

    ctx.save();
    this._stadiumPath(ctx);
    ctx.clip();

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(-rollRad); // 右滚时地平线逆时针倾斜

    // ---- 天空 / 地面 ----
    const L = 400;
    ctx.fillStyle = this.colors.sky;
    ctx.fillRect(-L, -L, L * 2, L + horizonY);
    ctx.fillStyle = this.colors.ground;
    ctx.fillRect(-L, horizonY, L * 2, L - horizonY);

    // ---- 地平线 ----
    ctx.strokeStyle = this.colors.horizon;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-L, horizonY);
    ctx.lineTo(L, horizonY);
    ctx.stroke();

    // ---- 俯仰刻度线（非均匀：与俯仰显示使用同一套比例）----
    const halfH = this.halfHeight;
    for (let deg = -90; deg <= 90; deg += 5) {
      if (deg === 0) continue; // 地平线已单独绘制
      const y = horizonY - this._pitchOffset(deg);
      if (y < -halfH - 8 || y > halfH + 8) continue;

      const isMajor = deg % 10 === 0;
      const halfWidth = isMajor ? 40 : 20;
      const thickness = isMajor ? 2 : 1.25;
      const tickHeight = isMajor ? 4 : 2.5;
      const labelGap = isMajor ? 13 : 0;

      // 深色描边，保证在天空 / 地面上都有足够对比度
      ctx.strokeStyle = this.colors.ladderShadow;
      ctx.lineWidth = thickness + 2;
      ctx.beginPath();
      ctx.moveTo(-halfWidth, y);
      ctx.lineTo(halfWidth, y);
      ctx.stroke();

      ctx.strokeStyle = this.colors.ladder;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      if (labelGap > 0) {
        // 主刻度中间为数字留出空隙，避免横线穿过数字
        ctx.moveTo(-halfWidth, y);
        ctx.lineTo(-labelGap, y);
        ctx.moveTo(labelGap, y);
        ctx.lineTo(halfWidth, y);
      } else {
        ctx.moveTo(-halfWidth, y);
        ctx.lineTo(halfWidth, y);
      }
      ctx.stroke();

      // 刻度两端的小竖线
      ctx.beginPath();
      ctx.moveTo(-halfWidth, y - tickHeight);
      ctx.lineTo(-halfWidth, y + tickHeight);
      ctx.moveTo(halfWidth, y - tickHeight);
      ctx.lineTo(halfWidth, y + tickHeight);
      ctx.stroke();

      // 刻度数值（Courier New）
      if (isMajor) {
        ctx.fillStyle = this.colors.ladder;
        ctx.font = `bold 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.abs(deg)), 0, y);
      }
    }

    // ---- 天空 / 地面方向色带（画在刻度之上，使刻度自然淡入色带）----
    if (this.horizonBand) {
      this._drawHorizonBand(extent);
    }

    ctx.restore(); // 退出旋转坐标系
    ctx.restore(); // 退出裁剪
  }

  /**
   * 天空 / 地面方向色带。
   * 沿世界「上 / 下」方向在球体边缘各铺一条渐变色带：
   * 顶部渐变为天空蓝、底部渐变为地面棕，越靠边缘越浓。
   * 地平线在显示范围内时，色带所在区域本就是同色，叠加后无任何变化；
   * 地平线移出显示范围后，对侧色带显现出来，用来指示天空 / 地面的方向。
   */
  _drawHorizonBand(extent) {
    const ctx = this.ctx;
    const L = 400;
    const inner = Math.max(2, extent - this.horizonMargin);
    const outer = extent;

    // 底部：地面方向
    const ground = ctx.createLinearGradient(0, inner, 0, outer);
    ground.addColorStop(0, this._withAlpha(this.colors.ground, 0));
    ground.addColorStop(1, this._withAlpha(this.colors.ground, 1));
    ctx.fillStyle = ground;
    ctx.fillRect(-L, inner, L * 2, L);

    // 顶部：天空方向
    const sky = ctx.createLinearGradient(0, -inner, 0, -outer);
    sky.addColorStop(0, this._withAlpha(this.colors.sky, 0));
    sky.addColorStop(1, this._withAlpha(this.colors.sky, 1));
    ctx.fillStyle = sky;
    ctx.fillRect(-L, -L, L * 2, L - inner);
  }

  /** 给 #RRGGBB 颜色加上透明度，返回 rgba() 字符串 */
  _withAlpha(color, alpha) {
    const hex = String(color).trim().replace('#', '');
    if (hex.length !== 6) return color;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * 机翼标识（不随姿态仪移动）。
   * 取字母「L」（顶部为原点，竖笔向下、末端横笔向右）：
   *   左半边：以顶部为原点逆时针旋转 90° 后沿对称轴翻转 → 由翼根向左伸出；
   *   右半边：以顶部为原点顺时针旋转 90° 后翻转 → 与左半边关于对称轴对称。
   * 旋转后的竖笔成为水平的翼展（横线），横笔成为翼尖的短竖线，且位于横线之下。
   */
  _drawWingSymbol() {
    const ctx = this.ctx;
    const root = this.wingRoot;
    const span = this.wingSpan;
    const tip = this.wingTip;

    // [翼根 x, 翼根 y, 伸展方向(+1 向右 / -1 向左)]
    const halves = [
      [this.cx - root, this.cy, -1],
      [this.cx + root, this.cy, +1],
    ];

    const paint = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      halves.forEach(([x0, y0, dir]) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);                        // L 的顶部（翼根）
        ctx.lineTo(x0 + dir * span, y0);           // L 的竖笔旋转后成为水平的翼展
        ctx.lineTo(x0 + dir * span, y0 + tip);     // L 的横笔旋转后成为翼尖短竖线（在横线之下）
        ctx.stroke();
      });
    };

    ctx.save();
    paint(this.colors.wingShadow, 5);
    paint(this.colors.wing, 2.5);
    ctx.restore();
  }

  /**
   * 顶部转向指示刻度：沿上半圆外侧，自对称轴起对称绘制长短相间的刻度线。
   * 对称轴（0°）为长线，5° 为小刻度、10° 为大刻度，不标数值；不属于姿态仪显示内容。
   */
  _drawBankScale() {
    const ctx = this.ctx;
    const inner = this.radius + this.bankTickGap;

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = this.colors.bankScale;
    for (let deg = -this.rollScaleMax; deg <= this.rollScaleMax; deg += 5) {
      const isMajor = deg % 10 === 0;
      const outer = inner + (isMajor ? this.bankTickLong : this.bankTickShort);
      const rad = (-90 + deg) * DEG;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      ctx.lineWidth = isMajor ? 2 : 1.25;
      ctx.beginPath();
      ctx.moveTo(this.cx + cos * inner, this.topArcY + sin * inner);
      ctx.lineTo(this.cx + cos * outer, this.topArcY + sin * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 转向指示三角形：位于姿态仪内侧、贴着圆形轮廓，
   * 其沿转向刻度线的位置与倾斜角一致（刻度固定，三角形随倾斜角移动）。
   */
  _drawRollPointer(roll) {
    const ctx = this.ctx;
    const deg = this._clamp(roll, -this.rollScaleMax, this.rollScaleMax);
    const rad = (-90 + deg) * DEG;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rTip = this.radius - this.rollPointerOuter;         // 顶点朝外，贴着轮廓
    const rBase = this.radius - this.rollPointerInner;        // 底边朝内
    const half = this.rollPointerHalfWidth;

    const tipX = this.cx + cos * rTip;
    const tipY = this.topArcY + sin * rTip;
    const baseX = this.cx + cos * rBase;
    const baseY = this.topArcY + sin * rBase;
    const perpX = -sin;
    const perpY = cos;

    const path = () => {
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(baseX + perpX * half, baseY + perpY * half);
      ctx.lineTo(baseX - perpX * half, baseY - perpY * half);
      ctx.closePath();
    };

    ctx.save();
    path();
    ctx.fillStyle = this.colors.rollPointerShadow;
    ctx.fill();
    ctx.strokeStyle = this.colors.rollPointerShadow;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    path();
    ctx.fillStyle = this.colors.rollPointer;
    ctx.fill();
    ctx.restore();
  }

  /** 姿态仪不可用：黄色、加框、位于姿态仪显示上半边的 ATT 字样 */
  _drawAttitudeFlag() {
    const ctx = this.ctx;
    const text = 'ATT';
    const cx = this.cx;
    const cy = this.cy - 46; // 姿态仪显示上半边

    ctx.save();
    ctx.font = `bold 17px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(text).width;
    const padX = 9;
    const padY = 5;
    const boxW = textWidth + padX * 2;
    const boxH = 18 + padY * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.strokeStyle = this.colors.fail;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = this.colors.fail;
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
  }

  /** 中心固定飞机符号（不随姿态仪移动） */
  _drawAircraftSymbol() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.strokeStyle = this.colors.aircraft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 姿态仪「操场形」轮廓 */
  _drawOutline() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.colors.outline;
    ctx.lineWidth = 2;
    this._stadiumPath(ctx);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 构造「操场形」路径：上矩形 + 上下两个半圆。
   * 以 (cx, cy) 为几何中心，宽 2R，总高 2R + straight。
   */
  _stadiumPath(ctx) {
    const cx = this.cx;
    const r = this.radius;
    const topY = this.topArcY;
    const bottomY = this.bottomArcY;
    ctx.beginPath();
    ctx.arc(cx, topY, r, Math.PI, 0);            // 上半圆：左端 → 顶部 → 右端
    ctx.lineTo(cx + r, bottomY);                 // 右侧直边
    ctx.arc(cx, bottomY, r, 0, Math.PI);         // 下半圆：右端 → 底部 → 左端
    ctx.closePath();                             // 左侧直边
  }

  /**
   * 飞行指引十字杆：水平杆按俯仰偏差上下平移，竖直杆按横滚偏差左右平移，
   * 位移比例与俯仰刻度一致（含 0~10° 的放大区间）。
   */
  _drawFlightDirector(fd) {
    const ctx = this.ctx;
    const half = this.flightDirectorBarLength / 2;
    const maxOffset = this.radius - 10;

    const lineY = this.cy + this._clamp(
      -this._pitchOffset(fd.pitchError),
      -maxOffset,
      maxOffset
    );
    const lineX = this.cx + this._clamp(
      fd.rollError * this.pitchScale,
      -maxOffset,
      maxOffset
    );

    const lines = [
      [this.cx - half, lineY, this.cx + half, lineY],
      [lineX, this.cy - half, lineX, this.cy + half],
    ];

    const paint = (lineWidth, strokeStyle, glow = false) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.shadowBlur = glow ? 4 : 0;
      ctx.shadowColor = glow ? fd.color : 'transparent';
      lines.forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });
    };

    ctx.save();
    ctx.lineCap = 'round';
    paint(this.flightDirectorBarThickness + 2.5, 'rgba(6, 8, 12, 0.9)');
    paint(this.flightDirectorBarThickness, fd.color, true);
    ctx.restore();
  }

  /** 归一化 updateDisplay 的第三个参数 */
  _normalizeOptions(options) {
    if (!options) {
      return { flightDirector: null, attitudeFailure: false };
    }
    const direct =
      options.flightDirector !== undefined ||
      options.attitudeFailure !== undefined ||
      options.attitudeAvailable !== undefined ||
      options.fma !== undefined;
    if (direct) {
      return {
        flightDirector: options.flightDirector ?? null,
        attitudeFailure:
          options.attitudeFailure === true || options.attitudeAvailable === false,
        fma: options.fma,
      };
    }
    // 兼容：第三个参数直接传飞行指引数据
    return { flightDirector: options, attitudeFailure: false, fma: undefined };
  }

  /** 整理飞行指引输入（与 att.js 保持一致） */
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
      pitchError: this._clamp(pitchError, -this.flightDirectorPitchLimit, this.flightDirectorPitchLimit),
      rollError: this._clamp(rollError, -this.flightDirectorRollLimit, this.flightDirectorRollLimit),
      color:
        typeof source.color === 'string' && source.color.trim()
          ? source.color
          : this.flightDirectorColor,
    };
  }

  /**
   * 非均匀俯仰比例：俯仰角（度）→ 相对地平线的像素距离（向下为正）。
   * 0~10° 占用原先 0~20° 的刻度空间（放大 2 倍），其余区间仍为 pitchScale 像素/度。
   */
  _pitchOffset(deg) {
    const value = Number(deg);
    if (!Number.isFinite(value)) return 0;
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    if (abs <= this.expandLimit) {
      return sign * abs * this.expandFactor * this.pitchScale;
    }
    const expanded = this.expandLimit * this.expandFactor; // 20（等效原刻度）
    return sign * (expanded + (abs - this.expandLimit)) * this.pitchScale;
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
