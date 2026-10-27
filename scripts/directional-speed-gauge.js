/*!
 * directional-speed-gauge.js
 * 带方向的速度指示仪表（罗盘式），绘制在 132 × 132 的 canvas 上。
 *
 * 结构（圆心 = 画布中心，外圈圆半径 R，默认 39）：
 *   1. 最外圈：实际绘制的白色圆，罗盘结构；5° 小刻度、10° 大刻度（向圆内）、30° 一个数字（画在圆外侧）
 *   2. 中轴线正上方：顶点朝下的白色等边三角形（顶点贴在外圈圆上端点，不与数字相碰），
 *      它所指的外圈角度 = “外圈角度指示”（默认 0°，可由 ringRotation 转动盘面改变）
 *   3. 圆内箭头：自圆心出发，长度 = 速度映射半径，箭头任何情况下不超出圆边界
 *      0~10 节  → 0 ~ 3/4 R（线性）
 *      10~30 节 → 3/4 R ~ R（线性，30 节时恰好到达圆边界）
 *      方向：speed.direction 是“盘外标注的角度”，屏幕角度 = direction − ringRotation，
 *            故速度方向不变而盘面转动时，箭头的屏幕指向随之改变（始终指向盘面上对应的那个刻度）
 *   4. 速度数字：画在箭头反向延长线的 1/2 半径处，颜色与箭头一致，数字本身不旋转
 *   5. 青色速度刻度（0 / 5 / 10 / 30）：与箭头同方向，数字本身不旋转
 *   6. 限速指示：红色圆（半径用同一映射），可不存在；存在时在画布左下角标出限速值
 *
 * 故障：
 *   速度信息不存在   → 不画箭头 / 速度刻度 / 速度数字，圆内显示黄色带框 SPD
 *   限速信息故障     → 原限速值位置显示黄色带框 LIM
 *   速度方向信息故障 → 推定速度方向 = 外圈角度指示（见 directionFaultEstimate），
 *                      并在画布右下角显示黄色带框 DIR
 *
 * 用法：
 *   var g = new DirectionalSpeedGauge(canvasEl, { pixelRatio: 2, ringRotation: 0 });
 *   g.render({ speed: 12, direction: 40, limit: 25 });
 *   g.render({ speed: 18, direction: 135, limit: 30, limitFault: true, directionFault: true });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DirectionalSpeedGauge = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var TAU = Math.PI * 2;

  var DEFAULTS = {
    size: 132,            // 画布逻辑尺寸（132 × 132）
    pixelRatio: 1,        // 设备像素比（>1 时更清晰，逻辑坐标不变）
    radius: 39,           // 外圈圆半径
    ringRotation: 0,      // 罗盘盘面转动量：该角度的刻度正对顶部三角形 = 外圈角度指示
    speedBreak: 10,       // 分段点（节）
    speedMax: 30,         // 满刻度（节）→ 箭头贴到圆边界
    indexSize: 6.5,       // 顶部等边三角形边长
    speedLabelRatio: 0.5, // 速度数字位置：反向延长线上 × 半径
    // 方向故障时的推定方式（外圈角度指示 = 顶部三角形所指的盘外角度，记为 φ）：
    //   'ring'   → 推定方向 = φ，箭头屏幕角度 = φ − φ = 0，即恒定指向正上方（顶部三角形处）
    //   'double' → 推定方向 = 2φ，箭头屏幕角度 = φ（盘面转动时箭头随之偏转）
    directionFaultEstimate: 'ring',
    cornerInset: 14,      // 左下 / 右下角标注距画布左右边界的距离
    cornerBottom: 12,     // 左下 / 右下角标注距画布底边的距离
    screenBorder: null,   // 方形“屏幕区域”的描边颜色（null = 不描边，仅填黑底）
    markSpeeds: [0, 5, 10, 30],
    background: '#0A0E13',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
    colors: {
      ring: '#FFFFFF',    // 外圈圆、刻度、数字、顶部三角形
      arrow: '#00FFFF',   // 箭头、速度数字、速度刻度（青色）
      limit: '#FF3B30',   // 限速圆与限速值（红色）
      warning: '#FFD400'  // 故障标志（黄色）
    }
  };

  function deepExtend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          target[k] = deepExtend(target[k] || {}, src[k]);
        } else {
          target[k] = src[k];
        }
      }
    }
    return target;
  }

  function norm360(a) {
    return ((+a || 0) % 360 + 360) % 360;
  }

  function flagOf(v, faultKey, validKey) {
    if (v && v[faultKey] != null) return !!v[faultKey];
    if (v && v[validKey] != null) return !v[validKey];
    return false;
  }

  /* ------------------------------------------------------------------ */

  function DirectionalSpeedGauge(canvas, options) {
    if (!canvas) throw new Error('DirectionalSpeedGauge: 需要传入 canvas 元素');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = deepExtend({}, DEFAULTS, options || {});
    this._prepare();
  }

  DirectionalSpeedGauge.prototype._prepare = function () {
    var o = this.options;
    var dpr = o.pixelRatio || 1;
    this.canvas.width = Math.round(o.size * dpr);
    this.canvas.height = Math.round(o.size * dpr);
    if (this.canvas.style) {
      this.canvas.style.width = o.size + 'px';
      this.canvas.style.height = o.size + 'px';
    }
  };

  DirectionalSpeedGauge.prototype.setOptions = function (options) {
    this.options = deepExtend({}, this.options, options || {});
    this._prepare();
    return this;
  };

  /** 当前顶部三角形所指的外圈角度（度） */
  DirectionalSpeedGauge.prototype.getOuterRingAngle = function () {
    return norm360(this.options.ringRotation || 0);
  };

  /**
   * 速度方向（盘外标注角度）→ 屏幕角度（0 = 正上方，顺时针）
   * 盘面转动 ringRotation 时，同一速度方向在屏幕上的指向随之改变。
   */
  DirectionalSpeedGauge.prototype.directionToScreen = function (direction) {
    return norm360((+direction || 0) - (this.options.ringRotation || 0));
  };

  /** 速度（节）→ 半径（px）：0~10 → 0~3/4R，10~30 → 3/4R~R，超出钳位到 R */
  DirectionalSpeedGauge.prototype.speedToRadius = function (speed) {
    var o = this.options;
    var R = o.radius;
    var s = Math.max(0, +speed || 0);
    var rBreak = R * 0.75;                 // 10 节 → 3/4 半径
    if (s <= o.speedBreak) return (s / o.speedBreak) * rBreak;
    if (s < o.speedMax) {
      return rBreak + ((s - o.speedBreak) / (o.speedMax - o.speedBreak)) * (R - rBreak);
    }
    return R;                              // 满刻度恰好到达圆边界，超出不再增长
  };

  /* ------------------------------ 主绘制 ------------------------------ */

  DirectionalSpeedGauge.prototype.render = function (state) {
    state = state || {};
    var o = this.options;
    var ctx = this.ctx;
    var S = o.size;
    var cx = S / 2;
    var cy = S / 2;
    var dpr = o.pixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, S, S);          // 黑色“屏幕区域”为方形（铺满整块画布）
    }
    if (o.screenBorder) {                // 可选：勾出方形屏幕边界
      ctx.strokeStyle = o.screenBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    }
    ctx.lineJoin = 'round';

    this._drawRing(ctx, cx, cy);
    this._drawIndexTriangle(ctx, cx, cy);
    this._drawLimit(ctx, cx, cy, state);
    this._drawVector(ctx, cx, cy, state);
    this._drawFaults(ctx, cx, cy, state);

    return this;
  };

  /** 1. 最外圈罗盘：白色圆 + 刻度（圆内）+ 数字（圆外） */
  DirectionalSpeedGauge.prototype._drawRing = function (ctx, cx, cy) {
    var o = this.options;
    var R = o.radius;
    var rot = o.ringRotation || 0;
    var C = o.colors;

    ctx.strokeStyle = C.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // 刻度：5° 小刻度、10° 大刻度，向圆内绘制，白色
    ctx.beginPath();
    for (var v = 0; v < 360; v += 5) {
      var a = (v - rot) * DEG;
      var sn = Math.sin(a);
      var cs = Math.cos(a);
      var len = (v % 10 === 0) ? 5 : 2.5;
      ctx.moveTo(cx + R * sn, cy - R * cs);
      ctx.lineTo(cx + (R - len) * sn, cy - (R - len) * cs);
    }
    ctx.stroke();

    // 数字：每 30° 一个，画在圆外侧
    ctx.fillStyle = C.ring;
    ctx.font = '8px ' + o.fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var rn = R + 13;
    for (var n = 0; n < 360; n += 30) {
      var b = (n - rot) * DEG;
      ctx.fillText(String(n), cx + rn * Math.sin(b), cy - rn * Math.cos(b));
    }
  };

  /** 2. 中轴线正上方、顶点朝下的白色等边三角形（顶点落在外圈圆上端点，不碰数字） */
  DirectionalSpeedGauge.prototype._drawIndexTriangle = function (ctx, cx, cy) {
    var o = this.options;
    var side = o.indexSize;
    var h = side * Math.sqrt(3) / 2;
    var apexY = cy - o.radius;             // 顶点：外圈圆最上端 = 外圈角度指示所在位置
    ctx.fillStyle = o.colors.ring;
    ctx.beginPath();
    ctx.moveTo(cx, apexY);
    ctx.lineTo(cx - side / 2, apexY - h);
    ctx.lineTo(cx + side / 2, apexY - h);
    ctx.closePath();
    ctx.fill();
  };

  /** 6. 限速：红色圆 + 圆外左下角限速值 */
  DirectionalSpeedGauge.prototype._drawLimit = function (ctx, cx, cy, state) {
    var o = this.options;
    var R = o.radius;
    var C = o.colors;
    var fault = flagOf(state, 'limitFault', 'limitValid');
    var lim = state.limit;

    if (fault || lim == null || !isFinite(lim)) return;

    var r = this.speedToRadius(lim);
    ctx.strokeStyle = C.limit;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r), 0, TAU);
    ctx.stroke();

    var p = this._corner('left');          // 画布左下角
    this._text(ctx, String(Math.round(lim)), p.x, p.y, { color: C.limit, size: 9, weight: 'bold' });
  };

  /** 3/4/5. 箭头 + 反向延长线上的速度数字 + 青色速度刻度 */
  DirectionalSpeedGauge.prototype._drawVector = function (ctx, cx, cy, state) {
    if (flagOf(state, 'speedFault', 'speedValid')) return;   // SPD 故障：箭头与速度刻度均不显示

    var o = this.options;
    var R = o.radius;
    var C = o.colors;

    var dir;
    if (flagOf(state, 'directionFault', 'directionValid')) {
      // 方向故障：以“外圈角度指示”(φ) 推定。'ring' 模式下推定方向 = φ，
      // 而 φ 在屏幕上正好就是正上方（顶部三角形处），故箭头直接指向上方。
      var ring = this.getOuterRingAngle();
      dir = (o.directionFaultEstimate === 'double') ? norm360(ring * 2) : ring;
    } else {
      dir = norm360(state.direction);
    }
    var speed = Math.max(0, +state.speed || 0);

    // direction 是盘外标注的角度 → 屏幕角度需扣除盘面转动量
    var a = this.directionToScreen(dir) * DEG;
    var ux = Math.sin(a);
    var uy = -Math.cos(a);                                   // 箭头方向单位向量
    var px = Math.cos(a);
    var py = Math.sin(a);                                    // 垂直方向（箭头右侧）
    var L = this.speedToRadius(speed);

    // 青色速度刻度（0 / 5 / 10 / 30），与箭头同方向
    ctx.strokeStyle = C.arrow;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < o.markSpeeds.length; i++) {
      var rm = this.speedToRadius(o.markSpeeds[i]);
      var bx = cx + rm * ux;
      var by = cy + rm * uy;
      ctx.moveTo(bx - px * 2.5, by - py * 2.5);
      ctx.lineTo(bx + px * 2.5, by + py * 2.5);
    }
    ctx.stroke();

    // 刻度数字：跟随箭头方向，但数字本身不旋转
    for (var j = 0; j < o.markSpeeds.length; j++) {
      var rl = this.speedToRadius(o.markSpeeds[j]);
      this._text(ctx, String(o.markSpeeds[j]),
        cx + (rl - 4) * ux + px * 8.5,
        cy + (rl - 4) * uy + py * 8.5,
        { color: C.arrow, size: 7 });
    }

    // 箭头（始终不超过圆边界）
    ctx.fillStyle = C.arrow;
    if (L < 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.2, 0, TAU);
      ctx.fill();
    } else {
      var headLen = Math.min(6.5, L * 0.9);
      var halfW = headLen * 0.5;
      var tipX = cx + L * ux;
      var tipY = cy + L * uy;
      var backX = tipX - headLen * ux;
      var backY = tipY - headLen * uy;

      ctx.strokeStyle = C.arrow;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(backX, backY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX + px * halfW, backY + py * halfW);
      ctx.lineTo(backX - px * halfW, backY - py * halfW);
      ctx.closePath();
      ctx.fill();
    }

    // 速度数字：箭头反向延长线上 1/2 半径处，颜色同箭头，不旋转
    var lr = R * (o.speedLabelRatio == null ? 0.5 : o.speedLabelRatio);
    this._text(ctx, formatSpeed(speed), cx - lr * ux, cy - lr * uy,
      { color: C.arrow, size: 10, weight: 'bold' });
  };

  /** 故障标志：黄色带框 SPD / LIM / DIR */
  DirectionalSpeedGauge.prototype._drawFaults = function (ctx, cx, cy, state) {
    if (flagOf(state, 'speedFault', 'speedValid')) {
      this._flag(ctx, cx, cy, 'SPD');                       // 圆内
    }
    if (flagOf(state, 'limitFault', 'limitValid')) {
      var p = this._corner('left');                         // 画布左下角（原限速值位置）
      this._flag(ctx, p.x, p.y, 'LIM');
    }
    if (flagOf(state, 'directionFault', 'directionValid')) {
      var q = this._corner('right');                        // 画布右下角
      this._flag(ctx, q.x, q.y, 'DIR');
    }
  };

  /* ------------------------------ 小工具 ------------------------------ */

  /**
   * 画布左下 / 右下角的标注位置（贴着方形画面的两个下角，远离圆外侧的数字环）
   */
  DirectionalSpeedGauge.prototype._corner = function (which) {
    var o = this.options;
    var S = o.size;
    var inset = o.cornerInset == null ? Math.max(10, S * 0.106) : o.cornerInset;
    var bottom = o.cornerBottom == null ? Math.max(9, S * 0.09) : o.cornerBottom;
    return {
      x: (which === 'left') ? inset : S - inset,
      y: S - bottom
    };
  };

  DirectionalSpeedGauge.prototype._text = function (ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.font = (opt.weight ? opt.weight + ' ' : '') + (opt.size || 8) + 'px ' + this.options.fontFamily;
    ctx.fillStyle = opt.color || this.options.colors.ring;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  };

  DirectionalSpeedGauge.prototype._flag = function (ctx, x, y, text) {
    var o = this.options;
    ctx.font = 'bold 8px ' + o.fontFamily;
    var w = ctx.measureText(text).width;
    var bw = Math.round(w + 6);
    var bh = 13;
    var bx = Math.round(x - bw / 2);
    var by = Math.round(y - bh / 2);

    ctx.strokeStyle = o.colors.warning;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.fillStyle = o.colors.warning;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
  };

  function formatSpeed(v) {
    if (!isFinite(v)) return '--';
    return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  }

  /* 便捷函数：一次性创建并绘制 */
  DirectionalSpeedGauge.draw = function (canvas, state, options) {
    return new DirectionalSpeedGauge(canvas, options).render(state);
  };

  return DirectionalSpeedGauge;
});
