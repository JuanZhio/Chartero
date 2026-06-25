import { BasicOptions, BasicTool, ManagerTool } from 'zotero-plugin-toolkit';
import { name as packageName } from '../../../../package.json';
import {
    getScrollProgress,
    isReaderStateActive,
    isSnapshotViewState,
    type ReaderActivityState,
} from './adapter';
import { AttachmentRecord } from './data';
import { recordPagePeriod, recordScrollProgress } from './storage';

const MAIN_ITEM_URL = 'https://github.com/JuanZhio/Chartero';
const HISTORY_LOAD_CONCURRENCY = 12;
const MAX_RECORD_GAP_FACTOR = 3;

async function mapLimit<T>(items: T[], limit: number, callback: (item: T) => Promise<void>) {
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const item = items[index++];
            await callback(item);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default class ReadingHistory extends ManagerTool {
    /** @private 缓存的主条目，下标为libraryID */
    private _mainItems: Array<Zotero.Item | null>;

    /** @private 缓存的历史记录，下标为ID */
    private readonly _cached: Map<number, RecordCache>;
    private readonly _totalSecondsCache: Map<number, number>;

    /** @private 当前打开的阅读器 */
    private _activeReader?: _ZoteroTypes.ReaderInstance;

    private readonly _recordHook: RecordHook;

    private _scanPeriod: number;
    private _firstState: ReaderActivityState;
    private _secondState: ReaderActivityState;

    private _intervalID: number;
    private _savePromise?: Promise<unknown>;
    private _lastRecordAt?: number;
    private _lastReaderItemID?: number;
    private _loadingPromise: _ZoteroTypes.Promise.DeferredPromise<void>;
    private _loading = false;

    cacheLoaded: boolean = false;

    constructor(base: BasicTool | BasicOptions, hook: RecordHook) {
        super(base);

        this._loadingPromise = Zotero.Promise.defer();
        this._recordHook = hook;
        this._mainItems = [];
        this._cached = new Map();
        this._totalSecondsCache = new Map();
        this._firstState = { counter: 0 };
        this._secondState = { counter: 0 };
    }

    register(scanPeriod: number) {
        this.loadAll();
        // 初始化定时器回调函数
        this._scanPeriod = Number(scanPeriod);
        this._intervalID = Zotero.getMainWindow().setInterval(
            this.schedule.bind(this),
            this._scanPeriod * 1000,
        );
    }
    unregister() {
        Zotero.getMainWindow().clearInterval(this._intervalID);
    }
    unregisterAll() {
        this.unregister();
    }

    loadAll(force = false): void {
        if (this._loading || (this.cacheLoaded && !force)) return;
        this._loading = true;
        this.cacheLoaded = false;
        this._loadingPromise = Zotero.Promise.defer();
        if (force) this._cached.clear();
        this._totalSecondsCache.clear();
        const loadLib = async (libID: number) => {
            const lib = Zotero.Libraries.get(libID);
            if (!lib || !lib.editable) {
                this.log('跳过只读文库：', lib && lib.name);
                return;
            }
            const mainItem = await this.getMainItem(libID);
            await mainItem.loadDataType('childItems'); // 等待主条目数据库加载子条目
            this.log(`${lib.name}读取到${mainItem.getNotes().length}条记录。`);

            await mapLimit(mainItem.getNotes(), HISTORY_LOAD_CONCURRENCY, async noteID => {
                const noteItem = (await Zotero.Items.getAsync(noteID)) as Zotero.Item;
                await noteItem.loadDataType('note'); // 等待笔记数据库加载
                const his = this.parseNote(noteItem);
                if (his) {
                    // 缓存解析出的记录
                    const id = Zotero.Items.getIDFromLibraryAndKey(libID, his.key);
                    id && this._cached.set(id, { note: noteItem, ...his });
                }
            });
        };
        loadLib(1)
            .then(() =>
                Promise.all(
                    Zotero.Groups.getAll()
                        .map((group: Zotero.Group) => Zotero.Groups.getLibraryIDFromGroupID(group.id))
                        .filter((libID): libID is number => typeof libID == 'number')
                        .map(loadLib),
                ).then(() => {
                    this._loadingPromise.resolve();
                    this.cacheLoaded = true;
                    this._loading = false;
                }),
            )
            .catch(error => {
                this.log(error);
                this._loading = false;
                this._loadingPromise.reject(error);
            });
    }

    async waitUntilLoaded(): Promise<void> {
        if (!this.cacheLoaded && !this._loading) this.loadAll();
        await this._loadingPromise.promise;
    }

    /**
     * @private 将记录存入笔记
     */
    private saveNote(cache: RecordCache) {
        cache.note.setNote(`${packageName}#${cache.key}\n${JSON.stringify(cache.record)}`);
        return cache.note.saveTx({ skipSelect: true, skipNotifier: true });
    }

    private async getCache(attID: number) {
        await this._loadingPromise.promise;
        let cache = this._cached.get(attID);
        if (!cache) {
            const attachment = Zotero.Items.get(attID);
            cache = {
                note: await this.newNoteItem(attachment),
                key: attachment.key,
                record: new AttachmentRecord(),
            };
            this._cached.set(attID, cache);
        }
        return cache;
    }

    clearHistory(libraryID: number = 1) {
        for (const [id, cache] of this._cached) {
            const note = cache.note;
            if (note && this._mainItems[libraryID]?.getNotes().includes(note.id)) {
                note.deleted = true;
                note.saveTx({ skipNotifier: true });
                this._cached.delete(id);
            }
        }
    }

    isMainItem(item: Zotero.Item) {
        return (
            this._mainItems[item.libraryID]?.id == item.id ||
            (item.itemType == 'computerProgram' &&
                item.getField('archiveLocation') == Zotero.URI.getLibraryURI(item.libraryID) &&
                (item.getField('url') == MAIN_ITEM_URL ||
                    item.getField('shortTitle') == packageName ||
                    item.getField('title') == addon.locale.history.mainItemTitle))
        );
    }

    isHistoryNote(item: Zotero.Item) {
        return item.itemType == 'note' && this._mainItems[item.libraryID]?.id == item.parentItemID;
    }

    /**
     * The callback of timer triggered periodically.
     */
    private async schedule() {
        if (this._savePromise === null) {
            addon.log('记录被阻塞！');
            return;
        }
        this._activeReader = Zotero.Reader._readers.find(r => r._iframeWindow?.document.hasFocus()); // refresh activated reader
        const now = Date.now();
        if (!this._activeReader?.itemID) {
            this.resetRecordClock();
            return;
        }
        if (this._lastReaderItemID != this._activeReader.itemID) {
            this.resetRecordClock(now, this._activeReader.itemID);
            return;
        }
        const elapsed = Math.round((now - (this._lastRecordAt ?? now)) / 1000),
            maxGap = this._scanPeriod * MAX_RECORD_GAP_FACTOR;
        this._lastRecordAt = now;
        if (elapsed < 1 || elapsed > maxGap) return;

        if (this._activeReader?.itemID) {
            try {
                const cache = await this.getCache(this._activeReader.itemID); // 当前PDF的缓存
                this.record(cache.record, elapsed, now); // 先记录到缓存
                this.queueSave(cache);
                this.invalidateTotalSeconds(this._activeReader.itemID);
            } catch (error) {
                addon.log(error);
            }
            this._recordHook(this._activeReader); // 插件回调函数，更新实时仪表盘
            this._onHold();
        }
    }

    private resetRecordClock(now?: number, itemID?: number) {
        this._lastRecordAt = now;
        this._lastReaderItemID = itemID;
        this._firstState = { counter: 0 };
        this._secondState = { counter: 0 };
    }

    private queueSave(cache: RecordCache) {
        this._savePromise = (this._savePromise ?? Promise.resolve())
            .catch(addon.log.bind(addon))
            .then(() => this.saveNote(cache));
    }

    /**
     * 新建与PDF相关联的笔记，存储在主条目下
     * @param attachment PDF条目
     * @returns 新建的笔记条目
     */
    private async newNoteItem(attachment: Zotero.Item): Promise<Zotero.Item> {
        const item = new Zotero.Item('note');
        item.libraryID = attachment.libraryID;
        item.parentID = (await this.getMainItem(attachment.libraryID)).id; // 若强制删除则成为独立笔记
        item.setNote(`${packageName}#${attachment.key}\n{}`);
        item.addRelatedItem(attachment);
        // 必须等待新条目存入数据库后才能建立关联
        if ((await item.saveTx()) && attachment.addRelatedItem(item))
            attachment.saveTx({ skipDateModifiedUpdate: true });
        addon.log('new note item: ', item);
        return item;
    }

    /**
     * 根据libraryID新建主条目，用于存储笔记条目，每个文库有且仅有一个
     * @param libraryID 主条目所在文库的ID
     * @returns 新建的主条目
     */
    private async newMainItem(libraryID: number): Promise<Zotero.Item> {
        addon.log('Creating new main item in library ' + libraryID);
        const item = new Zotero.Item('computerProgram');
        item.setField('archiveLocation', Zotero.URI.getLibraryURI(libraryID));
        item.setField('title', addon.locale.history.mainItemTitle);
        item.setField('shortTitle', packageName);
        item.setField('programmingLanguage', 'JSON');
        item.setField('abstractNote', addon.locale.history.mainItemDescription);
        item.setField('url', MAIN_ITEM_URL);
        if (Zotero.Groups.getByLibraryID(libraryID))
            item.setField('libraryCatalog', Zotero.Groups.getByLibraryID(libraryID).name);
        item.setCreators([
            {
                creatorType: 'programmer',
                firstName: 'volatile',
                lastName: 'static',
            },
        ]);
        item.libraryID = libraryID;
        await item.saveTx();
        this._mainItems[libraryID] = item;
        return item;
    }

    private async findMainItemIDs(libraryID: number): Promise<number[]> {
        const runSearch = async (conditions: Array<[string, string, string]>) => {
                const searcher = new Zotero.Search();
                searcher.addCondition('libraryID', 'is', String(libraryID));
                searcher.addCondition('itemType', 'is', 'computerProgram');
                conditions.forEach(condition =>
                    searcher.addCondition(condition[0] as any, condition[1] as any, condition[2]),
                );
                return searcher.search();
            },
            libraryURI = Zotero.URI.getLibraryURI(libraryID),
            ids = new Set<number>();
        for (const id of await runSearch([['url', 'is', MAIN_ITEM_URL]])) ids.add(id);
        for (const id of await runSearch([['archiveLocation', 'is', libraryURI]])) {
            const item = Zotero.Items.get(id);
            if (this.isMainItem(item)) ids.add(id);
        }
        for (const id of await runSearch([['shortTitle', 'is', packageName]])) ids.add(id);
        for (const id of await runSearch([['title', 'is', addon.locale.history.mainItemTitle]])) {
            const item = Zotero.Items.get(id);
            if (this.isMainItem(item) || item.getField('url') == MAIN_ITEM_URL) ids.add(id);
        }
        return Array.from(ids);
    }

    private async ensureMainItemMarker(item: Zotero.Item, libraryID: number) {
        let changed = false;
        const setField = (field: string, value: string) => {
            if (item.getField(field) == value) return;
            item.setField(field, value);
            changed = true;
        };
        setField('archiveLocation', Zotero.URI.getLibraryURI(libraryID));
        setField('title', addon.locale.history.mainItemTitle);
        setField('shortTitle', packageName);
        setField('programmingLanguage', 'JSON');
        setField('abstractNote', addon.locale.history.mainItemDescription);
        setField('url', MAIN_ITEM_URL);
        if (changed) await item.saveTx({ skipSelect: true, skipNotifier: true });
    }

    /**
     * 搜索文库中的主条目，若不存在则新建。
     * @summary 同时满足以下三点被认为是主条目：
     * 1. shortTitle is {@link packageName}
     * 2. itemType is computerProgram
     * 3. archiveLocation is {@link Zotero.URI.getLibraryURI}
     * @param [libraryID=1] 默认为用户文库
     * @returns 已有的或新建的主条目
     */
    async getMainItem(libraryID: number = Zotero.Libraries.userLibraryID): Promise<Zotero.Item> {
        if (this._mainItems[libraryID]) return this._mainItems[libraryID]!;

        const ids = await this.findMainItemIDs(libraryID);
        this.log('got main item(s): ', ids);

        if (!ids.length) return this.newMainItem(libraryID); // 没搜到，新建
        if (ids.length > 1) {
            await Zotero.Items.merge(Zotero.Items.get(ids[0]), Zotero.Items.get(ids.slice(1)));
            this.log('merge main item ', ids.slice(1), ' into ', ids[0]);
        }
        const mainItem = (await Zotero.Items.getAsync(ids[0])) as Zotero.Item;
        await this.ensureMainItemMarker(mainItem, libraryID);
        return (this._mainItems[libraryID] = mainItem);
    }

    /**
     * 解析笔记条目中的历史记录
     * @param noteItem 存储历史记录的笔记条目
     * @returns record是一个AttachmentRecord实例，key是PDF条目的key
     */
    parseNote(noteItem: Zotero.Item): HistoryAtt | null {
        const note = noteItem.note,
            [header, data] = note.split('\n'), // 第一行是标题，第二行是数据
            [sign, key] = header.split('#');

        if (sign != packageName || key?.length < 1) return null;
        let json = {};
        try {
            json = JSON.parse(data);
        } catch (error) {
            if (error instanceof SyntaxError) {
                data.replace(/<\/?\w+>/g, ''); // TODO: 考虑更复杂的情况
                json = JSON.parse(data);
            } else {
                this.log(error);
                return null;
            }
        }
        return { record: new AttachmentRecord(json), key };
    }

    /**
     * 须确保{@link _activeReader}已载入
     * @param history 待记录的对象，函数有副作用
     * @returns 与参数一样
     */
    private record(history: AttachmentRecord, elapsedSeconds: number, timestamp: number) {
        const recordPage = (stats: _ZoteroTypes.Reader.ViewStats) => {
                if (typeof stats?.pageIndex != 'number') {
                    addon.log('Recording failed!', stats);
                    return;
                }
                recordPagePeriod({
                    record: history,
                    itemID: this._activeReader!.itemID!,
                    pageIndex: stats.pageIndex,
                    pagesCount: stats.pagesCount,
                    elapsedSeconds,
                    timestamp,
                });
            },
            recordScrollPosition = (state: _ZoteroTypes.Reader.SnapshotViewState) => {
                const progress = getScrollProgress(this._activeReader!.itemID!, state);
                if (!progress) return;
                recordScrollProgress({
                    record: history,
                    itemID: this._activeReader!.itemID!,
                    progress,
                    elapsedSeconds,
                    timestamp,
                });
            };
        const scanTimeout = addon.getPref('scanTimeout');
        if (this._activeReader!.type == 'snapshot') {
            const state = this._activeReader!._state.primaryViewState;
            if (
                isSnapshotViewState(state) &&
                isReaderStateActive(this._firstState, state, elapsedSeconds, scanTimeout)
            )
                recordScrollPosition(state);
            return;
        }
        //  先检查副屏
        if (
            this._activeReader!.splitType &&
            isReaderStateActive(
                this._secondState,
                this._activeReader!._state.secondaryViewState,
                elapsedSeconds,
                scanTimeout,
            )
        )
            recordPage(this._activeReader!._state.secondaryViewStats);
        //  再检查主屏
        if (
            isReaderStateActive(
                this._firstState,
                this._activeReader!._state.primaryViewState,
                elapsedSeconds,
                scanTimeout,
            )
        )
            recordPage(this._activeReader!._state.primaryViewStats);
    }

    private _onHold() {
        const overlay = this._activeReader?._iframe?.contentDocument.getElementById('chartero-reader-alert');
        if (!overlay) return;

        const timeout = addon.getPref('scanTimeout'),
            recording =
                this._firstState.counter < timeout ||
                (this._activeReader!.splitType && this._secondState.counter < timeout); // 判定挂机的触发规则
        overlay.classList.toggle('hidden', recording);
    }

    compress(record: AttachmentRecord) {
        const oldPositions = record.progress?.positions,
            compressedPositions: { [timestamp: number]: number } = {};
        record.pageArr.forEach((page, pageIndex) => {
            if (!page.period) return;
            let start = 0, // 开始合并的时间戳
                total = 0, // 连续时长
                processing = false; // 是否正在合并
            // 压缩后的period
            const compressed: { [timestamp: number]: number } = {};
            const saveSegment = () => {
                compressed[start] = total;
                if (!oldPositions || pageIndex != 0) return;
                const positionTime = Object.keys(oldPositions)
                    .map(Number)
                    .filter(t => t >= start && t <= start + total)
                    .sort((a, b) => b - a)[0];
                if (positionTime) compressedPositions[start] = oldPositions[positionTime];
            };

            Object.keys(page.period)
                .map(t => parseInt(t))
                .filter(t => !Number.isNaN(t))
                .forEach(t => {
                    if (t - start == total) {
                        // 相连的时间戳合并
                        total += page.period![t];
                        processing = true;
                    } else {
                        if (processing) {
                            // 结束合并
                            processing = false;
                            saveSegment();
                        }
                        start = t;
                        total = page.period![t];
                    }
                });
            saveSegment(); // 保存最后一个连续的时间戳
            page.period = compressed;
        });
        if (record.progress?.positions) record.progress.positions = compressedPositions;
    }

    getByAttachment(att: Zotero.Item | number): AttachmentHistory | null {
        return this._cached.get(typeof att == 'number' ? att : att.id) ?? null;
    }

    getTotalSeconds(item: Zotero.Item): number {
        const cached = this._totalSecondsCache.get(item.id);
        if (typeof cached == 'number') return cached;
        const total = item.isRegularItem()
            ? this.getInTopLevelSync(item).reduce((sum, his) => sum + his.record.totalS, 0)
            : (this.getByAttachment(item)?.record.totalS ?? 0);
        this._totalSecondsCache.set(item.id, total);
        return total;
    }

    private invalidateTotalSeconds(itemID: number) {
        this._totalSecondsCache.delete(itemID);
        const parentID = Zotero.Items.get(itemID)?.parentID;
        if (parentID) this._totalSecondsCache.delete(parentID);
    }

    /**
     *  @file chrome\content\zotero\xpcom\data\item.js
     *  @see Zotero.Item.getBestAttachments
     */
    async getInTopLevel(item: Zotero.Item) {
        if (!item.isRegularItem()) return [];
        await item.loadDataType('itemData');
        const zotero = BasicTool.getZotero(),
            url = item.getField('url'),
            urlFieldID = zotero.ItemFields.getID('url'),
            sql =
                'SELECT IA.itemID FROM itemAttachments IA NATURAL JOIN items I ' +
                `LEFT JOIN itemData ID ON (IA.itemID=ID.itemID AND fieldID=${urlFieldID}) ` +
                'LEFT JOIN itemDataValues IDV ON (ID.valueID=IDV.valueID) ' +
                `WHERE parentItemID=? AND linkMode NOT IN (${zotero.Attachments.LINK_MODE_LINKED_URL}) ` +
                'AND IA.itemID NOT IN (SELECT itemID FROM deletedItems) ' +
                "ORDER BY contentType='application/pdf' DESC, value=? DESC, dateAdded ASC",
            itemIDs: number[] = await Zotero.DB.columnQueryAsync(sql, [item.id, url]);
        return itemIDs.map(id => this.getByAttachment(id)).filter(his => his) as AttachmentHistory[];
    }

    getInTopLevelSync(item: Zotero.Item) {
        return item
            .getAttachments()
            .map(id => this.getByAttachment(id))
            .filter(his => his) as AttachmentHistory[];
    }

    getInCollection(collection: Zotero.Collection) {
        return collection
            .getChildItems()
            .filter(it => it.isRegularItem())
            .map(it => this.getInTopLevel(it));
    }

    getInLibrary(libraryID: number = Zotero.Libraries.userLibraryID) {
        return Array.from(this._cached.values()).filter(
            c => c?.note.libraryID == libraryID,
        ) as AttachmentHistory[];
    }

    getAll() {
        return Array.from(this._cached.values());
    }

    get mainItems() {
        return this._mainItems.filter(it => it) as Zotero.Item[];
    }
}

type RecordHook = (reader: _ZoteroTypes.ReaderInstance) => void;

export type AttachmentHistory = Readonly<RecordCache>;

interface HistoryAtt {
    key: string;
    record: AttachmentRecord;
}

export interface RecordCache extends HistoryAtt {
    note: Zotero.Item;
}
