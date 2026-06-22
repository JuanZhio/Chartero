<script lang="ts">
import type {
    GanttPointOptionsObject,
    NavigatorYAxisOptions,
    Options,
    Point,
    SeriesGanttOptions,
    XAxisOptions,
    YAxisOptions,
} from 'highcharts';
import { Chart } from 'highcharts-vue';
import { FilterIcon, SwapIcon } from 'tdesign-icons-vue-next';
import { defineComponent } from 'vue';
import Highcharts from '@/highcharts';
import { helpMessageOption } from '@/utils';
import type { AttachmentHistory } from '$/history/history';
import {
    createReadingKernelSnapshot,
    createReadingKernelSnapshotForItem,
    getHistoryItem,
    getHistoryItemID,
    getHistoryTitle,
    getReadingKernelBounds,
} from '$/history/kernel';
import { toTimeString } from '$/utils';

interface GanttItem extends GanttPointOptionsObject {
    start: number;
    end: number;
    completed: number;
    custom: { totalS: number; author?: string };
}
let rawData: GanttItem[] = [];

const MIN_CHART_HEIGHT = 360,
    MAX_CHART_HEIGHT = 760,
    ROW_HEIGHT = 34,
    CHART_CHROME_HEIGHT = 132;

function sortData(opt: string, data: GanttItem[]): GanttItem[] {
    return data.sort((a, b) => {
        switch (opt) {
            case 'startAscending':
                return a.start - b.start;
            case 'startDescending':
                return b.start - a.start;
            case 'endAscending':
                return a.end - b.end;
            case 'endDescending':
                return b.end - a.end;
            case 'timeAscending':
                return a.custom.totalS - b.custom.totalS;
            case 'timeDescending':
                return b.custom.totalS - a.custom.totalS;
            default:
                return 0;
        }
    });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function filterData(opts: string[], data: GanttItem[]): GanttItem[] {
    const now = new Date(); // 时间选项不会同时出现，所以放在循环外
    return data.filter(point =>
        opts.every(opt => {
            switch (opt) {
                case 'completed':
                    return point.completed > 0.99;
                case 'incomplete':
                    return point.completed < 1.0;

                case 'month':
                    now.setMonth(now.getMonth() - 1);
                    return point.end > now.getTime();
                case 'week':
                    now.setDate(now.getDate() - 7);
                    return point.end > now.getTime();
                case 'day':
                    now.setDate(now.getDate() - 1);
                    return point.end > now.getTime();

                case 'fit':
                default:
                    return true;
            }
        }),
    );
}
function filterDataFast(opts: string[], data: GanttItem[]): GanttItem[] {
    const now = Date.now(),
        day = 24 * 60 * 60 * 1000,
        cutoffs: Record<string, number> = {
            month: now - 30 * day,
            week: now - 7 * day,
            day: now - day,
        };
    return data.filter(point =>
        opts.every(opt => {
            switch (opt) {
                case 'completed':
                    return point.completed > 0.99;
                case 'incomplete':
                    return point.completed < 1.0;
                case 'month':
                case 'week':
                case 'day':
                    return point.end > cutoffs[opt];
                default:
                    return true;
            }
        }),
    );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function addParentData(data: GanttItem[]): GanttItem[] {
    let parentIds = new Set<string>();
    // 遍历找到共同父条目的附件
    for (let i = 0; i < data.length; ++i)
        for (let j = i + 1; j < data.length; ++j) {
            const pi = Zotero.Items.get(data[i].id!).parentID,
                pj = Zotero.Items.get(data[j].id!).parentID;
            if (pi === pj) {
                parentIds.add(String(pi));
                data[i].parent = data[j].parent = String(pi);
            }
        }
    // 添加父条目
    for (const id of parentIds) {
        const it = Zotero.Items.get(id),
            snapshot = createReadingKernelSnapshotForItem(it),
            bounds = getReadingKernelBounds(snapshot);
        data.push({
            id: String(id),
            name: it.getField('title'),
            start: bounds.firstTime * 1000,
            end: bounds.lastTime * 1000,
            completed: snapshot.progressPercent / 100,
            custom: { totalS: snapshot.totalS, author: it.firstCreator },
        });
    }
    // 替换顶层条目名为父条目标题
    for (const d of data)
        if (!d.parent) {
            const it = Zotero.Items.get(d.id!);
            d.name = (it.parentItem ?? it).getField('title');
        }
    return data;
}

function addParentDataFast(data: GanttItem[]): GanttItem[] {
    const itemByID = new Map<string, Zotero.Item>(),
        childrenByParent = new Map<number, GanttItem[]>();
    for (const point of data) {
        const id = String(point.id),
            item = Zotero.Items.get(id);
        itemByID.set(id, item);
        if (!item.parentID) continue;
        const children = childrenByParent.get(item.parentID) ?? [];
        children.push(point);
        childrenByParent.set(item.parentID, children);
    }
    const parentIds = Array.from(childrenByParent.entries())
        .filter(([, children]) => children.length > 1)
        .map(([parentID, children]) => {
            children.forEach(child => (child.parent = String(parentID)));
            return String(parentID);
        });
    for (const id of parentIds) {
        const it = Zotero.Items.get(id),
            snapshot = createReadingKernelSnapshotForItem(it),
            bounds = getReadingKernelBounds(snapshot);
        data.push({
            id: String(id),
            name: it.getField('title'),
            start: bounds.firstTime * 1000,
            end: bounds.lastTime * 1000,
            completed: snapshot.progressPercent / 100,
            custom: { totalS: snapshot.totalS, author: it.firstCreator },
        });
    }
    for (const d of data)
        if (!d.parent) {
            const it = itemByID.get(String(d.id)) ?? Zotero.Items.get(d.id!);
            d.name = (it.parentItem ?? it).getField('title');
        }
    return data;
}

function pointFormatter(this: Point) {
    const data = this.options as GanttItem,
        startDate = new Date(data.start).toLocaleDateString(),
        endDate = new Date(data.end).toLocaleDateString(),
        totalS = toTimeString(data.custom.totalS),
        completed = Math.round((data.completed ?? 0) * 100);
    return `
        <div class="gantt-tooltip">
            <b>${data.name}</b><br/>
            <span>${addon.locale.author}: ${data.custom.author ?? '-'}</span><br/>
            <span>${addon.locale.time}: ${totalS}</span><br/>
            <span>${addon.locale.progressLabel?.read ?? 'Progress'}: ${completed}%</span><br/>
            <span>${startDate} ~ ${endDate}</span>
        </div>
    `;
}

const colTitleOpt = {
        title: { text: addon.locale.fileName },
        labels: {
            format: '{point.name}',
            style: { textOverflow: 'ellipsis', width: '220px' },
        },
    },
    colAuthorOpt = {
        title: { text: addon.locale.author },
        labels: {
            format: '{point.custom.author}',
            style: { textOverflow: 'ellipsis', width: '116px' },
        },
    };

export default defineComponent({
    components: { Chart, FilterIcon, SwapIcon },
    props: {
        history: {
            type: Array<AttachmentHistory>,
            required: true,
        },
        theme: Object,
    },
    data() {
        return {
            chartOpts: {
                exporting: {
                    menuItemDefinitions: helpMessageOption(addon.locale.doc.gantt),
                },
                chart: {
                    height: MIN_CHART_HEIGHT,
                    marginRight: 18,
                    spacing: [12, 10, 8, 10],
                    zooming: { type: undefined },
                },
                navigator: {
                    enabled: true,
                    yAxis: { reversed: true, min: 0, max: 1 },
                    handles: { width: 16 },
                    margin: 16,
                },
                // rangeSelector: { enabled: true },
                scrollbar: { enabled: true, liveRedraw: true },
                xAxis: {
                    dateTimeLabelFormats: {
                        year: '%[Y]',
                        month: {
                            list: ['%[yB]', '%[b]'],
                            main: {},
                        },
                        week: {
                            list: ['%Y | W%W', 'Week%W', 'W%W'],
                            main: {},
                        },
                        day: {
                            list: ['%[YBe]', '%[be]', '%[a]', '%e'],
                            main: {},
                        },
                        hour: {
                            list: ['%[YBeH]', '%[beH]', '%[H]'],
                            main: {},
                        },
                        minute: {
                            list: ['%[YBe] %H:%M', '%[be] %H:%M', '%H:%M'],
                            main: {},
                        },
                        second: {
                            list: ['%H:%M:%S', '%H:%M'],
                            main: {},
                        },
                    },
                    grid: { enabled: true },
                    lineColor: 'var(--td-border-level-1-color)',
                },
                yAxis: {
                    visible: window.innerWidth > 500,
                    grid: {
                        enabled: true,
                        borderColor: 'var(--td-border-level-1-color)',
                        columns: [colTitleOpt],
                    },
                    labels: {
                        style: { color: 'var(--td-text-color-secondary)' },
                    },
                },
                tooltip: {
                    headerFormat: `<span style="color: {point.color}">\u25CF</span>`,
                    pointFormatter,
                    outside: true,
                    useHTML: true,
                },
                plotOptions: {
                    gantt: {
                        borderRadius: 4,
                        borderWidth: 0,
                        colorByPoint: true,
                        dataLabels: {
                            enabled: true,
                            crop: true,
                            overflow: 'justify',
                            style: {
                                color: 'var(--td-text-color-primary)',
                                fontSize: '11px',
                                fontWeight: '500',
                                textOutline: 'none',
                            },
                            formatter() {
                                const point = this.point.options as GanttItem;
                                return point.completed > 0.99 ? '100%' : '';
                            },
                        },
                    },
                },
                series: [
                    {
                        type: 'gantt',
                        minPointLength: 10,
                        borderRadius: 4,
                        data: [],
                    } as SeriesGanttOptions,
                ],
            } as Options,
            locale: addon.locale,
            sortOption: '',
            filterOption: new Array<string>(),
            titleOption: ['title'],
            isLandscape: window.innerWidth > 500,
            onResizeDebounced: Zotero.Utilities.debounce(this.onResize, 100) as () => void,
            noHistoryFound: true,
        };
    },
    computed: {
        options() {
            const opts: Options = Highcharts.merge(this.chartOpts, this.theme),
                xAxis = opts.xAxis as XAxisOptions;
            opts.xAxis = [xAxis, xAxis];
            return opts;
        },
        totalTimeLabel(): string {
            return toTimeString(this.seriesData.reduce((total, point) => total + point.custom.totalS, 0));
        },
        completedCount(): number {
            return this.seriesData.filter(point => point.completed > 0.99).length;
        },
        dateRangeLabel(): string {
            if (!this.seriesData.length) return '-';
            const start = Math.min(...this.seriesData.map(point => point.start)),
                end = Math.max(...this.seriesData.map(point => point.end));
            return `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
        },
        seriesData: {
            get(): GanttItem[] {
                return (this.chartOpts.series![0] as SeriesGanttOptions).data as GanttItem[];
            },
            set(data: GanttItem[]) {
                data.forEach((point, i) => (point.y = i));
                (this.chartOpts.series![0] as SeriesGanttOptions).data = data;
            },
        },
    },
    watch: {
        sortOption(opt) {
            this.seriesData = sortData(opt, this.seriesData);
        },
        filterOption(opt) {
            this.updateSeriesData(this.sortOption, opt);
        },
        titleOption(opt) {
            const yAxis = this.chartOpts.yAxis as YAxisOptions;
            yAxis.grid ??= {};
            yAxis.grid.columns ??= [];
            const col = yAxis.grid.columns;
            col.length = 0;
            if (opt.includes('title')) col.push(colTitleOpt);
            if (opt.includes('author')) col.push(colAuthorOpt);
        },
        history(his: AttachmentHistory[]) {
            this.updateChart(his);
        },
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.onResizeDebounced);
    },
    mounted() {
        this.updateChart(this.history);
        window.addEventListener('resize', this.onResizeDebounced);
    },
    methods: {
        updateSeriesData(sortOption: string, filterOption: string[]) {
            this.seriesData = sortData(sortOption, addParentDataFast(filterDataFast(filterOption, rawData)));
            (this.chartOpts.navigator!.yAxis as NavigatorYAxisOptions).max = this.seriesData.length - 1;
            this.updateChartHeight();
        },
        updateChart(his: AttachmentHistory[]) {
            rawData = his
                .map(attHis => {
                    const snapshot = createReadingKernelSnapshot([attHis]),
                        item = getHistoryItem(attHis);
                    return {
                        name: getHistoryTitle(attHis),
                        start: (attHis.record.firstTime ?? 0) * 1000,
                        end: (attHis.record.lastTime ?? 0) * 1000,
                        completed: snapshot.progressPercent / 100,
                        id: getHistoryItemID(attHis),
                        custom: {
                            totalS: attHis.record.totalS,
                            author: item?.parentItem?.firstCreator,
                        },
                    } as GanttItem;
                })
                .filter(point => point.start! + point.end! > 0);
            this.noHistoryFound = rawData.length < 1;
            this.updateSeriesData(this.sortOption, this.filterOption);
        },
        onResize() {
            (this.chartOpts.yAxis as YAxisOptions).visible = this.isLandscape = window.innerWidth > 500;
        },
        updateChartHeight() {
            const height = Math.min(
                MAX_CHART_HEIGHT,
                Math.max(MIN_CHART_HEIGHT, this.seriesData.length * ROW_HEIGHT + CHART_CHROME_HEIGHT),
            );
            this.chartOpts.chart = {
                ...(this.chartOpts.chart as Options['chart']),
                height,
            };
        },
    },
});
</script>

<template>
    <div class="gantt-page">
        <div v-if="noHistoryFound" class="empty-state">
            <h1>{{ locale.noHistoryFound }}</h1>
        </div>
        <template v-else>
            <div class="gantt-toolbar">
                <div class="toolbar-controls">
                    <t-select
                        v-if="isLandscape"
                        v-model="titleOption"
                        :placeholder="locale.tableHeader"
                        size="small"
                        multiple
                        clearable
                        auto-width
                    >
                        <t-option value="title" :label="locale.ganttMenu.showTitle" />
                        <t-option value="author" :label="locale.ganttMenu.showAuthor" />
                    </t-select>
                    <t-select v-else disabled auto-width size="small" :placeholder="locale.tableHeaderTip" />
                    <t-select v-model="sortOption" :placeholder="locale.sort" size="small" auto-width>
                        <template #prefixIcon>
                            <SwapIcon style="transform: rotate(90deg)" />
                        </template>
                        <t-option value="startAscending" :label="locale.ganttMenu.startAscending" />
                        <t-option value="startDescending" :label="locale.ganttMenu.startDescending" />
                        <t-option value="endAscending" :label="locale.ganttMenu.endAscending" />
                        <t-option value="endDescending" :label="locale.ganttMenu.endDescending" />
                        <t-option value="timeAscending" :label="locale.ganttMenu.timeAscending" />
                        <t-option value="timeDescending" :label="locale.ganttMenu.timeDescending" />
                    </t-select>
                    <t-select
                        v-model="filterOption"
                        :placeholder="locale.filter"
                        size="small"
                        multiple
                        clearable
                        auto-width
                    >
                        <template #prefixIcon>
                            <FilterIcon />
                        </template>
                        <t-option
                            value="completed"
                            :label="locale.ganttMenu.completed"
                            :disabled="filterOption.includes('incomplete')"
                        />
                        <t-option
                            value="incomplete"
                            :label="locale.ganttMenu.incomplete"
                            :disabled="filterOption.includes('completed')"
                        />
                        <t-option
                            value="month"
                            :label="locale.ganttMenu.month"
                            :disabled="filterOption.some(val => ['week', 'day'].includes(val))"
                        />
                        <t-option
                            value="week"
                            :label="locale.ganttMenu.week"
                            :disabled="filterOption.some(val => ['month', 'day'].includes(val))"
                        />
                        <t-option
                            value="day"
                            :label="locale.ganttMenu.day"
                            :disabled="filterOption.some(val => ['month', 'week'].includes(val))"
                        />
                    </t-select>
                </div>

                <div class="gantt-stats">
                    <span>{{ seriesData.length }} {{ locale.progressLabel.PDFs }}</span>
                    <span>{{ completedCount }} {{ locale.ganttMenu.completed }}</span>
                    <span>{{ totalTimeLabel }}</span>
                    <span>{{ dateRangeLabel }}</span>
                </div>
            </div>

            <div class="chart-panel">
                <Chart
                    :key="JSON.stringify(theme)"
                    ref="chart"
                    constructor-type="ganttChart"
                    :options="options"
                    style="width: 100%"
                />
            </div>
        </template>
    </div>
</template>

<style scoped>
.gantt-page {
    display: grid;
    gap: 10px;
    padding: 10px;
}

.empty-state {
    align-items: center;
    color: var(--td-text-color-placeholder);
    display: flex;
    justify-content: center;
    min-height: 280px;
}

.empty-state h1 {
    font-size: 18px;
    font-weight: 500;
    margin: 0;
}

.gantt-toolbar {
    background: var(--td-bg-color-container);
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    padding: 10px;
}

.toolbar-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.gantt-stats {
    color: var(--td-text-color-secondary);
    display: flex;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 8px;
    line-height: 20px;
}

.gantt-stats span {
    background: var(--td-bg-color-secondarycontainer);
    border-radius: 6px;
    max-width: 100%;
    overflow: hidden;
    padding: 0 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chart-panel {
    background: var(--td-bg-color-container);
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 8px;
    overflow: hidden;
}

:deep(.highcharts-tooltip .gantt-tooltip) {
    color: var(--td-text-color-primary);
    line-height: 1.7;
}
</style>
