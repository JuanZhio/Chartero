<script lang="ts">
import type { Options, SeriesWordcloudOptions } from 'highcharts';
import { Chart } from 'highcharts-vue';
import StopWords from 'stopwords-iso';
import Highcharts from '@/highcharts';
import { buttons, helpMessageOption } from '@/utils';
import type { AttachmentHistory } from '$/history/history';
import { createReadingKernelSnapshot } from '$/history/kernel';
import { compileExcludedTagPatterns, getExcludedTagIDs, isTagExcluded } from '$/tagFilter';
import { toTimeString } from '$/utils';

const Zotero = addon.getGlobal('Zotero');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const stopWordSet = new Set(Object.values(StopWords).flat());

export default {
    components: { Chart },
    props: {
        items: { type: Array<Zotero.Item>, required: true },
        histories: {
            type: Array<AttachmentHistory[]>,
            default: () => [],
        },
        theme: Object,
    },
    data() {
        return {
            locale: addon.locale,
            dataOption: 'tag',
            filteredTags: getExcludedTagIDs(),
            excludedTagRegexes: compileExcludedTagPatterns(),
        };
    },
    computed: {
        seriesData(): Array<[word: string, weight: number]> {
            const data = new Map<string, number>();

            function setWord(word: string) {
                data.set(word, (data.get(word) ?? 0) + 1);
            }

            function setData(text: string[]) {
                for (const str of text)
                    for (const { segment, isWordLike } of Array.from(segmenter.segment(str))) {
                        const word = segment.toLocaleLowerCase();
                        if (isWordLike && !stopWordSet.has(word)) setWord(word);
                    }
            }

            switch (this.dataOption) {
                case 'tag':
                    for (let i = 0; i < this.items.length; ++i) {
                        const item = this.items[i],
                            totalS = createReadingKernelSnapshot(this.histories[i] ?? []).totalS;
                        if (!item) continue;
                        item.getTags().forEach(tag => {
                            const tagName = tag.tag,
                                id = Zotero.Tags.getID(tagName);
                            if (
                                tag.type &&
                                id &&
                                !isTagExcluded(tagName, id, this.filteredTags, this.excludedTagRegexes)
                            )
                                data.set(tagName, (data.get(tagName) ?? 0) + totalS);
                        });
                    }
                    break;

                case 'author':
                    for (const item of this.items)
                        for (const c of item.getCreators()) setWord(c.firstName + ' ' + c.lastName);
                    break;

                case 'title':
                    setData(this.items.map(item => item.getField('title') as string));
                    break;

                case 'annotation':
                    setData(
                        this.items
                            .map(item => item.getAttachments())
                            .flat()
                            .map(id => Zotero.Items.get(id))
                            .filter(att => att.isPDFAttachment())
                            .map(att => att.getAnnotations())
                            .flat()
                            .map(anno => anno.annotationText)
                            .filter(text => text),
                    );
                    break;

                default:
                    break;
            }
            return Array.from(data.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 60);
        },
        chartOpts() {
            const isTag = this.dataOption === 'tag';
            return {
                exporting: {
                    buttons,
                    menuItemDefinitions: helpMessageOption(addon.locale.doc.wordCloud),
                },
                tooltip: {
                    formatter() {
                        const weight = this.options.weight!,
                            context = isTag ? toTimeString(weight) : weight + addon.locale.occurrences;
                        return `
                            <span style="color: ${this.color}">\u25CF</span>
                            <b>${this.key}</b><br/>
                            <span>${context}</span>
                        `;
                    },
                },
                series: [
                    {
                        name: isTag ? addon.locale.time : addon.locale.times,
                        type: 'wordcloud',
                        maxFontSize: 26,
                        minFontSize: 8,
                        data: this.seriesData,
                    } as SeriesWordcloudOptions,
                ],
            } as Options;
        },
        options() {
            return Highcharts.merge(this.chartOpts, this.theme);
        },
    },
    mounted() {
        addEventListener('message', e => {
            if (e.data != 'updateExcludedTags') return;
            this.filteredTags = getExcludedTagIDs();
            this.excludedTagRegexes = compileExcludedTagPatterns();
        });
    },
};
</script>

<template>
  <t-space direction="vertical" style="width: 100%">
    <t-space style="padding: 8px" break-line>
      <b>{{ locale.selectDataSource }}</b>
      <t-select v-model="dataOption" :placeholder="locale.sort" size="small" auto-width>
        <t-option value="tag" :label="locale.tags" />
        <t-option value="author" :label="locale.author" />
        <t-option value="title" :label="locale.itemTitle" />
        <t-option value="annotation" :label="locale.pdfAnnotation" />
      </t-select>
    </t-space>
    <Chart :key="JSON.stringify(theme)" :options="options" />
  </t-space>
</template>

<style scoped></style>
