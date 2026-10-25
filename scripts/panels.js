// ==================== 全局组件注册表 ====================
const globalComponentRegistry = new Map();

export function registerComponent(name, instance) {
    if (name && typeof name === 'string') {
        globalComponentRegistry.set(name, instance);
    }
}

export function getComponentByName(name) {
    return globalComponentRegistry.get(name);
}

// ==================== 工具函数 ====================
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function mapRange(val, inMin, inMax, outMin, outMax) {
    return outMin + ((val - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function getGlowShadow(colorName) {
    const map = {
        'green': 'var(--shadow-glow-green)',
        'amber': 'var(--shadow-glow-amber)',
        'blue': 'var(--shadow-glow-blue)',
        'red': 'var(--shadow-glow-red)',
        'white': 'var(--shadow-glow-white)',
        'cyan': 'var(--shadow-glow-cyan)',
    };
    return map[colorName] || 'var(--shadow-glow-white)';
}

function getColorVar(colorName) {
    const map = {
        'green': 'var(--color-green)',
        'amber': 'var(--color-amber)',
        'blue': 'var(--color-blue)',
        'red': 'var(--color-red)',
        'white': 'var(--color-white)',
        'cyan': 'var(--color-cyan)',
    };
    if (!colorName) return map.white;
    // 除内置颜色名外，也允许直接传入任意 CSS 颜色（如 #ff8800、rgba(...)）
    return map[colorName] || colorName;
}

function normalizeLabelPosition(position) {
    return ['top', 'bottom', 'left', 'right'].includes(position) ? position : 'top';
}

function normalizeLabelOrientation(orientation) {
    return orientation === 'vertical' ? 'vertical' : 'horizontal';
}

// 将颜色与暗色背景混合，用于指示灯熄灭时的暗淡底色/文字
function getDimColor(color, percent, darkColor = '#0b0d11') {
    return `color-mix(in srgb, ${color} ${clamp(percent, 0, 100)}%, ${darkColor})`;
}

function normalizeBrightness(value) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 0, 100) : 0;
}

// 指示灯/灯组的单个灯芯共用同一套亮灭样式
function applyIndicatorLightStyle(element, brightness, backgroundColor, foregroundColor) {
    if (!element) return;
    const b = clamp(brightness, 0, 100);
    const bgColor = getColorVar(backgroundColor);
    const fgColor = getColorVar(foregroundColor);

    if (b <= 0) {
        element.classList.remove('lit');
        element.style.background = getDimColor(bgColor, 18);
        element.style.color = getDimColor(fgColor, 32);
        element.style.borderColor = getDimColor(bgColor, 34);
        element.style.boxShadow = 'inset 0 2px 6px rgba(0, 0, 0, 0.55)';
        element.style.textShadow = 'none';
        return;
    }

    element.classList.add('lit');
    const intensity = b / 100;
    const glowSize = 4 + intensity * 10;
    element.style.background = getDimColor(bgColor, 30 + intensity * 70);
    element.style.color = fgColor;
    element.style.borderColor = bgColor;
    element.style.boxShadow =
        `0 0 ${glowSize}px ${bgColor}, inset 0 0 ${glowSize * 0.6}px ${bgColor}`;
    element.style.textShadow = `0 0 ${3 + intensity * 6}px ${fgColor}`;
}

// ==================== 旋钮拖拽工具 ====================
function normalizeAngle(angleDeg) {
    let a = angleDeg % 360;
    if (a < 0) a += 360;
    return a;
}

// 计算两个角度之间的最短差值（-180 ~ 180）
function shortestAngleDelta(currentAngle, lastAngle) {
    let diff = normalizeAngle(currentAngle) - normalizeAngle(lastAngle);
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
}

function getPointerAngle(container, event) {
    const rect = container.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    if (!point) return { angle: 0, distance: 0 };

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = point.clientX - cx;
    const dy = point.clientY - cy;
    // 0 度在正上方，角度顺时针增加
    const angle = normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI + 90);
    return { angle, distance: Math.hypot(dx, dy) };
}

/**
 * 绑定旋钮的旋转拖拽。
 * 使用相对角度增量（并处理 0/360 环绕），因此指针即使移动到很远的位置，
 * 只要绕旋钮转动，旋钮就会继续旋转。优先使用 Pointer Events + 指针捕获，
 * 鼠标拖出组件甚至拖出窗口后依然可以正常操作。
 *
 * @param {HTMLElement} container 旋钮容器
 * @param {{onStart?: Function, onRotate?: Function, onEnd?: Function}} callbacks
 * @returns {Function} 清理函数
 */
function bindRotaryDrag(container, callbacks = {}) {
    const { onStart, onRotate, onEnd } = callbacks;
    const deadZone = 6; // 靠近圆心时角度不稳定，暂时忽略
    let isDragging = false;
    let lastAngle = null;
    let activePointerId = null;

    const handleStart = (event) => {
        if (isDragging) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.pointerType === 'touch' && event.isPrimary === false) return;

        event.preventDefault();
        isDragging = true;
        activePointerId = event.pointerId !== undefined ? event.pointerId : null;

        const { angle, distance } = getPointerAngle(container, event);
        lastAngle = distance >= deadZone ? angle : null;

        container.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';

        if (activePointerId !== null && typeof container.setPointerCapture === 'function') {
            try {
                container.setPointerCapture(activePointerId);
            } catch (err) {
                // 某些浏览器/输入方式下捕获可能失败，不影响 window 上的监听
            }
        }
        if (onStart) onStart(event);
    };

    const handleMove = (event) => {
        if (!isDragging) return;
        if (activePointerId !== null && event.pointerId !== undefined &&
            event.pointerId !== activePointerId) return;

        if (event.cancelable) event.preventDefault();
        const { angle, distance } = getPointerAngle(container, event);

        // 指针掠过圆心时不响应，避免角度瞬间跳变
        if (distance < deadZone) {
            lastAngle = null;
            return;
        }
        if (lastAngle === null) {
            lastAngle = angle;
            return;
        }

        const delta = shortestAngleDelta(angle, lastAngle);
        lastAngle = angle;
        if (Math.abs(delta) > 0.0001 && onRotate) onRotate(delta, event);
    };

    const handleEnd = (event) => {
        if (!isDragging) return;
        if (activePointerId !== null && event.pointerId !== undefined &&
            event.pointerId !== activePointerId) return;

        isDragging = false;
        lastAngle = null;
        activePointerId = null;
        container.style.cursor = 'grab';
        document.body.style.cursor = '';
        if (onEnd) onEnd(event);
    };

    const listeners = [];
    const addListener = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        listeners.push([target, type, handler, options]);
    };

    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
        addListener(container, 'pointerdown', handleStart);
        // move/up 绑定在 window 上：即使指针捕获失败或指针移出组件，拖拽仍然有效
        addListener(window, 'pointermove', handleMove);
        addListener(window, 'pointerup', handleEnd);
        addListener(window, 'pointercancel', handleEnd);
        addListener(container, 'lostpointercapture', handleEnd);
    } else {
        // 旧浏览器回退到鼠标/触摸事件
        addListener(container, 'mousedown', handleStart);
        addListener(container, 'touchstart', handleStart, { passive: false });
        addListener(window, 'mousemove', handleMove);
        addListener(window, 'touchmove', handleMove, { passive: false });
        addListener(window, 'mouseup', handleEnd);
        addListener(window, 'touchend', handleEnd);
    }

    return () => {
        listeners.forEach(([target, type, handler, options]) => {
            target.removeEventListener(type, handler, options);
        });
    };
}

// ==================== 面板类 ====================
export class Panel {
    constructor(containerId, options = {}) {
        const {
            columns = 12, rows = 6, cellSize = 44, gap = 8, panelId = null
        } = options;
        this.columns = columns;
        this.rows = rows;
        this.cellSize = cellSize;
        this.gap = gap;
        this.panelId = panelId || ('panel_' + Date.now() + '_' + Math.random().toString(36).substr(2,
            6));
        this.components = [];

        // 查找或创建容器
        let containerEl = document.getElementById(containerId);
        if (!containerEl) {
            // 尝试在panels-container中查找
            const pc = document.getElementById('panels-container');
            if (pc) {
                containerEl = document.createElement('div');
                containerEl.id = containerId;
                pc.appendChild(containerEl);
            } else {
                containerEl = document.createElement('div');
                containerEl.id = containerId;
                document.body.appendChild(containerEl);
            }
        }

        // 创建面板div
        this.panelDiv = document.createElement('div');
        this.panelDiv.className = 'cockpit-panel';
        this.panelDiv.style.gridTemplateColumns = `repeat(${columns}, ${cellSize}px)`;
        this.panelDiv.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
        this.panelDiv.style.gap = `${gap}px`;
        this.panelDiv.setAttribute('data-panel-id', this.panelId);

        containerEl.appendChild(this.panelDiv);
    }

    addComponent(component, gridOptions = {}) {
        const {
            row = 1, col = 1, rowSpan = 1, colSpan = 1
        } = gridOptions;
        component.setGridPosition(row, col, rowSpan, colSpan);
        component.attachToPanel(this);
        this.components.push(component);
        // 将组件的DOM元素添加到面板
        if (component.wrapperDiv) {
            this.panelDiv.appendChild(component.wrapperDiv);
        }
        return component;
    }

    getPanelDiv() {
        return this.panelDiv;
    }

    getPanelId() {
        return this.panelId;
    }

    toJSON() {
        return {
            id: this.panelId,
            columns: this.columns,
            rows: this.rows,
            cellSize: this.cellSize,
            gap: this.gap,
            components: this.components.map((component) => component.toJSON()),
        };
    }

    // 从 JSON 重建面板；containerId 是面板的挂载容器
    static fromJSON(containerId, json = {}) {
        const panel = new Panel(containerId, {
            columns: json.columns,
            rows: json.rows,
            cellSize: json.cellSize,
            gap: json.gap,
            panelId: json.id,
        });
        (json.components || []).forEach((componentJson) => {
            const component = createComponentInstance(
                componentJson.type,
                componentJson.id,
                componentJson.props || {}
            );
            panel.addComponent(component, componentJson.grid || {});
        });
        return panel;
    }
}

// ==================== 组件基类 ====================
class BaseComponent {
    constructor(cmpName, options = {}) {
        this.cmpName = cmpName || ('cmp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
        this.labelText = options.label || '';
        this.labelPosition = normalizeLabelPosition(options.labelPosition || 'top'); // top, bottom, left, right
        // left / right 时文字是否竖排
        this.labelOrientation = normalizeLabelOrientation(options.labelOrientation);
        this.gridRow = 1;
        this.gridCol = 1;
        this.gridRowSpan = 1;
        this.gridColSpan = 1;
        this.panel = null;
        this.wrapperDiv = null;
        this.labelDiv = null;
        this._eventHandlers = {};

        this._buildWrapper();
        registerComponent(this.cmpName, this);
    }

    _buildWrapper() {
        this.wrapperDiv = document.createElement('div');
        this.wrapperDiv.className = 'component-wrapper';
        this.wrapperDiv.setAttribute('data-cmp-name', this.cmpName);

        this._renderLabel();
    }

    // 创建/更新描述性标签（位置、竖排方向可配置）
    _renderLabel() {
        if (!this.labelText) {
            if (this.labelDiv && this.labelDiv.parentNode) {
                this.labelDiv.parentNode.removeChild(this.labelDiv);
            }
            this.labelDiv = null;
            return;
        }

        if (!this.labelDiv) {
            this.labelDiv = document.createElement('div');
            this.wrapperDiv.insertBefore(this.labelDiv, this.wrapperDiv.firstChild);
        }
        this.labelDiv.textContent = this.labelText;
        this._applyLabelStyle();
    }

    _applyLabelStyle() {
        if (!this.labelDiv) return;
        const position = normalizeLabelPosition(this.labelPosition);
        const isVertical = this.labelOrientation === 'vertical' &&
            (position === 'left' || position === 'right');
        this.labelDiv.className = 'component-label label-' + position +
            (isVertical ? ' label-vertical' : '');
        this.labelDiv.setAttribute('data-label-position', position);
        this.labelDiv.setAttribute('data-label-orientation', isVertical ? 'vertical' : 'horizontal');
    }

    setLabel(text) {
        this.labelText = text || '';
        this._renderLabel();
        return this;
    }

    setLabelPosition(position, orientation) {
        this.labelPosition = normalizeLabelPosition(position);
        if (orientation !== undefined) {
            this.labelOrientation = normalizeLabelOrientation(orientation);
        }
        this._applyLabelStyle();
        return this;
    }

    setLabelOrientation(orientation) {
        this.labelOrientation = normalizeLabelOrientation(orientation);
        this._applyLabelStyle();
        return this;
    }

    getType() {
        return this.constructor.name;
    }

    // 返回可写入项目 JSON 的构造参数；子类在此基础上追加自己的属性
    getOptions() {
        return {
            label: this.labelText,
            labelPosition: this.labelPosition,
            labelOrientation: this.labelOrientation,
        };
    }

    toJSON() {
        return {
            id: this.cmpName,
            type: this.getType(),
            grid: {
                row: this.gridRow,
                col: this.gridCol,
                rowSpan: this.gridRowSpan,
                colSpan: this.gridColSpan,
            },
            props: this.getOptions(),
        };
    }

    setGridPosition(row, col, rowSpan, colSpan) {
        this.gridRow = row;
        this.gridCol = col;
        this.gridRowSpan = rowSpan;
        this.gridColSpan = colSpan;
        if (this.wrapperDiv) {
            this.wrapperDiv.style.gridRow = `${row} / span ${rowSpan}`;
            this.wrapperDiv.style.gridColumn = `${col} / span ${colSpan}`;
        }
    }

    attachToPanel(panel) {
        this.panel = panel;
    }

    on(eventName, callback) {
        if (!this._eventHandlers[eventName]) {
            this._eventHandlers[eventName] = [];
        }
        this._eventHandlers[eventName].push(callback);
        return this;
    }

    _emit(eventName, data) {
        const handlers = this._eventHandlers[eventName] || [];
        handlers.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`事件处理错误 [${eventName}] on ${this.cmpName}:`, e);
            }
        });
    }

    getComponentName() {
        return this.cmpName;
    }

    destroy() {
        globalComponentRegistry.delete(this.cmpName);
        if (this.wrapperDiv && this.wrapperDiv.parentNode) {
            this.wrapperDiv.parentNode.removeChild(this.wrapperDiv);
        }
        this._eventHandlers = {};
    }
}

// ==================== 显示屏组件 ====================
export class Display extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            width = 400,
            height = 250,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);

        // 重建wrapper以包含canvas
        this._buildDisplayWrapper();
    }

    _buildDisplayWrapper() {
        // 清理旧wrapper
        if (this.wrapperDiv && this.wrapperDiv.parentNode) {
            this.wrapperDiv.parentNode.removeChild(this.wrapperDiv);
        }
        this.wrapperDiv = document.createElement('div');
        this.wrapperDiv.className = 'component-wrapper';
        this.wrapperDiv.setAttribute('data-cmp-name', this.cmpName);
        this.wrapperDiv.style.overflow = 'visible';

        // 描述性标签
        this.labelDiv = null;
        this._renderLabel();

        // 显示屏容器
        const displayContainer = document.createElement('div');
        displayContainer.className = 'display-container';
        displayContainer.style.width = this.canvasWidth + 'px';
        displayContainer.style.height = this.canvasHeight + 'px';
        displayContainer.style.flexShrink = '0';

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        this.canvas.style.width = this.canvasWidth + 'px';
        this.canvas.style.height = this.canvasHeight + 'px';
        this.ctx = this.canvas.getContext('2d');

        displayContainer.appendChild(this.canvas);
        this.wrapperDiv.appendChild(displayContainer);
    }

    getCanvas() {
        return this.canvas;
    }

    getContext() {
        return this.ctx;
    }

    getOptions() {
        return {
            ...super.getOptions(),
            width: this.canvasWidth,
            height: this.canvasHeight,
        };
    }

    resizeCanvas(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        const container = this.canvas.parentElement;
        if (container) {
            container.style.width = width + 'px';
            container.style.height = height + 'px';
        }
    }

    setGridPosition(row, col, rowSpan, colSpan) {
        super.setGridPosition(row, col, rowSpan, colSpan);
        // 显示屏使用其canvas实际大小，wrapper需要足够大
        if (this.wrapperDiv) {
            this.wrapperDiv.style.minWidth = this.canvasWidth + 'px';
            this.wrapperDiv.style.minHeight = this.canvasHeight + 'px';
        }
    }
}

// ==================== 按钮 - 类型a (仅按键) ====================
export class ButtonSimple extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            text = '',
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;
        this.buttonText = text;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);

        this._buildButton();
    }

    _buildButton() {
        // 更新wrapper
        this._renderLabel();

        this.buttonEl = document.createElement('button');
        this.buttonEl.className = 'btn-simple';
        this.buttonEl.textContent = this.buttonText;
        this.buttonEl.setAttribute('type', 'button');
        this.buttonEl.setAttribute('aria-label', this.cmpName);

        this.buttonEl.addEventListener('click', (e) => {
            e.preventDefault();
            this._emit('click', { cmpName: this.cmpName, event: e });
        });

        // 移除旧按钮
        const oldBtn = this.wrapperDiv.querySelector('.btn-simple');
        if (oldBtn) oldBtn.remove();

        this.wrapperDiv.appendChild(this.buttonEl);
    }

    setText(text) {
        this.buttonText = text;
        if (this.buttonEl) {
            this.buttonEl.textContent = text;
        }
    }

    getButtonElement() {
        return this.buttonEl;
    }

    getOptions() {
        return {
            ...super.getOptions(),
            text: this.buttonText,
        };
    }

    // 兼容updateDisplay接口（此类型按钮无指示灯，但保持接口一致）
    updateLights(upperLight, lowerLight) {
        // 无操作，此按钮类型没有指示灯
    }
}

// ==================== 按钮 - 类型b (按键与指示灯结合) ====================
export class ButtonWithLights extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            text = '',
            upperLightColor = 'white',
            lowerLightColor = 'amber',
            upperLightText = '',
            lowerLightText = '',
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
            initialUpperBrightness = 0,
            initialLowerBrightness = 0,
        } = options;
        this.buttonText = text;
        this.upperLightColor = upperLightColor;
        this.lowerLightColor = lowerLightColor;
        this.upperLightText = upperLightText;
        this.lowerLightText = lowerLightText;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this._upperBrightness = initialUpperBrightness;
        this._lowerBrightness = initialLowerBrightness;

        this._buildButtonWithLights();
    }

    _buildButtonWithLights() {
        this._renderLabel();

        // 清除旧内容
        const oldBtn = this.wrapperDiv.querySelector('.btn-with-lights');
        if (oldBtn) oldBtn.remove();

        this.btnContainer = document.createElement('div');
        this.btnContainer.className = 'btn-with-lights';

        // 上方指示灯（无外侧框）
        this.upperLightEl = document.createElement('div');
        this.upperLightEl.className = 'light-upper';
        this.upperLightEl.textContent = this.upperLightText;
        this.upperLightEl.style.color = getColorVar(this.upperLightColor);
        this._applyUpperBrightness();

        // 按钮主体
        this.buttonBodyEl = document.createElement('div');
        this.buttonBodyEl.className = 'btn-body';
        this.buttonBodyEl.textContent = this.buttonText;
        this.buttonBodyEl.setAttribute('aria-label', this.cmpName);

        // 下方指示灯（有外侧框）
        this.lowerLightEl = document.createElement('div');
        this.lowerLightEl.className = 'light-lower';
        this.lowerLightEl.textContent = this.lowerLightText;
        this.lowerLightEl.style.color = getColorVar(this.lowerLightColor);
        this.lowerLightEl.style.borderColor = getColorVar(this.lowerLightColor);
        this._applyLowerBrightness();

        this.btnContainer.appendChild(this.upperLightEl);
        this.btnContainer.appendChild(this.buttonBodyEl);
        this.btnContainer.appendChild(this.lowerLightEl);

        this.buttonBodyEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._emit('click', { cmpName: this.cmpName, event: e });
        });

        // 也让指示灯区域可点击
        this.btnContainer.addEventListener('click', (e) => {
            if (e.target === this.btnContainer || e.target === this.upperLightEl || e
                .target === this.lowerLightEl) {
                this._emit('click', { cmpName: this.cmpName, event: e });
            }
        });

        this.wrapperDiv.appendChild(this.btnContainer);
    }

    _applyUpperBrightness() {
        if (!this.upperLightEl) return;
        const b = this._upperBrightness;
        if (b <= 0) {
            this.upperLightEl.classList.remove('lit');
            this.upperLightEl.style.opacity = '0';
            this.upperLightEl.style.textShadow = 'none';
        } else {
            this.upperLightEl.classList.add('lit');
            const opacity = clamp(b / 100, 0.06, 1);
            this.upperLightEl.style.opacity = opacity;
            const glowIntensity = b / 100;
            const glowSize = 4 + glowIntensity * 10;
            this.upperLightEl.style.textShadow =
                `0 0 ${glowSize}px ${getColorVar(this.upperLightColor)}`;
        }
    }

    _applyLowerBrightness() {
        if (!this.lowerLightEl) return;
        const b = this._lowerBrightness;
        if (b <= 0) {
            this.lowerLightEl.classList.remove('lit');
            this.lowerLightEl.style.opacity = '0';
            this.lowerLightEl.style.boxShadow = 'none';
        } else {
            this.lowerLightEl.classList.add('lit');
            const opacity = clamp(b / 100, 0.06, 1);
            this.lowerLightEl.style.opacity = opacity;
            const glowIntensity = b / 100;
            const glowSize = 3 + glowIntensity * 8;
            this.lowerLightEl.style.boxShadow =
                `0 0 ${glowSize}px ${getColorVar(this.lowerLightColor)}, inset 0 0 ${glowSize * 0.6}px ${getColorVar(this.lowerLightColor)}`;
            this.lowerLightEl.style.borderColor = getColorVar(this.lowerLightColor);
        }
    }

    updateLights(upperLight, lowerLight) {
        if (upperLight !== undefined) {
            this._upperBrightness = clamp(upperLight, 0, 100);
            this._applyUpperBrightness();
        }
        if (lowerLight !== undefined) {
            this._lowerBrightness = clamp(lowerLight, 0, 100);
            this._applyLowerBrightness();
        }
    }

    setUpperLightText(text) {
        this.upperLightText = text;
        if (this.upperLightEl) this.upperLightEl.textContent = text;
    }

    setLowerLightText(text) {
        this.lowerLightText = text;
        if (this.lowerLightEl) this.lowerLightEl.textContent = text;
    }

    setButtonText(text) {
        this.buttonText = text;
        if (this.buttonBodyEl) this.buttonBodyEl.textContent = text;
    }

    getUpperBrightness() { return this._upperBrightness; }
    getLowerBrightness() { return this._lowerBrightness; }

    getOptions() {
        return {
            ...super.getOptions(),
            text: this.buttonText,
            upperLightColor: this.upperLightColor,
            lowerLightColor: this.lowerLightColor,
            upperLightText: this.upperLightText,
            lowerLightText: this.lowerLightText,
            initialUpperBrightness: this._upperBrightness,
            initialLowerBrightness: this._lowerBrightness,
        };
    }
}

// ==================== 独立指示灯 ====================
export class IndicatorLight extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            text = '',
            backgroundColor,
            foregroundColor,
            bgColor,
            fgColor,
            lightColor,
            textColor,
            initialBrightness = 0,
            brightness,
            lit,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;

        this.lightText = text;
        // 背景色 = 灯点亮时的发光颜色；前景色 = 文字颜色
        this.backgroundColor = backgroundColor || bgColor || lightColor || 'green';
        this.foregroundColor = foregroundColor || fgColor || textColor || 'white';
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);

        let initial = brightness !== undefined ? brightness : initialBrightness;
        if (lit !== undefined) initial = lit ? 100 : 0;
        this._brightness = normalizeBrightness(initial);

        this._buildIndicator();
    }

    _buildIndicator() {
        this._renderLabel();

        const oldLight = this.wrapperDiv.querySelector('.indicator-light');
        if (oldLight) oldLight.remove();

        this.indicatorEl = document.createElement('div');
        this.indicatorEl.className = 'indicator-light';
        this.indicatorEl.setAttribute('role', 'status');
        this.indicatorEl.setAttribute('aria-label', this.cmpName);
        // 关键尺寸与布局写在元素上，避免样式表缺失/缓存时退化为文字大小
        Object.assign(this.indicatorEl.style, {
            width: '100%',
            height: '100%',
            aspectRatio: 'auto',
            boxSizing: 'border-box',
            minWidth: '0',
            minHeight: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: '2px 8px',
            border: '2px solid var(--border-color, #5a5d67)',
            borderRadius: '5px',
            fontFamily: 'var(--font-main, Bahnschrift, Segoe UI, Arial, sans-serif)',
            fontSize: '12px',
            fontWeight: '700',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            textAlign: 'center',
        });

        this.indicatorTextEl = document.createElement('span');
        this.indicatorTextEl.className = 'indicator-light-text';
        this.indicatorTextEl.textContent = this.lightText;

        this.indicatorEl.appendChild(this.indicatorTextEl);
        this.wrapperDiv.appendChild(this.indicatorEl);

        this._applyBrightness();
    }

    _applyBrightness() {
        applyIndicatorLightStyle(
            this.indicatorEl,
            this._brightness,
            this.backgroundColor,
            this.foregroundColor
        );
    }

    setBrightness(brightness) {
        const newBrightness = normalizeBrightness(brightness);
        if (Math.abs(newBrightness - this._brightness) > 0.0001) {
            this._brightness = newBrightness;
            this._applyBrightness();
            this._emit('change', {
                cmpName: this.cmpName,
                brightness: this._brightness,
                value: this._brightness,
                lit: this._brightness > 0,
            });
        }
        return this;
    }

    getBrightness() { return this._brightness; }

    isLit() { return this._brightness > 0; }

    setLit(on) {
        return this.setBrightness(on ? 100 : 0);
    }

    setText(text) {
        this.lightText = text;
        if (this.indicatorTextEl) this.indicatorTextEl.textContent = text;
        return this;
    }

    setBackgroundColor(color) {
        this.backgroundColor = color || 'green';
        this._applyBrightness();
        return this;
    }

    setForegroundColor(color) {
        this.foregroundColor = color || 'white';
        this._applyBrightness();
        return this;
    }

    // 兼容 updateDisplay 接口：使用 upperLight 作为指示灯亮度
    updateLights(upperLight) {
        if (upperLight !== undefined) {
            this.setBrightness(upperLight);
        }
    }

    getLightElement() {
        return this.indicatorEl;
    }

    getOptions() {
        return {
            ...super.getOptions(),
            text: this.lightText,
            backgroundColor: this.backgroundColor,
            foregroundColor: this.foregroundColor,
            initialBrightness: this._brightness,
        };
    }
}

// ==================== 指示灯组 ====================
export class IndicatorLightGroup extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            rows = 3,
            columns = 3,
            texts = [],
            brightness = [],
            backgroundColor = 'green',
            foregroundColor = 'white',
            gap = 4,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;

        this.rows = clamp(Math.round(rows), 1, 8);
        this.columns = clamp(Math.round(columns), 1, 8);
        this.gap = clamp(Number(gap) || 0, 0, 20);
        this.backgroundColor = backgroundColor || 'green';
        this.foregroundColor = foregroundColor || 'white';
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);

        const count = this.rows * this.columns;
        const rawTexts = Array.isArray(texts) ? texts : [];
        const rawBrightness = Array.isArray(brightness) ? brightness : [];
        this._texts = Array.from({ length: count }, (_, index) =>
            String(rawTexts[index] ?? '')
        );
        this._brightness = Array.from({ length: count }, (_, index) =>
            normalizeBrightness(rawBrightness[index])
        );

        this._buildGroup();
    }

    _buildGroup() {
        this._renderLabel();

        const oldGroup = this.wrapperDiv.querySelector('.indicator-light-group');
        if (oldGroup) oldGroup.remove();

        this.groupEl = document.createElement('div');
        this.groupEl.className = 'indicator-light-group';
        this.groupEl.setAttribute('role', 'group');
        this.groupEl.setAttribute('aria-label', this.cmpName);
        Object.assign(this.groupEl.style, {
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            display: 'grid',
            gridTemplateColumns: `repeat(${this.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${this.rows}, minmax(0, 1fr))`,
            gap: `${this.gap}px`,
            padding: '4px',
            background: 'linear-gradient(180deg, #1b1f27, #11151b)',
            border: '1px solid var(--border-color, #5a5d67)',
            borderRadius: '5px',
            overflow: 'hidden',
        });

        this.cellEls = [];
        this.lampEls = [];

        for (let index = 0; index < this.rows * this.columns; index += 1) {
            const cell = document.createElement('div');
            cell.className = 'indicator-light-group-cell';
            Object.assign(cell.style, {
                minWidth: '0',
                minHeight: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(4, 6, 9, 0.42)',
                border: '1px solid #2d333d',
                borderRadius: '3px',
                overflow: 'hidden',
            });

            const lamp = document.createElement('div');
            lamp.className = 'indicator-light-group-lamp';
            lamp.dataset.index = String(index);
            lamp.setAttribute('role', 'status');
            Object.assign(lamp.style, {
                width: '64%',
                height: '64%',
                minWidth: '8px',
                minHeight: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                padding: '1px',
                border: '1px solid #3a414d',
                borderRadius: '2px',
                background: '#161a20',
                color: '#4a505a',
                fontFamily: 'var(--font-main, Bahnschrift, Segoe UI, Arial, sans-serif)',
                fontSize: '7px',
                fontWeight: '700',
                lineHeight: '1',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                textAlign: 'center',
                overflow: 'hidden',
            });

            const textEl = document.createElement('span');
            textEl.className = 'indicator-light-group-lamp-text';
            textEl.textContent = this._texts[index] || '';
            Object.assign(textEl.style, {
                display: 'block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            });
            lamp.appendChild(textEl);

            cell.appendChild(lamp);
            this.groupEl.appendChild(cell);
            this.cellEls.push(cell);
            this.lampEls.push(lamp);
        }

        this.wrapperDiv.appendChild(this.groupEl);
        this._applyAllBrightness();
    }

    _applyAllBrightness() {
        this._brightness.forEach((value, index) => {
            applyIndicatorLightStyle(
                this.lampEls[index],
                value,
                this.backgroundColor,
                this.foregroundColor
            );
        });
    }

    _applyBrightnessAt(index) {
        applyIndicatorLightStyle(
            this.lampEls[index],
            this._brightness[index],
            this.backgroundColor,
            this.foregroundColor
        );
    }

    _emitGroupChange(index) {
        this._emit('change', {
            cmpName: this.cmpName,
            index,
            brightness: this._brightness[index],
            brightnesses: [...this._brightness],
            lit: this._brightness[index] > 0,
        });
    }

    setLightBrightness(index, brightness) {
        const targetIndex = Math.round(Number(index));
        if (!Number.isInteger(targetIndex) ||
            targetIndex < 0 || targetIndex >= this._brightness.length) {
            return this;
        }
        const value = normalizeBrightness(brightness);
        if (Math.abs(value - this._brightness[targetIndex]) > 0.0001) {
            this._brightness[targetIndex] = value;
            this._applyBrightnessAt(targetIndex);
            this._emitGroupChange(targetIndex);
        }
        return this;
    }

    setBrightnesses(values) {
        if (!Array.isArray(values)) return this;
        this._brightness = this._brightness.map((current, index) => {
            const value = Number(values[index]);
            return Number.isFinite(value) ? clamp(value, 0, 100) : 0;
        });
        this._applyAllBrightness();
        this._emit('change', {
            cmpName: this.cmpName,
            brightnesses: [...this._brightness],
        });
        return this;
    }

    setAllBrightness(brightness) {
        const value = normalizeBrightness(brightness);
        this._brightness = this._brightness.map(() => value);
        this._applyAllBrightness();
        this._emit('change', {
            cmpName: this.cmpName,
            brightnesses: [...this._brightness],
        });
        return this;
    }

    getBrightness(index) {
        const targetIndex = Math.round(Number(index));
        return Number.isInteger(targetIndex) ? this._brightness[targetIndex] : undefined;
    }

    getBrightnesses() {
        return [...this._brightness];
    }

    setLightText(index, text) {
        const targetIndex = Math.round(Number(index));
        if (!Number.isInteger(targetIndex) ||
            targetIndex < 0 || targetIndex >= this._texts.length) {
            return this;
        }
        this._texts[targetIndex] = String(text ?? '');
        const textEl = this.lampEls[targetIndex]?.querySelector('.indicator-light-group-lamp-text');
        if (textEl) textEl.textContent = this._texts[targetIndex];
        return this;
    }

    setBackgroundColor(color) {
        this.backgroundColor = color || 'green';
        this._applyAllBrightness();
        return this;
    }

    setForegroundColor(color) {
        this.foregroundColor = color || 'white';
        this._applyAllBrightness();
        return this;
    }

    // 兼容 updateDisplay：upperLight 可以是单灯亮度或整个灯组的亮度数组
    updateLights(upperLight) {
        if (Array.isArray(upperLight)) {
            this.setBrightnesses(upperLight);
        } else if (upperLight !== undefined) {
            this.setAllBrightness(upperLight);
        }
    }

    getOptions() {
        return {
            ...super.getOptions(),
            rows: this.rows,
            columns: this.columns,
            texts: [...this._texts],
            brightness: [...this._brightness],
            backgroundColor: this.backgroundColor,
            foregroundColor: this.foregroundColor,
            gap: this.gap,
        };
    }

    getLightElement(index) {
        return this.lampEls[index] || null;
    }
}

// ==================== 旋钮 - 类型a (离散档位) ====================
export class KnobDiscrete extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            positions = ['OFF', 'STBY', 'ON'],
            initialPosition = 0,
            diameter = 50,
            arcStartAngle = 210,
            arcEndAngle = 330,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;
        this.positions = positions; // 档位名称数组
        this.currentPosition = clamp(initialPosition, 0, positions.length - 1);
        this.diameter = diameter;
        this.arcStartAngle = arcStartAngle; // 起始角度（度，0=顶部，顺时针）
        this.arcEndAngle = arcEndAngle; // 结束角度
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this._isDragging = false;
        this._dragAccumAngle = 0;
        this._dragStartPosition = 0;

        this._buildKnob();
        this._updateKnobRotation();
    }

    _buildKnob() {
        this._renderLabel();

        const oldKnob = this.wrapperDiv.querySelector('.knob-container');
        if (oldKnob) oldKnob.remove();

        const containerSize = this.diameter + 36;
        this.knobContainer = document.createElement('div');
        this.knobContainer.className = 'knob-container';
        this.knobContainer.style.width = containerSize + 'px';
        this.knobContainer.style.height = containerSize + 'px';

        // 档位标签
        this._tickLabelEls = [];
        const numPositions = this.positions.length;
        const centerX = containerSize / 2;
        const centerY = containerSize / 2;
        const labelRadius = this.diameter / 2 + 14;

        for (let i = 0; i < numPositions; i++) {
            const angleDeg = this._getAngleForPosition(i);
            const angleRad = (angleDeg - 90) * Math.PI / 180;
            const lx = centerX + labelRadius * Math.cos(angleRad);
            const ly = centerY + labelRadius * Math.sin(angleRad);
            const tickLabel = document.createElement('span');
            tickLabel.className = 'knob-tick-label';
            tickLabel.textContent = this.positions[i];
            tickLabel.style.left = lx + 'px';
            tickLabel.style.top = ly + 'px';
            if (i === this.currentPosition) {
                tickLabel.classList.add('active');
            }
            this.knobContainer.appendChild(tickLabel);
            this._tickLabelEls.push(tickLabel);
        }

        // 旋钮主体
        this.knobOuter = document.createElement('div');
        this.knobOuter.className = 'knob-outer';
        this.knobOuter.style.width = this.diameter + 'px';
        this.knobOuter.style.height = this.diameter + 'px';
        this.knobOuter.style.position = 'absolute';
        this.knobOuter.style.left = (containerSize / 2 - this.diameter / 2) + 'px';
        this.knobOuter.style.top = (containerSize / 2 - this.diameter / 2) + 'px';

        const innerSize = this.diameter * 0.55;
        this.knobInner = document.createElement('div');
        this.knobInner.className = 'knob-inner';
        this.knobInner.style.width = innerSize + 'px';
        this.knobInner.style.height = innerSize + 'px';

        // 指示线
        this.indicatorLine = document.createElement('div');
        this.indicatorLine.className = 'knob-indicator';
        const indicatorHeight = this.diameter * 0.38;
        const indicatorWidth = Math.max(2, this.diameter * 0.05);
        this.indicatorLine.style.height = indicatorHeight + 'px';
        this.indicatorLine.style.width = indicatorWidth + 'px';
        this.indicatorLine.style.bottom = '50%';
        this.indicatorLine.style.left = '50%';
        this.indicatorLine.style.marginLeft = (-indicatorWidth / 2) + 'px';
        this.indicatorLine.style.transformOrigin = 'bottom center';
        this.indicatorLine.style.borderRadius = (indicatorWidth / 2) + 'px';

        this.knobOuter.appendChild(this.indicatorLine);
        this.knobOuter.appendChild(this.knobInner);
        this.knobContainer.appendChild(this.knobOuter);
        this.wrapperDiv.appendChild(this.knobContainer);

        // 事件绑定
        this._bindKnobEvents();
    }

    _getAngleForPosition(posIndex) {
        const numPositions = this.positions.length;
        if (numPositions <= 1) return (this.arcStartAngle + this.arcEndAngle) / 2;
        return mapRange(posIndex, 0, numPositions - 1, this.arcStartAngle, this.arcEndAngle);
    }

    _getPositionForAngle(angleDeg) {
        const numPositions = this.positions.length;
        if (numPositions <= 1) return 0;
        let raw = mapRange(angleDeg, this.arcStartAngle, this.arcEndAngle, 0, numPositions - 1);
        return Math.round(clamp(raw, 0, numPositions - 1));
    }

    _updateKnobRotation() {
        const angle = this._getAngleForPosition(this.currentPosition);
        if (this.indicatorLine) {
            this.indicatorLine.style.transform = `rotate(${angle}deg)`;
        }
        // 更新档位标签高亮
        if (this._tickLabelEls) {
            this._tickLabelEls.forEach((el, i) => {
                if (i === this.currentPosition) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }
    }

    _bindKnobEvents() {
        if (!this.knobContainer) return;

        const emitChange = () => {
            this._emit('change', {
                cmpName: this.cmpName,
                position: this.currentPosition,
                positionName: this.positions[this.currentPosition],
            });
        };

        // 滚轮切换档位
        const onWheel = (e) => {
            e.preventDefault();
            const numPositions = this.positions.length;
            const step = e.deltaY > 0 ? 1 : -1;
            const newPos = clamp(this.currentPosition + step, 0, numPositions - 1);
            if (newPos !== this.currentPosition) {
                this.currentPosition = newPos;
                this._updateKnobRotation();
                emitChange();
            }
        };
        this.knobContainer.addEventListener('wheel', onWheel, { passive: false });

        // 相对角度拖拽：指针离开旋钮较远时仍可继续旋转
        const removeDrag = bindRotaryDrag(this.knobContainer, {
            onStart: () => {
                this._isDragging = true;
                this._dragStartPosition = this.currentPosition;
                this._dragAccumAngle = 0;
            },
            onRotate: (deltaDeg) => {
                const numPositions = this.positions.length;
                if (numPositions <= 1) return;
                const totalRange = Math.abs(this.arcEndAngle - this.arcStartAngle);
                const anglePerStep = totalRange / (numPositions - 1);
                if (anglePerStep <= 0) return;

                this._dragAccumAngle += deltaDeg;
                // 限制累计角度，到达档位两端后反向拖动可以立即响应
                const minAccum = -this._dragStartPosition * anglePerStep;
                const maxAccum = (numPositions - 1 - this._dragStartPosition) * anglePerStep;
                this._dragAccumAngle = clamp(this._dragAccumAngle, minAccum, maxAccum);

                const newPos = clamp(
                    this._dragStartPosition +
                        Math.round(this._dragAccumAngle / anglePerStep),
                    0,
                    numPositions - 1
                );
                if (newPos !== this.currentPosition) {
                    this.currentPosition = newPos;
                    this._updateKnobRotation();
                    emitChange();
                }
            },
            onEnd: () => {
                this._isDragging = false;
            },
        });

        // 存储清理引用
        this._knobCleanup = () => {
            removeDrag();
            this.knobContainer.removeEventListener('wheel', onWheel);
        };
    }

    getPosition() { return this.currentPosition; }
    getPositionName() { return this.positions[this.currentPosition]; }

    getOptions() {
        return {
            ...super.getOptions(),
            positions: [...this.positions],
            initialPosition: this.currentPosition,
            diameter: this.diameter,
            arcStartAngle: this.arcStartAngle,
            arcEndAngle: this.arcEndAngle,
        };
    }

    setPosition(posIndex) {
        const newPos = clamp(posIndex, 0, this.positions.length - 1);
        if (newPos !== this.currentPosition) {
            this.currentPosition = newPos;
            this._updateKnobRotation();
            this._emit('change', {
                cmpName: this.cmpName,
                position: this.currentPosition,
                positionName: this.positions[this.currentPosition],
            });
        }
    }

    // 兼容updateDisplay接口
    updateLights(upperLight, lowerLight) {}

    destroy() {
        if (this._knobCleanup) this._knobCleanup();
        super.destroy();
    }
}

// ==================== 旋钮 - 类型b (连续调节) ====================
export class KnobContinuous extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            minValue = 0,
            maxValue = 100,
            initialValue = 50,
            diameter = 50,
            arcStartAngle = 210,
            arcEndAngle = 330,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
            valueDisplayPrecision = 0,
        } = options;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.currentValue = clamp(initialValue, minValue, maxValue);
        this.diameter = diameter;
        this.arcStartAngle = arcStartAngle;
        this.arcEndAngle = arcEndAngle;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this.valueDisplayPrecision = valueDisplayPrecision;
        this._isDragging = false;
        this._dragAccumAngle = 0;
        this._dragStartValue = 0;

        this._buildKnob();
        this._updateKnobRotation();
    }

    _buildKnob() {
        this._renderLabel();

        const oldKnob = this.wrapperDiv.querySelector('.knob-container');
        if (oldKnob) oldKnob.remove();

        const containerSize = this.diameter + 36;
        this.knobContainer = document.createElement('div');
        this.knobContainer.className = 'knob-container';
        this.knobContainer.style.width = containerSize + 'px';
        this.knobContainer.style.height = containerSize + 'px';

        // 最小值/最大值标签
        const centerX = containerSize / 2;
        const centerY = containerSize / 2;
        const labelRadius = this.diameter / 2 + 14;

        const minAngleRad = (this.arcStartAngle - 90) * Math.PI / 180;
        const minLx = centerX + labelRadius * Math.cos(minAngleRad);
        const minLy = centerY + labelRadius * Math.sin(minAngleRad);
        this.minLabel = document.createElement('span');
        this.minLabel.className = 'knob-tick-label';
        this.minLabel.textContent = this.minValue.toFixed(this.valueDisplayPrecision);
        this.minLabel.style.left = minLx + 'px';
        this.minLabel.style.top = minLy + 'px';
        this.knobContainer.appendChild(this.minLabel);

        const maxAngleRad = (this.arcEndAngle - 90) * Math.PI / 180;
        const maxLx = centerX + labelRadius * Math.cos(maxAngleRad);
        const maxLy = centerY + labelRadius * Math.sin(maxAngleRad);
        this.maxLabel = document.createElement('span');
        this.maxLabel.className = 'knob-tick-label';
        this.maxLabel.textContent = this.maxValue.toFixed(this.valueDisplayPrecision);
        this.maxLabel.style.left = maxLx + 'px';
        this.maxLabel.style.top = maxLy + 'px';
        this.knobContainer.appendChild(this.maxLabel);

        // 当前值显示（中心）
        this.valueDisplay = document.createElement('span');
        this.valueDisplay.className = 'knob-tick-label active';
        this.valueDisplay.style.left = centerX + 'px';
        this.valueDisplay.style.top = (centerY - this.diameter / 2 - 8) + 'px';
        this.valueDisplay.textContent = this.currentValue.toFixed(this.valueDisplayPrecision);
        this.knobContainer.appendChild(this.valueDisplay);

        // 旋钮主体
        this.knobOuter = document.createElement('div');
        this.knobOuter.className = 'knob-outer';
        this.knobOuter.style.width = this.diameter + 'px';
        this.knobOuter.style.height = this.diameter + 'px';
        this.knobOuter.style.position = 'absolute';
        this.knobOuter.style.left = (containerSize / 2 - this.diameter / 2) + 'px';
        this.knobOuter.style.top = (containerSize / 2 - this.diameter / 2) + 'px';

        const innerSize = this.diameter * 0.55;
        this.knobInner = document.createElement('div');
        this.knobInner.className = 'knob-inner';
        this.knobInner.style.width = innerSize + 'px';
        this.knobInner.style.height = innerSize + 'px';

        this.indicatorLine = document.createElement('div');
        this.indicatorLine.className = 'knob-indicator';
        const indicatorHeight = this.diameter * 0.38;
        const indicatorWidth = Math.max(2, this.diameter * 0.05);
        this.indicatorLine.style.height = indicatorHeight + 'px';
        this.indicatorLine.style.width = indicatorWidth + 'px';
        this.indicatorLine.style.bottom = '50%';
        this.indicatorLine.style.left = '50%';
        this.indicatorLine.style.marginLeft = (-indicatorWidth / 2) + 'px';
        this.indicatorLine.style.transformOrigin = 'bottom center';
        this.indicatorLine.style.borderRadius = (indicatorWidth / 2) + 'px';

        this.knobOuter.appendChild(this.indicatorLine);
        this.knobOuter.appendChild(this.knobInner);
        this.knobContainer.appendChild(this.knobOuter);
        this.wrapperDiv.appendChild(this.knobContainer);

        this._bindKnobEvents();
    }

    _getAngleForValue(val) {
        return mapRange(val, this.minValue, this.maxValue, this.arcStartAngle, this.arcEndAngle);
    }

    _getValueForAngle(angleDeg) {
        return mapRange(angleDeg, this.arcStartAngle, this.arcEndAngle, this.minValue, this.maxValue);
    }

    _updateKnobRotation() {
        const angle = this._getAngleForValue(this.currentValue);
        if (this.indicatorLine) {
            this.indicatorLine.style.transform = `rotate(${angle}deg)`;
        }
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.currentValue.toFixed(this.valueDisplayPrecision);
        }
    }

    _bindKnobEvents() {
        if (!this.knobContainer) return;

        const emitChange = () => {
            this._emit('change', {
                cmpName: this.cmpName,
                value: this.currentValue,
            });
        };

        const onWheel = (e) => {
            e.preventDefault();
            const valueRange = this.maxValue - this.minValue;
            if (valueRange <= 0) return;
            const step = valueRange / 100;
            const newValue = clamp(
                this.currentValue + (e.deltaY > 0 ? step : -step),
                this.minValue,
                this.maxValue
            );
            if (Math.abs(newValue - this.currentValue) > 0.0001) {
                this.currentValue = newValue;
                this._updateKnobRotation();
                emitChange();
            }
        };
        this.knobContainer.addEventListener('wheel', onWheel, { passive: false });

        // 相对角度拖拽：不再把指针角度限制在旋钮刻度范围内，
        // 因此指针移到远处甚至绕过多圈时依然可以连续调节。
        const removeDrag = bindRotaryDrag(this.knobContainer, {
            onStart: () => {
                this._isDragging = true;
                this._dragStartValue = this.currentValue;
                this._dragAccumAngle = 0;
            },
            onRotate: (deltaDeg) => {
                const totalAngleRange = Math.abs(this.arcEndAngle - this.arcStartAngle);
                const valueRange = this.maxValue - this.minValue;
                if (totalAngleRange <= 0 || valueRange <= 0) return;

                const valuePerDegree = valueRange / totalAngleRange;
                const minAccum = (this.minValue - this._dragStartValue) / valuePerDegree;
                const maxAccum = (this.maxValue - this._dragStartValue) / valuePerDegree;

                this._dragAccumAngle = clamp(
                    this._dragAccumAngle + deltaDeg,
                    minAccum,
                    maxAccum
                );
                const newValue = clamp(
                    this._dragStartValue + this._dragAccumAngle * valuePerDegree,
                    this.minValue,
                    this.maxValue
                );
                if (Math.abs(newValue - this.currentValue) > 0.0001) {
                    this.currentValue = newValue;
                    this._updateKnobRotation();
                    emitChange();
                }
            },
            onEnd: () => {
                this._isDragging = false;
            },
        });

        this._knobCleanup = () => {
            removeDrag();
            this.knobContainer.removeEventListener('wheel', onWheel);
        };
    }

    getValue() { return this.currentValue; }

    getOptions() {
        return {
            ...super.getOptions(),
            minValue: this.minValue,
            maxValue: this.maxValue,
            initialValue: this.currentValue,
            diameter: this.diameter,
            arcStartAngle: this.arcStartAngle,
            arcEndAngle: this.arcEndAngle,
            valueDisplayPrecision: this.valueDisplayPrecision,
        };
    }

    setValue(val) {
        const newVal = clamp(val, this.minValue, this.maxValue);
        if (Math.abs(newVal - this.currentValue) > 0.0001) {
            this.currentValue = newVal;
            this._updateKnobRotation();
            this._emit('change', {
                cmpName: this.cmpName,
                value: this.currentValue,
            });
        }
    }

    updateLights(upperLight, lowerLight) {}

    destroy() {
        if (this._knobCleanup) this._knobCleanup();
        super.destroy();
    }
}

// ==================== 拨杆组件 ====================
export class Lever extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            positions = ['DOWN', 'CENTER', 'UP'],
            initialPosition = 0,
            orientation = 'vertical',
            slotLength = 100,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
        } = options;
        this.positions = positions;
        this.currentPosition = clamp(initialPosition, 0, positions.length - 1);
        this.orientation = orientation; // 'vertical' 或 'horizontal'
        this.slotLength = slotLength;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this._isDragging = false;

        this._buildLever();
        this._updateHandlePosition();
    }

    _buildLever() {
        this._renderLabel();

        const oldLever = this.wrapperDiv.querySelector('.lever-container');
        if (oldLever) oldLever.remove();

        const isVertical = this.orientation === 'vertical';
        const containerWidth = isVertical ? 60 : this.slotLength + 40;
        const containerHeight = isVertical ? this.slotLength + 40 : 60;

        this.leverContainer = document.createElement('div');
        this.leverContainer.className = 'lever-container';
        this.leverContainer.style.width = containerWidth + 'px';
        this.leverContainer.style.height = containerHeight + 'px';

        // 槽道
        this.slotEl = document.createElement('div');
        this.slotEl.className = 'lever-slot ' + (isVertical ? 'vertical' : 'horizontal');
        if (isVertical) {
            this.slotEl.style.height = this.slotLength + 'px';
            this.slotEl.style.width = '22px';
        } else {
            this.slotEl.style.width = this.slotLength + 'px';
            this.slotEl.style.height = '22px';
        }
        this.slotEl.style.position = 'relative';

        // 刻度标记和标签
        this._tickLabelEls = [];
        const numPositions = this.positions.length;
        const slotInnerLength = this.slotLength - 16;

        for (let i = 0; i < numPositions; i++) {
            const frac = numPositions > 1 ? i / (numPositions - 1) : 0.5;
            const pos = 8 + frac * slotInnerLength;

            // 刻度标记
            const tickMark = document.createElement('div');
            tickMark.className = 'lever-tick-mark';
            if (isVertical) {
                tickMark.style.top = pos + 'px';
            } else {
                tickMark.style.left = pos + 'px';
            }
            this.slotEl.appendChild(tickMark);

            // 标签
            const tickLabel = document.createElement('span');
            tickLabel.className = 'lever-tick-label';
            tickLabel.textContent = this.positions[i];
            if (isVertical) {
                tickLabel.style.top = pos + 'px';
            } else {
                tickLabel.style.left = pos + 'px';
            }
            if (i === this.currentPosition) {
                tickLabel.classList.add('active');
            }
            this.slotEl.appendChild(tickLabel);
            this._tickLabelEls.push(tickLabel);
        }

        // 手柄
        this.handleEl = document.createElement('div');
        this.handleEl.className = 'lever-handle';
        this.slotEl.appendChild(this.handleEl);

        this.leverContainer.appendChild(this.slotEl);
        this.wrapperDiv.appendChild(this.leverContainer);

        this._bindLeverEvents();
    }

    _getHandlePositionForIndex(posIndex) {
        const numPositions = this.positions.length;
        const slotInnerLength = this.slotLength - 16;
        const frac = numPositions > 1 ? posIndex / (numPositions - 1) : 0.5;
        return 8 + frac * slotInnerLength;
    }

    _getIndexForHandlePosition(handlePos) {
        const numPositions = this.positions.length;
        const slotInnerLength = this.slotLength - 16;
        const frac = (handlePos - 8) / slotInnerLength;
        return Math.round(clamp(frac, 0, 1) * (numPositions - 1));
    }

    _updateHandlePosition() {
        if (!this.handleEl) return;
        const pos = this._getHandlePositionForIndex(this.currentPosition);
        const isVertical = this.orientation === 'vertical';
        if (isVertical) {
            this.handleEl.style.top = pos + 'px';
            this.handleEl.style.left = '50%';
            this.handleEl.style.transform = 'translate(-50%, -50%)';
        } else {
            this.handleEl.style.left = pos + 'px';
            this.handleEl.style.top = '50%';
            this.handleEl.style.transform = 'translate(-50%, -50%)';
        }
        // 更新标签高亮
        if (this._tickLabelEls) {
            this._tickLabelEls.forEach((el, i) => {
                if (i === this.currentPosition) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }
    }

    _bindLeverEvents() {
        if (!this.slotEl || !this.handleEl) return;
        const isVertical = this.orientation === 'vertical';

        const getLocalPosition = (e) => {
            const rect = this.slotEl.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (isVertical) {
                return clientY - rect.top;
            } else {
                return clientX - rect.left;
            }
        };

        const updateFromPosition = (localPos) => {
            const newIndex = this._getIndexForHandlePosition(clamp(localPos, 8, this.slotLength -
                8));
            if (newIndex !== this.currentPosition) {
                this.currentPosition = newIndex;
                this._updateHandlePosition();
                this._emit('change', {
                    cmpName: this.cmpName,
                    position: this.currentPosition,
                    positionName: this.positions[this.currentPosition],
                });
            }
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            this._isDragging = true;
            const localPos = getLocalPosition(e);
            updateFromPosition(localPos);
            this.handleEl.style.cursor = 'grabbing';
            document.body.style.cursor = 'grabbing';
        };

        const onPointerMove = (e) => {
            if (!this._isDragging) return;
            e.preventDefault();
            const localPos = getLocalPosition(e);
            updateFromPosition(localPos);
        };

        const onPointerUp = () => {
            if (!this._isDragging) return;
            this._isDragging = false;
            this.handleEl.style.cursor = 'grab';
            document.body.style.cursor = '';
        };

        this.slotEl.addEventListener('mousedown', onPointerDown);
        this.slotEl.addEventListener('touchstart', onPointerDown, { passive: false });
        this.handleEl.addEventListener('mousedown', onPointerDown);
        this.handleEl.addEventListener('touchstart', onPointerDown, { passive: false });
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('mouseup', onPointerUp);
        window.addEventListener('touchend', onPointerUp);

        // 滚轮
        this.slotEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const numPositions = this.positions.length;
            if (e.deltaY > 0) {
                this.currentPosition = clamp(this.currentPosition + 1, 0, numPositions - 1);
            } else {
                this.currentPosition = clamp(this.currentPosition - 1, 0, numPositions - 1);
            }
            this._updateHandlePosition();
            this._emit('change', {
                cmpName: this.cmpName,
                position: this.currentPosition,
                positionName: this.positions[this.currentPosition],
            });
        }, { passive: false });

        this._leverCleanup = () => {
            window.removeEventListener('mousemove', onPointerMove);
            window.removeEventListener('touchmove', onPointerMove);
            window.removeEventListener('mouseup', onPointerUp);
            window.removeEventListener('touchend', onPointerUp);
        };
    }

    getPosition() { return this.currentPosition; }
    getPositionName() { return this.positions[this.currentPosition]; }

    getOptions() {
        return {
            ...super.getOptions(),
            positions: [...this.positions],
            initialPosition: this.currentPosition,
            orientation: this.orientation,
            slotLength: this.slotLength,
        };
    }

    setPosition(posIndex) {
        const newPos = clamp(posIndex, 0, this.positions.length - 1);
        if (newPos !== this.currentPosition) {
            this.currentPosition = newPos;
            this._updateHandlePosition();
            this._emit('change', {
                cmpName: this.cmpName,
                position: this.currentPosition,
                positionName: this.positions[this.currentPosition],
            });
        }
    }

    updateLights(upperLight, lowerLight) {}

    destroy() {
        if (this._leverCleanup) this._leverCleanup();
        super.destroy();
    }
}

// ==================== 连续调节拨杆 ====================
export class LeverContinuous extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            minValue = 0,
            maxValue = 100,
            initialValue = 50,
            orientation = 'vertical',
            slotLength = 100,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
            valueDisplayPrecision = 0,
        } = options;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.currentValue = clamp(initialValue, minValue, maxValue);
        this.orientation = orientation;
        this.slotLength = slotLength;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this.valueDisplayPrecision = valueDisplayPrecision;
        this._isDragging = false;

        this._buildLever();
        this._updateHandlePosition();
    }

    _buildLever() {
        this._renderLabel();

        const oldLever = this.wrapperDiv.querySelector('.lever-container');
        if (oldLever) oldLever.remove();

        const isVertical = this.orientation === 'vertical';
        const containerWidth = isVertical ? 60 : this.slotLength + 40;
        const containerHeight = isVertical ? this.slotLength + 40 : 60;

        this.leverContainer = document.createElement('div');
        this.leverContainer.className = 'lever-container';
        this.leverContainer.style.width = containerWidth + 'px';
        this.leverContainer.style.height = containerHeight + 'px';

        // 槽道
        this.slotEl = document.createElement('div');
        this.slotEl.className = 'lever-slot ' + (isVertical ? 'vertical' : 'horizontal');
        if (isVertical) {
            this.slotEl.style.height = this.slotLength + 'px';
            this.slotEl.style.width = '22px';
        } else {
            this.slotEl.style.width = this.slotLength + 'px';
            this.slotEl.style.height = '22px';
        }
        this.slotEl.style.position = 'relative';

        // 最小/最大值标签（显示在槽道两端）
        const minLabel = document.createElement('span');
        minLabel.className = 'lever-tick-label';
        minLabel.textContent = this.minValue.toFixed(this.valueDisplayPrecision);
        const maxLabel = document.createElement('span');
        maxLabel.className = 'lever-tick-label';
        maxLabel.textContent = this.maxValue.toFixed(this.valueDisplayPrecision);

        if (isVertical) {
            minLabel.style.top = '8px';
            maxLabel.style.bottom = '8px';
            minLabel.style.left = 'calc(100% + 10px)';
            maxLabel.style.left = 'calc(100% + 10px)';
        } else {
            minLabel.style.left = '8px';
            maxLabel.style.right = '8px';
            minLabel.style.top = 'calc(100% + 8px)';
            maxLabel.style.top = 'calc(100% + 8px)';
        }
        this.slotEl.appendChild(minLabel);
        this.slotEl.appendChild(maxLabel);

        // 当前值显示（手柄旁边）
        this.valueDisplay = document.createElement('span');
        this.valueDisplay.className = 'lever-tick-label active';
        if (isVertical) {
            this.valueDisplay.style.left = 'calc(100% + 10px)';
        } else {
            this.valueDisplay.style.top = 'calc(100% + 8px)';
        }
        this.slotEl.appendChild(this.valueDisplay);

        // 手柄
        this.handleEl = document.createElement('div');
        this.handleEl.className = 'lever-handle';
        this.slotEl.appendChild(this.handleEl);

        this.leverContainer.appendChild(this.slotEl);
        this.wrapperDiv.appendChild(this.leverContainer);

        this._bindLeverEvents();
    }

    _getHandlePositionForValue(val) {
        const isVertical = this.orientation === 'vertical';
        const slotInnerLength = this.slotLength - 16;
        const frac = (val - this.minValue) / (this.maxValue - this.minValue);
        return 8 + frac * slotInnerLength;
    }

    _getValueForHandlePosition(handlePos) {
        const slotInnerLength = this.slotLength - 16;
        const frac = (handlePos - 8) / slotInnerLength;
        return this.minValue + frac * (this.maxValue - this.minValue);
    }

    _updateHandlePosition() {
        if (!this.handleEl) return;
        const pos = this._getHandlePositionForValue(this.currentValue);
        const isVertical = this.orientation === 'vertical';
        if (isVertical) {
            this.handleEl.style.top = pos + 'px';
            this.handleEl.style.left = '50%';
            this.handleEl.style.transform = 'translate(-50%, -50%)';
        } else {
            this.handleEl.style.left = pos + 'px';
            this.handleEl.style.top = '50%';
            this.handleEl.style.transform = 'translate(-50%, -50%)';
        }
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.currentValue.toFixed(this.valueDisplayPrecision);
            if (isVertical) {
                this.valueDisplay.style.top = pos + 'px';
                this.valueDisplay.style.transform = 'translateY(-50%)';
            } else {
                this.valueDisplay.style.left = pos + 'px';
                this.valueDisplay.style.transform = 'translateX(-50%)';
            }
        }
    }

    _bindLeverEvents() {
        if (!this.slotEl || !this.handleEl) return;
        const isVertical = this.orientation === 'vertical';

        const getLocalPosition = (e) => {
            const rect = this.slotEl.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (isVertical) {
                return clientY - rect.top;
            } else {
                return clientX - rect.left;
            }
        };

        const updateFromPosition = (localPos) => {
            const clampedPos = clamp(localPos, 8, this.slotLength - 8);
            const newValue = clamp(
                this._getValueForHandlePosition(clampedPos),
                this.minValue,
                this.maxValue
            );
            if (Math.abs(newValue - this.currentValue) > 0.0001) {
                this.currentValue = newValue;
                this._updateHandlePosition();
                this._emit('change', {
                    cmpName: this.cmpName,
                    value: this.currentValue,
                });
            }
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            this._isDragging = true;
            updateFromPosition(getLocalPosition(e));
            this.handleEl.style.cursor = 'grabbing';
            document.body.style.cursor = 'grabbing';
        };

        const onPointerMove = (e) => {
            if (!this._isDragging) return;
            e.preventDefault();
            updateFromPosition(getLocalPosition(e));
        };

        const onPointerUp = () => {
            if (!this._isDragging) return;
            this._isDragging = false;
            this.handleEl.style.cursor = 'grab';
            document.body.style.cursor = '';
        };

        this.slotEl.addEventListener('mousedown', onPointerDown);
        this.slotEl.addEventListener('touchstart', onPointerDown, { passive: false });
        this.handleEl.addEventListener('mousedown', onPointerDown);
        this.handleEl.addEventListener('touchstart', onPointerDown, { passive: false });
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('mouseup', onPointerUp);
        window.addEventListener('touchend', onPointerUp);

        this.slotEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const range = this.maxValue - this.minValue;
            const step = range / 200;
            const delta = e.deltaY > 0 ? -step : step;
            const newValue = clamp(this.currentValue + delta, this.minValue, this.maxValue);
            if (Math.abs(newValue - this.currentValue) > 0.0001) {
                this.currentValue = newValue;
                this._updateHandlePosition();
                this._emit('change', {
                    cmpName: this.cmpName,
                    value: this.currentValue,
                });
            }
        }, { passive: false });

        this._leverCleanup = () => {
            window.removeEventListener('mousemove', onPointerMove);
            window.removeEventListener('touchmove', onPointerMove);
            window.removeEventListener('mouseup', onPointerUp);
            window.removeEventListener('touchend', onPointerUp);
        };
    }

    getValue() { return this.currentValue; }

    getOptions() {
        return {
            ...super.getOptions(),
            minValue: this.minValue,
            maxValue: this.maxValue,
            initialValue: this.currentValue,
            orientation: this.orientation,
            slotLength: this.slotLength,
            valueDisplayPrecision: this.valueDisplayPrecision,
        };
    }

    setValue(val) {
        const newVal = clamp(val, this.minValue, this.maxValue);
        if (Math.abs(newVal - this.currentValue) > 0.0001) {
            this.currentValue = newVal;
            this._updateHandlePosition();
            this._emit('change', {
                cmpName: this.cmpName,
                value: this.currentValue,
            });
        }
    }

    updateLights(upperLight, lowerLight) {}

    destroy() {
        if (this._leverCleanup) this._leverCleanup();
        super.destroy();
    }
}

// ==================== 无限调节旋钮 ====================
export class KnobInfinite extends BaseComponent {
    constructor(cmpName, options = {}) {
        super(cmpName, options);
        const {
            initialValue = 0,
            valuePerRevolution = 100, // 每360度数值变化量
            diameter = 50,
            label = '',
            labelPosition = 'top',
            labelOrientation = 'horizontal',
            valueDisplayPrecision = 0,
        } = options;
        this.currentValue = initialValue;
        this.valuePerRevolution = valuePerRevolution;
        this.diameter = diameter;
        this.labelText = label;
        this.labelPosition = normalizeLabelPosition(labelPosition);
        this.labelOrientation = normalizeLabelOrientation(labelOrientation);
        this.valueDisplayPrecision = valueDisplayPrecision;
        this._isDragging = false;

        this._buildKnob();
        this._updateKnobRotation();
    }

    _buildKnob() {
        this._renderLabel();

        const oldKnob = this.wrapperDiv.querySelector('.knob-container');
        if (oldKnob) oldKnob.remove();

        const containerSize = this.diameter + 36;
        this.knobContainer = document.createElement('div');
        this.knobContainer.className = 'knob-container';
        this.knobContainer.style.width = containerSize + 'px';
        this.knobContainer.style.height = containerSize + 'px';

        // 当前值显示（上方居中）
        this.valueDisplay = document.createElement('span');
        this.valueDisplay.className = 'knob-tick-label active';
        this.valueDisplay.style.left = '50%';
        this.valueDisplay.style.top = (containerSize / 2 - this.diameter / 2 - 10) + 'px';
        this.valueDisplay.style.transform = 'translateX(-50%)';
        this.valueDisplay.textContent = this.currentValue.toFixed(this.valueDisplayPrecision);
        this.knobContainer.appendChild(this.valueDisplay);

        // 旋钮主体
        this.knobOuter = document.createElement('div');
        this.knobOuter.className = 'knob-outer';
        this.knobOuter.style.width = this.diameter + 'px';
        this.knobOuter.style.height = this.diameter + 'px';
        this.knobOuter.style.position = 'absolute';
        this.knobOuter.style.left = (containerSize / 2 - this.diameter / 2) + 'px';
        this.knobOuter.style.top = (containerSize / 2 - this.diameter / 2) + 'px';

        const innerSize = this.diameter * 0.55;
        this.knobInner = document.createElement('div');
        this.knobInner.className = 'knob-inner';
        this.knobInner.style.width = innerSize + 'px';
        this.knobInner.style.height = innerSize + 'px';

        this.indicatorLine = document.createElement('div');
        this.indicatorLine.className = 'knob-indicator';
        const indicatorHeight = this.diameter * 0.38;
        const indicatorWidth = Math.max(2, this.diameter * 0.05);
        this.indicatorLine.style.height = indicatorHeight + 'px';
        this.indicatorLine.style.width = indicatorWidth + 'px';
        this.indicatorLine.style.bottom = '50%';
        this.indicatorLine.style.left = '50%';
        this.indicatorLine.style.marginLeft = (-indicatorWidth / 2) + 'px';
        this.indicatorLine.style.transformOrigin = 'bottom center';
        this.indicatorLine.style.borderRadius = (indicatorWidth / 2) + 'px';

        this.knobOuter.appendChild(this.indicatorLine);
        this.knobOuter.appendChild(this.knobInner);
        this.knobContainer.appendChild(this.knobOuter);
        this.wrapperDiv.appendChild(this.knobContainer);

        this._bindKnobEvents();
    }

    _updateKnobRotation() {
        // 根据累计角度旋转指示器（无上限，但CSS旋转角度可以任意大）
        const totalAngleDeg = (this.currentValue / this.valuePerRevolution) * 360;
        if (this.indicatorLine) {
            this.indicatorLine.style.transform = `rotate(${totalAngleDeg}deg)`;
        }
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.currentValue.toFixed(this.valueDisplayPrecision);
        }
    }

    _bindKnobEvents() {
        if (!this.knobContainer) return;

        const emitChange = () => {
            this._emit('change', {
                cmpName: this.cmpName,
                value: this.currentValue,
            });
        };

        // 滚轮支持
        const onWheel = (e) => {
            e.preventDefault();
            const step = this.valuePerRevolution / 360; // 每度对应值
            const delta = e.deltaY > 0 ? -step * 15 : step * 15; // 一次滚轮约15度
            this.currentValue += delta;
            this._updateKnobRotation();
            emitChange();
        };
        this.knobContainer.addEventListener('wheel', onWheel, { passive: false });

        // 无限旋钮：累计相对角度增量，指针离得再远也能继续旋转
        const removeDrag = bindRotaryDrag(this.knobContainer, {
            onStart: () => {
                this._isDragging = true;
            },
            onRotate: (deltaDeg) => {
                const deltaValue = (deltaDeg / 360) * this.valuePerRevolution;
                this.currentValue += deltaValue;
                this._updateKnobRotation();
                emitChange();
            },
            onEnd: () => {
                this._isDragging = false;
            },
        });

        this._knobCleanup = () => {
            removeDrag();
            this.knobContainer.removeEventListener('wheel', onWheel);
        };
    }

    getValue() { return this.currentValue; }

    getOptions() {
        return {
            ...super.getOptions(),
            initialValue: this.currentValue,
            valuePerRevolution: this.valuePerRevolution,
            diameter: this.diameter,
            valueDisplayPrecision: this.valueDisplayPrecision,
        };
    }

    setValue(val) {
        if (Math.abs(val - this.currentValue) > 0.0001) {
            this.currentValue = val;
            this._updateKnobRotation();
            this._emit('change', {
                cmpName: this.cmpName,
                value: this.currentValue,
            });
        }
    }

    updateLights(upperLight, lowerLight) {}

    destroy() {
        if (this._knobCleanup) this._knobCleanup();
        super.destroy();
    }
}

// ==================== 全局 updateDisplay 函数 ====================
export const updateDisplay = function(params) {
    if (!params || !params.cmpName) {
        console.warn('updateDisplay: 缺少 cmpName 参数');
        return;
    }
    const component = getComponentByName(params.cmpName);
    if (!component) {
        console.warn(`updateDisplay: 未找到组件 "${params.cmpName}"`);
        return;
    }

    let handled = false;
    if (Array.isArray(params.lights) && typeof component.setBrightnesses === 'function') {
        component.setBrightnesses(params.lights);
        handled = true;
    } else if (params.lightIndex !== undefined &&
        typeof component.setLightBrightness === 'function') {
        component.setLightBrightness(
            params.lightIndex,
            params.brightness !== undefined ? params.brightness : 100
        );
        handled = true;
    }

    if (!handled && typeof component.updateLights === 'function') {
        component.updateLights(params.upperLight, params.lowerLight);
    } else if (!handled) {
        console.warn(`updateDisplay: 组件 "${params.cmpName}" 不支持指示灯更新`);
    }
};

// ==================== 组件工厂 ====================
const COMPONENT_CLASS_MAP = {
    Display,
    ButtonSimple,
    ButtonWithLights,
    IndicatorLight,
    IndicatorLightGroup,
    KnobDiscrete,
    KnobContinuous,
    KnobInfinite,
    Lever,
    LeverContinuous,
};

export function createComponentInstance(type, cmpName, options = {}) {
    const ComponentClass = COMPONENT_CLASS_MAP[type];
    if (!ComponentClass) {
        throw new Error(`未知组件类型: ${type}`);
    }
    return new ComponentClass(cmpName, options);
}

export function getComponentTypes() {
    return Object.keys(COMPONENT_CLASS_MAP);
}

// ==================== 项目挂载 ====================
let mountProjectSequence = 0;

/**
 * 根据项目 JSON 创建所有面板与组件。
 *
 * @param {HTMLElement|string} container 挂载容器（元素或元素 id）
 * @param {object} project 项目 JSON
 * @param {{displayRenderers?: Record<string, Function>}} options 显示屏绘制回调
 * @returns {{root: HTMLElement, panels: Map, components: Map}}
 */
export function mountProject(container, project = {}, options = {}) {
    const target = typeof container === 'string'
        ? document.getElementById(container)
        : container;
    if (!target) {
        throw new Error('mountProject: 找不到挂载容器');
    }

    const sequence = ++mountProjectSequence;
    const root = document.createElement('div');
    root.className = 'main-panel-div';
    root.style.display = 'flex';
    root.style.flexWrap = 'wrap';
    root.style.gap = '30px';
    root.style.alignItems = 'flex-start';
    target.appendChild(root);

    const panels = new Map();
    const components = new Map();
    const displayRenderers = options.displayRenderers || {};

    (project.panels || []).forEach((panelData, panelIndex) => {
        const host = document.createElement('div');
        host.id = `cockpit-panel-host-${sequence}-${panelIndex}`;
        root.appendChild(host);

        const panel = new Panel(host.id, {
            columns: panelData.columns,
            rows: panelData.rows,
            cellSize: panelData.cellSize,
            gap: panelData.gap,
            panelId: panelData.id,
        });
        panels.set(panelData.id, panel);

        (panelData.components || []).forEach((componentData) => {
            const component = createComponentInstance(
                componentData.type,
                componentData.id,
                componentData.props || {}
            );
            panel.addComponent(component, componentData.grid || {});
            components.set(componentData.id, component);

            if (componentData.type === 'Display' &&
                typeof displayRenderers[componentData.id] === 'function') {
                try {
                    displayRenderers[componentData.id](component);
                } catch (error) {
                    console.error(`显示屏 ${componentData.id} 绘制失败:`, error);
                }
            }
        });
    });

    return { root, panels, components };
}

// ==================== 导出 ====================
