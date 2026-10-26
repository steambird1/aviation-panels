// ==================== 编辑器组件元数据 / 项目模型 ====================

export const PROJECT_VERSION = 1;
export const STORAGE_KEY = 'cockpit-editor.project.v1';

export const LABEL_POSITION_OPTIONS = [
    { value: 'top', label: '上方' },
    { value: 'bottom', label: '下方' },
    { value: 'left', label: '左侧' },
    { value: 'right', label: '右侧' },
];

export const LABEL_ORIENTATION_OPTIONS = [
    { value: 'horizontal', label: '横排' },
    { value: 'vertical', label: '竖排' },
];

export const LEVER_ORIENTATION_OPTIONS = [
    { value: 'vertical', label: '垂直' },
    { value: 'horizontal', label: '水平' },
];

export const COLOR_SUGGESTIONS = ['green', 'amber', 'blue', 'red', 'white', 'cyan'];

const LABEL_FIELDS = [
    { key: 'label', label: '标签文本', type: 'text', placeholder: '留空则不显示' },
    { key: 'labelPosition', label: '标签位置', type: 'select', options: LABEL_POSITION_OPTIONS },
    {
        key: 'labelOrientation',
        label: '标签方向',
        type: 'select',
        options: LABEL_ORIENTATION_OPTIONS,
        hint: '仅在标签位于左侧/右侧时生效',
    },
];

const GUARD_FIELD = {
    key: 'guard',
    label: '带盖板',
    type: 'boolean',
    hint: '开启后需要先打开盖板才能操作',
};

function withLabelFields(fields) {
    return [...fields, ...LABEL_FIELDS];
}

const NUMBER = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });
const COLOR = (key, label) => ({
    key, label, type: 'color', suggestions: COLOR_SUGGESTIONS,
});

export const COMPONENT_TYPES = {
    ButtonSimple: {
        label: '普通按钮',
        shortLabel: '按钮',
        group: 'buttons',
        prefix: 'btn',
        icon: '▭',
        defaultGrid: { colSpan: 2, rowSpan: 1 },
        defaults: {
            text: 'BTN',
            guard: false,
            label: 'BUTTON',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            { key: 'text', label: '按键文本', type: 'text', placeholder: '例如 AP1' },
            GUARD_FIELD,
        ]),
    },

    ButtonWithLights: {
        label: '带灯按钮',
        shortLabel: '灯按钮',
        group: 'buttons',
        prefix: 'btnlight',
        icon: '▤',
        defaultGrid: { colSpan: 2, rowSpan: 1 },
        defaults: {
            text: 'BTN',
            upperLightColor: 'green',
            lowerLightColor: 'amber',
            upperLightText: 'ON',
            lowerLightText: 'FAULT',
            initialUpperBrightness: 0,
            initialLowerBrightness: 0,
            guard: false,
            label: 'BUTTON',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            { key: 'text', label: '按键文本', type: 'text' },
            COLOR('upperLightColor', '上方灯颜色'),
            { key: 'upperLightText', label: '上方灯文本', type: 'text' },
            NUMBER('initialUpperBrightness', '上方灯亮度', { min: 0, max: 100, step: 1 }),
            COLOR('lowerLightColor', '下方灯颜色'),
            { key: 'lowerLightText', label: '下方灯文本', type: 'text' },
            NUMBER('initialLowerBrightness', '下方灯亮度', { min: 0, max: 100, step: 1 }),
            GUARD_FIELD,
        ]),
    },

    IndicatorLight: {
        label: '指示灯',
        shortLabel: '指示灯',
        group: 'lights',
        prefix: 'light',
        icon: '●',
        defaultGrid: { colSpan: 2, rowSpan: 1 },
        defaults: {
            text: 'LIGHT',
            backgroundColor: 'green',
            foregroundColor: 'white',
            initialBrightness: 0,
            guard: false,
            label: 'INDICATOR',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            { key: 'text', label: '灯内文本', type: 'text' },
            COLOR('backgroundColor', '背景 / 发光颜色'),
            COLOR('foregroundColor', '前景 / 文字颜色'),
            NUMBER('initialBrightness', '亮度', { min: 0, max: 100, step: 1 }),
            GUARD_FIELD,
        ]),
    },

    IndicatorLightGroup: {
        label: '指示灯组',
        shortLabel: '灯组',
        group: 'lights',
        prefix: 'lightgroup',
        icon: '▦',
        defaultGrid: { colSpan: 3, rowSpan: 3 },
        defaults: {
            rows: 3,
            columns: 3,
            texts: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
            brightness: [80, 0, 0, 0, 80, 0, 0, 0, 80],
            backgroundColor: 'green',
            foregroundColor: 'white',
            gap: 4,
            fontSize: 8,
            label: 'LIGHT GROUP',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            NUMBER('rows', '行数', { min: 1, max: 8, step: 1, integer: true }),
            NUMBER('columns', '列数', { min: 1, max: 8, step: 1, integer: true }),
            NUMBER('gap', '灯间距 (px)', { min: 0, max: 20, step: 1, integer: true }),
            NUMBER('fontSize', '灯内文字大小 (px)', { min: 5, max: 24, step: 1, integer: true }),
            { key: 'texts', label: '灯光文本', type: 'array', hint: '按行优先排列，用英文逗号分隔' },
            {
                key: 'brightness',
                label: '初始亮度',
                type: 'numberArray',
                min: 0,
                max: 100,
                step: 1,
                integer: true,
                hint: '按行优先排列，0 为熄灭，100 为最亮；缺少的灯为熄灭',
            },
            COLOR('backgroundColor', '背景 / 发光颜色'),
            COLOR('foregroundColor', '前景 / 文字颜色'),
        ]),
    },

    KnobDiscrete: {
        label: '离散旋钮',
        shortLabel: '离散旋钮',
        group: 'knobs',
        prefix: 'knob',
        icon: '◉',
        defaultGrid: { colSpan: 2, rowSpan: 2 },
        defaults: {
            positions: ['OFF', 'AUTO', 'ON'],
            initialPosition: 1,
            diameter: 50,
            arcStartAngle: 210,
            arcEndAngle: 330,
            guard: false,
            label: 'KNOB',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            { key: 'positions', label: '档位', type: 'array', hint: '用英文逗号分隔，例如 OFF, AUTO, ON' },
            NUMBER('initialPosition', '初始档位索引', { min: 0, step: 1, integer: true }),
            NUMBER('diameter', '直径 (px)', { min: 24, max: 160, step: 1, integer: true }),
            NUMBER('arcStartAngle', '起始角度', { min: -360, max: 360, step: 1 }),
            NUMBER('arcEndAngle', '结束角度', { min: -360, max: 360, step: 1 }),
            GUARD_FIELD,
        ]),
    },

    KnobContinuous: {
        label: '连续旋钮',
        shortLabel: '连续旋钮',
        group: 'knobs',
        prefix: 'knob',
        icon: '◎',
        defaultGrid: { colSpan: 2, rowSpan: 2 },
        defaults: {
            minValue: 0,
            maxValue: 100,
            initialValue: 50,
            diameter: 50,
            arcStartAngle: 210,
            arcEndAngle: 330,
            valueDisplayPrecision: 0,
            guard: false,
            label: 'KNOB',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            NUMBER('minValue', '最小值', { step: 1 }),
            NUMBER('maxValue', '最大值', { step: 1 }),
            NUMBER('initialValue', '初始值', { step: 1 }),
            NUMBER('diameter', '直径 (px)', { min: 24, max: 160, step: 1, integer: true }),
            NUMBER('arcStartAngle', '起始角度', { min: -360, max: 360, step: 1 }),
            NUMBER('arcEndAngle', '结束角度', { min: -360, max: 360, step: 1 }),
            NUMBER('valueDisplayPrecision', '小数位', { min: 0, max: 4, step: 1, integer: true }),
            GUARD_FIELD,
        ]),
    },

    KnobInfinite: {
        label: '无限旋钮',
        shortLabel: '无限旋钮',
        group: 'knobs',
        prefix: 'knob',
        icon: '◌',
        defaultGrid: { colSpan: 2, rowSpan: 2 },
        defaults: {
            initialValue: 0,
            valuePerRevolution: 100,
            diameter: 50,
            valueDisplayPrecision: 0,
            guard: false,
            label: 'KNOB',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            NUMBER('initialValue', '初始值', { step: 1 }),
            NUMBER('valuePerRevolution', '每圈变化量', { step: 1 }),
            NUMBER('diameter', '直径 (px)', { min: 24, max: 160, step: 1, integer: true }),
            NUMBER('valueDisplayPrecision', '小数位', { min: 0, max: 4, step: 1, integer: true }),
            GUARD_FIELD,
        ]),
    },

    Lever: {
        label: '离散拨杆',
        shortLabel: '拨杆',
        group: 'levers',
        prefix: 'lever',
        icon: '⇕',
        defaultGrid: { colSpan: 1, rowSpan: 3 },
        defaults: {
            positions: ['DOWN', 'UP'],
            initialPosition: 0,
            orientation: 'vertical',
            slotLength: 90,
            label: 'LEVER',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            { key: 'positions', label: '档位', type: 'array', hint: '用英文逗号分隔' },
            NUMBER('initialPosition', '初始档位索引', { min: 0, step: 1, integer: true }),
            { key: 'orientation', label: '拨杆方向', type: 'select', options: LEVER_ORIENTATION_OPTIONS },
            NUMBER('slotLength', '槽道长度 (px)', { min: 40, max: 240, step: 1, integer: true }),
        ]),
    },

    LeverContinuous: {
        label: '连续拨杆',
        shortLabel: '连续拨杆',
        group: 'levers',
        prefix: 'lever',
        icon: '↕',
        defaultGrid: { colSpan: 4, rowSpan: 1 },
        defaults: {
            minValue: 0,
            maxValue: 100,
            initialValue: 50,
            orientation: 'horizontal',
            slotLength: 100,
            valueDisplayPrecision: 0,
            label: 'LEVER',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            NUMBER('minValue', '最小值', { step: 1 }),
            NUMBER('maxValue', '最大值', { step: 1 }),
            NUMBER('initialValue', '初始值', { step: 1 }),
            { key: 'orientation', label: '拨杆方向', type: 'select', options: LEVER_ORIENTATION_OPTIONS },
            NUMBER('slotLength', '槽道长度 (px)', { min: 40, max: 240, step: 1, integer: true }),
            NUMBER('valueDisplayPrecision', '小数位', { min: 0, max: 4, step: 1, integer: true }),
        ]),
    },

    Display: {
        label: '显示屏',
        shortLabel: '显示屏',
        group: 'displays',
        prefix: 'display',
        icon: '▣',
        defaultGrid: { colSpan: 3, rowSpan: 3 },
        defaults: {
            width: 132,
            height: 132,
            label: 'DISPLAY',
            labelPosition: 'top',
            labelOrientation: 'horizontal',
        },
        fields: withLabelFields([
            NUMBER('width', '画布分辨率宽 (px)', {
                min: 32, max: 800, step: 1, integer: true,
                hint: '显示区域由网格决定；分辨率决定 Canvas 绘制精度与比例',
            }),
            NUMBER('height', '画布分辨率高 (px)', { min: 32, max: 800, step: 1, integer: true }),
        ]),
    },
};

export const COMPONENT_GROUPS = [
    { id: 'buttons', label: '按钮', types: ['ButtonSimple', 'ButtonWithLights'] },
    { id: 'lights', label: '指示灯', types: ['IndicatorLight', 'IndicatorLightGroup'] },
    { id: 'knobs', label: '旋钮', types: ['KnobDiscrete', 'KnobContinuous', 'KnobInfinite'] },
    { id: 'levers', label: '拨杆', types: ['Lever', 'LeverContinuous'] },
    { id: 'displays', label: '显示屏', types: ['Display'] },
];

export const PANEL_DEFAULTS = {
    columns: 16,
    rows: 10,
    cellSize: 46,
    gap: 8,
};

export function getComponentDefinition(type) {
    return COMPONENT_TYPES[type] || null;
}

export function getComponentLabel(type) {
    return COMPONENT_TYPES[type]?.label || type;
}

export function cloneValue(value) {
    if (Array.isArray(value)) return value.map((item) => cloneValue(item));
    if (value && typeof value === 'object') return { ...value };
    return value;
}

export function cloneProps(props = {}) {
    return JSON.parse(JSON.stringify(props));
}

export function createPanelModel(id, overrides = {}) {
    return {
        id,
        columns: PANEL_DEFAULTS.columns,
        rows: PANEL_DEFAULTS.rows,
        cellSize: PANEL_DEFAULTS.cellSize,
        gap: PANEL_DEFAULTS.gap,
        components: [],
        ...overrides,
    };
}

export function createProject(name = '未命名项目') {
    return {
        version: PROJECT_VERSION,
        name,
        panels: [createPanelModel('main-panel')],
    };
}

export function makeUniqueId(base, usedIds) {
    const cleanBase = String(base || 'item').replace(/[^\w-]/g, '-').replace(/-+/g, '-');
    let id = cleanBase || 'item';
    let index = 2;
    while (usedIds.has(id)) {
        id = `${cleanBase}-${index}`;
        index += 1;
    }
    usedIds.add(id);
    return id;
}

export function getDefaultGrid(type, panel) {
    const definition = getComponentDefinition(type);
    if (!definition) return { row: 1, col: 1, rowSpan: 1, colSpan: 1 };

    let colSpan = definition.defaultGrid?.colSpan || 1;
    let rowSpan = definition.defaultGrid?.rowSpan || 1;

    // 显示屏根据实际画布尺寸换算网格跨度
    if (type === 'Display') {
        const width = Number(definition.defaults.width) || 132;
        const height = Number(definition.defaults.height) || 132;
        colSpan = Math.ceil((width + panel.gap) / (panel.cellSize + panel.gap));
        rowSpan = Math.ceil((height + panel.gap) / (panel.cellSize + panel.gap));
    }

    return {
        row: 1,
        col: 1,
        rowSpan: clampInt(rowSpan, 1, panel.rows),
        colSpan: clampInt(colSpan, 1, panel.columns),
    };
}

export function clampInt(value, min, max) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
}

export function normalizeComponentProps(type, rawProps = {}) {
    const definition = getComponentDefinition(type);
    if (!definition) return {};

    const raw = rawProps && typeof rawProps === 'object' ? rawProps : {};
    const props = {};

    definition.fields.forEach((field) => {
        const fallback = cloneValue(definition.defaults[field.key]);
        const value = Object.prototype.hasOwnProperty.call(raw, field.key) ? raw[field.key] : fallback;

        switch (field.type) {
            case 'number': {
                let number = Number(value);
                if (!Number.isFinite(number)) number = Number(fallback) || 0;
                if (field.integer) number = Math.round(number);
                if (field.min !== undefined) number = Math.max(field.min, number);
                if (field.max !== undefined) number = Math.min(field.max, number);
                props[field.key] = number;
                break;
            }
            case 'array': {
                let list = value;
                if (typeof list === 'string') {
                    list = list.split(/[,\n]/);
                }
                if (!Array.isArray(list)) list = cloneValue(fallback) || [];
                list = list.map((item) => String(item).trim()).filter(Boolean);
                if (!list.length) {
                    list = cloneValue(fallback) || ['ITEM'];
                }
                props[field.key] = list;
                break;
            }
            case 'numberArray': {
                let list = value;
                if (typeof list === 'string') {
                    list = list.split(/[,\n]/);
                }
                if (!Array.isArray(list)) list = cloneValue(fallback) || [];
                props[field.key] = list
                    .filter((item) => item !== '' && item !== null && item !== undefined)
                    .map((item) => {
                        let number = Number(item);
                        if (!Number.isFinite(number)) number = 0;
                        if (field.integer) number = Math.round(number);
                        if (field.min !== undefined) number = Math.max(field.min, number);
                        if (field.max !== undefined) number = Math.min(field.max, number);
                        return number;
                    });
                break;
            }
            case 'select': {
                const allowed = (field.options || []).map((option) =>
                    typeof option === 'string' ? option : option.value
                );
                props[field.key] = allowed.includes(String(value)) ? String(value) : fallback;
                break;
            }
            case 'boolean':
                props[field.key] = value === true || value === 'true' ||
                    value === 1 || value === '1';
                break;
            case 'color':
            case 'text':
            default:
                props[field.key] = value === undefined || value === null ? fallback : String(value);
                break;
        }
    });

    // 档位类组件的初始索引不能超过档位数量
    if (Array.isArray(props.positions) && props.initialPosition !== undefined) {
        props.initialPosition = clampInt(props.initialPosition, 0, Math.max(0, props.positions.length - 1));
    }

    return props;
}

function normalizeGrid(rawGrid = {}, panel) {
    const grid = rawGrid && typeof rawGrid === 'object' ? rawGrid : {};
    const col = clampInt(grid.col ?? 1, 1, panel.columns);
    const row = clampInt(grid.row ?? 1, 1, panel.rows);
    return {
        row,
        col,
        rowSpan: clampInt(grid.rowSpan ?? 1, 1, panel.rows - row + 1),
        colSpan: clampInt(grid.colSpan ?? 1, 1, panel.columns - col + 1),
    };
}

function rectsOverlap(a, b) {
    return a.row < b.row + b.rowSpan &&
        a.row + a.rowSpan > b.row &&
        a.col < b.col + b.colSpan &&
        a.col + a.colSpan > b.col;
}

/**
 * 规范化并校验从文件/本地存储读取的项目。
 * 返回 { project, warnings }，结构错误时抛出异常。
 */
export function normalizeProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('项目 JSON 的根节点必须是一个对象');
    }
    if (!Array.isArray(raw.panels) || raw.panels.length === 0) {
        throw new Error('项目至少需要包含一个 panels 面板');
    }

    const warnings = [];
    const usedPanelIds = new Set();
    const usedComponentIds = new Set();

    const panels = raw.panels.map((rawPanel, panelIndex) => {
        if (!rawPanel || typeof rawPanel !== 'object') {
            throw new Error(`第 ${panelIndex + 1} 个面板格式不正确`);
        }

        const panel = createPanelModel(
            makeUniqueId(rawPanel.id || `panel-${panelIndex + 1}`, usedPanelIds),
            {
                columns: clampInt(rawPanel.columns ?? PANEL_DEFAULTS.columns, 1, 64),
                rows: clampInt(rawPanel.rows ?? PANEL_DEFAULTS.rows, 1, 64),
                cellSize: clampInt(rawPanel.cellSize ?? PANEL_DEFAULTS.cellSize, 20, 160),
                gap: clampInt(rawPanel.gap ?? PANEL_DEFAULTS.gap, 0, 40),
            }
        );

        const rawComponents = Array.isArray(rawPanel.components) ? rawPanel.components : [];
        rawComponents.forEach((rawComponent, componentIndex) => {
            if (!rawComponent || typeof rawComponent !== 'object') {
                warnings.push(`已跳过面板 ${panel.id} 中的无效组件 #${componentIndex + 1}`);
                return;
            }
            const type = String(rawComponent.type || '');
            if (!getComponentDefinition(type)) {
                warnings.push(`已跳过未知组件类型 "${type || '空'}"`);
                return;
            }

            const id = makeUniqueId(
                rawComponent.id || `${COMPONENT_TYPES[type].prefix}-${componentIndex + 1}`,
                usedComponentIds
            );
            const grid = normalizeGrid(rawComponent.grid, panel);
            const props = normalizeComponentProps(type, rawComponent.props);
            panel.components.push({ id, type, grid, props });
        });

        // 仅提示重叠，不擅自修改用户已有布局
        for (let i = 0; i < panel.components.length; i += 1) {
            for (let j = i + 1; j < panel.components.length; j += 1) {
                const a = panel.components[i];
                const b = panel.components[j];
                if (rectsOverlap(a.grid, b.grid)) {
                    warnings.push(`面板 ${panel.id} 中的组件 "${a.id}" 与 "${b.id}" 存在重叠`);
                }
            }
        }

        return panel;
    });

    const name = String(raw.name || '未命名项目').trim() || '未命名项目';
    return {
        project: {
            version: PROJECT_VERSION,
            name,
            panels,
        },
        warnings,
    };
}
