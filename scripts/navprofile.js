/* =============================================================================
 * navprofile.js —— 垂直导航（VNAV）剖面相关的【纯计算】
 * -----------------------------------------------------------------------------
 * 本文件不接触 canvas，只做数值计算，可在浏览器与 Node 中直接使用：
 *   - 单位换算（m <-> ft，m/s <-> ft/min，NM <-> m）
 *   - 沿航路的累计距离（用于把航路点放到剖面上）
 *   - 高度带的刻度（大刻度 + 两相邻大刻度之间的小刻度）
 *   - 高度趋势线：h(d) = h0 + v·t + ½·a·t²（v、a 为 m/s、m/s²，t 由距离/地速换算）
 *   - 目标高度/升降率的分阶段轨迹
 *   - 沿航迹采样地形高程（复用地形雷达的屏幕空间高程栅格，或世界坐标采样函数）
 *   - 地形威胁等级（按接近率/余度给出绿、黄、红）
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NavProfile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var NM_TO_M = 1852;                    // 1 NM = 1852 m
  var M_TO_FT = 3.28083989501312;        // 1 m  = 3.28084 ft
  var FT_TO_M = 0.3048;                  // 1 ft = 0.3048 m

  /* ---------------- 小工具 ---------------- */
  function rad(d) { return d * Math.PI / 180; }
  function mToFt(m) { return m * M_TO_FT; }
  function ftToM(f) { return f * FT_TO_M; }
  function msToFpm(v) { return v * M_TO_FT * 60; }     // m/s   -> ft/min
  function fpmToMs(r) { return r / 60 * FT_TO_M; }     // ft/min-> m/s
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** 两点间的水平距离（NM） */
  function distNM(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ---------------------------------------------------------------------------
   * 沿航路的累计距离
   * ------------------------------------------------------------------------ */
  /**
   * 从飞机当前位置起算，各航路点沿航路的累计距离（NM）。
   * 下一个航路点（activeIndex）为正，已经飞过的为负。
   * 用直线航段累加（沿航迹距离的标准做法），不依赖航路圆角几何。
   *
   * @param {Array<{x,y}>} pts         航路点（世界坐标 NM）
   * @param {{x,y}}        from        飞机当前位置
   * @param {number}       activeIndex 下一个航路点下标
   * @returns {number[]} 与 pts 等长
   */
  function alongTrackDistances(pts, from, activeIndex) {
    var n = pts.length, out = new Array(n), i;
    if (!n) return out;
    var a = clamp(activeIndex == null ? 0 : activeIndex, 0, n - 1);

    // 向前（含下一个点）
    var acc = distNM(from, pts[a]);
    out[a] = acc;
    for (i = a + 1; i < n; i++) {
      acc += distNM(pts[i - 1], pts[i]);
      out[i] = acc;
    }
    // 向后（已飞过的点为负）
    var back = 0;
    for (i = a - 1; i >= 0; i--) {
      back += distNM(pts[i + 1], pts[i]);
      out[i] = -back;
    }
    return out;
  }

  /**
   * 取“前方”的航路点（距离 > 0），附带名称与可选高度。
   * @param {Array} pts  航路点（可含 name / altFt）
   * @param {number[]} dists  alongTrackDistances 的结果
   * @param {number} maxDistNm 只保留该距离内的
   */
  function forwardWaypoints(pts, dists, maxDistNm) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var d = dists[i];
      if (!isNum(d) || d <= 0) continue;
      if (isNum(maxDistNm) && d > maxDistNm) continue;
      out.push({
        name: pts[i].name || null,
        distNm: d,
        altFt: isNum(pts[i].altFt) ? pts[i].altFt : null,
        index: i
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 高度带刻度
   * ------------------------------------------------------------------------ */
  /**
   * 生成高度带刻度。y 轴向上为高度增加。
   * @param {number} centerFt  中心（飞机当前）高度
   * @param {number} centerY   中心对应的屏幕 y
   * @param {number} pxPerFt   每英尺的像素数
   * @param {number} y0,y1     可见范围的上下边界（屏幕 y）
   * @param {number} majorDivFt   大刻度分度值（100/500/1000/2000/5000 ...）
   * @param {number} minorPerMajor 两个大刻度之间被小刻度分成的份数
   * @returns {{major:Array<{ft,y}>, minor:Array<{ft,y}>}}
   */
  function altitudeTicks(centerFt, centerY, pxPerFt, y0, y1, majorDivFt, minorPerMajor) {
    var major = [], minor = [];
    if (!(pxPerFt > 0) || !(majorDivFt > 0)) return { major: major, minor: minor };
    var sub = Math.max(1, Math.round(minorPerMajor || 1));

    // y -> 高度
    function ftAt(y) { return centerFt + (centerY - y) / pxPerFt; }
    var ftTop = ftAt(y0), ftBot = ftAt(y1);
    var lo = Math.min(ftTop, ftBot), hi = Math.max(ftTop, ftBot);

    var first = Math.ceil(lo / majorDivFt) * majorDivFt;
    var stepMinor = majorDivFt / sub;
    for (var ft = first; ft <= hi + 1e-6; ft += majorDivFt) {
      var y = centerY - (ft - centerFt) * pxPerFt;
      major.push({ ft: ft, y: y });
      for (var k = 1; k < sub; k++) {
        var f2 = ft + k * stepMinor;
        if (f2 > hi) break;
        minor.push({ ft: f2, y: centerY - (f2 - centerFt) * pxPerFt });
      }
    }
    return { major: major, minor: minor };
  }

  /* ---------------------------------------------------------------------------
   * 高度趋势线：h = h0 + v·t + ½·a·t²
   * ------------------------------------------------------------------------ */
  /** 距离(NM) -> 飞行时间(s)，按地速换算 */
  function timeAtDistance(distNm, gsMs) {
    var gs = (isNum(gsMs) && gsMs > 1e-6) ? gsMs : 1e-6;
    return distNm * NM_TO_M / gs;
  }

  /**
   * 趋势高度（ft）。vs/acc 为垂直方向的 m/s、m/s²（正 = 爬升）。
   */
  function trendAltitudeFt(alt0Ft, vsMs, accMs2, gsMs, distNm) {
    var t = timeAtDistance(distNm, gsMs);
    var v = isNum(vsMs) ? vsMs : 0;
    var a = isNum(accMs2) ? accMs2 : 0;
    return alt0Ft + (v * t + 0.5 * a * t * t) * M_TO_FT;
  }

  /** 趋势线在该距离处的垂直速度（ft/min，正 = 爬升） */
  function trendRateFpm(vsMs, accMs2, gsMs, distNm) {
    var t = timeAtDistance(distNm, gsMs);
    return msToFpm((isNum(vsMs) ? vsMs : 0) + (isNum(accMs2) ? accMs2 : 0) * t);
  }

  /** 采样趋势线：[{distNm, altFt}] */
  function trendProfile(alt0Ft, vsMs, accMs2, gsMs, maxDistNm, steps) {
    var n = Math.max(2, steps || 60), out = [];
    for (var i = 0; i <= n; i++) {
      var d = maxDistNm * i / n;
      out.push({ distNm: d, altFt: trendAltitudeFt(alt0Ft, vsMs, accMs2, gsMs, d) });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 目标高度 / 目标升降率（可能分阶段）
   * ------------------------------------------------------------------------ */
  /**
   * 把 input.vnav.target 规范成阶段数组。
   * 支持：
   *   target = null                                     -> 不显示
   *   target = {altFt:6000, rateFpm:-1800}              -> 单阶段
   *   target = {stages:[{altFt,rateFpm}, ...]}          -> 多阶段
   * @returns {Array<{altFt:number, rateFpm:number}>}|null
   */
  function normalizeStages(target) {
    if (!target) return null;
    var list = target.stages;
    if (!list || !list.length) {
      if (!isNum(target.altFt)) return null;
      list = [{ altFt: target.altFt, rateFpm: isNum(target.rateFpm) ? target.rateFpm : 0 }];
    }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!isNum(s.altFt)) continue;
      out.push({ altFt: s.altFt, rateFpm: isNum(s.rateFpm) ? s.rateFpm : 0 });
    }
    return out.length ? out : null;
  }

  /**
   * 目标轨迹：从当前高度出发，依次按各阶段的升降率飞到该阶段目标高度，
   * 最后一阶段到达后保持平飞。
   * @returns {Array<{distNm, altFt}>}|null
   */
  function targetProfile(alt0Ft, stages, gsMs, maxDistNm, steps) {
    if (!stages || !stages.length) return null;

    // 先把阶段拆成「时间 -> 高度」的分段线性函数
    var segs = [], t = 0, alt = alt0Ft, i;
    for (i = 0; i < stages.length; i++) {
      var rateFps = stages[i].rateFpm / 60;          // ft/s（正 = 爬升）
      var tgt = stages[i].altFt;
      if (Math.abs(rateFps) < 1e-9) { alt = tgt; continue; }
      var dt = (tgt - alt) / rateFps;
      if (dt < 0) dt = 0;                            // 方向不符视为立即到达
      segs.push({ t0: t, alt0: alt, rate: rateFps, t1: t + dt });
      t += dt; alt = tgt;
    }
    segs.push({ t0: t, alt0: alt, rate: 0, t1: Infinity });

    var n = Math.max(2, steps || 60), out = [];
    for (var k = 0; k <= n; k++) {
      var d = maxDistNm * k / n;
      var tt = timeAtDistance(d, gsMs);
      var h = segs[0].alt0, j;
      for (j = 0; j < segs.length; j++) {
        if (tt < segs[j].t0) break;
        var te = (segs[j].t1 === Infinity) ? tt : Math.min(tt, segs[j].t1);
        h = segs[j].alt0 + segs[j].rate * (te - segs[j].t0);
      }
      out.push({ distNm: d, altFt: h });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 沿航迹采样地形高程
   * ------------------------------------------------------------------------ */
  /**
   * 沿当前航迹方向，从飞机位置向前采样地形高程（ft）。
   *
   * 两种数据源（二选一，优先 sample 函数）：
   *   1) terrain.sample(xNM, yNM) -> ft     世界坐标采样
   *   2) terrain.elevation: Float32Array(W*H)，索引 y*W+x，单位英尺，
   *      即地形雷达栅格的高程版本（屏幕空间，与雷达图象一一对应）。
   *      超出栅格范围或无数据的点返回 NaN。
   *
   * @param {object} terrain
   * @param {object} o {L:{cx,acY,pxPerNm}, aircraft:{x,y}, trackDeg, maxDistNm, steps, canvasW, canvasH}
   * @returns {Array<{distNm:number, elevFt:number}>}
   */
  function sampleTerrainTrack(terrain, o) {
    var out = [];
    if (!terrain) return out;
    var n = Math.max(2, o.steps || 120), maxD = o.maxDistNm || 0;
    var sampler = (typeof terrain.sample === 'function') ? terrain.sample : null;
    var elev = terrain.elevation || null;
    var cw = o.canvasW, ch = o.canvasH;
    var b = rad(o.trackDeg || 0), sb = Math.sin(b), cb = Math.cos(b);

    for (var i = 0; i <= n; i++) {
      var d = maxD * i / n;
      var v = NaN;
      if (sampler) {
        v = sampler(o.aircraft.x + sb * d, o.aircraft.y + cb * d);
      } else if (elev && cw && ch && o.L) {
        // 屏幕空间：航迹向上，正前方即中心列 cx 上方
        var y = Math.round(o.L.acY - d * o.L.pxPerNm);
        var x = Math.round(o.L.cx);
        if (y >= 0 && y < ch && x >= 0 && x < cw) v = elev[y * cw + x];
      }
      out.push({ distNm: d, elevFt: v });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 地形威胁等级（按接近率 / 余度）
   * ------------------------------------------------------------------------ */
  var DEFAULT_THREAT = {
    redAtOrAbove: 0,      // 余度 <= 0 ft（地形已接近/高于预测轨迹）-> 红
    yellowBelow: 1000,    // 余度 < 1000 ft -> 黄
    closingFpm: 4000,     // 接近率超过该值且余度 < 2500 ft -> 也判黄
    closingNearFt: 2500
  };

  /**
   * @param {number} clearanceFt 预测轨迹高度 - 地形高度（ft），越大越安全
   * @param {number} closingFpm  余度缩小的速率（ft/min，正 = 正在接近）
   * @param {object} th          阈值（缺省用 DEFAULT_THREAT）
   * @returns {'red'|'yellow'|'green'}
   */
  function terrainLevelAt(clearanceFt, closingFpm, th) {
    var t = th || DEFAULT_THREAT;
    if (!isNum(clearanceFt) || clearanceFt <= t.redAtOrAbove) return 'red';
    if (clearanceFt < t.yellowBelow) return 'yellow';
    if (isNum(closingFpm) && closingFpm > t.closingFpm && clearanceFt < t.closingNearFt) return 'yellow';
    return 'green';
  }

  /**
   * 把地形采样序列转换成带威胁等级的剖面点。
   * @param {Array<{distNm,elevFt}>} samples
   * @param {object} o {alt0Ft, vsMs, accMs2, gsMs}
   * @returns {Array<{distNm, elevFt, predFt, clearanceFt, closingFpm, level}>}
   */
  function terrainProfileWithThreat(samples, o, th) {
    var out = [], prevC = null, prevT = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var pred = trendAltitudeFt(o.alt0Ft, o.vsMs, o.accMs2, o.gsMs, s.distNm);
      var item = {
        distNm: s.distNm, elevFt: s.elevFt, predFt: pred,
        clearanceFt: isNum(s.elevFt) ? pred - s.elevFt : NaN,
        closingFpm: NaN, level: 'green'
      };
      if (isNum(item.clearanceFt)) {
        if (prevC != null && prevT != null) {
          var dt = timeAtDistance(s.distNm, o.gsMs) - timeAtDistance(prevT, o.gsMs);
          if (dt > 1e-6) item.closingFpm = (prevC - item.clearanceFt) / dt * 60;
        }
        item.level = terrainLevelAt(item.clearanceFt, item.closingFpm, th);
        prevC = item.clearanceFt; prevT = s.distNm;
      } else {
        prevC = null; prevT = null;
      }
      out.push(item);
    }
    return out;
  }

  /* ------------------------------------------------------------------------ */
  return {
    NM_TO_M: NM_TO_M,
    M_TO_FT: M_TO_FT,
    FT_TO_M: FT_TO_M,
    DEFAULT_THREAT: DEFAULT_THREAT,

    rad: rad,
    mToFt: mToFt,
    ftToM: ftToM,
    msToFpm: msToFpm,
    fpmToMs: fpmToMs,
    clamp: clamp,
    isNum: isNum,
    distNM: distNM,

    alongTrackDistances: alongTrackDistances,
    forwardWaypoints: forwardWaypoints,

    altitudeTicks: altitudeTicks,

    timeAtDistance: timeAtDistance,
    trendAltitudeFt: trendAltitudeFt,
    trendRateFpm: trendRateFpm,
    trendProfile: trendProfile,

    normalizeStages: normalizeStages,
    targetProfile: targetProfile,

    sampleTerrainTrack: sampleTerrainTrack,
    terrainLevelAt: terrainLevelAt,
    terrainProfileWithThreat: terrainProfileWithThreat
  };
});
