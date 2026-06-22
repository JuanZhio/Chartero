import type { StoredScrollProgress } from './progress';
import { isScrollProgressResource, resolveReadingResource } from './resource';

export interface ReaderActivityState {
    counter: number;
    pageIndex?: number;
    top?: number;
    left?: number;
    cfi?: string;
    cfiElementOffset?: number;
    scrollYPercent?: number;
}

type ReaderViewState = _ZoteroTypes.Reader.State | _ZoteroTypes.Reader.DOMViewState | null;

export function isSnapshotViewState(state: ReaderViewState): state is _ZoteroTypes.Reader.SnapshotViewState {
    return !!state && 'scrollYPercent' in state;
}

export function getScrollProgress(itemID: number, state: ReaderViewState): StoredScrollProgress | undefined {
    const resource = resolveReadingResource(itemID);
    if (
        !isScrollProgressResource(resource) ||
        !isSnapshotViewState(state) ||
        typeof state.scrollYPercent != 'number'
    )
        return;
    return {
        kind:
            resource.kind == 'html-snapshot'
                ? 'html-snapshot'
                : resource.kind == 'markdown'
                  ? 'markdown'
                  : 'snapshot',
        source: 'scroll',
        ratio: Math.max(0, Math.min(1, state.scrollYPercent)),
    };
}

export function isReaderStateActive(
    previous: ReaderActivityState,
    current: ReaderViewState,
    elapsedSeconds: number,
    scanTimeout: number,
): boolean {
    if (!current) return false;
    if ('cfi' in current) updateEPUBState(previous, current, elapsedSeconds);
    else if ('scrollYPercent' in current) updateSnapshotState(previous, current, elapsedSeconds);
    else updatePDFState(previous, current as _ZoteroTypes.Reader.State, elapsedSeconds);
    return previous.counter < scanTimeout;
}

function updatePDFState(
    previous: ReaderActivityState,
    current: _ZoteroTypes.Reader.State,
    elapsedSeconds: number,
) {
    if (
        previous.pageIndex == current.pageIndex &&
        previous.top == current.top &&
        previous.left == current.left
    )
        previous.counter += elapsedSeconds;
    else {
        previous.pageIndex = current.pageIndex;
        previous.top = current.top;
        previous.left = current.left;
        previous.counter = 0;
    }
}

function updateEPUBState(
    previous: ReaderActivityState,
    current: _ZoteroTypes.Reader.EPUBViewState,
    elapsedSeconds: number,
) {
    if (previous.cfi == current.cfi && previous.cfiElementOffset == current.cfiElementOffset)
        previous.counter += elapsedSeconds;
    else {
        previous.cfi = current.cfi!;
        previous.cfiElementOffset = current.cfiElementOffset!;
        previous.counter = 0;
    }
}

function updateSnapshotState(
    previous: ReaderActivityState,
    current: _ZoteroTypes.Reader.SnapshotViewState,
    elapsedSeconds: number,
) {
    const scrollYPercent = Math.round((current.scrollYPercent ?? 0) * 1000) / 1000;
    if (previous.scrollYPercent == scrollYPercent) previous.counter += elapsedSeconds;
    else {
        previous.scrollYPercent = scrollYPercent;
        previous.counter = 0;
    }
}
