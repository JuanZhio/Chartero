<script lang="ts">
import {
    ChartColumnIcon,
    ChartPieIcon,
    ChartRadialIcon,
    ChartRingIcon,
    CloudIcon,
    FormatVerticalAlignRightIcon,
    TreeRoundDotVerticalIcon,
} from 'tdesign-icons-vue-next';
import { DarkUnicaTheme, GridLightTheme } from '@/themes';
import type { AttachmentHistory } from '$/history/history';
import AuthorBubble from './components/authorBubble.vue';
import authorIF from './components/authorIF.vue';
import Gantt from './components/gantt.vue';
import JCR from './components/jcr.vue';
import KpiGauge from './components/kpiGauge.vue';
import Sankey from './components/sankey.vue';
import TagsPie from './components/tagsPie.vue';
import WordCloud from './components/wordCloud.vue';

const SUMMARY_BATCH_SIZE = 24;

export default {
    components: {
        Sankey,
        Gantt,
        AuthorBubble,
        WordCloud,
        TagsPie,
        TreeRoundDotVerticalIcon,
        FormatVerticalAlignRightIcon,
        CloudIcon,
        ChartPieIcon,
        ChartColumnIcon,
        ChartRadialIcon,
        ChartRingIcon,
        KpiGauge,
        JCR,
        authorIF,
    },
    data() {
        return {
            locale: addon.locale.summary,
            isDark: matchMedia('(prefers-color-scheme: dark)')?.matches ?? false,
            messageContent: '',
            itemHistory: new Array<AttachmentHistory>(),
            itemHistories: new Array<AttachmentHistory[]>(),
            items: new Array<Zotero.Item>(),
            summaryVersion: 0,
            colorScheme: undefined as MediaQueryList | undefined,
            panelStyle: {
                height: window.innerHeight - 71 + 'px',
                overflow: 'scroll',
            } as CSSStyleDeclaration,
            greenFrog: 'greenfrog' in Zotero,
        };
    },
    computed: {
        chartTheme(): object {
            return this.isDark ? DarkUnicaTheme : GridLightTheme;
        },
    },
    mounted() {
        this.colorScheme = matchMedia('(prefers-color-scheme: dark)') ?? undefined;
        this.colorScheme?.addEventListener('change', this.handleColorSchemeChange);

        window.addEventListener('message', this.handleMessage);
        window.addEventListener('resize', this.handleResize);
        this.switchTheme(this.isDark);
    },
    beforeUnmount() {
        this.colorScheme?.removeEventListener('change', this.handleColorSchemeChange);
        window.removeEventListener('message', this.handleMessage);
        window.removeEventListener('resize', this.handleResize);
    },
    methods: {
        handleColorSchemeChange(e: MediaQueryListEvent) {
            this.switchTheme(e.matches);
        },
        async handleMessage(e: MessageEvent) {
            if (!Array.isArray(e.data) || e.data.length < 1) return; // TODO: show message

            this.messageContent =
                parent.document.querySelector('#zotero-item-pane-message-box description')?.innerHTML ?? '';

            const Items = Zotero.Items,
                items: Zotero.Item[] = e.data.map((id: number) => Items.get(id)),
                topLevels = Items.getTopLevel(items).filter(it => it.isRegularItem()),
                version = ++this.summaryVersion;
            this.items = topLevels;
            this.itemHistories = topLevels.map(() => []);
            this.itemHistory = [];
            for (let i = 0; i < topLevels.length; i += SUMMARY_BATCH_SIZE) {
                const chunk = topLevels.slice(i, i + SUMMARY_BATCH_SIZE),
                    his = await Promise.all(chunk.map(top => addon.history.getInTopLevel(top)));
                if (version !== this.summaryVersion) return;
                this.itemHistories.splice(i, his.length, ...his);
                this.itemHistory = this.itemHistories.flat();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            // addon.log(`Summary items: ${this.items.length}, history: ${this.itemHistory.length}`)
        },
        handleResize() {
            this.panelStyle.height = window.innerHeight - 71 + 'px';
        },
        switchTheme(dark: boolean) {
            this.isDark = dark;
            if (dark) document.documentElement.setAttribute('theme-mode', 'dark');
            else document.documentElement.removeAttribute('theme-mode');
        },
    },
};
</script>

<template>
  <t-layout>
    <t-content>
      <t-tabs default-value="gantt">
        <t-tab-panel value="sankey" :style="panelStyle">
          <template #label>
            <TreeRoundDotVerticalIcon /> {{ locale.sankey }}
          </template>
          <Sankey
            :history="items"
            :item-histories="itemHistories"
            :data-version="summaryVersion"
            :theme="chartTheme"
          />
        </t-tab-panel>
        <t-tab-panel value="gantt" :style="panelStyle">
          <template #label>
            <FormatVerticalAlignRightIcon /> {{ locale.gantt }}
          </template>
          <Gantt :history="itemHistory" :theme="chartTheme" />
        </t-tab-panel>
        <t-tab-panel value="wordCloud" :style="panelStyle">
          <template #label>
            <CloudIcon /> {{ locale.wordCloud }}
          </template>
          <WordCloud :items="items" :histories="itemHistories" :theme="chartTheme" />
        </t-tab-panel>
        <t-tab-panel value="kpiGauge" :style="panelStyle">
          <template #label>
            <ChartRadialIcon /> {{ locale.kpiGauge }}
          </template>
          <KpiGauge :history="itemHistory" :theme="chartTheme" :items-count="items.length" />
        </t-tab-panel>
        <t-tab-panel v-if="greenFrog" value="jcr" :style="panelStyle">
          <template #label>
            <ChartRingIcon /> {{ locale.jcrPie }}
          </template>
          <JCR :items="items" :theme="chartTheme" />
        </t-tab-panel>
        <t-tab-panel v-if="greenFrog" value="authorIF" :style="panelStyle">
          <template #label>
            <ChartColumnIcon /> {{ locale.authorIF }}
          </template>
          <authorIF :items="items" :theme="chartTheme" />
        </t-tab-panel>
        <!-- <t-tab-panel value="tagsPie" :style="panelStyle">
                    <template #label>
                        <ChartPieIcon /> {{ locale.tagsPie }}
                    </template>
                    <TagsPie :history="itemHistory" :theme="chartTheme" />
                </t-tab-panel> -->
      </t-tabs>
    </t-content>
    <t-header class="layout-header" height="22px">
      <span>{{ messageContent }}</span>
    </t-header>
  </t-layout>
</template>

<style scoped>
.layout-header {
    background-color: var(--td-bg-color-secondarycontainer);
    border-bottom: solid 1px var(--td-border-level-1-color);
    display: inline-flex;
    justify-content: space-between;
    padding: 0 8px;
}
</style>
