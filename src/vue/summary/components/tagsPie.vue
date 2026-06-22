<script lang="ts">
import { Chart } from 'highcharts-vue';
import Highcharts from '@/highcharts';
import { helpMessageOption } from '@/utils';
import type { AttachmentHistory } from '$/history/history';
import { getHistoryItem } from '$/history/kernel';

export default {
    components: { Chart },
    props: {
        history: {
            type: Array<AttachmentHistory>,
            required: true,
        },
        theme: Object,
    },
    data() {
        return {
            locale: addon.locale,
            dataOption: 'journal',
        };
    },
    computed: {
        chartOpts(): Highcharts.Options {
            const parents = Array.from(
                new Set(
                    this.history
                        .map(history => getHistoryItem(history)?.parentItem)
                        .filter((item): item is Zotero.Item => !!item?.isRegularItem()),
                ),
            );

            return {
                exporting: {
                    menuItemDefinitions: helpMessageOption(addon.locale.doc.pie),
                },
                plotOptions: { variablepie: { allowPointSelect: true } },
                series: [
                    {
                        type: 'variablepie',
                        data: this.getJournalData(parents),
                        innerSize: '20%',
                    } as Highcharts.SeriesVariablepieOptions,
                ],
            };
        },
        options() {
            return Highcharts.merge(this.chartOpts, this.theme);
        },
    },
    methods: {
        getJournalData(items: Zotero.Item[]) {
            const journalMap: Record<string, number> = {};
            for (const item of items) {
                const name =
                    item.getField('journalAbbreviation') ||
                    item.getField('publicationTitle') ||
                    item.getField('conferenceName') ||
                    item.getField('university');
                if (typeof name == 'string') journalMap[name] = (journalMap[name] ?? 0) + 1;
            }
            addon.log(journalMap);
            return Object.entries(journalMap).map(([name, y]) => ({
                name,
                y,
                z: y,
            }));
        },
    },
};
</script>

<template>
  <t-space direction="vertical" style="width: 100%">
    <t-space style="padding: 8px" break-line>
      <b>{{ locale.selectDataSource }}</b>
      <t-select v-model="dataOption" :placeholder="locale.sort" size="small" auto-width>
        <t-option value="journal" :label="locale.tags" />
        <t-option value="firstCreator" :label="locale.author" />
        <t-option value="lastCreator" :label="locale.author" />
      </t-select>
    </t-space>
    <Chart :key="JSON.stringify(theme)" :options="options" />
  </t-space>
</template>

<style scoped></style>
