/*!
 * eicas-fault-display.js
 * ---------------------------------------------------------------------------
 * EICAS（Engine Indicating and Crew Alerting System）风格的故障信息显示组件。
 *
 * 画布逻辑尺寸固定为 207 × 253，右栏宽 60px，左栏宽 147px。
 *
 * 警告级别：
 *   1 = 红色，且为「锁定」级：无论在哪一页都固定显示在顶部，不会被 CANCEL 清除
 *   2 = 黄色，左侧带 "·" 标识
 *   3 = 黄色，无标识
 *   4 = 白色
 *   5 = 绿色
 *
 * 主要 API：
 *   add(level, message, parent = null, column = 0) -> handle   添加条目（可挂子条目）
 *   remove(handle) -> boolean                                   移除条目及其所有子条目
 *   cancel()                                                    清除当前页并翻到下一页（末页则清空显示）
 *   recall()                                                    恢复被清除的条目并回到第一页
 *   clear()                                                     删除全部条目
 *   render()                                                    立即重绘
 *   getState() -> { page, totalPages, cleared, count }           读取当前状态
 * ---------------------------------------------------------------------------
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.EICASFaultDisplay = api.EICASFaultDisplay;
    global.EICAS_LEVELS = api.LEVELS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 画布逻辑尺寸（CSS 像素） */
  var WIDTH = 207;
  var HEIGHT = 253;
  var RIGHT_WIDTH = 60;

  /** 五级警告的样式表：颜色 + 是否带 "·" 标识 */
  var LEVELS = {
    1: { name: 'WARNING', color: '#ff3b30', bullet: false, locked: true },
    2: { name: 'CAUTION', color: '#ffc300', bullet: true, locked: false },
    3: { name: 'CAUTION', color: '#ffc300', bullet: false, locked: false },
    4: { name: 'ADVISORY', color: '#ffffff', bullet: false, locked: false },
    5: { name: 'STATUS', color: '#3ddc84', bullet: false, locked: false }
  };

  var DEFAULTS = {
    rightColumnWidth: RIGHT_WIDTH,   // 右栏宽度
    font: '11px "Helvetica Neue", Helvetica, Arial, sans-serif',
    pageFont: '10px "Helvetica Neue", Helvetica, Arial, sans-serif',
    bullet: '·',                     // 级别 2 的左侧标识
    bulletWidth: 6,                  // 标识占位宽度（所有行统一留白，保证文字对齐）
    indentWidth: 6,                  // 子条目每层缩进
    lineHeight: 13,
    topPadding: 3,
    bottomPadding: 15,               // 底部留给页码的区域
    paddingX: 4,                     // 栏内左右内边距
    backgroundColor: '#000000',
    dividerColor: 'rgba(255, 255, 255, 0.13)',
    pageColor: '#ffffff',
    uppercase: true,                 // EICAS 文字惯例为全大写
    pixelRatio: 1,                   // 1 = 画布位图就是 207×253；2/3 可用于高分屏放大显示
    onChange: null                   // 状态变化回调 (state) => {}
  };

  /** 归一化为栏索引：0 = 左栏，1 = 右栏 */
  function normalizeColumn(column) {
    if (column === 1 || column === true) return 1;
    if (typeof column === 'string') {
      var s = column.toLowerCase();
      if (s === 'right' || s === 'r' || s === '1') return 1;
    }
    return 0;
  }

  class EICASFaultDisplay {
    /**
     * @param {HTMLCanvasElement|string} canvas 画布元素或元素 id
     * @param {object} [options] 见 DEFAULTS
     */
    constructor(canvas, options) {
      this.canvas = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
      if (!this.canvas) throw new Error('[EICAS] 找不到画布元素');
      this.ctx = this.canvas.getContext('2d');
      this.options = Object.assign({}, DEFAULTS, options || {});

      this._nodes = new Map();        // handle -> 节点
      this._roots = [[], []];         // [左栏根条目, 右栏根条目]
      this._seq = 0;                  // 递增序号，用于「先来后到」排序
      this._nextHandle = 1;
      this._page = 0;                 // 当前页（0 基）
      this._cleared = false;          // 是否已被 cancel 清空显示

      this._applyPixelRatio();
      this.render();
    }

    /* ======================= 公共 API ======================= */

    /**
     * 添加一条警告信息。
     * @param {number} level  1~5
     * @param {string} message 文本
     * @param {number|null} [parent] 父条目 handle；子条目会缩进显示并继承父条目所在栏
     * @param {number|string} [column] 0/'left' = 左栏，1/'right' = 右栏（仅在无 parent 时生效）
     * @returns {number} handle
     */
    add(level, message, parent, column) {
      var lvl = Number(level);
      if (!LEVELS[lvl]) throw new RangeError('[EICAS] level 必须是 1~5，收到：' + level);

      var parentNode = null;
      var col = normalizeColumn(column);

      if (parent !== null && parent !== undefined) {
        parentNode = this._nodes.get(parent);
        if (!parentNode) throw new Error('[EICAS] 未知的 parent handle：' + parent);
        col = parentNode.column; // 子条目跟随父条目所在栏
      }

      var node = {
        handle: this._nextHandle++,
        level: lvl,
        text: String(message),
        parent: parentNode,
        column: col,
        children: [],
        cancelled: false,        // 仅根条目使用该标志
        seq: this._seq++
      };

      this._nodes.set(node.handle, node);
      if (parentNode) parentNode.children.push(node);
      else this._roots[col].push(node);

      this._revealOnAdd(node);
      this.render();
      return node.handle;
    }

    /** 移除一条信息及其全部子条目 */
    remove(handle) {
      var node = this._nodes.get(handle);
      if (!node) return false;

      if (node.parent) {
        var i = node.parent.children.indexOf(node);
        if (i >= 0) node.parent.children.splice(i, 1);
      } else {
        var arr = this._roots[node.column];
        var j = arr.indexOf(node);
        if (j >= 0) arr.splice(j, 1);
      }

      // 连同子孙一起从索引中摘除
      var stack = [node];
      while (stack.length) {
        var n = stack.pop();
        this._nodes.delete(n.handle);
        for (var k = 0; k < n.children.length; k++) stack.push(n.children[k]);
      }
      node.children.length = 0;

      this.render();
      return true;
    }

    /**
     * CANCEL：清除当前页（隐藏当前页上的可清除条目）并翻到下一页。
     * 在最后一页按下则清空显示；此后新添加的条目会自动显示出来。
     */
    cancel() {
      var layout = this._layout();
      var page = Math.min(this._page, layout.totalPages - 1);

      for (var c = 0; c < layout.columns.length; c++) {
        var blocks = layout.columns[c].pages[this._pageIndexIn(layout.columns[c], page)] || [];
        for (var i = 0; i < blocks.length; i++) blocks[i].root.cancelled = true;
      }

      if (page < layout.totalPages - 1) {
        this._page = page + 1;
        this._cleared = false;
      } else {
        this._cleared = true; // 末页：显示被清空
      }
      this.render();
      return this;
    }

    /** RECALL：恢复被 CANCEL 隐藏的条目，并回到第一页 */
    recall() {
      for (var c = 0; c < this._roots.length; c++) {
        var arr = this._roots[c];
        for (var i = 0; i < arr.length; i++) arr[i].cancelled = false;
      }
      this._page = 0;
      this._cleared = false;
      this.render();
      return this;
    }

    /** 删除全部条目 */
    clear() {
      this._nodes.clear();
      this._roots = [[], []];
      this._page = 0;
      this._cleared = false;
      this.render();
      return this;
    }

    /** 立刻重绘 */
    render() { return this._render(); }

    /** 设置位图倍率（1 = 位图即为 207×253；2/3 用于高分屏或放大显示） */
    setPixelRatio(ratio) {
      this.options.pixelRatio = Math.max(1, Number(ratio) || 1);
      this._applyPixelRatio();
      this.render();
      return this;
    }

    /** 当前状态：{ page, totalPages, cleared, count }（page 为 1 基） */
    getState() {
      var layout = this._layout();
      return {
        page: Math.min(this._page, layout.totalPages - 1) + 1,
        totalPages: layout.totalPages,
        cleared: this._cleared,
        count: this._nodes.size
      };
    }

    /* ======================= 内部实现 ======================= */

    _applyPixelRatio() {
      var r = Math.max(1, Number(this.options.pixelRatio) || 1);
      this.canvas.width = Math.round(WIDTH * r);
      this.canvas.height = Math.round(HEIGHT * r);
      if (this.canvas.style) {
        this.canvas.style.width = WIDTH + 'px';
        this.canvas.style.height = HEIGHT + 'px';
      }
    }

    /** 一屏最多可容纳的文本行数 */
    get _maxLines() {
      var o = this.options;
      return Math.max(1, Math.floor((HEIGHT - o.topPadding - o.bottomPadding) / o.lineHeight));
    }

    /** 栏几何：{ x, width } */
    _columnGeometry(index) {
      var right = this.options.rightColumnWidth;
      return index === 1
        ? { x: WIDTH - right, width: right }
        : { x: 0, width: WIDTH - right };
    }

    /** 把一个根条目（含子孙）展开为若干行 */
    _block(node) {
      var lines = [];
      (function walk(n, depth) {
        lines.push({ node: n, depth: depth });
        for (var i = 0; i < n.children.length; i++) walk(n.children[i], depth + 1);
      })(node, 0);
      return { root: node, lines: lines };
    }

    /** 某栏在给定全局页码下应显示的分页下标（该栏页数较少时停在它的最后一页） */
    _pageIndexIn(column, page) {
      var p = page === undefined ? this._page : page;
      return Math.min(Math.max(p, 0), column.pages.length - 1);
    }

    /** 按行容量把条目块装进各页（一个块不跨页，保证子条目与父条目同页） */
    _paginate(blocks, capacity) {
      if (capacity <= 0) return [[]];
      var pages = [];
      var current = [];
      var used = 0;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (current.length && used + b.lines.length > capacity) {
          pages.push(current);
          current = [];
          used = 0;
        }
        current.push(b);
        used += b.lines.length;
      }
      pages.push(current);
      return pages;
    }

    /** 计算版式：锁定条目（1 级）置顶，其余按「级别升序 + 先来后到」排序后分页 */
    _layout() {
      var columns = [];
      for (var c = 0; c < 2; c++) {
        var roots = this._roots[c];

        var lockedRoots = roots.filter(function (n) { return n.level === 1; })
          .sort(function (a, b) { return a.seq - b.seq; });
        var freeRoots = roots.filter(function (n) { return n.level !== 1; })
          .sort(function (a, b) { return (a.level - b.level) || (a.seq - b.seq); });

        var pinned = lockedRoots.map((n) => this._block(n));
        var pinnedLines = pinned.reduce(function (s, b) { return s + b.lines.length; }, 0);
        var capacity = Math.max(0, this._maxLines - pinnedLines);
        var blocks = freeRoots.map((n) => this._block(n));

        columns.push({
          pinned: pinned,
          pages: this._paginate(blocks, capacity),
          capacity: capacity,
          pinnedLines: pinnedLines
        });
      }

      var totalPages = 1;
      for (var i = 0; i < columns.length; i++) {
        totalPages = Math.max(totalPages, columns[i].pages.length);
      }
      return { columns: columns, totalPages: totalPages };
    }

    /** 显示被清空后新增的条目：把当前页切到该条目所在页，使其可见 */
    _revealOnAdd(node) {
      if (!this._cleared) return;
      var root = node;
      while (root.parent) root = root.parent; // 找到根条目
      this._cleared = false;
      if (root.level === 1) return;           // 1 级本来就常显在顶部
      var pages = this._layout().columns[root.column].pages;
      for (var i = 0; i < pages.length; i++) {
        for (var j = 0; j < pages[i].length; j++) {
          if (pages[i][j].root === root) { this._page = i; return; }
        }
      }
    }

    _render() {
      var ctx = this.ctx;
      var o = this.options;
      var ratio = Math.max(1, Number(o.pixelRatio) || 1);

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = o.backgroundColor;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      var layout = this._layout();
      this._page = Math.min(Math.max(this._page, 0), layout.totalPages - 1);

      // 栏分隔线
      var splitX = WIDTH - o.rightColumnWidth;
      if (o.dividerColor) {
        ctx.fillStyle = o.dividerColor;
        ctx.fillRect(Math.round(splitX) - 0.5, o.topPadding, 1, HEIGHT - o.topPadding - o.bottomPadding + 2);
      }

      for (var c = 0; c < layout.columns.length; c++) {
        var column = layout.columns[c];
        var geo = this._columnGeometry(c);
        var lineIndex = 0;

        var drawBlock = (block) => {
          for (var i = 0; i < block.lines.length; i++) {
            if (lineIndex >= this._maxLines) return false; // 超出可见区域则裁掉
            this._drawLine(block.lines[i].node, block.lines[i].depth, geo, lineIndex);
            lineIndex++;
          }
          return true;
        };

        // 1 级警告：任何页都置顶显示，且不会被 CANCEL 清除
        for (var p = 0; p < column.pinned.length; p++) {
          if (!drawBlock(column.pinned[p])) break;
        }

        // 当前页的可清除条目
        var pageBlocks = column.pages[this._pageIndexIn(column)] || [];
        for (var b = 0; b < pageBlocks.length; b++) {
          if (pageBlocks[b].root.cancelled) continue;
          if (!drawBlock(pageBlocks[b])) break;
        }
      }

      // 页码：超过一页时才显示
      var hasVisible = !this._cleared;
      if (layout.totalPages > 1 && hasVisible) {
        ctx.font = o.pageFont;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = o.pageColor;
        ctx.fillText((this._page + 1) + '/' + layout.totalPages, WIDTH - 4, HEIGHT - 4);
      }

      if (typeof o.onChange === 'function') {
        try { o.onChange(this.getState()); } catch (e) { /* 忽略回调异常 */ }
      }
      return this;
    }

    _drawLine(node, depth, geo, lineIndex) {
      var ctx = this.ctx;
      var o = this.options;
      var style = LEVELS[node.level] || LEVELS[4];

      var textX = geo.x + o.paddingX + o.bulletWidth + depth * o.indentWidth;
      var y = o.topPadding + lineIndex * o.lineHeight + Math.round(o.lineHeight / 2);

      ctx.font = o.font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.color;

      if (style.bullet) {
        ctx.fillText(o.bullet, geo.x + o.paddingX, y);
      }
      var maxWidth = geo.width - (textX - geo.x) - 2;
      ctx.fillText(this._fit(this._format(node.text), maxWidth), textX, y);
    }

    _format(text) {
      return this.options.uppercase ? String(text).toUpperCase() : String(text);
    }

    /** 超出栏宽时截断并加省略号 */
    _fit(text, maxWidth) {
      if (maxWidth <= 0) return '';
      if (this.ctx.measureText(text).width <= maxWidth) return text;
      var lo = 0;
      var hi = text.length;
      while (lo < hi) {
        var mid = Math.ceil((lo + hi) / 2);
        if (this.ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      return lo > 0 ? text.slice(0, lo) + '…' : '';
    }
  }

  return { EICASFaultDisplay: EICASFaultDisplay, LEVELS: LEVELS, WIDTH: WIDTH, HEIGHT: HEIGHT };
});
