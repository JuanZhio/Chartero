import type { AttachmentRecord } from './data';
import type { AttachmentHistory } from './history';
import type { ResourceKind } from './resource';

export type ProgressResourceKind = Extract<
    ResourceKind,
    'pdf' | 'markdown' | 'html-snapshot' | 'snapshot' | 'zotero-item'
>;

export type AttachmentProgress =
    | {
          kind: 'pdf';
          ratio: number;
          source: 'page';
          pageIndex?: number;
          pageCount: number;
          completedPages: number;
          weight: number;
      }
    | {
          kind: 'markdown' | 'html-snapshot' | 'snapshot';
          ratio: number;
          source: 'scroll';
          scrollRatio: number;
          weight: number;
      };

export interface DerivedProgress {
    kind: 'zotero-item';
    ratio: number;
    source: 'derived';
    children: AttachmentProgress[];
}

export interface StoredScrollProgress {
    kind: 'markdown' | 'html-snapshot' | 'snapshot';
    source: 'scroll';
    ratio: number;
    positions?: { [timestamp: number]: number };
}

function clampRatio(ratio: number) {
    if (!Number.isFinite(ratio)) return 0;
    return Math.max(0, Math.min(1, ratio));
}

function percentFromRatio(ratio: number) {
    return Math.round(clampRatio(ratio) * 100);
}

export function getAttachmentProgress(record: AttachmentRecord): AttachmentProgress {
    if (record.progress?.source == 'scroll') {
        const ratio = clampRatio(record.progress.ratio);
        return {
            kind: record.progress.kind,
            ratio,
            source: 'scroll',
            scrollRatio: ratio,
            weight: 1,
        };
    }

    const pageCount = record.numPages ?? 0,
        completedPages = record.readPages,
        ratio = pageCount > 0 ? completedPages / pageCount : 0;

    return {
        kind: 'pdf',
        ratio: clampRatio(ratio),
        source: 'page',
        pageCount,
        completedPages,
        weight: pageCount || 1,
    };
}

export function getDerivedProgress(histories: AttachmentHistory[]): DerivedProgress {
    const children = histories.map(history => getAttachmentProgress(history.record)),
        totalWeight = children.reduce((sum, progress) => sum + progress.weight, 0),
        ratio =
            totalWeight > 0
                ? children.reduce((sum, progress) => sum + progress.ratio * progress.weight, 0) / totalWeight
                : 0;

    return {
        kind: 'zotero-item',
        ratio: clampRatio(ratio),
        source: 'derived',
        children,
    };
}

export function getProgressPercent(histories: AttachmentHistory[]) {
    return percentFromRatio(getDerivedProgress(histories).ratio);
}
