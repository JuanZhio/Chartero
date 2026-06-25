<template>
    <div class="skyline-layout">
        <div class="week-layout">
            <span>{{ weekdayLabels[1] }}</span>
            <span>{{ weekdayLabels[3] }}</span>
            <span>{{ weekdayLabels[5] }}</span>
        </div>
        <div class="heatmap-wrap">
            <div class="month-layout">
                <span v-for="month in 13" :key="month">
                    {{ monthLabels[(now.getMonth() + month - 1) % 12] }}
                </span>
            </div>
            <t-skeleton :loading="loading" animation="gradient">
                <div class="block-container">
                    <TTooltip
                        v-for="block of blocks"
                        :key="block.description"
                        :content="block.description"
                        show-arrow
                    >
                        <div
                            class="day-block"
                            :style="{ backgroundColor: block.color }"
                            @click="onBlockClick(block.time)"
                        />
                    </TTooltip>
                </div>
                <div class="heatmap-legend">
                    <span>{{ legendLabels.less }}</span>
                    <i v-for="color in legendColors" :key="color" :style="{ backgroundColor: color }" />
                    <span>{{ legendLabels.more }}</span>
                </div>
            </t-skeleton>
        </div>
    </div>
</template>

<script lang="ts">
import { MessagePlugin } from 'tdesign-vue-next';
import { nextTick } from 'vue';
import { getReadSecondsByDate } from '$/history/analytics';
import { createReadingKernelSnapshot } from '$/history/kernel';
import { toTimeString } from '$/utils';

export default {
    data() {
        return {
            weekdayLabels: addon.locale.weekdays ?? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            now: new Date(),
            blocks: [] as Array<{
                color: string;
                time: string;
                description: string;
            }>,
            legendLabels: navigator.language.startsWith('zh')
                ? { less: '较少', more: '较多' }
                : { less: 'Less', more: 'More' },
            legendColors: [] as string[],
            loading: true,
            colorScheme: undefined as MediaQueryList | undefined,
        };
    },
    computed: {
        monthLabels(): string[] {
            const locale = addon.getGlobal('Zotero').locale || navigator.language;
            return Array.from({ length: 12 }, (_, month) =>
                new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2026, month, 1)),
            );
        },
    },
    mounted() {
        setTimeout(this.init, 10);
        this.colorScheme = matchMedia('(prefers-color-scheme: dark)') ?? undefined;
        this.colorScheme?.addEventListener('change', this.handleColorSchemeChange);
    },
    beforeUnmount() {
        this.colorScheme?.removeEventListener('change', this.handleColorSchemeChange);
    },
    methods: {
        handleColorSchemeChange(e: MediaQueryListEvent) {
            this.init(e.matches);
        },
        init(isDark: boolean) {
            const now = this.now,
                firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 364);

            function forEachBlock<T>(fun: (week: number, day: number) => T): T[] {
                const result = [];
                for (let i = 0; i < 53; ++i)
                    for (let j = 0; j <= (i < 52 ? 6 : now.getDay()); ++j) result.push(fun(i, j));
                return result;
            }

            function getDate(i: number, j: number) {
                const date = new Date(firstDay);
                date.setDate(firstDay.getDate() + i * 7 + j);
                return date;
            }

            const lightColors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
                darkColors = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
                colors = isDark ? darkColors : lightColors,
                kernel = createReadingKernelSnapshot(addon.history.getInLibrary()),
                readingS = forEachBlock((week: number, day: number) =>
                    getReadSecondsByDate(kernel.events, getDate(week, day)),
                ),
                orderlyReadingS = readingS.filter(e => e > 0).sort((l, r) => l - r);
            this.legendColors = colors.slice(1);
            this.blocks = forEachBlock((week: number, day: number) => {
                const index = week * 7 + day;
                let color = colors[0];
                if (readingS[index] > 0) {
                    const min = orderlyReadingS[0],
                        max = orderlyReadingS.at(-1)!,
                        percent = max == min ? 1 : (readingS[index] - min) / (max - min),
                        level = Math.min(4, Math.max(1, Math.ceil(percent * 4)));
                    color = colors[level];
                }
                return {
                    color,
                    time: toTimeString(readingS[index]),
                    description: `${getDate(week, day).toLocaleDateString(addon.getGlobal('Zotero').locale)} - ${toTimeString(
                        readingS[index],
                    )}`,
                };
            });
            nextTick(() => (this.loading = false));
        },
        onBlockClick(message: string) {
            MessagePlugin.info(message);
        },
    },
};
</script>

<style scoped>
.skyline-layout {
    box-sizing: border-box;
    display: grid;
    gap: 8px;
    grid-template-columns: 28px minmax(0, 1fr);
    padding: 12px;
}

.week-layout {
    color: var(--td-text-color-placeholder);
    display: grid;
    font-size: 11px;
    grid-template-rows: repeat(3, 1fr);
    line-height: 1;
    padding-top: 28px;
    text-align: right;
}

.heatmap-wrap {
    min-width: 0;
    overflow-x: auto;
    padding-bottom: 2px;
}

.month-layout {
    color: var(--td-text-color-placeholder);
    display: grid;
    font-size: 11px;
    grid-template-columns: repeat(13, minmax(42px, 1fr));
    line-height: 18px;
    min-width: 640px;
}

.block-container {
    display: grid;
    gap: 3px;
    grid-auto-flow: column;
    grid-template-columns: repeat(53, 1fr);
    grid-template-rows: repeat(7, 1fr);
    min-width: 640px;
}

.heatmap-legend {
    align-items: center;
    color: var(--td-text-color-placeholder);
    display: flex;
    font-size: 11px;
    gap: 4px;
    justify-content: flex-end;
    line-height: 16px;
    margin-top: 8px;
    min-width: 640px;
}

.heatmap-legend i {
    border-radius: 3px;
    display: block;
    height: 10px;
    width: 10px;
}

.day-block {
    aspect-ratio: 1;
    border-radius: 3px;
    cursor: pointer;
    min-width: 9px;
    transition:
        box-shadow 0.2s,
        transform 0.2s;
}

.day-block:hover {
    box-shadow: 0 0 0 2px var(--td-brand-color-focus);
    transform: scale(1.08);
}
</style>
