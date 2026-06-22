import { AttachmentRecord, HISTORY_SCHEMA_VERSION, PageRecord } from './data';
import type { StoredScrollProgress } from './progress';

export interface RecordPeriodInput {
    record: AttachmentRecord;
    itemID: number;
    pageIndex: number;
    elapsedSeconds: number;
    timestamp: number;
    pagesCount?: number;
}

export interface RecordScrollProgressInput {
    record: AttachmentRecord;
    itemID: number;
    progress: StoredScrollProgress;
    elapsedSeconds: number;
    timestamp: number;
}

export function recordPagePeriod(input: RecordPeriodInput): void {
    const page = (input.record.pages[input.pageIndex] ??= new PageRecord());
    input.record.schemaVersion = HISTORY_SCHEMA_VERSION;
    input.record.numPages ??= input.pagesCount;
    recordPeriod(page, input.itemID, input.elapsedSeconds, input.timestamp);
}

export function recordScrollProgress(input: RecordScrollProgressInput): void {
    const page = (input.record.pages[0] ??= new PageRecord());
    input.record.schemaVersion = HISTORY_SCHEMA_VERSION;
    const timeKey = recordPeriod(page, input.itemID, input.elapsedSeconds, input.timestamp),
        progress = (input.record.progress = {
            ...input.progress,
            positions: input.record.progress?.positions,
        });
    progress.positions ??= {};
    progress.positions[timeKey] = input.progress.ratio;
}

function recordPeriod(page: PageRecord, itemID: number, elapsedSeconds: number, timestamp: number): number {
    page.period ??= {};
    const timeKey = Math.round(timestamp / 1000);
    page.period[timeKey] = (page.period[timeKey] ?? 0) + elapsedSeconds;

    const item = Zotero.Items.getLibraryAndKeyFromID(itemID);
    if (item && item.libraryID > 1) {
        page.userSeconds ??= {};
        const userID = Zotero.Users.getCurrentUserID();
        page.userSeconds[userID] = (page.userSeconds[userID] ?? 0) + elapsedSeconds;
    }
    return timeKey;
}
