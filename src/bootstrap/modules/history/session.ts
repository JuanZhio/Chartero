import { buildReadingEvents, type ReadingEvent } from './event';
import type { AttachmentHistory } from './history';

export const DEFAULT_SESSION_GAP_SECONDS = 30 * 60;

export interface ReadingPeriod {
    time: number;
    duration: number;
}

export interface ReadingSession {
    start: number;
    end: number;
    totalS: number;
}

export interface ReadingSessionStats {
    count: number;
    averageS: number;
    longestS: number;
    latestS: number;
}

export function getHistoryPeriods(histories: AttachmentHistory[]): ReadingPeriod[] {
    return histories.flatMap(history =>
        history.record.pageArr.flatMap(page =>
            Object.entries(page.period ?? {}).map(([time, duration]) => ({
                time: Number(time),
                duration,
            })),
        ),
    );
}

export function buildReadingSessions(
    histories: AttachmentHistory[],
    maxGap = DEFAULT_SESSION_GAP_SECONDS,
): ReadingSession[] {
    return buildReadingSessionsFromEvents(buildReadingEvents(histories), maxGap);
}

export function buildReadingSessionsFromEvents(
    events: ReadingEvent[],
    maxGap = DEFAULT_SESSION_GAP_SECONDS,
): ReadingSession[] {
    const periods = events
            .map(event => ({ time: event.at, duration: event.duration }))
            .sort((a, b) => a.time - b.time),
        sessions: ReadingSession[] = [];

    for (const period of periods) {
        const last = sessions.at(-1),
            periodEnd = period.time + period.duration;
        if (!last || period.time - last.end > maxGap) {
            sessions.push({ start: period.time, end: periodEnd, totalS: period.duration });
        } else {
            last.end = Math.max(last.end, periodEnd);
            last.totalS += period.duration;
        }
    }

    return sessions;
}

export function buildReadingSessionStats(histories: AttachmentHistory[]): ReadingSessionStats {
    return buildReadingSessionStatsFromSessions(buildReadingSessions(histories));
}

export function buildReadingSessionStatsFromSessions(sessions: ReadingSession[]): ReadingSessionStats {
    if (!sessions.length) return { count: 0, averageS: 0, longestS: 0, latestS: 0 };

    const totalS = sessions.reduce((sum, session) => sum + session.totalS, 0),
        longestS = Math.max(...sessions.map(session => session.totalS)),
        latestS = sessions.at(-1)?.totalS ?? 0;
    return {
        count: sessions.length,
        averageS: Math.round(totalS / sessions.length),
        longestS,
        latestS,
    };
}
