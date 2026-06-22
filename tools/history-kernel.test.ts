import assert from 'node:assert/strict';

(globalThis as any).addon = {
    getPref(name: string) {
        if (name == 'completeThreshold') return 1;
        return 20;
    },
};

const mockItems = new Map<number, any>([
    [
        101,
        {
            id: 101,
            key: 'pdf-key',
            attachmentContentType: 'application/pdf',
            attachmentFilename: 'paper.pdf',
            isRegularItem: () => false,
            isSnapshotAttachment: () => false,
            getField: () => 'PDF',
        },
    ],
    [
        102,
        {
            id: 102,
            key: 'md-key',
            attachmentContentType: 'text/markdown',
            attachmentFilename: 'note.md',
            isRegularItem: () => false,
            isSnapshotAttachment: () => true,
            getField: () => 'Markdown',
        },
    ],
]);

(globalThis as any).Zotero = {
    Items: {
        get(id: number) {
            return mockItems.get(Number(id));
        },
        getIDFromLibraryAndKey(_libraryID: number, key: string) {
            if (key == 'pdf-key') return 101;
            if (key == 'md-key') return 102;
            return 0;
        },
        getByLibraryAndKey(_libraryID: number, key: string) {
            const id = this.getIDFromLibraryAndKey(_libraryID, key);
            return id ? mockItems.get(id) : false;
        },
        getLibraryAndKeyFromID(id: number) {
            const item = mockItems.get(Number(id));
            return item ? { libraryID: 1, key: item.key } : undefined;
        },
    },
    Users: {
        getCurrentUserID: () => 1,
    },
};

const { AttachmentRecord } = await import('../src/bootstrap/modules/history/data');
const { recordPagePeriod, recordScrollProgress } = await import('../src/bootstrap/modules/history/storage');
const { buildReadingEvents } = await import('../src/bootstrap/modules/history/event');
const { createReadingKernelSnapshot } = await import('../src/bootstrap/modules/history/kernel');
const { buildReadingSessionsFromEvents } = await import('../src/bootstrap/modules/history/session');

const pdfRecord = new AttachmentRecord(4);
recordPagePeriod({
    record: pdfRecord,
    itemID: 101,
    pageIndex: 0,
    pagesCount: 4,
    elapsedSeconds: 5,
    timestamp: 1000,
});
recordPagePeriod({
    record: pdfRecord,
    itemID: 101,
    pageIndex: 1,
    pagesCount: 4,
    elapsedSeconds: 5,
    timestamp: 2000,
});

const markdownRecord = new AttachmentRecord();
recordScrollProgress({
    record: markdownRecord,
    itemID: 102,
    progress: { kind: 'markdown', source: 'scroll', ratio: 0.25 },
    elapsedSeconds: 3,
    timestamp: 3000,
});
recordScrollProgress({
    record: markdownRecord,
    itemID: 102,
    progress: { kind: 'markdown', source: 'scroll', ratio: 0.75 },
    elapsedSeconds: 4,
    timestamp: 4000,
});

const histories = [
    { note: { libraryID: 1 }, key: 'pdf-key', record: pdfRecord },
    { note: { libraryID: 1 }, key: 'md-key', record: markdownRecord },
] as any;

const events = buildReadingEvents(histories);
assert.equal(events.length, 4);
assert.deepEqual(
    events.filter(event => event.position.kind == 'scroll').map(event => (event.position as any).ratio),
    [0.25, 0.75],
);

const snapshot = createReadingKernelSnapshot(histories);
assert.equal(snapshot.totalS, 17);
assert.equal(snapshot.resourceCounts.pdf, 1);
assert.equal(snapshot.resourceCounts.markdown, 1);
assert.equal(snapshot.progress.children.length, 2);
assert.equal(snapshot.progressPercent, 55);

const sessions = buildReadingSessionsFromEvents(events);
assert.equal(sessions.length, 1);
assert.equal(sessions[0].totalS, 17);

console.log('history kernel tests passed');
