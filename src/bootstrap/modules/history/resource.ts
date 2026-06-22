export type ResourceKind =
    | 'pdf'
    | 'epub'
    | 'markdown'
    | 'html-snapshot'
    | 'snapshot'
    | 'other'
    | 'zotero-item';

export interface ReadingResource {
    kind: ResourceKind;
    itemID: number;
    contentType?: string;
    filename?: string;
}

export type ResourceKindCounts = Record<ResourceKind, number>;

function getZotero() {
    return typeof Zotero != 'undefined' ? Zotero : addon.getGlobal('Zotero');
}

export function resolveReadingResource(item: Zotero.Item | number): ReadingResource {
    const zotero = getZotero(),
        zoteroItem = typeof item == 'number' ? zotero.Items.get(item) : item,
        contentType = zoteroItem?.attachmentContentType?.toLowerCase() || undefined,
        filename = zoteroItem?.attachmentFilename?.toLowerCase() || undefined,
        itemID = typeof item == 'number' ? item : item.id;

    return {
        kind: getResourceKind(zoteroItem, contentType, filename),
        itemID,
        contentType,
        filename,
    };
}

function getResourceKind(
    item: Zotero.Item | undefined,
    contentType?: string,
    filename?: string,
): ResourceKind {
    if (item?.isRegularItem()) return 'zotero-item';
    if (contentType == 'application/pdf' || filename?.endsWith('.pdf')) return 'pdf';
    if (contentType == 'application/epub+zip' || filename?.endsWith('.epub')) return 'epub';
    if (
        contentType == 'text/markdown' ||
        contentType == 'text/x-markdown' ||
        filename?.endsWith('.md') ||
        filename?.endsWith('.markdown')
    )
        return 'markdown';
    if (item?.isSnapshotAttachment()) {
        if (contentType == 'text/html' || contentType == 'application/xhtml+xml') return 'html-snapshot';
        return 'snapshot';
    }
    if (contentType == 'text/html' || contentType == 'application/xhtml+xml' || filename?.endsWith('.html'))
        return 'html-snapshot';
    return 'other';
}

export function isScrollProgressResource(resource: ReadingResource): boolean {
    return resource.kind == 'markdown' || resource.kind == 'html-snapshot' || resource.kind == 'snapshot';
}

export function countResourceKinds(resources: ReadingResource[]): ResourceKindCounts {
    const counts = {
        pdf: 0,
        epub: 0,
        markdown: 0,
        'html-snapshot': 0,
        snapshot: 0,
        other: 0,
        'zotero-item': 0,
    } satisfies ResourceKindCounts;
    for (const resource of resources) counts[resource.kind] += 1;
    return counts;
}
