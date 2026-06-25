<script lang="ts">
import type {
    Options,
    PointOptionsObject,
    SeriesAreaOptions,
    SeriesColumnOptions,
    SeriesPieOptions,
    SeriesSplineOptions,
    SeriesVariablepieOptions,
} from 'highcharts';
import { Chart } from 'highcharts-vue';
import Highcharts from '@/highcharts';
import { splitOtherData } from '@/utils';
import {
    buildDailyTrendStatsFromEvents,
    buildReadingStreakStatsFromEvents,
    buildScheduleStatsFromEvents,
    buildTimeBucketStats,
    type DailyTrendStats,
    getActiveReadingDays,
    getDayNumber,
    getReadSecondsByDate,
    type ReadingStreakStats,
} from '$/history/analytics';
import type { AttachmentHistory } from '$/history/history';
import { createReadingKernelSnapshot, createReadingKernelSnapshotForItem } from '$/history/kernel';
import { getHistoryPeriods, type ReadingSessionStats } from '$/history/session';
import { compileExcludedTagPatterns, getExcludedTagIDs, isTagExcluded } from '$/tagFilter';
import { accumulate, toTimeString } from '$/utils';
import Skyline from './components/skyline.vue';

const excludedTags = getExcludedTagIDs(),
    excludedTagRegexes = compileExcludedTagPatterns(),
    libraryHistory = addon.history.getInLibrary(),
    kernel = createReadingKernelSnapshot(libraryHistory),
    Zotero = addon.getGlobal('Zotero');

type LiteratureSortMode = 'latest' | 'duration';
type TrendRange = 7 | 30;

interface LiteratureRecord {
    id: number;
    title: string;
    author: string;
    totalS: number;
    lastTime: number;
    progress: number;
    attachmentCount: number;
    histories: AttachmentHistory[];
}

interface TimePreferenceStat {
    key: string;
    label: string;
    totalS: number;
    percent: number;
}

interface TagInvestmentStat {
    name: string;
    totalS: number;
    count: number;
    percent: number;
}

function drawSchedule() {
    const { weekData, hourData } = buildScheduleStatsFromEvents(kernel.events);
    return [
        {
            name: addon.locale.scheduleWeek ?? 'week',
            type: 'column',
            data: weekData,
        } as SeriesColumnOptions,
        {
            name: addon.locale.scheduleHour ?? 'hour',
            type: 'spline',
            data: hourData,
            tooltip: { headerFormat: '{point.x}:00~{add point.x 1}:00<br/>' },
            xAxis: 1,
        } as SeriesSplineOptions,
    ];
}

async function drawVariablePie() {
    function getTime(item: Zotero.Item) {
        return createReadingKernelSnapshotForItem(item).totalS;
    }
    function process(arr: Array<PointOptionsObject>, item: Zotero.Item) {
        const tags = item
                .getTags()
                .filter(t => t.type)
                .map(t => t.tag)
                .filter(t => {
                    const id = Zotero.Tags.getID(t);
                    return id && !isTagExcluded(t, id, excludedTags, excludedTagRegexes);
                }),
            time = getTime(item);
        for (const tag of tags) {
            const fan = arr.find(i => i.name === tag);
            if (fan) {
                ++fan.y!;
                fan.z! += time;
            } else arr.push({ name: tag, y: 1, z: time });
        }
        return arr;
    }
    const data = new Array<PointOptionsObject>(),
        series = new Array<SeriesVariablepieOptions | SeriesPieOptions>(),
        userLib = Zotero.Libraries.userLibraryID,
        collections: Array<Zotero.Collection | Zotero.Search> = Zotero.Collections.getByLibrary(
            userLib,
            true,
        ),
        unfiled = new Zotero.Search({
            libraryID: userLib,
            name: addon.locale.unfiled,
        });
    unfiled.addCondition('unfiled', 'true');
    unfiled.addCondition('itemType', 'isNot', 'note');
    collections.push(unfiled);

    for (const collection of collections) {
        const items =
                'getChildItems' in collection
                    ? collection.getChildItems()
                    : Zotero.Items.get(await collection.search()),
            drilldownData = items.reduce(process, []),
            [major, minor] = splitOtherData(drilldownData);
        if (major.length < 2 || minor.length < 2) major.push(...minor);
        else
            major.push({
                name: addon.locale.others,
                sliced: true,
                y: accumulate(minor, 'y'),
                z: accumulate(minor, 'z'),
            });
        data.push({
            name: collection.name,
            drilldown: collection.name,
            y: items.length,
            z: items.reduce((sum: number, item: Zotero.Item) => sum + getTime(item), 0),
        });
        series.push({
            name: collection.name,
            id: collection.name,
            type: data.at(-1)!.z! > 0 ? 'variablepie' : 'pie',
            data: major,
        });
    }
    return { data, series };
}

function buildLiteratureRecords(histories: AttachmentHistory[]): LiteratureRecord[] {
    const records = new Map<string, LiteratureRecord>();
    for (const history of histories) {
        const attachment = Zotero.Items.getByLibraryAndKey(history.note.libraryID, history.key) as
                | false
                | Zotero.Item,
            item = attachment ? (attachment.parentItem ?? attachment) : undefined,
            id = item?.id ?? 0,
            key = id ? String(id) : `${history.note.libraryID}-${history.key}`,
            existing = records.get(key),
            record = existing ?? {
                id,
                title: item ? (item.getField('title') as string) : history.key,
                author: item?.firstCreator ?? '-',
                totalS: 0,
                lastTime: 0,
                progress: 0,
                attachmentCount: 0,
                histories: [],
            };
        record.totalS += history.record.totalS;
        record.lastTime = Math.max(record.lastTime, history.record.lastTime ?? 0);
        record.attachmentCount += 1;
        record.histories.push(history);
        records.set(key, record);
    }
    for (const record of records.values())
        record.progress = createReadingKernelSnapshot(record.histories).progressPercent;
    return Array.from(records.values()).filter(record => record.totalS > 0);
}

function buildTimePreferenceStats(labels: {
    night: string;
    morning: string;
    afternoon: string;
    evening: string;
}) {
    return buildTimeBucketStats(kernel.events, [
        { key: 'night', label: labels.night, start: 0, end: 6 },
        { key: 'morning', label: labels.morning, start: 6, end: 12 },
        { key: 'afternoon', label: labels.afternoon, start: 12, end: 18 },
        { key: 'evening', label: labels.evening, start: 18, end: 24 },
    ]) as TimePreferenceStat[];
}

function buildTagInvestmentStats(records: LiteratureRecord[]): TagInvestmentStat[] {
    const tags = new Map<string, TagInvestmentStat>();
    for (const record of records) {
        if (!record.id) continue;
        const item = Zotero.Items.get(record.id);
        for (const tagName of item
            .getTags()
            .filter((t: { type?: unknown; tag: string }) => t.type)
            .map((t: { type?: unknown; tag: string }) => t.tag)) {
            const tagID = Zotero.Tags.getID(tagName);
            if (isTagExcluded(tagName, tagID, excludedTags, excludedTagRegexes)) continue;
            const stat = tags.get(tagName) ?? { name: tagName, totalS: 0, count: 0, percent: 0 };
            stat.totalS += record.totalS;
            stat.count += 1;
            tags.set(tagName, stat);
        }
    }
    const totalS = Array.from(tags.values()).reduce((sum, tag) => sum + tag.totalS, 0);
    return Array.from(tags.values())
        .map(tag => ({
            ...tag,
            percent: totalS > 0 ? Math.round((tag.totalS / totalS) * 100) : 0,
        }))
        .sort((a, b) => b.totalS - a.totalS)
        .slice(0, 8);
}

export default {
    components: { Chart, Skyline },
    data() {
        return {
            locale: addon.locale,
            overallProgress: kernel.progressPercent,
            totalTime: kernel.totalS,
            todayTime: getReadSecondsByDate(kernel.events, new Date()),
            activeDays: getActiveReadingDays(kernel.events),
            streakStats: buildReadingStreakStatsFromEvents(kernel.events),
            attachmentCount: libraryHistory.length,
            trendRange: 30 as TrendRange,
            literatureSortMode: 'latest' as LiteratureSortMode,
            literatureRecords: buildLiteratureRecords(libraryHistory),
            detailVisible: false,
            selectedLiteratureRecord: null as LiteratureRecord | null,
            extraLabels: navigator.language.startsWith('zh')
                ? {
                      almostDoneTitle: '即将读完',
                      almostDoneHint: '进度 80% 以上但未完成',
                      resumedTitle: '最近重新拾起',
                      resumedHint: '间隔较久后最近又阅读',
                      tagsTitle: '标签投入排行',
                      tagsHint: '按累计阅读时长排序',
                      sessionCount: '阅读会话',
                      averageSession: '平均会话',
                      longestSession: '最长会话',
                      latestSession: '最近会话',
                      detailTitle: '文献阅读详情',
                      gapDays: '间隔天数',
                  }
                : {
                      almostDoneTitle: 'Almost Finished',
                      almostDoneHint: '80%+ progress but unfinished',
                      resumedTitle: 'Recently Resumed',
                      resumedHint: 'Read again after a long gap',
                      tagsTitle: 'Tag Investment',
                      tagsHint: 'Sorted by total reading duration',
                      sessionCount: 'Reading Sessions',
                      averageSession: 'Average Session',
                      longestSession: 'Longest Session',
                      latestSession: 'Latest Session',
                      detailTitle: 'Literature Details',
                      gapDays: 'Gap Days',
                  },
            insightLabels: navigator.language.startsWith('zh')
                ? {
                      recentStreak: '最近连续阅读',
                      longestStreak: '最长连续阅读',
                      days: '天',
                      topTitle: 'Top 文献',
                      topHint: '累计阅读时长最高',
                      unfinishedTitle: '未完成但投入很多',
                      unfinishedHint: '阅读时长较高但尚未读完',
                      trendTitle: '最近阅读趋势',
                      trendHint: '按天统计阅读时长',
                      preferenceTitle: '阅读时段偏好',
                      preferenceHint: '按阅读发生时间归类',
                      night: '凌晨',
                      morning: '上午',
                      afternoon: '下午',
                      evening: '晚上',
                      preferred: '最常阅读',
                      empty: '暂无数据',
                  }
                : {
                      recentStreak: 'Recent Streak',
                      longestStreak: 'Longest Streak',
                      days: 'days',
                      topTitle: 'Top Literature',
                      topHint: 'Highest total reading duration',
                      unfinishedTitle: 'Invested but Unfinished',
                      unfinishedHint: 'High duration but not finished',
                      trendTitle: 'Recent Trend',
                      trendHint: 'Daily reading duration',
                      preferenceTitle: 'Reading Time Preference',
                      preferenceHint: 'Grouped by reading hour',
                      night: 'Night',
                      morning: 'Morning',
                      afternoon: 'Afternoon',
                      evening: 'Evening',
                      preferred: 'Preferred',
                      empty: 'No data',
                  },
            literatureLabels: navigator.language.startsWith('zh')
                ? {
                      title: '已阅读文献',
                      latest: '最新阅读时间',
                      duration: '累计阅读时长',
                      activeDays: '活跃阅读天数',
                  }
                : {
                      title: 'Read Literature',
                      latest: 'Latest Read',
                      duration: 'Total Duration',
                      activeDays: 'Active Reading Days',
                  },
            pieData: [] as PointOptionsObject[],
            drilldownSeries: [] as Array<SeriesVariablepieOptions | SeriesPieOptions>,
            pieLoading: true,
            scheduleSeries: drawSchedule(),
        };
    },
    computed: {
        scheduleOptions(): Options {
            return Highcharts.merge(
                {
                    chart: {
                        height: 360,
                        spacing: [8, 8, 8, 8],
                    },
                    title: { text: undefined },
                    exporting: { enabled: false },
                    xAxis: [
                        {
                            opposite: true,
                            categories: addon.locale.weekdays,
                            crosshair: true,
                        },
                        { opposite: false },
                    ],
                    yAxis: {
                        title: { text: undefined },
                        labels: { formatter: ctx => toTimeString(ctx.value) },
                    },
                    tooltip: {
                        pointFormatter() {
                            return toTimeString(this.y ?? 0);
                        },
                    },
                    plotOptions: {
                        column: {
                            borderRadius: 4,
                            pointPadding: 0.12,
                        },
                        spline: {
                            marker: { enabled: false },
                        },
                    },
                    series: this.scheduleSeries,
                } as Options,
                {},
            );
        },
        pieOptions(): Options {
            return {
                chart: {
                    height: 360,
                    spacing: [8, 8, 8, 8],
                },
                title: { text: undefined },
                subtitle: { text: undefined },
                exporting: { enabled: false },
                tooltip: {
                    useHTML: true,
                    pointFormatter() {
                        const dot = `<span style="color: var(--highcharts-color-${this.colorIndex})">\u25CF</span>`;
                        return `
                            ${dot} ${addon.locale.itemsCount}: <b>${this.y}</b><br/>
                            ${dot} ${addon.locale.totalTime}: <b>${toTimeString((this as any).z)}</b>
                        `;
                    },
                },
                drilldown: { series: this.drilldownSeries },
                series: [
                    {
                        name: Zotero.Libraries.userLibrary.name,
                        type: 'variablepie',
                        minPointSize: 12,
                        innerSize: '28%',
                        zMin: 0,
                        colorByPoint: true,
                        allowPointSelect: false,
                        data: this.pieData,
                    } as SeriesVariablepieOptions,
                ],
            };
        },
        dailyTrendStats(): DailyTrendStats {
            return buildDailyTrendStatsFromEvents(
                kernel.events,
                this.trendRange,
                Zotero.locale || navigator.language,
            );
        },
        trendOptions(): Options {
            return {
                chart: {
                    height: 300,
                    spacing: [8, 8, 8, 8],
                },
                title: { text: undefined },
                exporting: { enabled: false },
                xAxis: {
                    categories: this.dailyTrendStats.categories,
                    tickmarkPlacement: 'on',
                    labels: {
                        step: this.trendRange == 30 ? 5 : 1,
                    },
                },
                yAxis: {
                    title: { text: undefined },
                    labels: { formatter: ctx => toTimeString(ctx.value) },
                },
                tooltip: {
                    pointFormatter() {
                        return toTimeString(this.y ?? 0);
                    },
                },
                plotOptions: {
                    area: {
                        marker: {
                            radius: 3,
                        },
                        fillOpacity: 0.18,
                        threshold: 0,
                    },
                },
                series: [
                    {
                        type: 'area',
                        name: addon.locale.time,
                        data: this.dailyTrendStats.data,
                    } as SeriesAreaOptions,
                ],
            };
        },
        timePreferenceStats(): TimePreferenceStat[] {
            return buildTimePreferenceStats({
                night: this.insightLabels.night,
                morning: this.insightLabels.morning,
                afternoon: this.insightLabels.afternoon,
                evening: this.insightLabels.evening,
            });
        },
        preferredTimePreference(): TimePreferenceStat {
            return [...this.timePreferenceStats].sort((a, b) => b.totalS - a.totalS)[0];
        },
        sessionStats(): ReadingSessionStats {
            return kernel.sessionStats;
        },
        totalTimeLabel(): string {
            return toTimeString(this.totalTime);
        },
        todayTimeLabel(): string {
            return toTimeString(this.todayTime);
        },
        sortedLiteratureRecords(): LiteratureRecord[] {
            return [...this.literatureRecords].sort((a, b) => {
                if (this.literatureSortMode == 'duration') return b.totalS - a.totalS;
                return b.lastTime - a.lastTime;
            });
        },
        topLiteratureRecords(): LiteratureRecord[] {
            return [...this.literatureRecords].sort((a, b) => b.totalS - a.totalS).slice(0, 5);
        },
        unfinishedHeavyRecords(): LiteratureRecord[] {
            return [...this.literatureRecords]
                .filter(record => record.progress < 100)
                .sort((a, b) => b.totalS - a.totalS)
                .slice(0, 5);
        },
        almostDoneRecords(): LiteratureRecord[] {
            return [...this.literatureRecords]
                .filter(record => record.progress >= 80 && record.progress < 100)
                .sort((a, b) => b.progress - a.progress || b.totalS - a.totalS)
                .slice(0, 5);
        },
        resumedRecords(): Array<LiteratureRecord & { gapDays: number }> {
            const recentCutoff = Date.now() / 1000 - 30 * 86400;
            return this.literatureRecords
                .map(record => {
                    const days = Array.from(
                        new Set(
                            getHistoryPeriods(record.histories)
                                .map(period => getDayNumber(new Date(period.time * 1000)))
                                .sort((a, b) => a - b),
                        ),
                    );
                    const latest = days.at(-1),
                        previous = days.at(-2);
                    return {
                        ...record,
                        gapDays: latest && previous ? latest - previous : 0,
                    };
                })
                .filter(record => record.lastTime >= recentCutoff && record.gapDays >= 14)
                .sort((a, b) => b.lastTime - a.lastTime)
                .slice(0, 5);
        },
        tagInvestmentStats(): TagInvestmentStat[] {
            return buildTagInvestmentStats(this.literatureRecords);
        },
        selectedHistoryRows(): Array<{ title: string; totalS: number; lastTime: number; progress: number }> {
            return (
                this.selectedLiteratureRecord?.histories.map(history => {
                    const attachment = Zotero.Items.getByLibraryAndKey(history.note.libraryID, history.key) as
                        | false
                        | Zotero.Item;
                    return {
                        title: attachment ? (attachment.getField('title') as string) : history.key,
                        totalS: history.record.totalS,
                        lastTime: history.record.lastTime ?? 0,
                        progress: createReadingKernelSnapshot([history]).progressPercent,
                    };
                }) ?? []
            );
        },
    },
    async mounted() {
        const { data, series } = await drawVariablePie();
        this.pieData = data;
        this.drilldownSeries = series;
        this.pieLoading = false;
    },
    methods: {
        formatTime(seconds: number): string {
            return toTimeString(seconds);
        },
        formatDateTime(seconds: number): string {
            return seconds ? new Date(seconds * 1000).toLocaleString() : '-';
        },
        openLiteratureDetail(record: LiteratureRecord) {
            this.selectedLiteratureRecord = record;
            this.detailVisible = true;
        },
    },
};
</script>

<template>
    <main class="overview-page">
        <section class="summary-overview">
            <article class="progress-card">
                <TProgress theme="circle" size="medium" :percentage="overallProgress" />
                <div class="progress-copy">
                    <span class="metric-label">{{ locale.overallProgress }}</span>
                    <strong>{{ overallProgress }}%</strong>
                </div>
            </article>
            <div class="metric-strip">
                <div class="metric-item">
                    <span class="metric-label">{{ locale.totalTime }}</span>
                    <strong>{{ totalTimeLabel }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ locale.chartTitle.readToday }}</span>
                    <strong>{{ todayTimeLabel }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ locale.progressLabel.PDFs }}</span>
                    <strong>{{ attachmentCount }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ literatureLabels.activeDays }}</span>
                    <strong>{{ activeDays }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ insightLabels.recentStreak }}</span>
                    <strong>{{ streakStats.recent }} {{ insightLabels.days }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ insightLabels.longestStreak }}</span>
                    <strong>{{ streakStats.longest }} {{ insightLabels.days }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ extraLabels.sessionCount }}</span>
                    <strong>{{ sessionStats.count }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ extraLabels.averageSession }}</span>
                    <strong>{{ formatTime(sessionStats.averageS) }}</strong>
                </div>
                <div class="metric-item">
                    <span class="metric-label">{{ extraLabels.longestSession }}</span>
                    <strong>{{ formatTime(sessionStats.longestS) }}</strong>
                </div>
            </div>
        </section>

        <section class="panel skyline-panel">
            <div class="panel-header">
                <h2>{{ locale.chartTitle.dateTime }}</h2>
                <span>{{ locale.totalTime }}: {{ totalTimeLabel }}</span>
            </div>
            <Skyline />
        </section>

        <section class="chart-grid">
            <article class="panel">
                <div class="panel-header">
                    <h2>{{ locale.chartTitle.schedule }}</h2>
                    <span>{{ locale.time }}</span>
                </div>
                <Chart :options="scheduleOptions" />
            </article>
            <article class="panel">
                <div class="panel-header">
                    <h2>{{ locale.chartTitle.pie }}</h2>
                    <span>{{ locale.chartTitle.pieSub }}</span>
                </div>
                <t-skeleton :loading="pieLoading" animation="gradient">
                    <Chart :options="pieOptions" />
                </t-skeleton>
            </article>
        </section>

        <section class="trend-grid">
            <article class="panel">
                <div class="panel-header trend-header">
                    <div>
                        <h2>{{ insightLabels.trendTitle }}</h2>
                        <span>{{ insightLabels.trendHint }}</span>
                    </div>
                    <t-radio-group v-model="trendRange" variant="default-filled" size="small">
                        <t-radio-button :value="7">7</t-radio-button>
                        <t-radio-button :value="30">30</t-radio-button>
                    </t-radio-group>
                </div>
                <Chart :options="trendOptions" />
            </article>

            <article class="panel preference-panel">
                <div class="panel-header">
                    <h2>{{ insightLabels.preferenceTitle }}</h2>
                    <span>{{ insightLabels.preferenceHint }}</span>
                </div>
                <div class="preference-summary">
                    <span>{{ insightLabels.preferred }}</span>
                    <strong>{{ preferredTimePreference.label }}</strong>
                    <b>{{ formatTime(preferredTimePreference.totalS) }}</b>
                </div>
                <div class="preference-list">
                    <div v-for="item in timePreferenceStats" :key="item.key" class="preference-item">
                        <div class="preference-row">
                            <span>{{ item.label }}</span>
                            <b>{{ formatTime(item.totalS) }}</b>
                        </div>
                        <t-progress theme="line" size="small" :percentage="item.percent" />
                    </div>
                </div>
            </article>
        </section>

        <section class="insight-grid">
            <article class="panel insight-panel">
                <div class="panel-header">
                    <h2>{{ insightLabels.topTitle }}</h2>
                    <span>{{ insightLabels.topHint }}</span>
                </div>
                <ol v-if="topLiteratureRecords.length" class="rank-list">
                    <li
                        v-for="(record, index) in topLiteratureRecords"
                        :key="record.id || record.title"
                        @click="openLiteratureDetail(record)"
                    >
                        <span class="rank-index">{{ index + 1 }}</span>
                        <div class="rank-content">
                            <strong>{{ record.title }}</strong>
                            <span>{{ record.author }} · {{ formatDateTime(record.lastTime) }}</span>
                        </div>
                        <b>{{ formatTime(record.totalS) }}</b>
                    </li>
                </ol>
                <div v-else class="empty-list">{{ insightLabels.empty }}</div>
            </article>

            <article class="panel insight-panel">
                <div class="panel-header">
                    <h2>{{ insightLabels.unfinishedTitle }}</h2>
                    <span>{{ insightLabels.unfinishedHint }}</span>
                </div>
                <ol v-if="unfinishedHeavyRecords.length" class="rank-list">
                    <li
                        v-for="record in unfinishedHeavyRecords"
                        :key="record.id || record.title"
                        @click="openLiteratureDetail(record)"
                    >
                        <span class="progress-badge">{{ record.progress }}%</span>
                        <div class="rank-content">
                            <strong>{{ record.title }}</strong>
                            <span>{{ record.author }} · {{ formatDateTime(record.lastTime) }}</span>
                        </div>
                        <b>{{ formatTime(record.totalS) }}</b>
                    </li>
                </ol>
                <div v-else class="empty-list">{{ insightLabels.empty }}</div>
            </article>
        </section>

        <section class="insight-grid">
            <article class="panel insight-panel">
                <div class="panel-header">
                    <h2>{{ extraLabels.almostDoneTitle }}</h2>
                    <span>{{ extraLabels.almostDoneHint }}</span>
                </div>
                <ol v-if="almostDoneRecords.length" class="rank-list">
                    <li
                        v-for="record in almostDoneRecords"
                        :key="record.id || record.title"
                        @click="openLiteratureDetail(record)"
                    >
                        <span class="progress-badge">{{ record.progress }}%</span>
                        <div class="rank-content">
                            <strong>{{ record.title }}</strong>
                            <span>{{ record.author }} - {{ formatDateTime(record.lastTime) }}</span>
                        </div>
                        <b>{{ formatTime(record.totalS) }}</b>
                    </li>
                </ol>
                <div v-else class="empty-list">{{ insightLabels.empty }}</div>
            </article>

            <article class="panel insight-panel">
                <div class="panel-header">
                    <h2>{{ extraLabels.resumedTitle }}</h2>
                    <span>{{ extraLabels.resumedHint }}</span>
                </div>
                <ol v-if="resumedRecords.length" class="rank-list">
                    <li
                        v-for="record in resumedRecords"
                        :key="record.id || record.title"
                        @click="openLiteratureDetail(record)"
                    >
                        <span class="rank-index">{{ record.gapDays }}</span>
                        <div class="rank-content">
                            <strong>{{ record.title }}</strong>
                            <span
                                >{{ extraLabels.gapDays }}: {{ record.gapDays }} -
                                {{ formatDateTime(record.lastTime) }}</span
                            >
                        </div>
                        <b>{{ formatTime(record.totalS) }}</b>
                    </li>
                </ol>
                <div v-else class="empty-list">{{ insightLabels.empty }}</div>
            </article>

            <article class="panel insight-panel">
                <div class="panel-header">
                    <h2>{{ extraLabels.tagsTitle }}</h2>
                    <span>{{ extraLabels.tagsHint }}</span>
                </div>
                <div v-if="tagInvestmentStats.length" class="tag-list">
                    <div v-for="tag in tagInvestmentStats" :key="tag.name" class="tag-item">
                        <div class="preference-row">
                            <span>{{ tag.name }} · {{ tag.count }} {{ locale.itemsCount }}</span>
                            <b>{{ formatTime(tag.totalS) }}</b>
                        </div>
                        <t-progress theme="line" size="small" :percentage="tag.percent" />
                    </div>
                </div>
                <div v-else class="empty-list">{{ insightLabels.empty }}</div>
            </article>
        </section>

        <section class="panel literature-panel">
            <div class="panel-header literature-header">
                <div>
                    <h2>{{ literatureLabels.title }}</h2>
                    <span>{{ sortedLiteratureRecords.length }} {{ locale.itemsCount }}</span>
                </div>
                <t-radio-group v-model="literatureSortMode" variant="default-filled" size="small">
                    <t-radio-button value="latest">{{ literatureLabels.latest }} ↓</t-radio-button>
                    <t-radio-button value="duration">{{ literatureLabels.duration }} ↓</t-radio-button>
                </t-radio-group>
            </div>

            <div class="literature-table-wrap">
                <table class="literature-table">
                    <thead>
                        <tr>
                            <th>{{ locale.itemTitle }}</th>
                            <th>{{ locale.author }}</th>
                            <th>{{ literatureLabels.duration }}</th>
                            <th>{{ literatureLabels.latest }}</th>
                            <th>{{ locale.readingProgress }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="record in sortedLiteratureRecords"
                            :key="record.id || record.title"
                            @click="openLiteratureDetail(record)"
                        >
                            <td>
                                <div class="title-cell">
                                    <strong>{{ record.title }}</strong>
                                    <span>{{ record.attachmentCount }} {{ locale.progressLabel.PDFs }}</span>
                                </div>
                            </td>
                            <td>{{ record.author }}</td>
                            <td>{{ formatTime(record.totalS) }}</td>
                            <td>
                                {{
                                    record.lastTime ? new Date(record.lastTime * 1000).toLocaleString() : '-'
                                }}
                            </td>
                            <td>
                                <div class="progress-cell">
                                    <t-progress theme="line" size="small" :percentage="record.progress" />
                                    <span>{{ record.progress }}%</span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <t-drawer
            v-model:visible="detailVisible"
            :header="extraLabels.detailTitle"
            size="480px"
            :footer="false"
        >
            <div v-if="selectedLiteratureRecord" class="detail-panel">
                <h3>{{ selectedLiteratureRecord.title }}</h3>
                <p>{{ selectedLiteratureRecord.author }}</p>
                <div class="detail-grid">
                    <div>
                        <span>{{ literatureLabels.duration }}</span>
                        <strong>{{ formatTime(selectedLiteratureRecord.totalS) }}</strong>
                    </div>
                    <div>
                        <span>{{ literatureLabels.latest }}</span>
                        <strong>{{ formatDateTime(selectedLiteratureRecord.lastTime) }}</strong>
                    </div>
                    <div>
                        <span>{{ locale.readingProgress }}</span>
                        <strong>{{ selectedLiteratureRecord.progress }}%</strong>
                    </div>
                    <div>
                        <span>{{ locale.progressLabel.PDFs }}</span>
                        <strong>{{ selectedLiteratureRecord.attachmentCount }}</strong>
                    </div>
                </div>
                <div class="detail-attachments">
                    <h4>{{ locale.progressLabel.PDFs }}</h4>
                    <div v-for="row in selectedHistoryRows" :key="row.title" class="detail-attachment">
                        <strong>{{ row.title }}</strong>
                        <span>{{ formatTime(row.totalS) }} · {{ formatDateTime(row.lastTime) }}</span>
                        <t-progress theme="line" size="small" :percentage="row.progress" />
                    </div>
                </div>
            </div>
        </t-drawer>
    </main>
</template>

<style scoped>
.overview-page {
    background: var(--td-bg-color-page);
    box-sizing: border-box;
    display: grid;
    gap: 12px;
    min-height: 100vh;
    padding: 12px;
}

.progress-card,
.panel {
    background: var(--td-bg-color-container);
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 8px;
}

.summary-overview {
    background: var(--td-bg-color-container);
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 8px;
    display: grid;
    gap: 0;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    overflow: hidden;
}

.progress-card {
    align-items: center;
    border: 0;
    border-radius: 0;
    border-right: 1px solid var(--td-border-level-1-color);
    display: grid;
    gap: 12px;
    grid-template-columns: auto minmax(0, 1fr);
    min-height: 132px;
    min-width: 0;
    overflow: hidden;
    padding: 18px;
}

.metric-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    min-width: 0;
}

.metric-item {
    border-bottom: 1px solid var(--td-border-level-1-color);
    border-right: 1px solid var(--td-border-level-1-color);
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 12px 14px;
}

.metric-item:nth-child(3n) {
    border-right: 0;
}

.metric-item:nth-last-child(-n + 3) {
    border-bottom: 0;
}

.metric-item strong,
.progress-copy strong {
    color: var(--td-text-color-primary);
    font-size: 18px;
    font-weight: 600;
    line-height: 24px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.progress-copy strong {
    font-size: 24px;
    line-height: 30px;
}

.metric-label {
    color: var(--td-text-color-secondary);
    font-size: 12px;
    line-height: 18px;
}

.progress-copy {
    display: grid;
    min-width: 0;
}

.panel {
    overflow: hidden;
}

.panel-header {
    align-items: baseline;
    border-bottom: 1px solid var(--td-border-level-1-color);
    display: flex;
    gap: 10px;
    justify-content: space-between;
    min-height: 42px;
    padding: 10px 12px;
}

.panel-header h2 {
    color: var(--td-text-color-primary);
    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    margin: 0;
}

.panel-header span {
    color: var(--td-text-color-placeholder);
    font-size: 12px;
    line-height: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.skyline-panel {
    min-width: 0;
}

.chart-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
}

.trend-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.6fr);
}

.trend-header {
    align-items: center;
}

.trend-header > div {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.preference-panel {
    min-width: 0;
}

.preference-summary {
    align-items: baseline;
    border-bottom: 1px solid var(--td-border-level-1-color);
    display: grid;
    gap: 4px;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 14px 12px;
}

.preference-summary span {
    color: var(--td-text-color-secondary);
    font-size: 12px;
    grid-column: 1 / -1;
    line-height: 18px;
}

.preference-summary strong {
    color: var(--td-text-color-primary);
    font-size: 22px;
    font-weight: 600;
    line-height: 28px;
}

.preference-summary b {
    color: var(--td-text-color-secondary);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
}

.preference-list {
    display: grid;
    gap: 12px;
    padding: 12px;
}

.preference-item {
    display: grid;
    gap: 6px;
}

.preference-row {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
}

.preference-row span {
    color: var(--td-text-color-primary);
    font-size: 13px;
}

.preference-row b {
    color: var(--td-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
}

.insight-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
}

.insight-panel {
    min-width: 0;
}

.rank-list {
    display: grid;
    gap: 0;
    list-style: none;
    margin: 0;
    padding: 0;
}

.rank-list li {
    align-items: center;
    border-bottom: 1px solid var(--td-border-level-1-color);
    cursor: pointer;
    display: grid;
    gap: 10px;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    min-height: 58px;
    padding: 10px 12px;
}

.rank-list li:last-child {
    border-bottom: 0;
}

.rank-list li:hover {
    background: var(--td-bg-color-container-hover);
}

.rank-index,
.progress-badge {
    align-items: center;
    background: var(--td-bg-color-secondarycontainer);
    border-radius: 6px;
    color: var(--td-text-color-secondary);
    display: inline-flex;
    font-size: 12px;
    font-weight: 600;
    height: 28px;
    justify-content: center;
    min-width: 32px;
}

.progress-badge {
    background: var(--td-warning-color-light);
    color: var(--td-warning-color);
}

.rank-content {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.rank-content strong {
    color: var(--td-text-color-primary);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rank-content span {
    color: var(--td-text-color-placeholder);
    font-size: 12px;
    line-height: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rank-list b {
    color: var(--td-text-color-primary);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
}

.empty-list {
    color: var(--td-text-color-placeholder);
    font-size: 13px;
    padding: 24px 12px;
    text-align: center;
}

.tag-list {
    display: grid;
    gap: 12px;
    padding: 12px;
}

.tag-item {
    display: grid;
    gap: 6px;
}

.literature-header {
    align-items: center;
}

.literature-header > div {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.literature-table-wrap {
    overflow-x: auto;
}

.literature-table {
    border-collapse: collapse;
    color: var(--td-text-color-primary);
    font-size: 13px;
    min-width: 760px;
    width: 100%;
}

.literature-table th,
.literature-table td {
    border-bottom: 1px solid var(--td-border-level-1-color);
    padding: 10px 12px;
    text-align: left;
    vertical-align: middle;
}

.literature-table th {
    background: var(--td-bg-color-secondarycontainer);
    color: var(--td-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    position: sticky;
    top: 0;
    z-index: 1;
}

.literature-table tbody tr:hover {
    background: var(--td-bg-color-container-hover);
}

.literature-table tbody tr {
    cursor: pointer;
}

.title-cell {
    display: grid;
    gap: 2px;
    min-width: 260px;
}

.title-cell strong {
    font-weight: 500;
    line-height: 20px;
}

.title-cell span {
    color: var(--td-text-color-placeholder);
    font-size: 12px;
    line-height: 18px;
}

.progress-cell {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(120px, 1fr) 42px;
}

.progress-cell span {
    color: var(--td-text-color-secondary);
    font-size: 12px;
    text-align: right;
}

.detail-panel {
    display: grid;
    gap: 16px;
}

.detail-panel h3 {
    color: var(--td-text-color-primary);
    font-size: 18px;
    font-weight: 600;
    line-height: 26px;
    margin: 0;
}

.detail-panel p {
    color: var(--td-text-color-secondary);
    font-size: 13px;
    line-height: 20px;
    margin: -10px 0 0;
}

.detail-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-grid div {
    background: var(--td-bg-color-secondarycontainer);
    border-radius: 8px;
    display: grid;
    gap: 4px;
    min-height: 64px;
    padding: 10px;
}

.detail-grid span,
.detail-attachments h4 {
    color: var(--td-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    margin: 0;
}

.detail-grid strong {
    color: var(--td-text-color-primary);
    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.detail-attachments {
    display: grid;
    gap: 8px;
}

.detail-attachment {
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 8px;
    display: grid;
    gap: 6px;
    padding: 10px;
}

.detail-attachment strong {
    color: var(--td-text-color-primary);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
}

.detail-attachment span {
    color: var(--td-text-color-placeholder);
    font-size: 12px;
    line-height: 18px;
}

@media (max-width: 520px) {
    .overview-page {
        padding: 8px;
    }

    .summary-overview {
        grid-template-columns: 1fr;
    }

    .progress-card {
        border-bottom: 1px solid var(--td-border-level-1-color);
        border-right: 0;
        min-height: 104px;
    }

    .metric-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metric-item:nth-child(3n) {
        border-right: 1px solid var(--td-border-level-1-color);
    }

    .metric-item:nth-child(2n) {
        border-right: 0;
    }

    .metric-item:nth-last-child(-n + 3) {
        border-bottom: 1px solid var(--td-border-level-1-color);
    }

    .metric-item:last-child {
        border-bottom: 0;
    }

    .chart-grid {
        grid-template-columns: 1fr;
    }

    .trend-grid {
        grid-template-columns: 1fr;
    }

    .insight-grid {
        grid-template-columns: 1fr;
    }

    .panel-header {
        align-items: flex-start;
        flex-direction: column;
        gap: 2px;
    }

    .literature-header {
        align-items: flex-start;
    }
}
</style>
