import type { AttachmentHistory } from './history';
import { type ReadingResource, resolveReadingResource } from './resource';

export type ReadingEventType = 'duration';

export type ReadingEventPosition =
    | {
          kind: 'page';
          pageIndex: number;
          pageCount?: number;
      }
    | {
          kind: 'scroll';
          ratio: number;
      };

export interface ReadingEvent {
    type: ReadingEventType;
    at: number;
    duration: number;
    attachmentKey: string;
    itemID?: number;
    resource: ReadingResource;
    position: ReadingEventPosition;
}

function getZotero() {
    return typeof Zotero != 'undefined' ? Zotero : addon.getGlobal('Zotero');
}

export function buildReadingEvents(histories: AttachmentHistory[]): ReadingEvent[] {
    const zotero = getZotero();
    return histories
        .flatMap(history => {
            const itemID =
                    zotero.Items.getIDFromLibraryAndKey(history.note.libraryID, history.key) || undefined,
                resource = itemID ? resolveReadingResource(itemID) : fallbackResource(history);
            return Object.entries(history.record.pages).flatMap(([pageIndex, page]) =>
                Object.entries(page.period ?? {}).map(([time, duration]) => ({
                    type: 'duration' as const,
                    at: Number(time),
                    duration,
                    attachmentKey: history.key,
                    itemID,
                    resource,
                    position: getEventPosition(history, Number(pageIndex), Number(time)),
                })),
            );
        })
        .sort((a, b) => a.at - b.at);
}

function getEventPosition(
    history: AttachmentHistory,
    pageIndex: number,
    timestamp: number,
): ReadingEventPosition {
    if (history.record.progress?.source == 'scroll') {
        return {
            kind: 'scroll',
            ratio: history.record.progress.positions?.[timestamp] ?? history.record.progress.ratio,
        };
    }
    return {
        kind: 'page',
        pageIndex,
        pageCount: history.record.numPages,
    };
}

function fallbackResource(history: AttachmentHistory): ReadingResource {
    return {
        kind: history.record.progress?.source == 'scroll' ? history.record.progress.kind : 'other',
        itemID: 0,
    };
}
