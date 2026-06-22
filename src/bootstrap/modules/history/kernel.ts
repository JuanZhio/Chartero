import {
    buildBehaviorSegmentsFromEvents,
    buildReadingBehaviorStats,
    type ReadingBehaviorSegment,
    type ReadingBehaviorStats,
} from './behavior';
import { buildReadingEvents, type ReadingEvent } from './event';
import type { AttachmentHistory } from './history';
import { type DerivedProgress, getDerivedProgress, getProgressPercent } from './progress';
import {
    countResourceKinds,
    type ReadingResource,
    type ResourceKindCounts,
    resolveReadingResource,
} from './resource';
import {
    buildReadingSessionStatsFromSessions,
    buildReadingSessionsFromEvents,
    getHistoryPeriods,
    type ReadingPeriod,
    type ReadingSession,
    type ReadingSessionStats,
} from './session';

export interface ReadingKernelSnapshot {
    histories: AttachmentHistory[];
    resources: ReadingResource[];
    resourceCounts: ResourceKindCounts;
    totalS: number;
    events: ReadingEvent[];
    progress: DerivedProgress;
    progressPercent: number;
    periods: ReadingPeriod[];
    sessions: ReadingSession[];
    sessionStats: ReadingSessionStats;
    behaviorSegments: ReadingBehaviorSegment[];
    behaviorStats: ReadingBehaviorStats;
}

export interface ReadingKernelBounds {
    firstTime: number;
    lastTime: number;
}

function getZotero() {
    return typeof Zotero != 'undefined' ? Zotero : addon.getGlobal('Zotero');
}

export function createReadingKernelSnapshot(histories: AttachmentHistory[]): ReadingKernelSnapshot {
    const zotero = getZotero();
    const periods = getHistoryPeriods(histories),
        events = buildReadingEvents(histories),
        sessions = buildReadingSessionsFromEvents(events),
        behaviorSegments = buildBehaviorSegmentsFromEvents(events),
        resources = histories
            .map(history => zotero.Items.getIDFromLibraryAndKey(history.note.libraryID, history.key))
            .filter((itemID): itemID is number => !!itemID)
            .map(resolveReadingResource);

    return {
        histories,
        resources,
        resourceCounts: countResourceKinds(resources),
        totalS: histories.reduce((sum, history) => sum + history.record.totalS, 0),
        events,
        progress: getDerivedProgress(histories),
        progressPercent: getProgressPercent(histories),
        periods,
        sessions,
        sessionStats: buildReadingSessionStatsFromSessions(sessions),
        behaviorSegments,
        behaviorStats: buildReadingBehaviorStats(behaviorSegments),
    };
}

export function getReadingKernelBounds(snapshot: ReadingKernelSnapshot): ReadingKernelBounds {
    if (!snapshot.events.length) return { firstTime: 0, lastTime: 0 };
    return snapshot.events.reduce(
        (bounds, event) => ({
            firstTime: Math.min(bounds.firstTime, event.at),
            lastTime: Math.max(bounds.lastTime, event.at + event.duration),
        }),
        { firstTime: Infinity, lastTime: 0 },
    );
}

export function createReadingKernelSnapshotForItem(item: Zotero.Item): ReadingKernelSnapshot {
    if (item.isRegularItem()) return createReadingKernelSnapshot(addon.history.getInTopLevelSync(item));
    const history = addon.history.getByAttachment(item);
    return createReadingKernelSnapshot(history ? [history] : []);
}

export function getHistoryItemID(history: AttachmentHistory): number | undefined {
    return getZotero().Items.getIDFromLibraryAndKey(history.note.libraryID, history.key) || undefined;
}

export function getHistoryItem(history: AttachmentHistory): Zotero.Item | undefined {
    const itemID = getHistoryItemID(history);
    return itemID ? getZotero().Items.get(itemID) : undefined;
}

export function getHistoryTitle(history: AttachmentHistory): string | undefined {
    return getHistoryItem(history)?.getField('title') as string | undefined;
}
