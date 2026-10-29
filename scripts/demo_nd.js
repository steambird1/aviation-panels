/* =============================================================================
 * demo_nd.js —— 导航显示演示页面逻辑
 * 依赖：navdisplay.js（全局 ND）、navprofile.js（全局 NavProfile，纯计算）、
 *       vnav.js（全局 VNavPanel，垂直导航面板绘制）
 * -----------------------------------------------------------------------------
 * 演示内容包括：
 *   - 航路（含转弯半径圆角）、航路点（下一个点紫色）、导航台 + 径向线、其余点状信息
 *   - 气象雷达 WXR / 地形雷达 TERR（逐像素 Uint8Array）
 *   - HDG / MAP 故障旗、风向风速、可调比例尺、可开关的“其它导航信息区域”
 *   - 其它导航信息区域 -> 垂直导航（VNAV）剖面：高度带、趋势线、地形、目标轨迹、MDA
 * ========================================================================== */
(function () {
  'use strict';

  /* 画布尺寸 / 预留区高度 / UI 缩放由页面通过 window.ND_DEMO_CFG 指定：
       { W: 884, H: 524, extraHeight: 135, uiScale: 1.8 }
     未指定时回退到最初的 253 x 253（VNAV 110px，uiScale 1）。 */
  var CFG = (typeof window !== 'undefined' && window.ND_DEMO_CFG) || {};
  var W = CFG.W || 253, H = CFG.H || 253;
  var EXTRA_H = CFG.extraHeight || 110;
  var UI_SCALE = CFG.uiScale || 1;

  var canvas = document.getElementById('nd');
  var nd = new ND.NavDisplay(canvas, { uiScale: UI_SCALE });

  /* ---------------------------------------------------------------------------
   * 0. 脚本新鲜度自检
   *    file:// 下 URL 上的 ?v=xxx 未必能让浏览器重新加载脚本，旧版 navdisplay.js
   *    会被继续复用（缺 updateLayout / extraRenderer），届时会抛 TypeError。
   *    这里提前检测并给出明确提示。
   * ------------------------------------------------------------------------ */
  var REQUIRED_ND_VERSION = '2.0.0';
  (function checkFresh() {
    var bad = [];
    if (!ND.VERSION) bad.push('navdisplay.js');
    else if (ND.VERSION !== REQUIRED_ND_VERSION) bad.push('navdisplay.js(' + ND.VERSION + ')');
    if (typeof NavProfile === 'undefined') bad.push('navprofile.js');
    if (typeof VNavPanel === 'undefined') bad.push('vnav.js');
    if (!bad.length) return;
    var msg = '脚本未更新（' + bad.join('、') + '）：请按 Ctrl/Cmd+Shift+R 强制刷新，' +
      '或在开发者工具 Network 面板勾选 Disable cache 后重新加载。';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;' +
      'background:#7a1f1f;color:#fff;font:13px/1.5 monospace;';
    box.textContent = msg;
    (document.body || document.documentElement).appendChild(box);
    if (typeof console !== 'undefined' && console.error) console.error(msg);
  })();

  /** 取最新布局：兼容旧版 navdisplay.js（无 updateLayout 时强制重算） */
  function refreshLayout(input) {
    if (typeof nd.updateLayout === 'function') { nd.updateLayout(); return nd.getLayout(); }
    nd.setInput(input);
    nd.L = null;                 // 旧版 getLayout() 会返回缓存的 L，先清空再重算
    return nd.getLayout();
  }

  /* ---------------------------------------------------------------------------
   * 1. 航路（世界坐标，x = 东 NM，y = 北 NM）
   *    飞机起始位置原点，航向 040，沿 ALPHA -> BRAVO 飞行
   * ------------------------------------------------------------------------ */
  function wp(name, x, y) { return { name: name, x: x, y: y }; }

  var ROUTE_POINTS = [
    wp('ALPHA', -5.14, -6.13),
    wp('BRAVO', 5.14, 6.13),
    wp('CHARLIE', 16.73, 9.24),
    wp('DELTA', 20.15, 18.64),
    wp('ECHO', 30.54, 24.64),
    wp('FOXTROT', 35.54, 33.30)
  ];

  /* 导航台（含径向线方位）与其余点状信息 */
  var NAVAIDS = [
    { kind: 'navaid', navaidType: 'VOR', name: 'XYZ', x: -2, y: 13, radial: 90 },
    { kind: 'navaid', navaidType: 'NDB', name: 'ABC', x: 11, y: 15, radial: 210 },
    { kind: 'navaid', navaidType: 'VOR', name: 'QQQ', x: 18, y: 3, radial: 320 }
  ];
  var POIS = [
    { kind: 'poi', name: 'FIX1', x: 2, y: 17 },
    { kind: 'poi', name: 'FIX2', x: 17, y: 9 },
    { kind: 'poi', name: 'ARPT', x: 9, y: 4 }
  ];

  /* ---------------------------------------------------------------------------
   * 2. 雷达回波源（世界坐标中的椭圆团，用于生成逐像素数据）
   * ------------------------------------------------------------------------ */
  var WXR_CELLS = [
    { x: 12, y: 15, r: 7.5, peak: 1.00, seed: 1.1 },
    { x: 20, y: 6, r: 5.5, peak: 0.85, seed: 2.4 },
    { x: 26, y: 22, r: 6.5, peak: 0.95, seed: 3.7 },
    { x: 4, y: 24, r: 5.0, peak: 0.70, seed: 0.6 }
  ];
  /* 地形：世界坐标中的山包，elev 为峰顶高程（英尺）。
     同一份数据既用于地形雷达图象（等级），也用于 VNAV 剖面的高程采样。 */
  var TERR_CELLS = [
    { x: 10, y: 12, r: 10.0, elev: 4200, seed: 1.7 },
    { x: 24, y: 20, r: 9.0, elev: 3600, seed: 2.9 },
    { x: 30, y: 6, r: 7.0, elev: 2800, seed: 4.2 },
    { x: 2, y: 20, r: 8.0, elev: 3100, seed: 5.5 }
  ];
  /* 包络：“另一个地形数据”。接口与地形完全一致，但含义是该点之上的安全下限，
     因此恒 >= 真实地形高度：env = max(地形 + 余度, 下限)。 */
  var ENV_CLEARANCE_FT = 500;     // 包络高出地形的余度
  var ENV_FLOOR_FT = 1600;        // 包络的绝对下限（无地形数据处取该值；取值不同于默认 MDA 便于区分）

  function levelOf(v) {
    if (v < 0.10) return 0;
    if (v < 0.32) return 1;   // 深绿
    if (v < 0.52) return 2;   // 浅绿
    if (v < 0.72) return 3;   // 黄
    if (v < 0.90) return 4;   // 红
    return 5;                 // 深红
  }

  /** 地形高程场（英尺）：cell 外为海平面 0 ft */
  function fieldElevFt(cells, x, y) {
    var best = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var dx = (x - c.x) / c.r, dy = (y - c.y) / c.r;
      var d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      var v = (1 - d2) * c.elev;
      v *= 0.72 + 0.28 * Math.sin(x * 1.9 + c.seed) * Math.cos(y * 1.6 - c.seed * 0.7);
      if (v > best) best = v;
    }
    return best;
  }

  /** 气象回波强度（0..1），保持原有观感 */
  function fieldPeak(cells, x, y) {
    var best = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var dx = (x - c.x) / c.r, dy = (y - c.y) / c.r;
      var d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      var v = (1 - d2) * c.peak;
      v *= 0.72 + 0.28 * Math.sin(x * 1.9 + c.seed) * Math.cos(y * 1.6 - c.seed * 0.7);
      if (v > best) best = v;
    }
    return best;
  }

  function fieldLevel(cells, x, y) {
    return levelOf(fieldPeak(cells, x, y));
  }

  function colorByLevel(lv) {
    if (lv >= 4) return 'red';
    if (lv >= 2) return 'yellow';
    return 'green';
  }

  /* ---------------------------------------------------------------------------
   * 3. 状态
   * ------------------------------------------------------------------------ */
  var state = {
    heading: 40,
    drift: 0,
    headingFault: false,
    mapFault: false,
    rangeNm: 20,
    windDir: 300,
    windSpeed: 18,
    radarMode: 'wxr',
    arcSpan: 45,
    navaidRadials: true,
    extraInfo: false,
    showNames: true,
    animate: false,
    turnRadius: 2.0,
    s: 8,                    // 沿航路已飞距离（NM），8 NM 时飞机在原点

    /* --- 垂直导航（VNAV）--- */
    majorDivFt: 2000,        // 高度带大刻度分度值（100/500/1000/2000/5000）
    altFt: 5000,             // 当前高度 ft
    vsMs: -0.8,              // 垂直速度 m/s（正 = 爬升）
    accMs2: -0.02,           // 垂直加速度 m/s²
    gsMs: 230,               // 地速 m/s（把时间换算成横轴距离）
    targetOn: true,          // false -> target 传 null
    targetAltFt: 3000,
    targetRateFpm: -1000,
    targetStages: 2,         // 目标轨迹的阶段数（1..3）
    mdaOn: true,             // false -> mdaFt 传 null
    mdaFt: 1200,
    envelopeOn: true,        // false -> envelope 传 null
    envClearanceFt: 500,     // 包络高出地形的余度（ft）
    vnavWaypoints: true      // “把航路点显示在上面”开关
  };

  var radarBuf = new Uint8Array(W * H);      // 逐像素雷达数据：0..5
  var terrainElev = new Float32Array(W * H); // 逐像素地形高程（英尺），与地形雷达同一栅格
  var terrainEnv = new Float32Array(W * H);  // 逐像素包络高程（英尺），恒 >= terrainElev
  var radarMaxLevel = 0;
  // 雷达输入对象保持不变，各字段在 updateRadarBuffer() 内随布局更新
  var radar = {
    mode: 'wxr', data: radarBuf,
    terrain: { lines: [], elevation: terrainElev }
  };
  // VNAV 输入对象同样保持不变（复用雷达栅格；envelope 与 terrain 接口一致）
  // envelope 对象单独持有：开关只切换“是否挂载”，不能把引用本身置空，
  // 否则关闭一次后再打开就再也回不来了。
  /* VNAV 的地形/包络：
     雷达图象用的是屏幕栅格（terrainElev / terrainEnv），量程受画布限制；
     VNAV 剖面的横轴往往比“正前方可见距离”更长，因此这里改用同一地形场的
     世界坐标采样函数（sample），保证剖面全程都有数据。
     两者同源——都来自 TERR_CELLS + fieldElevFt，只是取样方式不同。 */
  var vnavTerrain = {
    sample: function (x, y) { return fieldElevFt(TERR_CELLS, x, y); }
  };
  var vnavEnvelope = {
    sample: function (x, y) {
      return Math.max(fieldElevFt(TERR_CELLS, x, y) + state.envClearanceFt, ENV_FLOOR_FT);
    }
  };
  var vnav = {
    show: true,
    terrain: vnavTerrain,
    envelope: vnavEnvelope,
    waypoints: []
  };

  /* VNavPanel：绘制在“其它导航信息区域” */
  var vnavPanel = new VNavPanel({
    fontFamily: '"Courier New", Courier, monospace',
    uiScale: UI_SCALE, tickScale: CFG.vnavTickScale || 1
  });
  nd.setOption('extraRenderer', vnavPanel);   // 预留区 -> 垂直导航剖面

  /* ---------------------------------------------------------------------------
   * 4. 沿航路行走（用于飞行演示）
   * ------------------------------------------------------------------------ */
  function currentRoute() {
    var pts = ROUTE_POINTS.map(function (p, i) {
      var q = { x: p.x, y: p.y, name: p.name };
      // 中间航路点带转弯半径（首尾点不需要）
      if (i > 0 && i < ROUTE_POINTS.length - 1) q.turnRadius = state.turnRadius;
      return q;
    });
    return pts;
  }

  function flatten(segs) {
    var pts = [], cum = [0], total = 0, i, k;
    for (i = 0; i < segs.length; i++) {
      var sp = segs[i].pts;
      for (k = (i === 0 ? 0 : 1); k < sp.length; k++) {
        pts.push({ x: sp[k].x, y: sp[k].y, leg: segs[i].leg });
      }
    }
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total };
  }

  function posAt(walk, s) {
    var n = walk.cum.length;
    var i = 1;
    while (i < n - 1 && walk.cum[i] < s) i++;
    var a = walk.pts[i - 1], b = walk.pts[i];
    var seg = walk.cum[i] - walk.cum[i - 1];
    var t = seg > 1e-9 ? Math.max(0, Math.min(1, (s - walk.cum[i - 1]) / seg)) : 0;
    var dx = b.x - a.x, dy = b.y - a.y;
    return {
      x: a.x + dx * t,
      y: a.y + dy * t,
      leg: b.leg,
      bearing: ND.util.norm360(Math.atan2(dx, dy) * 180 / Math.PI)
    };
  }

  /* ---------------------------------------------------------------------------
   * 5. 生成雷达逐像素数据（屏幕像素 -> 世界坐标 -> 强度等级）
   * ------------------------------------------------------------------------ */
  /* ---------------------------------------------------------------------------
   * 4b. 地形高程栅格（屏幕空间，英尺）—— 与地形雷达图象同源
   *     VNAV 剖面直接复用这份栅格沿航迹采样。
   * ------------------------------------------------------------------------ */
  /**
   * 某一行需要计算的像素范围 [x0, x1]；null = 整行跳过。
   * 裁剪模式为 'rect'（宽画布）时铺满整个导航区，否则只算弧内圆——
   * 与 navdisplay.js 的地图裁剪保持一致，避免出现“有图象的区域没数据”。
   */
  function rowBounds(L, y) {
    if (L.clip === 'rect') return [0, W - 1];
    var dy = y - L.acY;
    if (dy < -L.r || dy > L.r) return null;
    var half = Math.sqrt(L.r * L.r - dy * dy);
    return [Math.max(0, Math.ceil(L.cx - half)), Math.min(W - 1, Math.floor(L.cx + half))];
  }

  function updateTerrainElevation() {
    var walk = flatten(ND.buildRoutePath(currentRoute()));
    var p = posAt(walk, state.s);
    var L = nd.getLayout();
    var track = state.heading + state.drift;
    var t = ND.util.rad(track);
    var ct = Math.cos(t), st = Math.sin(t), scale = L.pxPerNm;
    var cx = L.cx, acY = L.acY;

    for (var i = 0, n = W * H; i < n; i++) { terrainElev[i] = NaN; terrainEnv[i] = ENV_FLOOR_FT; }

    for (var y = 0; y < H; y++) {
      var b = rowBounds(L, y);
      if (!b) continue;
      var x0 = b[0], x1 = b[1];
      var uy = (acY - y) / scale;
      for (var x = x0; x <= x1; x++) {
        var ux = (x - cx) / scale;
        var ex = ux * ct + uy * st;
        var ny = -ux * st + uy * ct;
        var e = fieldElevFt(TERR_CELLS, p.x + ex, p.y + ny);
        terrainElev[y * W + x] = e;
        // 包络：地形 + 余度，且不低于绝对下限 -> 结构上保证 >= 地形
        terrainEnv[y * W + x] = Math.max(e + state.envClearanceFt, ENV_FLOOR_FT);
      }
    }
  }

  function updateRadarBuffer() {
    radar.mode = state.radarMode;
    radarMaxLevel = 0;
    if (state.radarMode === 'off') { radar.data = null; return; }
    radar.data = radarBuf;
    var cells = (state.radarMode === 'terr') ? TERR_CELLS : WXR_CELLS;

    var walk = flatten(ND.buildRoutePath(currentRoute()));
    var p = posAt(walk, state.s);
    var L = nd.getLayout();          // 此时布局已由 render() 中的 updateLayout() 刷新
    var track = state.heading + state.drift;
    var t = ND.util.rad(track);
    var ct = Math.cos(t), st = Math.sin(t), scale = L.pxPerNm;
    var cx = L.cx, acY = L.acY;

    radarBuf.fill(0);
    radarMaxLevel = 0;

    for (var y = 0; y < H; y++) {
      var b = rowBounds(L, y);
      if (!b) continue;                                // 裁剪区外的像素不计算
      var x0 = b[0], x1 = b[1];
      var uy = (acY - y) / scale;                      // 屏幕上分量(NM)
      for (var x = x0; x <= x1; x++) {
        var ux = (x - cx) / scale;                     // 屏幕右分量(NM)
        var ex = ux * ct + uy * st;                    // 东
        var ny = -ux * st + uy * ct;                   // 北
        var lv = fieldLevel(cells, p.x + ex, p.y + ny);
        radarBuf[y * W + x] = lv;
        if (lv > radarMaxLevel) radarMaxLevel = lv;
      }
    }

    // 地形两行数字随本次回波强度刷新（颜色可能为红/黄/绿）
    radar.terrain.lines = [
      { text: '4200', color: colorByLevel(radarMaxLevel) },
      { text: '1800', color: colorByLevel(Math.max(0, radarMaxLevel - 2)) }
    ];
  }

  /* ---------------------------------------------------------------------------
   * 6. 组装输入并绘制
   * ------------------------------------------------------------------------ */
  var lastPos = { x: 0, y: 0, leg: 0 };

  function buildInput() {
    var routePts = currentRoute();
    var walk = flatten(ND.buildRoutePath(routePts));
    var p = posAt(walk, state.s);
    lastPos = p;

    return {
      heading: state.heading,
      track: ND.util.norm360(state.heading + state.drift),
      headingFault: state.headingFault,
      mapFault: state.mapFault,
      rangeNm: state.rangeNm,
      aircraft: { x: p.x, y: p.y },
      wind: { dir: state.windDir, speed: state.windSpeed },
      route: { show: true, activeIndex: p.leg + 1, points: routePts },
      points: NAVAIDS.concat(POIS),
      navaidRadials: state.navaidRadials,
      showNames: state.showNames,
      radar: radar,
      vnav: buildVnav(routePts, p),
      extraInfo: { show: state.extraInfo, height: EXTRA_H, side: 'bottom' }
    };
  }

  /* ---------------------------------------------------------------------------
   * 6b. 组装 VNAV 输入
   * ------------------------------------------------------------------------ */
  function buildVnav(routePts, pos) {
    var L = nd.getLayout();
    var tapeW = vnavPanel.getOptions().tapeWidth;
    var maxDistNm = (W - tapeW) / L.pxPerNm;

    // 沿航路的累计距离 -> 航路点（计算部分在 NavProfile）
    var dists = NavProfile.alongTrackDistances(routePts, { x: pos.x, y: pos.y }, pos.leg + 1);
    var wps = NavProfile.forwardWaypoints(routePts, dists, maxDistNm);

    // 目标轨迹：可能分阶段
    var target = null;
    if (state.targetOn) {
      var stages = [];
      for (var i = 0; i < state.targetStages; i++) {
        stages.push({
          altFt: state.targetAltFt - i * 2000,
          rateFpm: state.targetRateFpm
        });
      }
      target = { stages: stages };
    }

    vnav.show = state.extraInfo;
    vnav.majorDivFt = state.majorDivFt;
    vnav.altFt = state.altFt;
    vnav.vsMs = state.vsMs;
    vnav.accMs2 = state.accMs2;
    vnav.groundSpeedMs = state.gsMs;
    vnav.target = target;                                   // null -> 不显示
    vnav.mdaFt = state.mdaOn ? state.mdaFt : null;          // null -> 不显示
    vnav.envelope = state.envelopeOn ? vnavEnvelope : null;   // null -> 不显示
    vnav.waypoints = wps;
    vnav.showWaypoints = state.vnavWaypoints;
    return vnav;
  }

  function render() {
    var input = buildInput();
    // 关键顺序：先挂上输入并按当前输入算好布局（pxPerNm 等），
    // 再用新布局逐像素生成雷达栅格，最后绘制。
    // 反过来（先生成栅格再 draw）会用到上一帧的比例尺，导致雷达缩放错误。
    nd.setInput(input);
    refreshLayout(input);         // 按当前输入重算布局（pxPerNm 等）
    updateTerrainElevation();     // 地形高程（VNAV 复用）
    updateRadarBuffer();          // 雷达等级栅格
    nd.draw(input);

    out.hdg.textContent = ND.util.fmt3(input.track);
    out.wpt.textContent = (input.route.points[input.route.activeIndex] || {}).name || '-';
    out.pos.textContent = p2(lastPos.x) + ', ' + p2(lastPos.y);
    out.lvl.textContent = state.radarMode === 'off' ? '-' : String(radarMaxLevel);
  }
  function p2(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* ---------------------------------------------------------------------------
   * 7. 界面
   * ------------------------------------------------------------------------ */
  var $ = function (id) { return document.getElementById(id); };
  var out = { hdg: $('outHdg'), wpt: $('outWpt'), pos: $('outPos'), lvl: $('outLvl') };

  function bindRange(id, key, fmt) {
    var el = $(id), lab = $(id + 'Val');
    function sync() {
      state[key] = parseFloat(el.value);
      if (lab) lab.textContent = fmt ? fmt(state[key]) : el.value;
      render();
    }
    el.addEventListener('input', sync);
    return { el: el, lab: lab, sync: sync, fmt: fmt };
  }
  function bindCheck(id, key, after) {
    var el = $(id);
    el.addEventListener('change', function () {
      state[key] = el.checked;
      if (after) after();
      render();
    });
    return el;
  }

  var cHdg = bindRange('rngHdg', 'heading', function (v) { return ND.util.fmt3(v); });
  bindRange('rngDrift', 'drift', function (v) { return (v > 0 ? '+' : '') + v + '°'; });
  bindRange('rngWindDir', 'windDir', function (v) { return ND.util.fmt3(v) + '°'; });
  bindRange('rngWindSpd', 'windSpeed');
  bindRange('rngTurn', 'turnRadius', function (v) { return v.toFixed(1) + ' NM'; });

  bindCheck('chkHdgFault', 'headingFault');
  bindCheck('chkMapFault', 'mapFault');
  bindCheck('chkRadials', 'navaidRadials');
  bindCheck('chkNames', 'showNames');
  bindCheck('chkExtra', 'extraInfo');

  /* --- 垂直导航（VNAV）--- */
  bindRange('rngAlt', 'altFt');
  bindRange('rngVs', 'vsMs', function (v) {
    return v.toFixed(1) + ' m/s (' + Math.round(NavProfile.msToFpm(v)) + ' fpm)';
  });
  bindRange('rngAcc', 'accMs2', function (v) { return v.toFixed(2) + ' m/s²'; });
  bindRange('rngGs', 'gsMs');
  bindRange('rngMda', 'mdaFt');
  bindRange('rngTargetAlt', 'targetAltFt');
  bindRange('rngTargetRate', 'targetRateFpm', function (v) {
    return (v > 0 ? '+' : '') + v + ' fpm';
  });
  bindCheck('chkTarget', 'targetOn');
  bindCheck('chkMda', 'mdaOn');
  bindCheck('chkEnvelope', 'envelopeOn');
  bindRange('rngEnvClear', 'envClearanceFt', function (v) { return v + ' ft'; });
  bindCheck('chkVnavWpt', 'vnavWaypoints');

  $('selMajorDiv').addEventListener('change', function () {
    state.majorDivFt = parseFloat(this.value);
    render();
  });
  $('selTargetStages').addEventListener('change', function () {
    state.targetStages = parseInt(this.value, 10);
    render();
  });

  var chkAnimate = bindCheck('chkAnimate', 'animate', function () {
    cHdg.el.disabled = state.animate;
  });

  $('selRange').addEventListener('change', function () {
    state.rangeNm = parseFloat(this.value);
    $('selRangeVal').textContent = state.rangeNm + ' NM';
    render();
  });

  $('selRadar').addEventListener('change', function () {
    state.radarMode = this.value;
    render();
  });

  // 航向弧跨度：跨度越小 -> 弧越平缓、弧上方两个空角越小、地图半径越大
  $('selSpan').addEventListener('change', function () {
    state.arcSpan = parseFloat(this.value);
    nd.setOption('arcSpanDeg', state.arcSpan);
    render();
    $('selSpanVal').textContent = 'r' + nd.getLayout().r.toFixed(0);
  });

  $('chkZoom').addEventListener('change', function () {
    var z = this.checked ? 2 : 1;
    canvas.style.width = (W * z) + 'px';
    canvas.style.height = (H * z) + 'px';
    canvas.style.imageRendering = 'pixelated';
  });

  $('btnReset').addEventListener('click', function () {
    state.s = 8;
    state.altFt = 5000;
    $('rngAlt').value = '5000';
    state.heading = 40;
    cHdg.el.value = 40;
    cHdg.lab.textContent = '040';
    render();
  });

  /* 初始化控件显示 */
  $('selRange').value = String(state.rangeNm);
  $('selRangeVal').textContent = state.rangeNm + ' NM';
  $('selRadar').value = state.radarMode;
  $('selSpan').value = String(state.arcSpan);
  $('selSpanVal').textContent = 'r' + nd.getLayout().r.toFixed(0);
  $('rngHdg').value = state.heading;
  $('rngTurn').value = state.turnRadius;
  $('selMajorDiv').value = String(state.majorDivFt);
  $('selTargetStages').value = String(state.targetStages);
  ['rngAlt', 'rngVs', 'rngAcc', 'rngGs', 'rngMda', 'rngTargetAlt', 'rngTargetRate', 'rngEnvClear'].forEach(function (id) {
    $(id).value = String(state[{
      rngAlt: 'altFt', rngVs: 'vsMs', rngAcc: 'accMs2', rngGs: 'gsMs',
      rngMda: 'mdaFt', rngTargetAlt: 'targetAltFt', rngTargetRate: 'targetRateFpm',
      rngEnvClear: 'envClearanceFt'
    }[id]]);
  });
  ['rngHdg', 'rngDrift', 'rngWindDir', 'rngWindSpd', 'rngTurn',
   'rngAlt', 'rngVs', 'rngAcc', 'rngGs', 'rngMda', 'rngTargetAlt', 'rngTargetRate',
   'rngEnvClear'].forEach(function (id) {
    var ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
    $(id).dispatchEvent(ev);
  });

  /* 让 HTML 里的 checked 成为权威：启动时同步所有复选框的状态。
     （此前只同步了滑块/下拉，复选框的 checked 属性在启动阶段被忽略） */
  ['chkHdgFault', 'chkMapFault', 'chkRadials', 'chkNames', 'chkExtra',
   'chkTarget', 'chkMda', 'chkEnvelope', 'chkVnavWpt'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    var ev = document.createEvent('Event');
    ev.initEvent('change', true, true);
    el.dispatchEvent(ev);
  });

  /* ---------------------------------------------------------------------------
   * 8. 飞行演示
   * ------------------------------------------------------------------------ */
  var lastT = 0;
  function loop(ts) {
    if (state.animate) {
      if (!lastT) lastT = ts;
      var dt = Math.min(0.1, (ts - lastT) / 1000);
      lastT = ts;
      var walk = flatten(ND.buildRoutePath(currentRoute()));
      state.s += dt * 3;                       // 3 NM/s
      if (state.s > walk.total) state.s = 0;   // 到终点后回到起点
      var p = posAt(walk, state.s);
      state.heading = Math.round(p.bearing);
      cHdg.el.value = state.heading;
      cHdg.lab.textContent = ND.util.fmt3(state.heading);
      // 高度按垂直速度/加速度积分，高度条随之滚动
      state.altFt += NavProfile.mToFt(state.vsMs * dt + 0.5 * state.accMs2 * dt * dt);
      if (state.altFt < 0) state.altFt = 0;
      if (state.altFt > 45000) state.altFt = 45000;
      $('rngAlt').value = String(Math.round(state.altFt));
      render();
    } else {
      lastT = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  render();
})();
