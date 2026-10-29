/* =============================================================================
 * navdisplay.js —— 飞机导航显示（ND, Navigation Display）绘制库
 * 绘制画布：默认 253 x 253（可用 options.width/height 改为任意尺寸，如 884 x 524），
 *         字体 Courier New；所有字号与固定像素尺寸均按 options.uiScale 缩放。
 * -----------------------------------------------------------------------------
 * 坐标约定：
 *   - 导航在二维平面上进行，世界坐标为 东北天 平面：x = 东(NM)，y = 北(NM)。
 *   - aircraft 为飞机在世界坐标中的位置（默认原点）。
 *   - 显示方式为“航迹向上”(track up)：屏幕正上方 = 当前航迹方向。
 *
 * 输入（NavDisplay#draw(input)）结构見文件末尾 draw() 上方的注释块。
 * 雷达像素数据用 Uint8Array 传递：长度 = width*height，索引 = y*width + x，
 * 取值 0..5（无 / 深绿 / 浅绿 / 黄 / 红 / 深红），见 ND.RADAR_LEVEL。
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ND = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * 常量
   * ------------------------------------------------------------------------ */

  /** 雷达强度等级（每个像素一个字节，用 Uint8Array 传递） */
  var RADAR_LEVEL = {
    NONE: 0, DARK_GREEN: 1, LIGHT_GREEN: 2, YELLOW: 3, RED: 4, DARK_RED: 5
  };

  /** 等级 -> RGBA */
  var RADAR_RGBA = [
    [0, 0, 0, 0],          // 0 无（透明）
    [0, 110, 40, 255],     // 1 深绿
    [0, 190, 70, 255],     // 2 浅绿
    [230, 215, 0, 255],    // 3 黄
    [225, 50, 35, 255],    // 4 红
    [150, 0, 0, 255]       // 5 深红
  ];

  var DEFAULTS = {
    width: 253,
    height: 253,

    // 分辨率无关：uiScale 会把所有字号与固定像素尺寸按该倍率放大，
    // 使同一套代码在不同画布尺寸下保持一致的观感（253 时为 1；884x524 时约 1.8）
    uiScale: 1,
    // 地图裁剪：'circle' 只画在以飞机为圆心、半径 r 的圆内；'rect' 画满整个导航区。
    // 'auto'：当导航区明显扁宽（宽高比 > mapClipMaxAspect）时改用矩形——
    //         此时圆受高度限制、铺不满宽度，两侧会留下大片空白。
    mapClip: 'auto',
    mapClipMaxAspect: 2.0,

    fontFamily: '"Courier New", Courier, monospace',
    fontSizeArc: 11,        // 航向带数字
    fontSizeBox: 15,        // 顶部航向框数字
    fontSizeLabel: 9,       // 地图点名称
    fontSizeSmall: 10,      // 比例尺数字
    fontSizeFlag: 13,       // 故障旗

    // 弧跨度越小 -> 弧半径越大、弧越平缓 -> 弧顶两侧的空角越小、地图越大
    // 空角高度 = r*(1-cos(arcSpanDeg))，是弧形显示固有的；可用 setOption('arcSpanDeg', n) 调整
    arcSpanDeg: 45,         // 航向弧：中心左右各 45°（可调；40 时空角最小、地图最大）
    arcMargin: 2,           // 弧端点相对导航区左右边的余量
    topReserve: 36,         // 弧顶距导航区顶部的距离（航向框/风所占的高度）
    minAcYRatio: 0.70,      // 飞机参考点不低于导航区高度的该比例，避免被抬得过高
    maxGapAboveArc: 30,     // 弧顶与顶部保留区之间允许的最大空档（弧很小时据此上移）
    radarLabelBacking: true, // WXR/TERR 标识加黑色衬底，避免压在雷达回波上难以辨认
    radarLabelYOffset: 2,    // 标识基线微调，使最底一行与飞机符号底边视觉对齐
    bottomMargin: 30,       // 飞机参考点到导航区底边
    // 飞机符号：等腰三角形，顶点 = 飞机位置，向下张开（顶角 ≈ 106°，较大）
    aircraftHalfWidth: 29,  // 底边半宽（顶角 = 2*atan(halfWidth/height)）
    aircraftHeight: 22,     // 顶点到底边的高度；底边与 WXR/TERR 最底一行对齐
    bottomMarginBottom: 22, // 预留区在下方时（导航区变矮）改用较小值，换取更大的弧半径
    scaleTopGap: 8,         // 比例尺竖线顶端与弧的间隙

    extraWidth: 110,        // “其它导航信息区域”预留宽度（不小于 110px）
    extraHeight: 110,       // 预留高度（side = 'bottom' 时使用，不小于 110px）
    extraSide: 'bottom',    // 'bottom' | 'right' | 'left'
    extraInfoOutline: false,// 仅调试：画出预留区边框

    headingLabelStyle: 'full', // 'full' -> 030 ; 'abbr' -> 3（空客风格缩写）
    showHeadingIndex: true,    // 弧顶当前航迹指示小三角
    windArrowToSource: true,   // 风箭头指向“风的来向”（false 则指向去向）
    radialDashed: false,       // 导航台径向线是否虚线
    mapFaultSuppressRadar: false, // 地图故障是否连雷达一起抑制

    colors: {
      bg: '#000000',
      white: '#ffffff',
      magenta: '#ff44ff',   // 紫红：当前航路 / 下一航路点
      cyan: '#22e0e0',      // 青：导航台、WXR/TERR 标识
      amber: '#ffcc00',     // 琥珀黄：故障旗
      grey: '#909090',
      red: '#ff3c30',
      yellow: '#ffd400',
      green: '#30ff30',
      arc: '#ffffff',
      scale: '#ffffff',
      aircraft: '#ffffff'
    }
  };

  /* ---------------------------------------------------------------------------
   * 小工具
   * ------------------------------------------------------------------------ */
  function rad(d) { return d * Math.PI / 180; }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function fmt3(d) {
    var v = Math.round(norm360(d)) % 360;
    return v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
  }
  function fmtNum(v) {
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    return (Math.round(v * 10) / 10).toFixed(1);
  }
  function merge(base, ext) {
    var out = {}, k;
    if (base) for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (ext) for (k in ext) if (Object.prototype.hasOwnProperty.call(ext, k)) out[k] = ext[k];
    return out;
  }
  function colorOf(colors, name) {
    switch (name) {
      case 'red': return colors.red;
      case 'yellow': case 'amber': return colors.yellow;
      case 'green': return colors.green;
      case 'cyan': return colors.cyan;
      case 'magenta': return colors.magenta;
      default: return colors.white;
    }
  }

  /* ---------------------------------------------------------------------------
   * 航路几何：支持转弯半径（fly-by 转弯圆角）
   * 世界坐标（NM），返回 [{leg, pts:[{x,y}...]}, ...]
   * ------------------------------------------------------------------------ */
  function fillet(pts, j) {
    var P = pts[j], A = pts[j - 1], B = pts[j + 1];
    var R = (P.turnRadius != null ? P.turnRadius : 0);
    if (!(R > 0)) return null;

    var v1x = A.x - P.x, v1y = A.y - P.y, l1 = Math.sqrt(v1x * v1x + v1y * v1y);
    var v2x = B.x - P.x, v2y = B.y - P.y, l2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (l1 < 1e-6 || l2 < 1e-6) return null;
    v1x /= l1; v1y /= l1; v2x /= l2; v2y /= l2;

    var cosT = v1x * v2x + v1y * v2y;
    if (cosT > 1) cosT = 1; else if (cosT < -1) cosT = -1;
    var theta = Math.acos(cosT);                 // 转角
    if (theta < 1e-3 || Math.abs(theta - Math.PI) < 5e-3) return null; // 直线或掉头点不做圆角

    var tanHalf = Math.tan(theta / 2);
    var d = R / tanHalf;                          // 航路点到切点的距离
    var maxD = Math.min(l1, l2) * 0.98;
    if (d > maxD) { d = maxD; R = d * tanHalf; }  // 半径过大时自动收敛

    var p1 = { x: P.x + v1x * d, y: P.y + v1y * d };   // 来向边上的切点
    var p2 = { x: P.x + v2x * d, y: P.y + v2y * d };   // 去向边上的切点

    var bx = v1x + v2x, by = v1y + v2y, bl = Math.sqrt(bx * bx + by * by);
    if (bl < 1e-6) return null;
    var dist = R / Math.sin(theta / 2);
    var c = { x: P.x + bx / bl * dist, y: P.y + by / bl * dist };

    return { p1: p1, p2: p2, c: c, r: R, theta: theta, wp: P };
  }

  function arcPoints(f, steps) {
    var a1 = Math.atan2(f.p1.y - f.c.y, f.p1.x - f.c.x);
    var a2 = Math.atan2(f.p2.y - f.c.y, f.p2.x - f.c.x);
    var da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    var n = Math.max(2, Math.ceil(Math.abs(da) / rad(6)));
    if (steps) n = Math.min(n, steps);
    var out = [];
    for (var k = 0; k <= n; k++) {
      var a = a1 + da * k / n;
      out.push({ x: f.c.x + Math.cos(a) * f.r, y: f.c.y + Math.sin(a) * f.r });
    }
    return out;
  }

  function buildRoutePath(pts) {
    var out = [];
    if (!pts || pts.length < 2) return out;
    var cur = { x: pts[0].x, y: pts[0].y };
    for (var i = 0; i < pts.length - 1; i++) {
      var B = pts[i + 1];
      var f = (i + 1 <= pts.length - 2) ? fillet(pts, i + 1) : null;
      var endPt = f ? f.p1 : B;
      out.push({ leg: i, pts: [cur, endPt] });           // 直线段
      if (f) {
        out.push({ leg: i, pts: arcPoints(f), arc: true }); // 转弯圆弧（属于进入该点的航段）
        cur = f.p2;
      } else {
        cur = { x: B.x, y: B.y };
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * NavDisplay
   * ------------------------------------------------------------------------ */
  function NavDisplay(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    var o = merge(DEFAULTS, options || {});
    // 未显式给出 width/height 时沿用 canvas 自身的尺寸（同一份代码即可适配 884x524 等）
    if (!(options && options.width != null) && canvas.width) o.width = canvas.width;
    if (!(options && options.height != null) && canvas.height) o.height = canvas.height;
    this.options = o;
    if (o.width) canvas.width = o.width;
    if (o.height) canvas.height = o.height;
    this.width = o.width;
    this.height = o.height;
    this.input = {};
    this.L = null;
    this._routePath = [];
    this._radarCanvas = null;
    this._imgData = null;
  }

  /* ---------------- 对外接口 ---------------- */

  NavDisplay.prototype.setInput = function (input) { this.input = input || {}; return this; };

  /**
   * 按当前（或给定）输入重算布局但不绘制，返回布局对象。
   * 雷达数据是「屏幕空间栅格」，其内容取决于当前布局（尤其是 pxPerNm）。
   * 因此调用方应在生成雷达栅格之前先调用本方法拿到最新布局，再调 draw()，
   * 否则栅格会用上一帧的比例尺生成，出现与地图内容不匹配的错误缩放。
   */
  NavDisplay.prototype.updateLayout = function (input) {
    if (input) this.input = input;
    return this._layout();
  };
  NavDisplay.prototype.setOption = function (k, v) { this.options[k] = v; return this; };

  /** 调整比例尺（竖线顶端对应的距离，NM） */
  NavDisplay.prototype.setRangeNm = function (r) { this.input.rangeNm = r; return this; };

  NavDisplay.prototype.getLayout = function () { return this.L || this._layout(); };
  NavDisplay.prototype.getRoutePath = function () { return this._routePath || []; };

  /** 世界坐标(NM) -> 画布像素 */
  NavDisplay.prototype.worldToScreen = function (x, y) {
    var L = this.getLayout();
    var ac = (this.input && this.input.aircraft) || { x: 0, y: 0 };
    var t = rad(this._getTrack()), p = L.pxPerNm;
    var dx = x - ac.x, dy = y - ac.y;
    var ct = Math.cos(t), st = Math.sin(t);
    return {
      x: L.cx + (dx * ct - dy * st) * p,
      y: L.acY - (dx * st + dy * ct) * p
    };
  };

  /** 画布像素 -> 世界坐标(NM) */
  NavDisplay.prototype.screenToWorld = function (sx, sy) {
    var L = this.getLayout();
    var ac = (this.input && this.input.aircraft) || { x: 0, y: 0 };
    var t = rad(this._getTrack()), p = L.pxPerNm;
    var ct = Math.cos(t), st = Math.sin(t);
    var ux = (sx - L.cx) / p, uy = (L.acY - sy) / p;   // 右分量 / 上分量
    return {
      x: ac.x + (ux * ct + uy * st),
      y: ac.y + (-ux * st + uy * ct)
    };
  };

  NavDisplay.prototype._getTrack = function () {
    var inp = this.input || {};
    return (inp.track != null ? inp.track : (inp.heading != null ? inp.heading : 0));
  };

  /* ---------------- 分辨率缩放辅助 ---------------- */

  /** 固定像素尺寸 -> 实际像素（乘 uiScale） */
  NavDisplay.prototype._s = function (v) { return v * this.options.uiScale; };
  /** 字号 -> CSS font 字符串 */
  NavDisplay.prototype._font = function (px) {
    return (px * this.options.uiScale).toFixed(2) + 'px ' + this.options.fontFamily;
  };
  /** 线宽：随 uiScale 放大但夹在 [1, 3.5]，避免大画布上过粗 */
  NavDisplay.prototype._lw = function (v) {
    return Math.max(1, Math.min(3.5, v * this.options.uiScale));
  };

  /* ---------------- 布局 ---------------- */

  NavDisplay.prototype._layout = function () {
    var o = this.options, W = this.width, H = this.height;
    var inp = this.input || {};
    var ei = inp.extraInfo || {};
    var showExtra = !!ei.show;
    var side = ei.side || o.extraSide || 'bottom';
    // “其它导航信息区域”：至少预留 110px；关闭时导航内容占满整个画布
    var extraW = 0, extraH = 0;
    if (showExtra) {
      if (side === 'bottom') {
        extraH = Math.max(110, ei.height || ei.width || o.extraHeight || o.extraWidth || 110);
      } else {
        extraW = Math.max(110, ei.width || o.extraWidth || 110);
      }
    }

    var navX = (side === 'left') ? extraW : 0;
    var navW = Math.max(40, W - extraW);
    var navH = Math.max(40, H - extraH);

    var cx = navX + navW / 2;
    // 预留区在下方时导航区变矮，缩小下边距以换取更大的弧半径
    var bottomMargin = (side === 'bottom') ? this._s(o.bottomMarginBottom) : this._s(o.bottomMargin);
    var acYMax = navH - bottomMargin;

    // 弧半径取两个约束的较小值：
    //   横向 —— 弧两端（±arcSpanDeg）的刻度与数字仍落在导航区内
    //   纵向 —— 弧顶不侵入顶部保留区
    var sinSpan = Math.max(0.2, Math.sin(rad(o.arcSpanDeg)));
    var r = Math.min((navW / 2 - this._s(o.arcMargin)) / sinSpan, acYMax - this._s(o.topReserve));
    if (r < this._s(28)) r = this._s(28);

    // 弧顶紧贴顶部保留区下沿，消除弧上方的空白；同时不让飞机被抬到画面中部
    var acY = Math.max(this._s(o.topReserve) + r, navH * o.minAcYRatio);
    // 弧很小时（导航区窄）允许上移，但弧顶与保留区之间不留过大空档
    acY = Math.min(acY, acYMax, this._s(o.topReserve) + this._s(o.maxGapAboveArc) + r);

    var lineLen = Math.max(this._s(20), r - this._s(o.scaleTopGap));
    var rangeNm = (inp.rangeNm != null && inp.rangeNm > 0) ? inp.rangeNm : 20;
    var pxPerNm = lineLen / rangeNm;

    this.L = {
      W: W, H: H, navX: navX, navW: navW, navH: navH, cx: cx, acY: acY, r: r,
      lineLen: lineLen, rangeNm: rangeNm, pxPerNm: pxPerNm,
      extraW: extraW, extraH: extraH,
      extraX: (side === 'left' ? 0 : navW),
      extraY: navH,
      extraSide: side
    };
    this.L.clip = this._clipMode(this.L);
    return this.L;
  };

  /**
   * 地图裁剪模式。
   * 'auto'：导航区宽高比 > mapClipMaxAspect 时用矩形，否则用圆。
   * 圆以飞机为圆心、半径 = 弧半径；导航区又扁又宽时圆受高度限制而铺不满宽度，
   * 两侧会留下大片空白，此时改用矩形（真实宽屏 ND 的地图也是铺满整个屏幕的）。
   */
  NavDisplay.prototype._clipMode = function (L) {
    var o = this.options;
    if (o.mapClip === 'circle' || o.mapClip === 'rect') return o.mapClip;
    var aspect = (L.navH > 0) ? (L.navW / L.navH) : 1;
    return (aspect > o.mapClipMaxAspect) ? 'rect' : 'circle';
  };

  /* ---------------- 主绘制 ---------------- */

  /**
   * input = {
   *   heading: 30,                 // 当前航向(度)
   *   track: 32,                   // 当前航迹(度)，缺省 = heading；显示以此向上
   *   headingFault: false,         // 航向指示故障 -> 顶部黄色带框 HDG
   *   mapFault: false,             // 地图数据故障 -> 不绘制地图内容 + 黄色带框 MAP
   *   rangeNm: 20,                 // 比例尺（竖线顶端对应的距离 NM），可调
   *   aircraft: {x:0, y:0},        // 飞机世界坐标
   *   wind: {dir:300, speed:18},   // dir = 风的来向(度)
   *   route: {
   *     show: true,
   *     activeIndex: 1,            // 下一个航路点下标
   *     points: [{x,y,name?,turnRadius?}, ...]
   *   },
   *   points: [                    // 需要显示的点
   *     {kind:'navaid', navaidType:'VOR', x, y, name, radial: 90},
   *     {kind:'waypoint', x, y, name, active:true},
   *     {kind:'poi', x, y, name}   // 其余点状信息
   *   ],
   *   navaidRadials: true,         // 导航台径向线开关
   *   showNames: true,
   *   radar: {
   *     mode: 'off'|'wxr'|'terr',
   *     data: Uint8Array(W*H),     // 0..5，索引 y*W+x；屏幕空间栅格，
   *                                // 须在 updateLayout() 之后按当前 pxPerNm 生成
   *     terrain: {lines:[{text:'2400',color:'yellow'},{text:'1500',color:'red'}]}
   *   },
   *   extraInfo: {show:true, height:110, side:'bottom'} // 其它导航信息区域（本库不绘制其内容）
   *   vnav: {...}                                      // 垂直导航剖面数据，见 vnav.js
   * }
   *
   * 其它导航信息区域的绘制可通过 options.extraRenderer 注入：
   *   nd.setOption('extraRenderer', new VNavPanel({...}));
   * 渲染器接口：renderer.draw(ctx, rect, layout, input)
   */
  NavDisplay.prototype.draw = function (input) {
    if (input) this.input = input;
    var inp = this.input || {};
    var ctx = this.ctx, o = this.options, C = o.colors;

    var L = this._layout();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.setLineDash([]);

    this._drawMapArea();          // 地图内容（裁剪在弧内）
    this._drawHeadingArc();       // 弧形航向刻度带
    this._drawHeadingBox();       // 顶部 TRK / 航向框 / HDG 故障旗
    this._drawWind();             // 左上角风向箭头 + 风速
    this._drawScaleBar();         // 对称轴上竖线 + 3 个刻度 + 比例尺数字
    this._drawAircraft();         // 底部飞机（顶角较大的等腰三角形）
    this._drawRadarLabel();       // WXR / TERR + 两行数字
    if (inp.mapFault) this._drawFlag(L.cx, L.acY - L.r * 0.5, 'MAP', C.amber);
    this._drawExtraRegion();
    return this;
  };

  /**
   * “其它导航信息区域”：本库不绘制其内容（预留），
   * 但支持注入外部渲染器（options.extraRenderer）来填充，例如 VNavPanel。
   * 渲染器接口：renderer.draw(ctx, rect, layout, input)
   */
  NavDisplay.prototype._drawExtraRegion = function () {
    var o = this.options, L = this.L, ctx = this.ctx;
    if (!(L.extraW > 0 || L.extraH > 0)) return;

    var rect;
    if (L.extraSide === 'bottom') {
      rect = { x: 0, y: L.navH, w: this.width, h: L.extraH };
    } else if (L.extraSide === 'left') {
      rect = { x: 0, y: 0, w: L.extraW, h: this.height };
    } else {
      rect = { x: L.navW, y: 0, w: L.extraW, h: this.height };
    }

    var r = o.extraRenderer;
    if (r && typeof r.draw === 'function') r.draw(ctx, rect, L, this.input);

    if (o.extraInfoOutline) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = o.colors.grey;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.restore();
    }
  };

  /* ---------------- 地图区域 ---------------- */

  NavDisplay.prototype._drawMapArea = function () {
    var ctx = this.ctx, L = this.L, inp = this.input || {};
    var fault = !!inp.mapFault;

    ctx.save();
    // 地图只画在导航区内（预留区在下方时不越界）
    ctx.beginPath();
    ctx.rect(L.navX, 0, L.navW, L.navH);
    ctx.clip();
    // 再按裁剪模式限制：'circle' 只画在弧内圆；'rect' 画满导航区
    if (L.clip !== 'rect') {
      ctx.beginPath();
      ctx.arc(L.cx, L.acY, L.r, 0, Math.PI * 2);
      ctx.clip();
    }

    if (!(fault && this.options.mapFaultSuppressRadar)) this._drawRadar();
    if (!fault) {
      this._drawRoute();
      this._drawPoints();
    }
    ctx.restore();
  };

  /** 雷达/地形图象：data 为 Uint8Array，长度 W*H，索引 y*W+x */
  NavDisplay.prototype._drawRadar = function () {
    var inp = this.input || {};
    var r = inp.radar;
    if (!r || !r.mode || r.mode === 'off' || !r.data) return;

    var W = this.width, H = this.height;
    var n = W * H;
    if (r.data.length < n) return;

    if (!this._radarCanvas) {
      this._radarCanvas = (typeof document !== 'undefined')
        ? document.createElement('canvas') : null;
    }
    if (!this._radarCanvas) return;

    var img = this._imgData;
    if (!img || img.width !== W || img.height !== H) {
      img = this._imgData = this.ctx.createImageData(W, H);
    }
    var px = img.data, data = r.data;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var lv = data[i];
      if (!(lv > 0)) { px[j + 3] = 0; continue; }      // 无回波 -> 透明
      var c = RADAR_RGBA[lv];
      if (!c) { px[j + 3] = 0; continue; }
      px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = c[3];
    }

    var off = this._radarCanvas;
    if (off.width !== W) off.width = W;
    if (off.height !== H) off.height = H;
    off.getContext('2d').putImageData(img, 0, 0);
    this.ctx.drawImage(off, 0, 0);
  };

  NavDisplay.prototype._drawRoute = function () {
    var inp = this.input || {}, ctx = this.ctx, o = this.options, C = o.colors;
    var rt = inp.route;
    if (!rt || rt.show === false || !rt.points || rt.points.length < 2) { this._routePath = []; return; }

    var segs = buildRoutePath(rt.points);
    this._routePath = segs;
    var active = (rt.activeIndex != null ? rt.activeIndex : 0);

    // 到“下一个航路点”为止（含该点前的转弯圆弧）为紫色（当前航路），之后为白色
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var magenta = seg.leg < active;
      ctx.strokeStyle = magenta ? C.magenta : C.white;
      ctx.lineWidth = magenta ? this._lw(2) : this._lw(1.4);
      ctx.beginPath();
      var pts = seg.pts;
      for (var k = 0; k < pts.length; k++) {
        var s = this.worldToScreen(pts[k].x, pts[k].y);
        if (k === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }

    // 航路点符号（下一个点紫色）
    for (var w = 0; w < rt.points.length; w++) {
      var p = rt.points[w];
      var sp = this.worldToScreen(p.x, p.y);
      if (!this._inMap(sp)) continue;
      var col = (w === active) ? C.magenta : C.white;
      this._symbolWaypoint(sp.x, sp.y, col);
      if (p.name && inp.showNames !== false) this._label(p.name, sp.x, sp.y, col);
    }
  };

  NavDisplay.prototype._drawPoints = function () {
    var inp = this.input || {};
    var pts = inp.points || [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.show === false) continue;
      var sp = this.worldToScreen(p.x, p.y);
      var kind = p.kind || 'poi';

      if (kind === 'navaid') {
        // 径向线画在符号下面
        if (inp.navaidRadials && p.radial != null) {
          var list = (p.radial instanceof Array) ? p.radial : [p.radial];
          for (var k = 0; k < list.length; k++) this._radial(p, list[k], sp);
        }
        if (!this._inMap(sp)) continue;
        this._symbolNavaid(sp.x, sp.y, p.navaidType || 'VOR');
        if (p.name && inp.showNames !== false) this._label(p.name, sp.x, sp.y, this.options.colors.cyan);
      } else if (kind === 'waypoint') {
        if (!this._inMap(sp)) continue;
        var col = p.active ? this.options.colors.magenta : this.options.colors.white;
        this._symbolWaypoint(sp.x, sp.y, col);
        if (p.name && inp.showNames !== false) this._label(p.name, sp.x, sp.y, col);
      } else {
        if (!this._inMap(sp)) continue;
        this._symbolPoi(sp.x, sp.y, p.color);
        if (p.name && inp.showNames !== false) this._label(p.name, sp.x, sp.y, this.options.colors.white);
      }
    }
  };

  NavDisplay.prototype._inMap = function (s) {
    var L = this.L, m = this._s(6);
    if (s.x < -m || s.x > this.width + m || s.y < -m || s.y > (L.navH || this.height) + m) return false;
    if (L.clip === 'rect') return true;
    var dx = s.x - L.cx, dy = s.y - L.acY, rr = L.r + this._s(4);
    if (dx * dx + dy * dy > rr * rr) return false;
    return true;
  };

  NavDisplay.prototype._radial = function (p, bearing, sp) {
    var ctx = this.ctx, C = this.options.colors;
    var far = { x: p.x + Math.sin(rad(bearing)) * 400, y: p.y + Math.cos(rad(bearing)) * 400 };
    var s2 = this.worldToScreen(far.x, far.y);
    var dx = s2.x - sp.x, dy = s2.y - sp.y;
    var dl = Math.sqrt(dx * dx + dy * dy);
    if (dl < 1e-6) return;
    var ux = dx / dl, uy = dy / dl;

    ctx.save();
    if (this.options.radialDashed) ctx.setLineDash([this._s(5), this._s(4)]);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = this._lw(1);
    ctx.beginPath();
    var back = this._s(14);
    ctx.moveTo(sp.x - ux * back, sp.y - uy * back);   // 反方向一小段
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    ctx.restore();
  };

  /* ---------------- 符号 ---------------- */

  NavDisplay.prototype._poly = function (x, y, n, r, rot) {
    var ctx = this.ctx;
    ctx.beginPath();
    for (var k = 0; k < n; k++) {
      var a = rot + k * 2 * Math.PI / n;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  /** 航路点：菱形（空心） */
  NavDisplay.prototype._symbolWaypoint = function (x, y, color) {
    var ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = this._lw(1.5);
    this._poly(x, y, 4, this._s(4.8), -Math.PI / 2);
    ctx.stroke();
  };

  /** 导航台：VOR 六边形 / NDB 三角形（空心），与航路点明显不同 */
  NavDisplay.prototype._symbolNavaid = function (x, y, type) {
    var ctx = this.ctx, C = this.options.colors;
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = this._lw(1.4);
    if (type === 'NDB') {
      this._poly(x, y, 3, this._s(5.6), -Math.PI / 2);
    } else {
      this._poly(x, y, 6, this._s(5.2), -Math.PI / 2);
    }
    ctx.stroke();
  };

  /** 其余点状信息：小实心点 */
  NavDisplay.prototype._symbolPoi = function (x, y, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color || this.options.colors.white;
    ctx.beginPath();
    ctx.arc(x, y, this._s(2.2), 0, Math.PI * 2);
    ctx.fill();
  };

  NavDisplay.prototype._label = function (text, x, y, color) {
    var ctx = this.ctx, o = this.options;
    ctx.fillStyle = color || o.colors.white;
    ctx.font = this._font(o.fontSizeLabel);
    ctx.textAlign = 'left';
    ctx.fillText(text, x + this._s(7), y + this._s(1));
  };

  /* ---------------- 航向弧 ---------------- */

  NavDisplay.prototype._drawHeadingArc = function () {
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L;
    var track = this._getTrack();
    var span = o.arcSpanDeg;

    // 弧线
    ctx.strokeStyle = C.arc;
    ctx.lineWidth = this._lw(1);
    ctx.beginPath();
    ctx.arc(L.cx, L.acY, L.r, rad(-90 - span), rad(-90 + span));
    ctx.stroke();

    // 刻度：每 10° 一条，每 30° 一条长刻度 + 数字
    var h0 = Math.ceil((track - span) / 10) * 10;
    var h1 = Math.floor((track + span) / 10) * 10;
    ctx.font = this._font(o.fontSizeArc);
    for (var h = h0; h <= h1; h += 10) {
      var a = h - track;
      if (Math.abs(a) > span + 0.001) continue;
      var major = (Math.round(norm360(h)) % 30 === 0);
      var len = major ? this._s(9) : this._s(5);
      var p1 = this._polar(a, L.r), p2 = this._polar(a, L.r - len);
      ctx.strokeStyle = C.arc;
      ctx.lineWidth = this._lw(1);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      if (major) {
        var pt = this._polar(a, L.r - this._s(19));
        ctx.fillStyle = C.white;
        ctx.textAlign = 'center';
        ctx.fillText(this._headingLabel(h), pt.x, pt.y);
      }
    }

    // 弧顶：当前航迹指示小三角
    if (o.showHeadingIndex) {
      var y = L.acY - L.r;
      ctx.fillStyle = C.white;
      ctx.beginPath();
      ctx.moveTo(L.cx, y + this._s(7));
      ctx.lineTo(L.cx - this._s(5), y - this._s(2));
      ctx.lineTo(L.cx + this._s(5), y - this._s(2));
      ctx.closePath();
      ctx.fill();
    }
  };

  NavDisplay.prototype._polar = function (bearingDeg, radius) {
    var L = this.L, a = rad(bearingDeg);
    return { x: L.cx + Math.sin(a) * radius, y: L.acY - Math.cos(a) * radius };
  };

  NavDisplay.prototype._headingLabel = function (h) {
    var v = Math.round(norm360(h)) % 360;
    if (this.options.headingLabelStyle === 'abbr') return String(v / 10);
    return fmt3(v);
  };

  /* ---------------- 顶部航向框 / TRK / HDG 故障 ---------------- */

  NavDisplay.prototype._drawHeadingBox = function () {
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L, inp = this.input || {};
    var fault = !!inp.headingFault;
    var value = this._getTrack();

    var boxW = this._s(46), boxH = this._s(22), top = this._s(8);
    var txt = fault ? 'HDG' : fmt3(value);

    // 带框的当前航向居中于最上方；TRK 字样紧贴在其左侧
    var bx = L.cx - boxW / 2;
    var cy = top + boxH / 2;

    ctx.font = this._font(12);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.white;
    ctx.fillText('TRK', bx - this._s(6), cy);

    // 带框的当前航向（故障时为黄色带框 HDG）
    ctx.strokeStyle = fault ? C.amber : C.white;
    ctx.lineWidth = this._lw(1);
    ctx.strokeRect(bx + 0.5, top + 0.5, boxW - 1, boxH - 1);
    ctx.fillStyle = fault ? C.amber : C.white;
    ctx.textAlign = 'center';
    ctx.font = this._font(o.fontSizeBox);
    ctx.fillText(txt, bx + boxW / 2, cy + this._s(1));
  };

  /* ---------------- 左上角风 ---------------- */

  NavDisplay.prototype._drawWind = function () {
    var inp = this.input || {};
    var w = inp.wind;
    if (!w || w.show === false) return;
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L;

    var ox = L.navX + this._s(30), oy = this._s(24);
    var a = (w.dir != null ? w.dir : 0) - this._getTrack();
    if (!o.windArrowToSource) a += 180;
    var ux = Math.sin(rad(a)), uy = -Math.cos(rad(a));
    var len = this._s(17);
    var tx = ox + ux * len, ty = oy + uy * len;

    ctx.strokeStyle = C.white;
    ctx.lineWidth = this._lw(1.6);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // 箭头
    var hl = this._s(6), hw = this._s(3.6);
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * hl - uy * hw, ty - uy * hl + ux * hw);
    ctx.lineTo(tx - ux * hl + uy * hw, ty - uy * hl - ux * hw);
    ctx.closePath();
    ctx.fill();

    // 风速
    ctx.fillStyle = C.white;
    ctx.textAlign = 'left';
    ctx.font = this._font(12);
    ctx.fillText(String(Math.round(w.speed != null ? w.speed : 0)),
      L.navX + this._s(8), oy + this._s(24));
  };

  /* ---------------- 对称轴竖线 + 比例尺 ---------------- */

  NavDisplay.prototype._drawScaleBar = function () {
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L;
    var x = L.cx;
    var y0 = L.acY;                       // 底部 = 飞机位置（0 距离）
    var yTop = y0 - L.lineLen;            // 顶部 = 比例尺满量程
    var mid = y0 - L.lineLen / 2;         // 中间 = 比例尺一半

    var label = fmtNum(L.rangeNm / 2);
    ctx.font = this._font(o.fontSizeSmall);
    var tw = ctx.measureText(label).width;
    var gapH = this._s(11);               // 数字处断开的高度

    ctx.strokeStyle = C.scale;
    ctx.lineWidth = this._lw(1);
    // 竖线：在数字处断开，不穿过数字
    this._vline(x, y0, mid + gapH / 2);
    this._vline(x, mid - gapH / 2, yTop);

    // 3 个刻度：两端横线，中间在数字左右各一小段
    var t5 = this._s(5);
    this._hline(x - t5, x + t5, y0);
    this._hline(x - t5, x + t5, yTop);
    var hw = tw / 2 + this._s(2), t4 = this._s(4);
    this._hline(x - hw - t4, x - hw, mid);
    this._hline(x + hw, x + hw + t4, mid);

    // 中间的数字 = 比例尺的一半
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, mid);
  };

  NavDisplay.prototype._vline = function (x, y1, y2) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y2);
    ctx.stroke();
  };
  NavDisplay.prototype._hline = function (x1, x2, y) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x1, y + 0.5);
    ctx.lineTo(x2, y + 0.5);
    ctx.stroke();
  };

  /* ---------------- 飞机符号 ---------------- */

  /** 飞机符号尺寸：随导航区高度等比缩放（保持顶角），且不超出导航区底边 */
  NavDisplay.prototype._aircraftSize = function () {
    var o = this.options, L = this.L;
    var navH = (L.navH != null ? L.navH : this.height);
    var k = Math.min(1, navH / this.height);          // 导航区变矮时等比缩小
    var base = o.aircraftHeight * this.options.uiScale;
    var hh = Math.min(base * k, Math.max(this._s(8), navH - L.acY - this._s(3)));
    var hw = o.aircraftHalfWidth * this.options.uiScale * (hh / base);  // 顶角不变
    return { hw: hw, hh: hh };
  };

  NavDisplay.prototype._drawAircraft = function () {
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L;
    // 等腰三角形，顶角较大（≈106°），顶点即飞机位置
    var sz = this._aircraftSize(), hw = sz.hw, hh = sz.hh;
    ctx.fillStyle = C.aircraft;
    ctx.beginPath();
    ctx.moveTo(L.cx, L.acY);
    ctx.lineTo(L.cx - hw, L.acY + hh);
    ctx.lineTo(L.cx + hw, L.acY + hh);
    ctx.closePath();
    ctx.fill();
  };

  /* ---------------- 雷达标识 ---------------- */

  NavDisplay.prototype._drawRadarLabel = function () {
    var inp = this.input || {};
    var r = inp.radar;
    if (!r || !r.mode || r.mode === 'off') return;
    var ctx = this.ctx, o = this.options, C = o.colors, L = this.L;
    // 贴着导航区（而非整个画布）的左下角；最底一行与飞机符号底边对齐
    var x = L.navX + this._s(6), lh = this._s(13);
    var navBottom = (L.navH != null ? L.navH : this.height);
    // +2 补偿 Courier New 的 middle 基线与实际字形中心的偏差，使文字视觉中心正对飞机底边
    var base = Math.min(navBottom - this._s(6),
      L.acY + this._aircraftSize().hh + this._s(o.radarLabelYOffset));

    var items = [];
    if (r.mode === 'terr') {
      items.push({ text: 'TERR', color: C.cyan });
      var lines = (r.terrain && r.terrain.lines) || [];
      for (var i = 0; i < 2; i++) {
        var it = lines[i];
        if (it) items.push({ text: String(it.text), color: colorOf(C, it.color) });
      }
    } else {
      items.push({ text: 'WXR', color: C.cyan });
    }

    ctx.textAlign = 'left';
    ctx.font = this._font(12);
    for (var k = 0; k < items.length; k++) {
      var yy = base - (items.length - 1 - k) * lh;
      // 弧变大后左下角可能落到地图内，加黑色衬底保证字符可读
      if (o.radarLabelBacking) {
        var tw = ctx.measureText(items[k].text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(x - this._s(2), yy - this._s(7), tw + this._s(4), this._s(14));
      }
      ctx.fillStyle = items[k].color;
      ctx.fillText(items[k].text, x, yy);
    }
  };
;

  /* ---------------- 故障旗（黄色带框） ---------------- */

  NavDisplay.prototype._drawFlag = function (x, y, text, color) {
    var ctx = this.ctx, o = this.options;
    ctx.font = this._font(o.fontSizeFlag);
    var tw = ctx.measureText(text).width;
    var bw = tw + this._s(14), bh = this._s(18);
    ctx.strokeStyle = color;
    ctx.lineWidth = this._lw(1);
    ctx.strokeRect(x - bw / 2 + 0.5, y - bh / 2 + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + this._s(1));
  };

  /* ------------------------------------------------------------------------ */
  return {
    /* 库版本：demo_nd.js 会用它判断浏览器加载的是否为最新脚本
       （file:// 下 ?v=xxx 的缓存失效不可靠，旧脚本可能仍被复用） */
    VERSION: '2.0.0',
    NavDisplay: NavDisplay,
    RADAR_LEVEL: RADAR_LEVEL,
    RADAR_RGBA: RADAR_RGBA,
    buildRoutePath: buildRoutePath,
    util: { rad: rad, norm360: norm360, fmt3: fmt3, fmtNum: fmtNum }
  };
});
