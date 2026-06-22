import type { ReadingEvent } from './event';

export interface ReadingStreakStats {
    recent: number;
    longest: number;
}

export interface DailyTrendStats {
    categories: string[];
    data: number[];
}

export interface DateTimeStat {
    date: number;
    time: number;
}

export interface ScheduleStats {
    weekData: number[];
    hourData: number[];
}

export interface TimeBucketDefinition<K extends string = string> {
    key: K;
    label: string;
    start: number;
    end: number;
}

export interface TimeBucketStat<K extends string = string> {
    key: K;
    label: string;
    totalS: number;
    percent: number;
}

export function buildTimeBucketStats<K extends string>(
    events: ReadingEvent[],
    buckets: Array<TimeBucketDefinition<K>>,
): Array<TimeBucketStat<K>> {
    const total = events.reduce((sum, event) => sum + event.duration, 0),
        stats = buckets.map(bucket => ({ ...bucket, totalS: 0 }));

    for (const event of events) {
        const hour = new Date(event.at * 1000).getHours(),
            bucket = stats.find(item => hour >= item.start && hour < item.end);
        if (bucket) bucket.totalS += event.duration;
    }

    return stats.map(({ key, label, totalS }) => ({
        key,
        label,
        totalS,
        percent: total > 0 ? Math.round((totalS / total) * 100) : 0,
    }));
}

export function buildScheduleStatsFromEvents(events: ReadingEvent[]): ScheduleStats {
    const weekData = new Array(7).fill(0),
        hourData = new Array(24).fill(0);

    for (const event of events) {
        const date = new Date(event.at * 1000);
        weekData[date.getDay()] += event.duration;
        hourData[date.getHours()] += event.duration;
    }

    return { weekData, hourData };
}

export function buildReadingStreakStatsFromEvents(events: ReadingEvent[]): ReadingStreakStats {
    const days = Array.from(
        new Set(
            events.filter(event => event.duration > 0).map(event => getDayNumber(new Date(event.at * 1000))),
        ),
    ).sort((a, b) => a - b);
    if (!days.length) return { recent: 0, longest: 0 };

    let current = 1,
        longest = 1;
    for (let i = 1; i < days.length; i++) {
        current = days[i] - days[i - 1] == 1 ? current + 1 : 1;
        longest = Math.max(longest, current);
    }

    const today = getDayNumber(new Date()),
        latest = days.at(-1)!,
        recent = today - latest > 1 ? 0 : current;
    return { recent, longest };
}

export function buildDailyTrendStatsFromEvents(
    events: ReadingEvent[],
    range: number,
    locale: string,
): DailyTrendStats {
    const map = buildDateTimeMap(events),
        categories: string[] = [],
        data: number[] = [],
        today = new Date();
    for (let offset = range - 1; offset >= 0; offset--) {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset),
            key = date.toLocaleDateString();
        categories.push(
            new Intl.DateTimeFormat(locale, {
                month: 'numeric',
                day: 'numeric',
            }).format(date),
        );
        data.push(map[key]?.time ?? 0);
    }
    return { categories, data };
}

export function buildDateTimeStatsFromEvents(events: ReadingEvent[]): DateTimeStat[] {
    return Object.values(buildDateTimeMap(events)).sort((a, b) => a.date - b.date);
}

export function getActiveReadingDays(events: ReadingEvent[]): number {
    return new Set(
        events.filter(event => event.duration > 0).map(event => getDayNumber(new Date(event.at * 1000))),
    ).size;
}

export function getReadSecondsByDate(events: ReadingEvent[], date: Date): number {
    const targetDay = getDayNumber(date);
    return events.reduce((sum, event) => {
        return getDayNumber(new Date(event.at * 1000)) == targetDay ? sum + event.duration : sum;
    }, 0);
}

function buildDateTimeMap(events: ReadingEvent[]): Record<string, { date: number; time: number }> {
    const result: Record<string, { date: number; time: number }> = {};
    for (const event of events) {
        const date = new Date(event.at * 1000),
            key = date.toLocaleDateString();
        result[key] ??= {
            date: date.getTime(),
            time: 0,
        };
        result[key].time += event.duration;
    }
    return result;
}

export function getDayNumber(date: Date) {
    return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);
}
