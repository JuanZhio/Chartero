const API_URL = 'https://www.easyscholar.cc/open/getPublicationRank';
const RANK_FIELD = 'EasyScholar Rank';
const MAX_QUEUE_SIZE = 50;
const REQUEST_INTERVAL = 600;
const REFRESH_DELAY = 1500;
const SUCCESS_CODE = 200;
const SUCCESS_MESSAGE = 'SUCCESS';

export const OFFICIAL_RANK_OPTIONS = [
    { key: 'zhongguokejihexin', label: '科核' },
    { key: 'ccf', label: 'CCF' },
    { key: 'sciif', label: '影响因子' },
    { key: 'sciif5', label: '五年影响因子' },
    { key: 'eii', label: 'EI' },
    { key: 'pku', label: '北核' },
    { key: 'cssci', label: '南核' },
    { key: 'cscd', label: 'CSCD' },
    { key: 'sci', label: 'SCI' },
    { key: 'ssci', label: 'SSCI' },
    { key: 'sciUp', label: '中科院升级版' },
    { key: 'sciUpTop', label: '中科院 Top' },
    { key: 'sciUpSmall', label: '中科院小类' },
    { key: 'sciBase', label: '中科院基础版' },
    { key: 'sciwarn', label: '中科院预警' },
    { key: 'jci', label: 'JCI' },
    { key: 'ajg', label: 'AJG' },
    { key: 'ft50', label: 'FT50' },
    { key: 'utd24', label: 'UTD24' },
    { key: 'fms', label: 'FMS' },
    { key: 'ahci', label: 'A&HCI' },
    { key: 'esi', label: 'ESI' },
    { key: 'xr', label: '新锐' },
    { key: 'xrWarn', label: '新锐预警' },
    { key: 'xrTop', label: '新锐 Top' },
    { key: 'xrSmall', label: '新锐小类' },
    { key: 'swufe', label: '西财' },
    { key: 'cufe', label: '央财' },
    { key: 'uibe', label: '贸大' },
    { key: 'sdufe', label: '山财' },
    { key: 'ruc', label: '人大' },
    { key: 'xmu', label: '厦大' },
    { key: 'sjtu', label: '上交' },
    { key: 'fdu', label: '复旦' },
    { key: 'hhu', label: '河海' },
    { key: 'scu', label: '川大' },
    { key: 'cpu', label: '药大' },
    { key: 'cqu', label: '重大' },
    { key: 'nju', label: '南大' },
    { key: 'xju', label: '新大' },
    { key: 'cug', label: '地大' },
    { key: 'xdu', label: '西电' },
    { key: 'swjtu', label: '西南交大' },
    { key: 'cju', label: '长大' },
    { key: 'zju', label: '浙大' },
] as const;

const OFFICIAL_RANK_LABELS = new Map<string, string>(
    OFFICIAL_RANK_OPTIONS.map(option => [option.key.toLocaleLowerCase(), option.label]),
);
const OFFICIAL_RANK_ORDER = new Map<string, number>(
    OFFICIAL_RANK_OPTIONS.map((option, index) => [option.key.toLocaleLowerCase(), index]),
);

interface EasyScholarResponse {
    code?: unknown;
    msg?: unknown;
    data?: unknown;
}

interface EasyScholarData {
    customRank?: unknown;
    officialRank?: unknown;
}

interface OfficialRank {
    all?: unknown;
    select?: unknown;
}

interface CustomRank {
    rankInfo?: unknown;
    rank?: unknown;
}

interface CustomRankInfo {
    uuid?: unknown;
    abbName?: unknown;
    oneRankText?: unknown;
    twoRankText?: unknown;
    threeRankText?: unknown;
    fourRankText?: unknown;
    fiveRankText?: unknown;
}

interface RankResult {
    journal: string;
    ranks: RankLabel[];
}

type RankSource = 'officialSelected' | 'officialAll' | 'custom';

interface RankLabel {
    source: RankSource;
    key: string;
    label: string;
    value?: string;
}

export interface JournalRankDetails {
    publicationName: string;
    issn: string;
    officialRanks: RankLabel[];
    customRanks: RankLabel[];
    metrics: RankLabel[];
    field: string;
}

const journalCache = new Map<string, RankLabel[]>();
const journalDetailsCache = new Map<string, JournalRankDetails>();
const pendingJournals = new Set<string>();
const pendingJournalItems = new Map<string, Set<number>>();
const failedJournals = new Set<string>();
const queue: string[] = [];
let running = false;
let refreshTimer: number | undefined;
let needsColumnRefresh = false;

export function getPublicationName(item: Zotero.Item) {
    const fields = [
        'publicationTitle',
        'journalAbbreviation',
        'conferenceName',
        'proceedingsTitle',
        'university',
    ];
    for (const field of fields) {
        const value = item.getField(field);
        if (typeof value == 'string' && value.trim()) return value.trim();
    }
    return '';
}

export function getPublicationISSN(item: Zotero.Item) {
    const value = item.getField('ISSN' as any);
    return typeof value == 'string' ? value.trim() : '';
}

export function getStoredPublicationRanks(item: Zotero.Item) {
    const storedRanks = addon.extraField.getExtraField(item, RANK_FIELD) ?? '',
        normalizedRanks = sanitizePublicationRankText(storedRanks);
    if (storedRanks && storedRanks != normalizedRanks) {
        void addon.extraField.setExtraField(item, RANK_FIELD, normalizedRanks).catch(addon.log.bind(addon));
    }
    return normalizedRanks;
}

export function getVisiblePublicationRanks(item: Zotero.Item) {
    const journal = getPublicationName(item),
        storedRanks = getStoredPublicationRanks(item);

    const ranks = getJournalRanks(journal);
    if (ranks.length) return formatRankLabels(ranks, item);

    if (storedRanks) {
        if (shouldFetchRanks(journal)) schedulePublicationRankUpdate(item);
        return limitRankText(storedRanks);
    }
    return '';
}

function limitRankText(ranks: unknown) {
    const limit = Math.max(1, Number(addon.getPref('easyScholarRankLimit')) || 1);
    return String(ranks ?? '')
        .split(/\s*[|;]\s*/)
        .filter(Boolean)
        .slice(0, limit)
        .join(' | ');
}

function formatRankLabels(ranks: RankLabel[], item?: Zotero.Item) {
    return limitRankLabels(filterRankLabels(getDisplayRankLabels(ranks, item)))
        .map(rank => rank.label)
        .join(' | ');
}

function getDisplayRankLabels(ranks: RankLabel[], item?: Zotero.Item) {
    const thesisRankSource = item ? getThesisRankSource(item) : '';
    if (!thesisRankSource) return ranks;
    return ranks.map(rank => {
        if (rank.source != 'custom') return rank;
        const value = rank.value || rankValue(rank.label);
        return value ? { ...rank, key: thesisRankSource, label: `${thesisRankSource} ${value}` } : rank;
    });
}

function limitRankLabels(ranks: RankLabel[]) {
    const limit = Math.max(1, Number(addon.getPref('easyScholarRankLimit')) || 1);
    if (ranks.length <= limit) return ranks;

    const custom = ranks.filter(rank => rank.source == 'custom');
    if (!custom.length) return ranks.slice(0, limit);

    const customRanks = custom.slice(0, limit),
        officialRanks = ranks.filter(rank => rank.source != 'custom').slice(0, limit - customRanks.length);
    return [...officialRanks, ...customRanks];
}

export function sanitizePublicationRankText(ranks: unknown) {
    return String(ranks ?? '')
        .split(/\s*[|;,]\s*/)
        .map(rank => rank.trim())
        .filter(rank => rank && !containsRawCustomRankCode(rank))
        .join(' | ');
}

function containsRawCustomRankCode(rank: string) {
    return /&&&/.test(rank) || /^\d{6,}/.test(rank) || /\b\d{12,}\b/.test(rank);
}

export function schedulePublicationRankUpdate(item: Zotero.Item) {
    const secretKey = String(addon.getPref('easyScholarSecretKey') || '').trim(),
        journal = getPublicationName(item);
    if (!secretKey || !journal) return;
    if (getStoredPublicationRanks(item) && !shouldFetchRanks(journal)) return;

    const cacheKey = journal.toLocaleLowerCase();
    addPendingJournalItem(cacheKey, item.id);
    if (journalCache.has(cacheKey) || pendingJournals.has(cacheKey) || failedJournals.has(cacheKey)) return;
    if (queue.length >= MAX_QUEUE_SIZE) return;

    pendingJournals.add(cacheKey);
    queue.push(journal);
    void runQueue(secretKey);
}

export async function getJournalRankDetails(item: Zotero.Item): Promise<JournalRankDetails | undefined> {
    const secretKey = String(addon.getPref('easyScholarSecretKey') || '').trim(),
        publicationName = getPublicationName(item);
    if (!secretKey || !publicationName) return undefined;

    const cacheKey = publicationName.toLocaleLowerCase();
    if (journalDetailsCache.has(cacheKey)) return journalDetailsCache.get(cacheKey);

    const details = await fetchPublicationRankDetails(item, publicationName, secretKey);
    journalDetailsCache.set(cacheKey, details);
    journalCache.set(cacheKey, [...details.officialRanks, ...details.customRanks, ...details.metrics]);
    return details;
}

function getJournalRanks(journal: string) {
    return journal ? (journalCache.get(journal.toLocaleLowerCase()) ?? []) : [];
}

function shouldFetchRanks(journal: string) {
    return Boolean(
        journal &&
            String(addon.getPref('easyScholarSecretKey') || '').trim() &&
            !journalCache.has(journal.toLocaleLowerCase()),
    );
}

export function refreshPublicationRankColumns() {
    Zotero.ItemTreeManager.refreshColumns();
    refreshItemsView();
}

async function runQueue(secretKey: string) {
    if (running) return;
    running = true;
    while (queue.length) {
        const journal = queue.shift()!,
            cacheKey = journal.toLocaleLowerCase();
        try {
            const result = await fetchPublicationRanks(journal, secretKey);
            if (result.ranks.length) {
                journalCache.set(cacheKey, result.ranks);
                await savePublicationRanks(cacheKey, result.ranks).catch(addon.log.bind(addon));
                needsColumnRefresh = true;
            } else {
                failedJournals.add(cacheKey);
            }
        } catch (error) {
            addon.log('EasyScholar rank request failed:', journal, error);
            failedJournals.add(cacheKey);
        } finally {
            pendingJournals.delete(cacheKey);
            pendingJournalItems.delete(cacheKey);
        }
        await wait(REQUEST_INTERVAL);
    }
    running = false;
    if (needsColumnRefresh) {
        needsColumnRefresh = false;
        scheduleColumnRefresh();
    }
}

function scheduleColumnRefresh() {
    const win = Zotero.getMainWindow();
    if (refreshTimer) win.clearTimeout(refreshTimer);
    refreshTimer = win.setTimeout(() => {
        refreshTimer = undefined;
        Zotero.ItemTreeManager.refreshColumns();
        refreshItemsView();
    }, REFRESH_DELAY);
}

function refreshItemsView() {
    const itemsView = Zotero.getActiveZoteroPane().itemsView as any;
    itemsView?.invalidate?.();
    itemsView?.tree?.invalidate?.();
    itemsView?._tree?.invalidate?.();
}

function addPendingJournalItem(cacheKey: string, itemID: number) {
    const itemIDs = pendingJournalItems.get(cacheKey) ?? new Set<number>();
    itemIDs.add(itemID);
    pendingJournalItems.set(cacheKey, itemIDs);
}

async function savePublicationRanks(cacheKey: string, ranks: RankLabel[]) {
    const itemIDs = pendingJournalItems.get(cacheKey);
    if (!itemIDs?.size) return;

    await Promise.all(
        Array.from(itemIDs).map(async itemID => {
            const item = Zotero.Items.get(itemID);
            const rankText = item ? formatRankLabels(ranks, item) : '';
            if (!rankText) return;
            if (!item || addon.extraField.getExtraField(item, RANK_FIELD) == rankText) return;
            await addon.extraField.setExtraField(item, RANK_FIELD, rankText);
        }),
    );
}

function wait(ms: number) {
    return new Promise(resolve => Zotero.getMainWindow().setTimeout(resolve, ms));
}

async function fetchPublicationRanks(publicationName: string, secretKey: string): Promise<RankResult> {
    const url = new URL(API_URL);
    url.searchParams.set('secretKey', secretKey);
    url.searchParams.set('publicationName', publicationName);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as EasyScholarResponse;
    return {
        journal: publicationName,
        ranks: parsePublicationRanks(json, publicationName),
    };
}

async function fetchPublicationRankDetails(
    item: Zotero.Item,
    publicationName: string,
    secretKey: string,
): Promise<JournalRankDetails> {
    const url = new URL(API_URL);
    url.searchParams.set('secretKey', secretKey);
    url.searchParams.set('publicationName', publicationName);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as EasyScholarResponse,
        ranks = parsePublicationRanks(json, publicationName),
        displayRanks = getDisplayRankLabels(ranks, item),
        officialRanks = displayRanks.filter(rank => rank.source != 'custom' && !isMetricRank(rank)),
        customRanks = displayRanks.filter(rank => rank.source == 'custom'),
        metrics = ranks.filter(isMetricRank),
        esiRank = metrics.find(rank => rank.key.toLocaleLowerCase() == 'esi');

    return {
        publicationName,
        issn: getPublicationISSN(item),
        officialRanks: filterRankLabels(officialRanks),
        customRanks,
        metrics,
        field: rankValue(esiRank?.label ?? ''),
    };
}

function rankValue(label: string) {
    return label.split(/\s+/).slice(1).join(' ') || label;
}

function getThesisRankSource(item: Zotero.Item) {
    if (item.itemType != 'thesis') return '';
    const university = item.getField('university');
    return normalizeText(university) || getPublicationName(item);
}

function isMetricRank(rank: RankLabel) {
    return ['sciif', 'sciif5', 'jci', 'esi'].includes(rank.key.toLocaleLowerCase());
}

function parsePublicationRanks(response: EasyScholarResponse, publicationName: string) {
    if (Number(response.code) !== SUCCESS_CODE || String(response.msg).toUpperCase() !== SUCCESS_MESSAGE) {
        return [];
    }
    if (!isRecord(response.data)) return [];

    const data = response.data as EasyScholarData,
        labels = [
            ...parseOfficialRank(data.officialRank),
            ...parseCustomRank(data.customRank, publicationName),
        ];
    return unique(labels);
}

function filterRankLabels(ranks: RankLabel[]) {
    const showOfficialSelected = getBooleanPref('easyScholarShowOfficialSelected'),
        showOfficialAllFallback = getBooleanPref('easyScholarShowOfficialAllFallback'),
        showCustom = getBooleanPref('easyScholarShowCustom'),
        enabledOfficialKeys = new Set(
            addon
                .getPref('easyScholarOfficialRankKeys')
                .map((key: string) => String(key).toLocaleLowerCase()),
        ),
        enabledOfficial = ranks.filter(
            rank => rank.source != 'custom' && enabledOfficialKeys.has(rank.key.toLocaleLowerCase()),
        ),
        selected = enabledOfficial.filter(rank => rank.source == 'officialSelected'),
        custom = ranks.filter(rank => rank.source == 'custom'),
        official =
            showOfficialSelected && selected.length
                ? selected
                : showOfficialAllFallback
                  ? enabledOfficial.filter(rank => rank.source == 'officialAll')
                  : [];
    return [...official, ...(showCustom ? custom : [])];
}

function getBooleanPref(
    key: 'easyScholarShowOfficialSelected' | 'easyScholarShowOfficialAllFallback' | 'easyScholarShowCustom',
) {
    const value = addon.getPref(key) as unknown;
    return value === true || value === 'true' || value === 1 || value === '1';
}

function parseOfficialRank(value: unknown): RankLabel[] {
    if (!isRecord(value)) return [];
    const official = value as OfficialRank,
        selected = collectOfficialRankLabels(official.select, 'officialSelected'),
        all = collectOfficialRankLabels(official.all, 'officialAll');
    return [...selected, ...all];
}

function collectOfficialRankLabels(value: unknown, source: RankSource): RankLabel[] {
    if (!isRecord(value)) return [];
    return Object.entries(value as Record<string, unknown>)
        .map(([key, rank]) => {
            const text = normalizeText(rank);
            return text ? { source, key, label: officialRankLabel(key, text) } : undefined;
        })
        .filter((item): item is RankLabel => Boolean(item))
        .sort((a, b) => officialRankOrder(a.key) - officialRankOrder(b.key));
}

function officialRankLabel(key: string, rank: string) {
    const label = OFFICIAL_RANK_LABELS.get(key.toLocaleLowerCase()) ?? key,
        normalizedRank = rank.trim();
    switch (key.toLocaleLowerCase()) {
        case 'zhongguokejihexin':
            return '科核';
        case 'sciif':
            return `IF ${normalizedRank}`;
        case 'sciif5':
            return `5IF ${normalizedRank}`;
        case 'eii':
            return normalizedRank.toUpperCase() == 'EI' ? 'EI' : `EI ${normalizedRank}`;
        case 'jci':
            return `JCI ${normalizedRank}`;
        case 'sciup':
        case 'scibase':
        case 'xr':
            return `${label} ${compactRankText(normalizedRank)}`;
        case 'sciupsmall':
        case 'xrsmall':
            return `${label} ${compactSmallRankText(normalizedRank)}`;
        case 'sciuptop':
        case 'xrtop':
            return normalizedRank.toUpperCase().includes('TOP') ? label : `${label} ${normalizedRank}`;
        case 'ft50':
        case 'utd24':
        case 'cssci':
        case 'cscd':
        case 'pku':
        case 'ahci':
            return normalizedRank.toLocaleLowerCase() == key.toLocaleLowerCase()
                ? label
                : `${label} ${normalizedRank}`;
        default:
            return `${label} ${normalizedRank}`;
    }
}

function compactRankText(rank: string) {
    const top = rank.match(/TOP/i)?.[0],
        zone = rank.match(/[一二三四1234]区/)?.[0],
        tier = rank.match(/T[1-4]|A\+?|B\+?|C\+?|D/i)?.[0];
    return top ?? zone ?? tier ?? rank;
}

function compactSmallRankText(rank: string) {
    const matches = rank.match(/[一二三四1234]区/g);
    if (matches?.length) return [...new Set(matches)].join('/');
    return compactRankText(rank);
}

function officialRankOrder(key: string) {
    return OFFICIAL_RANK_ORDER.get(key.toLocaleLowerCase()) ?? OFFICIAL_RANK_OPTIONS.length;
}

function parseCustomRank(value: unknown, publicationName: string): RankLabel[] {
    if (!isRecord(value)) return [];
    const custom = value as CustomRank,
        infos = collectCustomRankInfo(custom.rankInfo),
        infoMap = new Map(
            infos.map(info => [normalizeText(info.uuid), info] as const).filter(([uuid]) => uuid),
        ),
        ranks = collectCustomRankValues(custom.rank);

    return ranks
        .map(rank => customRankLabel(rank, infoMap, publicationName))
        .filter((rank): rank is RankLabel => Boolean(rank));
}

function collectCustomRankInfo(value: unknown): CustomRankInfo[] {
    if (Array.isArray(value)) return value as CustomRankInfo[];
    if (!isRecord(value)) return [];
    return Object.entries(value).map(([uuid, info]) => {
        if (isRecord(info)) return { ...info, uuid: normalizeText(info.uuid) || uuid } as CustomRankInfo;
        return { uuid, abbName: info } as CustomRankInfo;
    });
}

function collectCustomRankValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
    if (!isRecord(value)) return [];
    return Object.entries(value)
        .flatMap(([uuid, rank]) => {
            if (Array.isArray(rank)) return rank.map(item => `${uuid}&&&${normalizeText(item)}`);
            if (isRecord(rank)) return Object.values(rank).map(item => `${uuid}&&&${normalizeText(item)}`);
            return `${uuid}&&&${normalizeText(rank)}`;
        })
        .filter(rank => !rank.endsWith('&&&'));
}

function customRankLabel(
    value: unknown,
    infoMap: Map<string, CustomRankInfo>,
    publicationName: string,
): RankLabel | undefined {
    if (typeof value != 'string') return undefined;
    const [uuid = '', rankIndexText = ''] = value.split('&&&'),
        info = infoMap.get(uuid),
        rankIndex = Number(rankIndexText);
    if (!uuid || !rankIndexText) return undefined;

    const source = normalizeText(info?.abbName) || normalizeText(publicationName),
        rank = normalizeText(
            info && Number.isInteger(rankIndex) ? customRankText(info, rankIndex) : rankIndexText,
        );
    if (!source || !rank) return undefined;
    return { source: 'custom', key: source, label: `${source} ${rank}`, value: rank };
}

function customRankText(info: CustomRankInfo, rankIndex: number) {
    const index = rankIndex > 0 ? rankIndex - 1 : rankIndex;
    return [info.oneRankText, info.twoRankText, info.threeRankText, info.fourRankText, info.fiveRankText][
        index
    ];
}

function unique(values: RankLabel[]) {
    const seen = new Set<string>();
    return values.filter(value => {
        if (!value.label || seen.has(value.label)) return false;
        seen.add(value.label);
        return true;
    });
}

function normalizeText(value: unknown) {
    if (typeof value != 'string' && typeof value != 'number') return '';
    return String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value == 'object' && !Array.isArray(value);
}
