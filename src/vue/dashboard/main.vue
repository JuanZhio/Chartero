<template>
    <div v-show="activeTab == SectionTab.Overview" class="progress-dashboard">
        <JournalInfo class="embedded-journal" :item="topLevel" embedded />

        <section class="progress-hero">
            <div class="progress-ring">
                <t-tooltip :content="locale.readingProgressTip" :show-arrow="false">
                    <t-progress theme="circle" size="medium" :percentage="readingProgress" />
                </t-tooltip>
            </div>
            <div class="progress-heading">
                <span class="progress-kicker">{{ locale.progressLabel.read }}</span>
                <strong class="progress-title">{{ readingProgress }}%</strong>
                <span class="progress-subtitle">
                    {{ progressDetail }}
                </span>
            </div>
        </section>

        <section class="metric-grid">
            <article class="metric-card">
                <BookOpenIcon class="metric-icon read-icon" />
                <div class="metric-content">
                    <span class="metric-label">{{ locale.progressLabel.read }}</span>
                    <span class="metric-value">{{ readPages }} / {{ numPages }}</span>
                    <span class="metric-unit">{{ progressUnit }}</span>
                </div>
            </article>
            <article class="metric-card">
                <FilePdfIcon class="metric-icon file-icon" />
                <div class="metric-content">
                    <span class="metric-label">{{ locale.progressLabel.PDFs }}</span>
                    <span class="metric-value">{{ numAttachment }}</span>
                    <span class="metric-unit">{{ attachmentSize }} MB</span>
                </div>
            </article>
            <article class="metric-card">
                <StickyNoteIcon class="metric-icon note-icon" />
                <div class="metric-content">
                    <span class="metric-label">{{ locale.progressLabel.notes }}</span>
                    <span class="metric-value">{{ noteNum }}</span>
                    <span class="metric-unit">{{ noteWords }} {{ locale.progressLabel.words }}</span>
                </div>
            </article>
        </section>

        <section class="progress-workspace">
            <nav class="progress-tabs">
                <button
                    v-for="view in visibleProgressViews"
                    :key="view.value"
                    type="button"
                    :class="{ active: progressView == view.value }"
                    @click="setProgressView(view.value)"
                >
                    {{ view.label }}
                </button>
            </nav>

            <div class="progress-panel">
                <div v-show="progressView == ProgressView.Overview" class="progress-summary">
                    <div class="summary-row">
                        <span>{{ locale.totalTime }}</span>
                        <strong>{{ totalReadTime }}</strong>
                    </div>
                    <div class="summary-row">
                        <span>{{ locale.progressLabel.read }}</span>
                        <strong>{{ readingProgress }}%</strong>
                    </div>
                    <div class="summary-row">
                        <span>{{ locale.progressLabel.PDFs }}</span>
                        <strong>{{ numAttachment }}</strong>
                    </div>
                </div>
                <PageTime
                    v-show="hasPageProgress && progressView == ProgressView.Page"
                    class="progress-chart"
                    :history="itemHistory"
                    :theme="chartTheme"
                />
                <DateTime
                    v-show="progressView == ProgressView.Date"
                    class="progress-chart"
                    :history="itemHistory"
                    :theme="chartTheme"
                />
                <TimeLine
                    v-show="progressView == ProgressView.Timeline"
                    class="progress-timeline"
                    :history="itemHistory"
                />
            </div>
        </section>
    </div>

    <UserPie v-show="activeTab == SectionTab.Group" :history="itemHistory" :theme="chartTheme" />

    <Network
        v-show="activeTab == SectionTab.Relation"
        :top-level="topLevel"
        :theme="chartTheme"
        :item-i-d="topLevel?.id"
    />

</template>

<script lang="ts">
import { type AnimationParams, animate, utils } from 'animejs';
import { BookOpenIcon, FilePdfIcon, StickyNoteIcon } from 'tdesign-icons-vue-next';
import { nextTick } from 'vue';
import { DarkUnicaTheme, GridLightTheme } from '@/themes';
import type { AttachmentHistory } from '$/history/history';
import { createReadingKernelSnapshot } from '$/history/kernel';
import { getAttachmentProgress } from '$/history/progress';
import { toTimeString } from '$/utils';
import DateTime from './components/dateTime.vue';
import JournalInfo from './components/journalInfo.vue';
import Network from './components/network.vue';
import PageTime from './components/pageTime.vue';
import TimeLine from './components/timeline.vue';
import UserPie from './components/userPie.vue';

enum SectionTab {
    Overview = 'overview',
    Progress = 'progress',
    Bubble = 'bubble',
    Group = 'group',
    Relation = 'relation',
}

enum ProgressView {
    Overview = 'overview',
    Page = 'page',
    Date = 'date',
    Timeline = 'timeline',
}

export default {
    components: {
        PageTime,
        DateTime,
        TimeLine,
        Network,
        UserPie,
        JournalInfo,
        BookOpenIcon,
        FilePdfIcon,
        StickyNoteIcon,
    },
    data() {
        return {
            dark: false,
            locale: addon.locale,
            SectionTab,
            ProgressView,
            activeTab: SectionTab.Overview,
            progressView: ProgressView.Overview,
            progressViews: [
                { value: ProgressView.Overview, label: addon.locale.overview },
                { value: ProgressView.Page, label: addon.locale.chartTitle.pageTime },
                { value: ProgressView.Date, label: addon.locale.chartTitle.dateTime },
                { value: ProgressView.Timeline, label: addon.locale.timeline },
            ],
            noteNum: 0,
            noteWords: 0,
            readPages: 0,
            numPages: 0,
            progressUnit: addon.locale.pages,
            numAttachment: 0,
            attachmentSize: '',
            item: null as null | Zotero.Item,
            animateInt: {
                modifier: utils.round(0),
                duration: 260,
            } as AnimationParams,
            realtimeUpdating: false,
        };
    },
    computed: {
        isUserLib(): boolean {
            return this.item?.libraryID == Zotero.Libraries.userLibraryID;
        },
        readingProgress(): number {
            if (this.itemHistory.length < 1) return 0;
            return this.kernelSnapshot.progressPercent;
        },
        totalReadTime(): string {
            if (this.itemHistory.length < 1) return '0' + addon.locale.seconds;
            return toTimeString(this.kernelSnapshot.totalS);
        },
        progressDetail(): string {
            if (this.progressUnit == '%') return `${this.readPages}% / ${this.numPages}%`;
            return `${this.readPages} ${this.progressUnit} / ${this.numPages} ${this.progressUnit}`;
        },
        hasPageProgress(): boolean {
            return this.kernelSnapshot.resourceCounts.pdf > 0 || this.kernelSnapshot.resourceCounts.epub > 0;
        },
        visibleProgressViews(): Array<{ value: ProgressView; label: string }> {
            return this.progressViews.filter(view => view.value != ProgressView.Page || this.hasPageProgress);
        },
        chartTheme(): object {
            return this.dark ? DarkUnicaTheme : GridLightTheme;
        },
        collapseDisabled(): boolean {
            return this.itemHistory.length < 1;
        },
        topLevel(): Zotero.Item | undefined {
            return this.isReader ? this.item?.parentItem : (this.item ?? undefined);
        },
        isReader(): boolean {
            return !this.item?.isRegularItem();
        },
        itemHistory(): AttachmentHistory[] {
            if (this.realtimeUpdating) {
                // Keep this dependency so realtime updates recompute history.
            }
            if (this.topLevel) return addon.history.getInTopLevelSync(this.topLevel);

            const his = this.item && addon.history.getByAttachment(this.item);
            // addon.log('itemHistory: ', his);
            return his ? [his] : [];
        },
        kernelSnapshot() {
            return createReadingKernelSnapshot(this.itemHistory);
        },
    },
    mounted() {
        const darkMedia = matchMedia('(prefers-color-scheme: dark)');
        darkMedia?.addEventListener('change', e => this.switchTheme(e.matches));
        this.switchTheme(darkMedia?.matches ?? false);

        addEventListener('message', e => {
            if (typeof e.data.tab == 'string') {
                this.activeTab = e.data.tab;
                return;
            }

            if (typeof e.data.id != 'number') return;

            this.item = Zotero.Items.get(e.data.id);
            if (addon.getPref('enableRealTimeDashboard')) this.realtimeUpdating = !this.realtimeUpdating;
            nextTick(() => {
                try {
                    this.updateNotes();
                    this.updateProgress();
                    this.updateSize();
                    if (this.progressView == ProgressView.Page && !this.hasPageProgress)
                        this.progressView = ProgressView.Overview;
                } catch (error) {
                    addon.log(error);
                }
            });
        });
    },
    methods: {
        switchTheme(dark: boolean) {
            this.dark = dark;
            if (dark) document.documentElement.setAttribute('theme-mode', 'dark');
            else document.documentElement.removeAttribute('theme-mode');
            document.querySelectorAll('div.highcharts-data-table').forEach(el => el.remove());
        },
        setProgressView(view: ProgressView) {
            if (view == ProgressView.Page && !this.hasPageProgress) view = ProgressView.Overview;
            this.progressView = view;
            nextTick(() => dispatchEvent(new Event('resize')));
        },
        updateNotes() {
            const noteIDs = this.topLevel?.getNotes(),
                notes = noteIDs?.map(id => Zotero.Items.get(id).getNote()),
                text = notes?.map(str => str.replace(/<[^<>]+>/g, '')).join('');
            animate(this, { ...this.animateInt, noteNum: noteIDs?.length ?? 0 });
            animate(this, {
                ...this.animateInt,
                noteWords: text?.replace(/\s/g, '').length ?? 0,
            });
        },
        async updateProgress() {
            const att = this.isReader ? this.item : await this.topLevel?.getBestAttachment();
            let readPages = 0;
            let numPages = 0;
            this.progressUnit = addon.locale.pages;
            if (att) {
                const his = addon.history.getByAttachment(att);
                if (his) {
                    const progress = getAttachmentProgress(his.record);
                    if (progress.source == 'scroll') {
                        readPages = Math.round(progress.ratio * 100);
                        numPages = 100;
                        this.progressUnit = '%';
                    } else {
                        readPages = progress.completedPages;
                        numPages = progress.pageCount;
                        this.progressUnit = addon.locale.pages;
                    }
                } else {
                    const fullPages = await Zotero.FullText.getPages(att.id);
                    numPages = fullPages ? fullPages.total : 0;
                    this.progressUnit = addon.locale.pages;
                }
            }
            animate(this, { ...this.animateInt, readPages, numPages });
        },
        updateSize() {
            const attachments = this.isReader
                    ? [this.item]
                    : this.topLevel
                          ?.getAttachments()
                          .map(id => Zotero.Items.get(id))
                          .filter(it => it.isFileAttachment()),
                files = attachments?.map(it => it!.getFilePath()),
                totalSize =
                    files?.reduce((size, file) => {
                        try {
                            return file ? Zotero.File.pathToFile(file).fileSize + size : size;
                        } catch (error) {
                            addon.log(error);
                            return size;
                        }
                    }, 0) ?? 0;
            animate(this, {
                attachmentSize: (totalSize / 1024 / 1024).toFixed(2),
                modifier: utils.round(0),
                duration: 260,
                ease: 'linear',
            });
            animate(this, {
                ...this.animateInt,
                numAttachment: this.topLevel?.numNonHTMLFileAttachments() ?? 1,
            });
        },
    },
};
</script>

<style scoped>
.progress-dashboard {
    background: var(--td-bg-color-page, #f6f7fb);
    display: grid;
    gap: 10px;
    min-height: 100%;
    padding: 12px;
}

.progress-hero {
    align-items: center;
    background: linear-gradient(135deg, var(--td-bg-color-container, #fff), var(--td-bg-color-secondarycontainer, #f7fafc));
    border: 1px solid var(--td-border-level-1-color, #e5e7eb);
    border-radius: 8px;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    display: grid;
    gap: 14px;
    grid-template-columns: auto minmax(0, 1fr);
    min-width: 0;
    padding: 16px;
}

.progress-ring {
    display: grid;
    place-items: center;
}

.progress-heading {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.progress-kicker,
.metric-label {
    color: var(--td-text-color-secondary, #64748b);
    font-size: 12px;
    line-height: 18px;
}

.progress-title {
    color: var(--td-text-color-primary, #111827);
    font-size: 28px;
    font-weight: 700;
    line-height: 34px;
}

.progress-subtitle {
    color: var(--td-text-color-secondary, #64748b);
    font-size: 13px;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.metric-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.metric-card {
    align-items: center;
    background: var(--td-bg-color-container, #fff);
    border: 1px solid var(--td-border-level-1-color, #e5e7eb);
    border-radius: 8px;
    display: grid;
    gap: 8px;
    grid-template-columns: 30px minmax(0, 1fr);
    min-height: 66px;
    min-width: 0;
    padding: 10px;
}

.metric-icon {
    border-radius: 8px;
    box-sizing: border-box;
    height: 30px;
    padding: 6px;
    width: 30px;
}

.read-icon {
    background: var(--td-brand-color-light);
    color: var(--td-brand-color);
}

.file-icon {
    background: var(--td-error-color-light);
    color: var(--td-error-color);
}

.note-icon {
    background: var(--td-warning-color-light);
    color: var(--td-warning-color);
}

.metric-content {
    display: grid;
    min-width: 0;
}

.metric-value {
    color: var(--td-text-color-primary, #111827);
    font-size: 17px;
    font-weight: 600;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.metric-unit {
    color: var(--td-text-color-placeholder, #94a3b8);
    font-size: 12px;
    line-height: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.progress-workspace {
    background: var(--td-bg-color-container, #fff);
    border: 1px solid var(--td-border-level-1-color, #e5e7eb);
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 10px;
}

.progress-tabs {
    background: var(--td-bg-color-secondarycontainer, #f1f5f9);
    border: 1px solid var(--td-border-level-1-color, #e5e7eb);
    border-radius: 8px;
    display: grid;
    gap: 4px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 4px;
}

.progress-tabs button {
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--td-text-color-secondary, #64748b);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
    min-height: 30px;
    min-width: 0;
    overflow: hidden;
    padding: 0 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.progress-tabs button.active {
    background: var(--td-bg-color-container, #fff);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    color: var(--td-brand-color, #0052d9);
}

.progress-panel {
    min-height: 260px;
    min-width: 0;
}

.progress-chart {
    display: block;
    min-height: 260px;
    min-width: 0;
}

.progress-timeline {
    max-height: 320px;
    overflow-y: auto;
}

.progress-summary {
    display: grid;
    gap: 8px;
}

.summary-row {
    align-items: center;
    background: var(--td-bg-color-secondarycontainer, #f8fafc);
    border: 1px solid var(--td-border-level-1-color, #eef2f7);
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    min-height: 46px;
    padding: 0 12px;
}

.summary-row span {
    color: var(--td-text-color-secondary, #64748b);
    font-size: 13px;
}

.summary-row strong {
    color: var(--td-text-color-primary, #111827);
    font-size: 16px;
    font-weight: 700;
}

.theme-button {
    position: fixed;
    bottom: 60px;
    left: 26px;
}

@media (max-width: 420px) {
    .metric-grid {
        grid-template-columns: 1fr;
    }

    .progress-tabs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
