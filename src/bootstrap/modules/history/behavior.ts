import { buildReadingEvents, type ReadingEvent } from './event';
import type { AttachmentHistory } from './history';
import { DEFAULT_SESSION_GAP_SECONDS, getHistoryPeriods, type ReadingPeriod } from './session';

export type ReadingBehaviorState = 'reading' | 'idle';

export interface ReadingBehaviorSegment {
    state: ReadingBehaviorState;
    start: number;
    end: number;
    duration: number;
}

export interface ReadingBehaviorStats {
    readingS: number;
    idleS: number;
    segmentCount: number;
}

export function buildReadingBehaviorSegments(
    histories: AttachmentHistory[],
    maxGap = DEFAULT_SESSION_GAP_SECONDS,
): ReadingBehaviorSegment[] {
    return buildBehaviorSegmentsFromEvents(buildReadingEvents(histories), maxGap);
}

export function buildBehaviorSegmentsFromEvents(
    events: ReadingEvent[],
    maxGap = DEFAULT_SESSION_GAP_SECONDS,
): ReadingBehaviorSegment[] {
    const sorted = [...events].sort((a, b) => a.at - b.at);
    return buildBehaviorSegments(
        sorted.map(event => ({ start: event.at, end: event.at + event.duration, duration: event.duration })),
        maxGap,
    );
}

export function buildBehaviorSegmentsFromPeriods(
    periods: ReadingPeriod[],
    maxGap = DEFAULT_SESSION_GAP_SECONDS,
): ReadingBehaviorSegment[] {
    const sorted = [...periods].sort((a, b) => a.time - b.time);
    return buildBehaviorSegments(
        sorted.map(period => ({
            start: period.time,
            end: period.time + period.duration,
            duration: period.duration,
        })),
        maxGap,
    );
}

function buildBehaviorSegments(
    durations: Array<{ start: number; end: number; duration: number }>,
    maxGap: number,
): ReadingBehaviorSegment[] {
    const sorted = [...durations].sort((a, b) => a.start - b.start),
        segments: ReadingBehaviorSegment[] = [];

    for (const duration of sorted) {
        const start = duration.start,
            end = duration.end,
            last = segments.at(-1);
        if (last && start > last.end && start - last.end <= maxGap) {
            segments.push({
                state: 'idle',
                start: last.end,
                end: start,
                duration: start - last.end,
            });
        }
        if (last && last.state == 'reading' && start <= last.end) {
            last.end = Math.max(last.end, end);
            last.duration = last.end - last.start;
        } else {
            segments.push({ state: 'reading', start, end, duration: duration.duration });
        }
    }

    return segments;
}

export function buildReadingBehaviorStats(segments: ReadingBehaviorSegment[]): ReadingBehaviorStats {
    return {
        readingS: segments
            .filter(segment => segment.state == 'reading')
            .reduce((sum, segment) => sum + segment.duration, 0),
        idleS: segments
            .filter(segment => segment.state == 'idle')
            .reduce((sum, segment) => sum + segment.duration, 0),
        segmentCount: segments.length,
    };
}
