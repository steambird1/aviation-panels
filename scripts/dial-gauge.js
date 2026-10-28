/*!
 * dial-gauge.js —— 通用机械指针式仪表（Canvas 2D）
 *
 * 设计约定：
 *   1. 角度以「12 点方向为 0°、顺时针为正」的度数表示（例如 -135° ~ 135° 即常见的 270° 开口向下表盘）。
 *   2. 刻度的取值范围(min/max)、分度值(majorStep/minorStep)、起止角度(startAngle/endAngle)全部由配置指定。
 *   3. 警示段(segments)按值域配置，内部自动排序 + 裁剪，保证任意两段不相交。
 *   4. 表盘文字(label)绘制在圆心上方，且在指针图层之下（指针可覆盖它，与真实仪表一致）。
 *   5. 数值显示窗口(valueWindow)绘制在圆心下方，可通过 showValueWindow 关闭。
 *
 * 用法：
 *   const g = new DialGauge('#box', { min:0, max:240, ... });
 *   g.setValue(120);          // 动态修改指针指向
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DialGauge = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
  // 滚轮数字用西文无衬线字体：阿拉伯数字天然等宽，滚动时宽度不跳动
  var DRUM_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

  /* ------------------------------------------------------------------ *
   * 默认配置
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    size: 132,                 // 画布边长（正方形，132*132）
    min: 0,                    // 刻度最小值
    max: 100,                  // 刻度最大值
    majorStep: 10,             // 大刻度分度值（标注数字）
    minorStep: 2,              // 小刻度分度值
    startAngle: -135,          // 刻度起始角度（度，12 点方向为 0，顺时针为正）
    endAngle: 135,             // 刻度结束角度
    value: 0,                  // 初始值
    decimals: null,            // 小数位数；null 时由 minorStep 自动推断

    numberScale: 1,            // 刻度数字的缩放（如转速表传 0.001，配合 subLabel 写 "x1000 r/min"）
    numberDecimals: null,      // 刻度数字的小数位；null 时同 decimals

    label: '',                 // 靠上方的文字：字符串，或 { text, subText }
    subLabel: '',              // 主文字下方的副文字

    segments: [],              // 警示段：[{ from, to, color, width, cap }]
    segmentOverlap: 'clip',    // 段重叠时的处理：'clip' 截断后者，'skip' 丢弃后者

    showValueWindow: true,     // 是否绘制下方数值显示窗口（机械滚轮式，只显示数字，不带单位）
    valueWindow: {             // 数值窗口 / 滚轮样式
      width: 46,               // 窗口宽度（内容超出时自动缩放字号，不会撑宽窗口）
      height: 15,              // 窗口高度（＝单个滚轮的可见行高）
      offsetY: 6,              // 窗口上边缘相对圆心的向下偏移（px）
      backgroundColor: '#05080c',
      borderColor: 'rgba(255,255,255,0.20)',
      innerShadow: 'rgba(0,0,0,0.65)',

      decimals: null,          // 滚轮小数位；null 时与刻度小数位一致
      padZeros: false,         // 整数高位是否补 0（true 时更像里程表，如 "042"）

      color: '#eaf2fb',        // 滚轮字符颜色
      fontSize: 12,
      digitWidth: null,        // 单个滚轮宽度；null 时取 fontSize * 0.62
      digitGap: 1,             // 滚轮之间的缝隙
      dotWidthRatio: 0.5,      // 小数点位的宽度系数
      padX: 3,                 // 内容与窗口左右边框的间距

      drumTop: '#04070a',      // 鼓轮上下缘（背光面）
      drumMid: '#2c3745',      // 鼓轮中部（受光面）
      drumBottom: '#04070a',
      shadeTop: 'rgba(0,0,0,0.58)',    // 叠加在字符上的圆柱体暗部（集中在上下缘，保证字符可读）
      shadeBottom: 'rgba(0,0,0,0.62)',
      separatorColor: 'rgba(0,0,0,0.55)',
      radius: 3
    },

    labelStyle: {              // 表盘文字样式
      fontSize: 11,
      color: '#cfd8e3',
      subFontSize: 8,
      subColor: '#7c8899'
    },

    pointer: {                 // 指针样式（尖端止于刻度数字之外，不遮挡数字）
      color: '#ff5a4d',
      length: 41,              // 尖端长度（自圆心算起）
      width: 5,                // 尾部宽度
      tail: 7,                 // 尾部反向长度
      capRadius: 3.5
    },

    face: {                    // 表盘样式
      backgroundColor: '#151c24',
      backgroundInner: '#0d1319',
      ringColor: '#2c3a49',
      tickMajorColor: '#e6edf5',
      tickMinorColor: '#8b98a8',
      tickMajorWidth: 1.6,
      tickMinorWidth: 1,
      numberColor: '#e6edf5',
      numberFontSize: 9.5
    },

    animate: true,             // setValue 是否带动画
    animationDuration: 420,    // 动画时长（ms）
    clamp: true,               // 数值是否限制在量程内
    devicePixelRatio: null     // null 时取 window.devicePixelRatio
  };

  /* ------------------------------------------------------------------ *
   * 工具函数
   * ------------------------------------------------------------------ */
  function isPlainObject(o) {
    return Object.prototype.toString.call(o) === '[object Object]';
  }

  function deepMerge(base, patch) {
    var out = {};
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
      out[k] = isPlainObject(base[k]) ? deepMerge(base[k], {}) : base[k];
    }
    if (!patch) return out;
    for (var p in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, p)) continue;
      var v = patch[p];
      if (isPlainObject(v) && isPlainObject(out[p])) out[p] = deepMerge(out[p], v);
      else if (v !== undefined) out[p] = v;
    }
    return out;
  }

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function decimalsOf(step) {
    var s = String(step);
    var i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   * DialGauge
   * ------------------------------------------------------------------ */
  function DialGauge(target, options) {
    if (!target) throw new Error('[DialGauge] 缺少挂载目标（canvas 元素 / 容器元素 / 选择器）');

    this.cfg = deepMerge(DEFAULTS, options || {});
    this._validate();

    // ---- 画布解析 ----
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('[DialGauge] 找不到挂载目标：' + target);
    if (host.tagName && host.tagName.toUpperCase() === 'CANVAS') {
      this.canvas = host;
      this._ownCanvas = false;
    } else {
      this.canvas = document.createElement('canvas');
      if (this.canvas.style) this.canvas.style.display = 'block';
      host.appendChild(this.canvas);
      this._ownCanvas = true;
    }

    this._buildGeometry();
    this._setupCanvas();

    this._value = this._normalizeValue(this.cfg.value);
    this._displayValue = this._value;   // 动画过程中的实际显示值
    this._animId = null;

    this._renderStatic();
    this.draw();
  }

  DialGauge.DEFAULTS = DEFAULTS;

  /* ---------------------------- 配置校验 ---------------------------- */
  DialGauge.prototype._validate = function () {
    var c = this.cfg;
    c.min = num(c.min, 0);
    c.max = num(c.max, 100);
    if (c.max <= c.min) throw new Error('[DialGauge] max 必须大于 min');
    c.majorStep = Math.abs(num(c.majorStep, 10)) || 10;
    c.minorStep = Math.abs(num(c.minorStep, 2)) || 2;
    if (c.minorStep > c.majorStep) c.minorStep = c.majorStep;
    if (Math.abs(c.startAngle - c.endAngle) < 1e-6) throw new Error('[DialGauge] startAngle 与 endAngle 不能相等');

    // 小刻度数量 / 每隔几个小刻度画一个大刻度
    this._minorCount = Math.max(1, Math.round((c.max - c.min) / c.minorStep));
    this._majorEvery = Math.max(1, Math.round(c.majorStep / c.minorStep));
    // 角度跨度（负值表示逆时针增大的表盘）
    this._span = c.endAngle - c.startAngle;
    // 小数位
    this._decimals = c.decimals == null ? decimalsOf(c.minorStep) : Math.max(0, c.decimals | 0);
    this._numDecimals = c.numberDecimals == null ? this._decimals : Math.max(0, c.numberDecimals | 0);
    // 文字配置归一化
    if (typeof c.label === 'string') c.label = { text: c.label };
    c.label = c.label || {};
    if (c.subLabel && !c.label.subText) c.label.subText = c.subLabel;
    // 警示段
    this._segments = this._normalizeSegments(c.segments);
  };

  /**
   * 警示段归一化：裁剪到量程内 → 按起点排序 → 依次裁剪重叠部分，
   * 从而保证最终绘制出来的任意两段都不会相交（mode='clip' 截断，'skip' 丢弃）。
   */
  DialGauge.prototype._normalizeSegments = function (list) {
    if (!list || !list.length) return [];
    var min = this.cfg.min, max = this.cfg.max;
    var mode = this.cfg.segmentOverlap || 'clip';
    var segs = [];

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s) continue;
      var from = Math.min(num(s.from, min), num(s.to, min));
      var to = Math.max(num(s.from, min), num(s.to, min));
      if (!isFinite(from) || !isFinite(to)) continue;
      from = clamp(from, min, max);
      to = clamp(to, min, max);
      if (to - from <= 1e-9) continue;   // 空段，丢弃
      segs.push({
        from: from,
        to: to,
        color: s.color || '#ff4d4f',
        width: s.width || 4,
        cap: s.cap || 'butt'
      });
    }

    segs.sort(function (a, b) { return a.from - b.from; });

    var out = [];
    var cursor = min;
    for (var j = 0; j < segs.length; j++) {
      var seg = segs[j];
      if (seg.to <= cursor) continue;                    // 完全被前面的段覆盖
      if (seg.from < cursor) {
        if (mode === 'skip') continue;                   // 与前面的段相交 → 丢弃
        seg = { from: cursor, to: seg.to, color: seg.color, width: seg.width, cap: seg.cap };
      }
      if (seg.to - seg.from <= 1e-9) continue;
      out.push(seg);
      cursor = seg.to;
    }
    return out;
  };

  /* ---------------------------- 几何尺寸 ---------------------------- */
  DialGauge.prototype._buildGeometry = function () {
    var size = this.cfg.size;
    var half = size / 2;
    this.size = size;
    this.cx = half;
    this.cy = half;
    // 各半径（以 132px 为基准等比缩放，保证小尺寸下互不遮挡）
    var k = size / 132;
    // 径向分配（各层由外向内依次排布，保证刻度、数字、文字、窗口互不重叠）
    this.R = {
      faceOuter: half - 3,          // 表盘外圆 63
      ringOuter: half - 5,          // 外圈 61
      ringInner: half - 9,          // 外圈内沿 57
      segRadius: half - 12,         // 警示段弧 54
      tickOuter: half - 16,         // 刻度外端 50
      tickMajorInner: half - 23.5,  // 大刻度内端 42.5
      tickMinorInner: half - 20,    // 小刻度内端 46
      number: half - 28             // 刻度数字中心 38
    };
    this._k = k;
    // 指针尺寸：配置值以 132px 为基准，此处按实际尺寸缩放（不写回 cfg，保证可重复调用）
    var p = this.cfg.pointer;
    this._pointer = {
      color: p.color,
      length: num(p.length, 46) * k,
      width: num(p.width, 5) * k,
      tail: num(p.tail, 8) * k,
      capRadius: num(p.capRadius, 4) * k
    };
  };

  DialGauge.prototype._setupCanvas = function () {
    var size = this.size;
    var dpr = this.cfg.devicePixelRatio;
    if (dpr == null) dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._dpr = Math.max(1, dpr);

    this.canvas.width = Math.round(size * this._dpr);
    this.canvas.height = Math.round(size * this._dpr);
    if (this.canvas.style) {
      this.canvas.style.width = size + 'px';
      this.canvas.style.height = size + 'px';
    }

    this.ctx = this.canvas.getContext('2d');

    // 静态图层（表盘/刻度/警示段/文字/窗口底板），指针每次重绘时直接贴图，避免重复计算
    this._static = document.createElement('canvas');
    this._static.width = this.canvas.width;
    this._static.height = this.canvas.height;
    this._sctx = this._static.getContext('2d');
  };

  /* ---------------------------- 数值 / 角度 ---------------------------- */
  DialGauge.prototype._normalizeValue = function (v) {
    v = num(v, this.cfg.min);
    return this.cfg.clamp ? clamp(v, this.cfg.min, this.cfg.max) : v;
  };

  /** 值 → 角度（度） */
  DialGauge.prototype.valueToAngle = function (v) {
    var c = this.cfg;
    var t = (v - c.min) / (c.max - c.min);
    return c.startAngle + t * this._span;
  };

  /** 角度（度）→ 弧度（canvas 坐标系，0° 指向 12 点方向） */
  DialGauge.prototype._rad = function (deg) {
    return (deg - 90) * DEG;
  };

  /** 极坐标 → 直角坐标 */
  DialGauge.prototype._pt = function (radius, deg) {
    var a = this._rad(deg);
    return [this.cx + radius * Math.cos(a), this.cy + radius * Math.sin(a)];
  };

  DialGauge.prototype._fmt = function (v, d) {
    return Number(v).toFixed(d == null ? this._decimals : d);
  };

  /* ---------------------------- 静态图层 ---------------------------- */
  DialGauge.prototype._renderStatic = function () {
    var ctx = this._sctx;
    var dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    this._drawFace(ctx);
    this._drawSegments(ctx);
    this._drawTicks(ctx);
    this._drawLabel(ctx);
    if (this.cfg.showValueWindow) this._drawValueWindowFrame(ctx);
  };

  DialGauge.prototype._drawFace = function (ctx) {
    var c = this.cfg.face, R = this.R;
    // 表盘底色（径向渐变，中心稍亮）
    var g = ctx.createRadialGradient(this.cx, this.cy - R.faceOuter * 0.35, R.faceOuter * 0.15,
      this.cx, this.cy, R.faceOuter);
    g.addColorStop(0, c.backgroundInner);
    g.addColorStop(1, c.backgroundColor);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R.faceOuter, 0, Math.PI * 2);
    ctx.fillStyle = c.backgroundColor;
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();

    // 外圈金属环
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, (R.ringOuter + R.ringInner) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = c.ringColor;
    ctx.lineWidth = R.ringOuter - R.ringInner;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R.ringOuter, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  DialGauge.prototype._drawSegments = function (ctx) {
    var segs = this._segments;
    if (!segs.length) return;
    var ccw = this._span < 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var a0 = this._rad(this.valueToAngle(s.from));
      var a1 = this._rad(this.valueToAngle(s.to));
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.R.segRadius, a0, a1, ccw);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * this._k;
      ctx.lineCap = s.cap;
      ctx.stroke();
    }
  };

  DialGauge.prototype._drawTicks = function (ctx) {
    var c = this.cfg, f = this.cfg.face, R = this.R;
    var n = this._minorCount;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = (f.numberFontSize * this._k).toFixed(2) + 'px ' + FONT_FAMILY;

    for (var i = 0; i <= n; i++) {
      var v = c.min + i * c.minorStep;
      var deg = this.valueToAngle(v);
      var isMajor = (i % this._majorEvery === 0) || i === n;
      var inner = isMajor ? R.tickMajorInner : R.tickMinorInner;
      var p1 = this._pt(R.tickOuter, deg);
      var p2 = this._pt(inner, deg);

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.strokeStyle = isMajor ? f.tickMajorColor : f.tickMinorColor;
      ctx.lineWidth = (isMajor ? f.tickMajorWidth : f.tickMinorWidth) * this._k;
      ctx.lineCap = 'butt';
      ctx.stroke();

      if (isMajor) {
        var pn = this._pt(R.number, deg);
        ctx.fillStyle = f.numberColor;
        ctx.fillText(this._fmt(v * c.numberScale, this._numDecimals), pn[0], pn[1]);
      }
    }
  };

  /** 按最大宽度自动收缩字号，避免长文字压到刻度数字 */
  DialGauge.prototype._fitFont = function (ctx, text, maxWidth, baseSize) {
    var size = baseSize;
    ctx.font = size.toFixed(2) + 'px ' + FONT_FAMILY;
    var w = ctx.measureText(text).width;
    if (w > maxWidth && w > 0) {
      size = Math.max(6, size * maxWidth / w);
      ctx.font = size.toFixed(2) + 'px ' + FONT_FAMILY;
    }
    return size;
  };

  DialGauge.prototype._drawLabel = function (ctx) {
    var st = this.cfg.labelStyle, lb = this.cfg.label || {};
    var k = this._k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 可用宽度：刻度数字所在圆以内的弦长，再留出安全边距
    var maxW = this.R.number * 1.5 * k;

    if (lb.text) {
      this._fitFont(ctx, lb.text, maxW, st.fontSize * k);
      ctx.fillStyle = st.color;
      ctx.fillText(lb.text, this.cx, this.cy - 19 * k);
    }
    if (lb.subText) {
      this._fitFont(ctx, lb.subText, maxW * 0.92, st.subFontSize * k);
      ctx.fillStyle = st.subColor;
      ctx.fillText(lb.subText, this.cx, this.cy - 8.5 * k);
    }
  };

  DialGauge.prototype._windowRect = function () {
    var w = this.cfg.valueWindow;
    var k = this._k;
    var width = w.width * k;
    var height = w.height * k;
    return {
      x: this.cx - width / 2,
      y: this.cy + w.offsetY * k,
      w: width,
      h: height
    };
  };

  DialGauge.prototype._drawValueWindowFrame = function (ctx) {
    var w = this.cfg.valueWindow, k = this._k;
    var r = this._windowRect();
    // 窗口底板
    roundRect(ctx, r.x, r.y, r.w, r.h, w.radius * k);
    ctx.fillStyle = w.backgroundColor;
    ctx.fill();
    ctx.strokeStyle = w.borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 窗口内阴影（上缘暗、下缘微亮），让滚轮看起来嵌在表壳里
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, w.radius * k);
    ctx.clip();
    var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, w.innerShadow);
    g.addColorStop(0.35, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  };

  /* ---------------------------- 指针与窗口内容 ---------------------------- */
  DialGauge.prototype._drawPointer = function (ctx, value) {
    var p = this._pointer, k = this._k;
    var deg = this.valueToAngle(value);
    var a = this._rad(deg);
    var cos = Math.cos(a), sin = Math.sin(a);
    var nx = -sin, ny = cos;            // 法线方向

    var tipX = this.cx + cos * p.length;
    var tipY = this.cy + sin * p.length;
    var hw = p.width / 2;
    var tail = p.tail;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 3 * k;
    ctx.shadowOffsetX = 1 * k;
    ctx.shadowOffsetY = 1 * k;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);                                             // 针尖
    ctx.lineTo(this.cx + nx * hw, this.cy + ny * hw);                   // 根部一侧
    ctx.lineTo(this.cx - cos * tail, this.cy - sin * tail);             // 尾部配重
    ctx.lineTo(this.cx - nx * hw, this.cy - ny * hw);                   // 根部另一侧
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();

    // 中心轴帽
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, p.capRadius * k, 0, Math.PI * 2);
    ctx.fillStyle = '#20272f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  /**
   * 把数值拆成一组「滚轮位」。
   * 每位返回 { ch, next, frac, dot }：
   *   - frac 为该轮的转动比例，0 表示正位，0.5 表示卡在一半（上下各露半个数字）；
   *   - 最低位随数值连续转动；高位只在低位即将进位（低位部分走到最后一个单位）时被带动，
   *     且各进位轮同步完成，与真实机械计数器一致。
   */
  DialGauge.prototype._rollerItems = function (value) {
    var w = this.cfg.valueWindow;
    var d = (w.decimals == null ? this._decimals : Math.max(0, w.decimals | 0));
    var pow = Math.pow(10, d);

    var v = num(value, this.cfg.min);
    var scaled = Math.round(v * pow * 1e6) / 1e6;      // 以 10^-d 为单位的总量（收敛浮点噪声）
    if (!isFinite(scaled)) scaled = this.cfg.min * pow;
    var neg = scaled < 0;
    var abs = Math.abs(scaled);
    var base = Math.floor(abs);
    var frac0 = abs - base;                            // 最低位的转动比例

    // 整数部分 / 小数部分（都取整数位串）
    var intPart = Math.floor(base / pow);
    var fracPart = base - intPart * pow;

    // 整数位数按量程确定，避免数值变化时位宽跳变
    var maxAbs = Math.max(Math.abs(this.cfg.min), Math.abs(this.cfg.max));
    var intLen = Math.max(1, String(Math.floor(maxAbs + 1e-9)).length);

    var intStr = String(intPart);
    if (intStr.length < intLen && w.padZeros) {
      intStr = new Array(intLen - intStr.length + 1).join('0') + intStr;
    }
    var fracStr = d > 0 ? ('000000000' + fracPart).slice(-d) : '';

    var digits = intStr + fracStr;                     // 从左到右的数字序列
    var fracs = [];                                    // 与 digits 对应的转动比例
    for (var i = 0; i < digits.length; i++) {
      var idx = digits.length - 1 - i;                 // i: 自右向左的位序（0 = 最低位）
      if (i === 0) { fracs[idx] = frac0; continue; }
      var p = Math.pow(10, i);
      var mod = abs - Math.floor(abs / p) * p;         // abs mod 10^i：低位部分
      // 低位部分进入最后一个单位（即低位全为 9）时才带动本位，且进度与最低位同步
      fracs[idx] = clamp(mod - (p - 1), 0, 1);
    }

    var items = [];
    if (neg) items.push({ ch: '-', next: '-', frac: 0, dot: true });
    for (var j = 0; j < digits.length; j++) {
      if (d > 0 && j === intStr.length) items.push({ ch: '.', next: '.', frac: 0, dot: true });
      var c = digits[j];
      items.push({ ch: c, next: String(((c.charCodeAt(0) - 48) + 1) % 10), frac: fracs[j] || 0, dot: false });
    }
    return items;
  };

  /** 单个鼓轮：鼓面渐变 + 可滚动的字符 + 圆柱体明暗 */
  DialGauge.prototype._drawOneDrum = function (ctx, item, x, y, cw, h, fontSize) {
    var w = this.cfg.valueWindow;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, h);
    ctx.clip();

    // 鼓面（上下背光、中部受光）
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, w.drumTop);
    g.addColorStop(0.5, w.drumMid);
    g.addColorStop(1, w.drumBottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cw, h);

    // 字符：随 frac 上移，下一个字符自下方进入（frac=0.5 时各露一半）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontSize.toFixed(2) + 'px ' + DRUM_FONT;
    ctx.fillStyle = w.color;
    var cy = y + h / 2;
    var off = item.frac * h;
    ctx.fillText(item.ch, x + cw / 2, cy - off);
    if (off > 0.4) ctx.fillText(item.next, x + cw / 2, cy - off + h);

    // 圆柱体明暗（叠在字符之上，形成立体感）
    var s = ctx.createLinearGradient(0, y, 0, y + h);
    s.addColorStop(0, w.shadeTop);
    s.addColorStop(0.30, 'rgba(0,0,0,0)');
    s.addColorStop(0.70, 'rgba(0,0,0,0)');
    s.addColorStop(1, w.shadeBottom);
    ctx.fillStyle = s;
    ctx.fillRect(x, y, cw, h);
    ctx.restore();

    // 轮与轮之间的细缝
    ctx.fillStyle = w.separatorColor;
    ctx.fillRect(x + cw, y + h * 0.12, Math.max(0.5, this._k * 0.7), h * 0.76);
  };

  /** 机械滚轮式数值窗口（不含单位） */
  DialGauge.prototype._drawValueWindowText = function (ctx, value) {
    if (!this.cfg.showValueWindow) return;
    var w = this.cfg.valueWindow, k = this._k;
    var r = this._windowRect();
    var items = this._rollerItems(value);
    if (!items.length) return;

    var fontSize = w.fontSize * k;
    var digitW = num(w.digitWidth, w.fontSize * 0.62) * k;
    var gap = w.digitGap * k;
    var padX = w.padX * k;
    var dotW = digitW * w.dotWidthRatio;

    var totalW = gap * (items.length - 1);
    for (var i = 0; i < items.length; i++) totalW += items[i].dot ? dotW : digitW;

    // 内容过宽时只缩小滚轮，绝不撑宽窗口（避免压到刻度数字）
    var avail = r.w - padX * 2;
    if (totalW > avail && totalW > 0) {
      var s = avail / totalW;
      fontSize *= s; digitW *= s; dotW *= s; gap *= s; totalW = avail;
    }

    var x = r.x + (r.w - totalW) / 2;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var cw = it.dot ? dotW : digitW;
      this._drawOneDrum(ctx, it, x, r.y, cw, r.h, fontSize);
      x += cw + gap;
    }
  };

  /* ---------------------------- 渲染 ---------------------------- */
  DialGauge.prototype.draw = function () {
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this._static, 0, 0);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._drawPointer(ctx, this._displayValue);
    this._drawValueWindowText(ctx, this._displayValue);
    return this;
  };

  /* ---------------------------- 对外 API ---------------------------- */
  /**
   * 动态修改指针指向的值
   * @param {number} value
   * @param {object|boolean} [opts]  true/false 快捷切换动画，或 { animate, duration }
   */
  DialGauge.prototype.setValue = function (value, opts) {
    var animate = this.cfg.animate, duration = this.cfg.animationDuration;
    if (opts === true || opts === false) animate = opts;
    else if (opts && typeof opts === 'object') {
      if (opts.animate != null) animate = !!opts.animate;
      if (opts.duration != null) duration = num(opts.duration, duration);
    }

    var to = this._normalizeValue(value);
    var from = this._displayValue;
    this._value = to;

    if (this._animId && this._cancelAnim) this._cancelAnim();
    if (!animate || duration <= 0 || from === to) {
      this._displayValue = to;
      this.draw();
      return this;
    }

    var self = this;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
    var caf = (typeof cancelAnimationFrame === 'function') ? cancelAnimationFrame : clearTimeout;

    this._cancelAnim = function () { caf(self._animId); self._animId = null; self._cancelAnim = null; };

    var step = function (now) {
      now = now || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
      var t = clamp((now - t0) / duration, 0, 1);
      var e = 1 - Math.pow(1 - t, 3);           // easeOutCubic
      self._displayValue = from + (to - from) * e;
      self.draw();
      if (t < 1) self._animId = raf(step);
      else { self._displayValue = to; self.draw(); self._animId = null; self._cancelAnim = null; }
    };
    this._animId = raf(step);
    return this;
  };

  DialGauge.prototype.getValue = function () { return this._value; };

  /** 替换警示段（自动裁剪，保证不相交） */
  DialGauge.prototype.setSegments = function (segments) {
    this.cfg.segments = segments || [];
    this._segments = this._normalizeSegments(this.cfg.segments);
    this._renderStatic();
    this.draw();
    return this;
  };

  /** 修改表盘文字 */
  DialGauge.prototype.setLabel = function (text, subText) {
    var lb = (typeof text === 'string') ? { text: text } : (text || {});
    if (subText != null) lb.subText = subText;
    this.cfg.label = lb;
    this._renderStatic();
    this.draw();
    return this;
  };

  /** 修改数值窗口显隐 */
  DialGauge.prototype.setValueWindow = function (visible, style) {
    this.cfg.showValueWindow = !!visible;
    if (style) this.cfg.valueWindow = deepMerge(this.cfg.valueWindow, style);
    this._renderStatic();
    this.draw();
    return this;
  };

  /** 合并修改其它配置（量程、分度、角度等），会重建表盘 */
  DialGauge.prototype.update = function (options) {
    this.cfg = deepMerge(this.cfg, options || {});
    this._validate();
    this._buildGeometry();
    this._setupCanvas();
    this._value = this._normalizeValue(this.cfg.value != null ? this.cfg.value : this._value);
    this._displayValue = this._value;
    this._renderStatic();
    this.draw();
    return this;
  };

  /** 返回实际生效的（已裁剪、不相交的）警示段，便于调试 */
  DialGauge.prototype.getSegments = function () {
    return this._segments.map(function (s) { return { from: s.from, to: s.to, color: s.color, width: s.width }; });
  };

  DialGauge.prototype.destroy = function () {
    if (this._animId && this._cancelAnim) this._cancelAnim();
    if (this._ownCanvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  return DialGauge;
});
