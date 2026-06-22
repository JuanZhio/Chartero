import { buildDateTimeStatsFromEvents } from './analytics';
import type { AttachmentHistory } from './history';
import {
    createReadingKernelSnapshot,
    createReadingKernelSnapshotForItem,
    getHistoryItem,
    getHistoryItemID,
    getReadingKernelBounds,
    type ReadingKernelSnapshot,
} from './kernel';

export default class HistoryAnalyzer {
    private readonly data: AttachmentHistory[];
    private readonly snapshot: ReadingKernelSnapshot;
    private _attachments: Array<false | Zotero.Item>;

    constructor(data: MaybeArray<AttachmentHistory> | Zotero.Item) {
        if (Array.isArray(data)) {
            this.data = data;
            this.snapshot = createReadingKernelSnapshot(data);
        } else if (data instanceof addon.getGlobal('Zotero').Item) {
            this.snapshot = createReadingKernelSnapshotForItem(data);
            this.data = this.snapshot.histories;
        } else {
            this.data = [data];
            this.snapshot = createReadingKernelSnapshot(this.data);
        }
        this._attachments = [];
    }

    get ids() {
        return this.data.map(getHistoryItemID);
    }

    get attachments() {
        if (this._attachments.length != this.data.length)
            this._attachments = this.data.map(attHis => getHistoryItem(attHis) ?? false);
        return this._attachments;
    }

    get validAttachments() {
        return this.attachments.filter(att => att) as Zotero.Item[];
    }

    get titles() {
        return this.attachments.map(att => (att ? (att.getField('title') as string) : undefined));
    }

    get parents() {
        return this.validAttachments.map(att => att.parentItem);
    }

    getByDate(date: Date) {
        return this.accumulatePeriodIf(time => time.toDateString() == date.toDateString());
    }

    getByDay(day: number) {
        return this.accumulatePeriodIf(time => time.getDay() == day);
    }

    getByHour(hour: number) {
        return this.accumulatePeriodIf(time => time.getHours() == hour);
    }

    get firstTime() {
        return getReadingKernelBounds(this.snapshot).firstTime;
    }

    get lastTime() {
        return getReadingKernelBounds(this.snapshot).lastTime;
    }

    get progress() {
        return this.snapshot.progressPercent;
    }

    get totalS() {
        return this.snapshot.totalS;
    }

    get dateTimeMap() {
        const result: { [key: string]: { date: number; time: number } } = {};
        for (const stat of this.dateTimeStats) result[new Date(stat.date).toLocaleDateString()] = stat;
        return result;
    }

    get dateTimeStats() {
        return buildDateTimeStatsFromEvents(this.snapshot.events);
    }

    private accumulatePeriodIf(predicate: (time: Date) => boolean) {
        return this.snapshot.events.reduce(
            (sum, event) => (predicate(new Date(event.at * 1000)) ? sum + event.duration : sum),
            0,
        );
    }

    forEachPeriod(callback: (time: Date, period: number) => void) {
        for (const event of this.snapshot.events) callback(new Date(event.at * 1000), event.duration);
    }
}
