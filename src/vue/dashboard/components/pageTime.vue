<template>
  <section class="reading-chart">
    <header class="chart-summary">
      <div>
        <span>{{ addon.locale.totalTime }}</span>
        <strong>{{ toTimeString(stats.total) }}</strong>
      </div>
      <div>
        <span>{{ addon.locale.pages }}</span>
        <strong>{{ stats.activePages }}</strong>
      </div>
      <div>
        <span>{{ addon.locale.pageNum }}</span>
        <strong>{{ stats.maxPage || '-' }}</strong>
      </div>
    </header>
    <Chart :key="JSON.stringify(theme)" ref="chart" class="chart" :options="options" />
  </section>
</template>

<script lang="ts">
import type {
    ExportingOptions,
    Point,
    PointClickEventObject,
    SeriesColumnOptions,
    Tooltip,
} from 'highcharts';
import { Chart } from 'highcharts-vue';
import { defineComponent } from 'vue';
import Highcharts from '@/highcharts';
import { buttons, helpMessageOption } from '@/utils';
import type { AttachmentHistory } from '$/history/history';
import { getHistoryItemID, getHistoryTitle } from '$/history/kernel';
import { toTimeString } from '$/utils';

function onPointClick(this: Point, events: PointClickEventObject) {
    if (events.ctrlKey || events.metaKey)
        Zotero.FileHandlers.open(Zotero.Items.get(Number(this.series.options.id)), {
            location: { pageIndex: Number(this.x) - 1 },
        });
    return false;
}

function tooltipFormatter(this: Point, tooltip: Tooltip) {
    const result =
        tooltip.chart.series.length > 1
            ? `<span style="color: ${this.series.color}">\u25CF</span> ${this.series.name}:<br>`
            : '';
    return result + `${addon.locale.pageNum}: ${this.x}<br>${addon.locale.time}: ` + toTimeString(this.y!);
}

function pageHeatColor(value: number, max: number) {
    const ratio = max ? value / max : 0;
    if (ratio >= 0.75) return '#dc2626';
    if (ratio >= 0.5) return '#f97316';
    if (ratio >= 0.25) return '#f59e0b';
    return '#0ea5e9';
}

export default defineComponent({
    data() {
        return {
            addon,
            toTimeString,
            stats: {
                total: 0,
                activePages: 0,
                maxPage: 0,
            },
            chartOpts: {
                exporting: {
                    buttons,
                    menuItemDefinitions: helpMessageOption(addon.locale.doc.pageTime),
                } as ExportingOptions,
                plotOptions: {
                    series: {
                        animation: { duration: 260 },
                        point: { events: { click: onPointClick } },
                    },
                    column: {
                        borderRadius: 5,
                        borderWidth: 0,
                        groupPadding: 0.08,
                        pointPadding: 0.04,
                    },
                },
                chart: {
                    backgroundColor: 'transparent',
                    height: 280,
                    panning: { type: 'x', enabled: true },
                    spacing: [8, 8, 8, 8],
                    zooming: { type: 'x', key: 'shift' },
                },
                xAxis: {
                    title: { text: addon.locale.pageNum },
                    tickLength: 0,
                    scrollbar: { enabled: true },
                },
                yAxis: {
                    gridLineDashStyle: 'Dash',
                    min: 0,
                    title: { text: undefined },
                    labels: { formatter: ctx => toTimeString(ctx.value) },
                },
                subtitle: {
                    text: (Zotero.isMac ? 'Meta' : 'Ctrl') + addon.locale.chartTitle.pageTimeSub,
                },
                tooltip: { formatter: tooltipFormatter },
                series: [{ type: 'column' }],
                legend: { enabled: false },
            } as Highcharts.Options,
        };
    },
    computed: {
        options() {
            return Highcharts.merge(this.chartOpts, this.theme);
        },
    },
    props: {
        history: {
            type: Array<AttachmentHistory>,
            required: true,
        },
        theme: Object,
    },
    watch: {
        history: {
            immediate: true,
            handler(his: AttachmentHistory[]) {
                if (his.length < 1) return;
                (this.$refs.chart as typeof Chart | undefined)?.chart?.hideData();
                const totals = his.flatMap(attHis =>
                        Object.entries(attHis.record.pages).map(([page, record]) => ({
                            page: Number(page) + 1,
                            time: record.totalS ?? 0,
                        })),
                    ),
                    active = totals.filter(item => item.time > 0),
                    max = active.reduce((result, item) => Math.max(result, item.time), 0),
                    hottest = active.reduce((result, item) => (item.time > result.time ? item : result), {
                        page: 0,
                        time: 0,
                    });
                this.stats = {
                    total: active.reduce((sum, item) => sum + item.time, 0),
                    activePages: active.length,
                    maxPage: hottest.page,
                };
                this.chartOpts.series = his.map(attHis => {
                    const firstPage = attHis.record.firstPage ?? 0,
                        lastPage = attHis.record.lastPage ?? firstPage,
                        data: Array<{ x: number; y: number; color: string }> = [];
                    for (let i = firstPage; i <= lastPage; ++i) {
                        const time = attHis.record.pages[i]?.totalS ?? 0;
                        data.push({
                            x: i + 1,
                            y: time,
                            color: pageHeatColor(time, max),
                        });
                    }
                    // addon.log(attHis.record.pages, data);
                    return {
                        type: 'column',
                        name:
                            his.length > 1
                                ? getHistoryTitle(attHis)
                                : `${addon.locale.time}(${addon.locale.seconds})`,
                        data,
                        id: String(getHistoryItemID(attHis) ?? ''),
                    } as SeriesColumnOptions;
                });
                this.chartOpts.legend!.enabled = his.length > 1;
            },
        },
    },
    components: { Chart },
});
</script>

<style scoped>
.reading-chart {
    display: grid;
    gap: 10px;
}

.chart-summary {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.chart-summary div {
    background: var(--td-bg-color-secondarycontainer, #f8fafc);
    border: 1px solid var(--td-border-level-1-color, #eef2f7);
    border-radius: 8px;
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 9px 10px;
}

.chart-summary span {
    color: var(--td-text-color-secondary, #64748b);
    font-size: 12px;
    line-height: 16px;
}

.chart-summary strong {
    color: var(--td-text-color-primary, #111827);
    font-size: 15px;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chart {
    min-height: 280px;
}
</style>
