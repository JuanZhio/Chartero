<template>
  <aside :class="['journal-panel', { embedded }]">
    <div class="journal-header">
      <div>
        <div class="journal-title">期刊信息</div>
        <div class="journal-subtitle">
          {{ details?.publicationName || publicationName || 'No journal' }}
        </div>
      </div>
      <t-button size="small" variant="outline" :loading="loading" @click="load">
        刷新
      </t-button>
    </div>

    <t-alert v-if="message" theme="warning" :message="message" />

    <section v-if="summaryItems.length" class="panel-card">
      <div class="card-title">核心摘要</div>
      <div class="summary-grid">
        <div
            v-for="item in summaryItems"
            :key="item.key"
            class="summary-item"
            :title="item.label + ': ' + item.value"
        >
          <span>{{ item.label }}</span>
          <strong :class="getBadgeClass(item.value)">{{ item.value }}</strong>
        </div>
      </div>
    </section>

    <section class="panel-card">
      <div class="card-title">期刊基本信息</div>
      <div class="info-row">
        <span>期刊</span>
        <strong>{{ details?.publicationName || publicationName || '-' }}</strong>
      </div>
      <div v-if="details?.field" class="info-row">
        <span>领域</span>
        <strong>{{ details.field }}</strong>
      </div>
      <div v-if="details?.issn" class="info-row">
        <span>ISSN</span>
        <strong>{{ details.issn }}</strong>
      </div>
      <div v-if="casPartition" class="info-row">
        <span>中科院分区</span>
        <strong>
          {{ casPartition.value }}
          <em v-if="casPartition.extra" class="mini-badge">{{ casPartition.extra }}</em>
        </strong>
      </div>
    </section>

    <section class="panel-card">
      <div class="card-title-row">
        <div class="card-title">官方排名</div>
        <span class="muted-count">{{ officialItems.length }}</span>
      </div>
      <div v-if="officialItems.length" class="rank-grid">
        <div
            v-for="item in officialItems"
            :key="item.key + item.label + item.value"
            class="rank-cell"
            :title="item.label + ': ' + item.value"
        >
          <div class="rank-label">{{ item.label }}</div>
          <div :class="['rank-value', getBadgeClass(item.value || item.label)]">
            {{ item.value || item.label }}
          </div>
        </div>
      </div>
      <div v-else class="empty-text">暂无官方排名数据</div>
      <div v-if="smallField" class="rank-note">
        <strong>细分领域：</strong>{{ smallField }}
      </div>
    </section>

    <section class="panel-card">
      <div class="card-title-row">
        <div class="card-title">自定义排名</div>
        <span class="muted-count">{{ customItems.length }}</span>
      </div>
      <div v-if="customItems.length" class="custom-ranks">
        <div
          v-for="item in customItems"
          :key="item.key + item.label + item.value"
          class="custom-rank"
          :title="item.label + ': ' + item.value"
        >
          <span>{{ item.label || '自定义' }}</span>
          <button :class="getBadgeClass(item.value)">{{ item.value }}</button>
        </div>
      </div>
      <div v-else class="empty-text">暂无自定义排名</div>
    </section>

    <section class="panel-card">
      <div class="card-title">期刊指标</div>
      <div v-if="metricItems.length" class="metric-grid">
        <div
            v-for="item in metricItems"
            :key="item.key + item.label + item.value"
            class="metric-cell"
            :title="item.label + ': ' + item.value"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
      <div v-else class="empty-text">暂无期刊指标</div>
    </section>

    <div class="panel-footer">数据来源：EasyScholar</div>
  </aside>
</template>

<script lang="ts">
import { getJournalRankDetails, getPublicationName, type JournalRankDetails } from '$/easyScholar';

interface DisplayItem {
    key: string;
    label: string;
    value: string;
    extra?: string;
}

export default {
    props: {
        item: Object,
        embedded: Boolean,
    },
    data() {
        return {
            details: undefined as JournalRankDetails | undefined,
            loading: false,
            message: '',
        };
    },
    computed: {
        publicationName(): string {
            return this.item ? getPublicationName(this.item as Zotero.Item) : '';
        },
        officialItems(): DisplayItem[] {
            return this.details?.officialRanks.map(this.toDisplayItem) ?? [];
        },
        customItems(): DisplayItem[] {
            return this.details?.customRanks.map(this.toDisplayItem) ?? [];
        },
        metricItems(): DisplayItem[] {
            return this.details?.metrics.map(this.toMetricItem) ?? [];
        },
        summaryItems(): DisplayItem[] {
            return [
                this.officialItems.find(item => item.key === 'ccf'),
                this.officialItems.find(item => item.key === 'sciUp'),
                this.metricItems.find(item => item.key === 'sciif'),
                this.metricItems.find(item => item.key === 'jci'),
            ].filter(Boolean) as DisplayItem[];
        },
        casPartition(): DisplayItem | undefined {
            return this.officialItems.find(
                item => /中科院|SCI|XR|新锐/.test(item.label) && /区|TOP/.test(item.value),
            );
        },
        smallField(): string {
            return (
                this.details?.officialRanks
                    .find(rank => /小类/.test(rank.label))
                    ?.label.replace(/^\S+\s*/, '') ?? ''
            );
        },
    },
    watch: {
        item: {
            immediate: true,
            handler() {
                void this.load();
            },
        },
    },
    methods: {
        async load() {
            this.message = '';
            this.details = undefined;
            if (!this.item) return;
            if (!String(addon.getPref('easyScholarSecretKey') || '').trim()) {
                this.message = '请先在设置中填写 EasyScholar API secretKey。';
                return;
            }
            this.loading = true;
            try {
                this.details = await getJournalRankDetails(this.item as Zotero.Item);
                if (!this.details) this.message = '当前条目没有可查询的期刊名称。';
                else if (
                    !this.details.officialRanks.length &&
                    !this.details.customRanks.length &&
                    !this.details.metrics.length
                )
                    this.message = '未查询到期刊等级。';
            } catch (error) {
                addon.log(error);
                this.message = '期刊等级查询失败。';
            } finally {
                this.loading = false;
            }
        },
        toDisplayItem(rank: { key: string; label: string }): DisplayItem {
            const [label, ...value] = rank.label.split(/\s+/);
            return { key: rank.key, label: label ?? '', value: value.join(' ') };
        },
        toMetricItem(rank: { key: string; label: string }): DisplayItem {
            const labelMap: Record<string, string> = {
                    sciif: '影响因子',
                    sciif5: '5年影响因子',
                    jci: 'JCI',
                    esi: 'ESI',
                },
                value = rank.label.split(/\s+/).at(-1) ?? '';
            return { key: rank.key, label: labelMap[rank.key] ?? rank.key.toUpperCase(), value };
        },
        getBadgeClass(value?: string) {
            if (!value) return 'badge-normal';
            const text = value.toUpperCase();
            if (/预警|WARN|WARNING|RETRACT/.test(value)) return 'badge-warning';
            if (/^(TOP|AA|A\+?)$/.test(text) || /\b(TOP|FT50|UTD24)\b/.test(text)) return 'badge-elite';
            if (/^(A|Q1|T1|1)$/.test(text) || /1区|一区/.test(value)) return 'badge-q1';
            if (/^(B\+?|Q2|T2|2)$/.test(text) || /2区|二区/.test(value)) return 'badge-q2';
            if (/^(C\+?|Q3|T3|3)$/.test(text) || /3区|三区/.test(value)) return 'badge-q3';
            if (/^(D\+?|E|Q4|T4|4|5)$/.test(text) || /4区|四区/.test(value)) return 'badge-q4';
            if (/^(IF|5IF|JCI)\s/i.test(value) || /^\d+(\.\d+)?$/.test(value)) return 'badge-metric';
            if (/^(EI|SCI|SSCI|CSSCI|CSCD|AHCI|ESI)$/.test(text) || /核心|北核|南核|科核/.test(value))
                return 'badge-core';
            if (/预警|WARN|Q4|T4|\bD\b/.test(value)) return 'badge-low';
            if (/A|Q1|1区|TOP|顶尖|T1/.test(value)) return 'badge-good';
            if (/B|Q2|2区|T2|EI/.test(value)) return 'badge-mid';
            return 'badge-normal';
        },
    },
};
</script>

<style scoped>
.journal-panel {
    background: var(--td-bg-color-page, #f8fafc);
    box-sizing: border-box;
    display: grid;
    gap: 12px;
    min-height: 100%;
    overflow-y: auto;
    padding: 12px;
}

.journal-panel.embedded {
    background: transparent;
    min-height: auto;
    overflow: visible;
    padding: 0;
}

.journal-header {
    align-items: flex-start;
    display: flex;
    gap: 12px;
    justify-content: space-between;
}

.journal-title {
    color: var(--td-text-color-primary, #111827);
    font-size: 18px;
    font-weight: 700;
    line-height: 24px;
}

.journal-subtitle {
    color: var(--td-text-color-secondary, #6b7280);
    font-size: 13px;
    line-height: 18px;
    margin-top: 4px;
}

.panel-card {
    background: var(--td-bg-color-container, #fff);
    border: 1px solid var(--td-border-level-1-color, #e5e7eb);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    padding: 12px;
}

.card-title,
.card-title-row {
    color: var(--td-text-color-primary, #111827);
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
    margin-bottom: 10px;
}

.card-title-row {
    align-items: center;
    display: flex;
    justify-content: space-between;
}

.muted-count,
.empty-text,
.panel-footer {
    color: var(--td-text-color-placeholder, #94a3b8);
    font-size: 12px;
}

.info-row {
    display: grid;
    gap: 10px;
    grid-template-columns: 72px minmax(0, 1fr);
    margin: 8px 0;
}

.info-row span {
    color: var(--td-text-color-secondary, #6b7280);
    font-size: 13px;
}

.info-row strong {
    color: var(--td-text-color-primary, #111827);
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
}

.mini-badge {
    background: #dbeafe;
    border-radius: 6px;
    color: #2563eb;
    display: inline-block;
    font-size: 12px;
    font-style: normal;
    margin-left: 6px;
    padding: 1px 6px;
}

.summary-grid,
.metric-grid,
.rank-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
}

.rank-grid {
    grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
}

.summary-item,
.rank-cell,
.metric-cell {
    background: var(--td-bg-color-secondarycontainer, #f8fafc);
    border-radius: 8px;
    min-width: 0;
    padding: 8px 6px;
    text-align: center;
}

.rank-cell {
    border: 1px solid var(--td-border-level-1-color, #eef2f7);
}

.summary-item {
    background: var(--td-bg-color-secondarycontainer, #f1f5f9);
}

.summary-item span,
.rank-label,
.metric-cell span {
    color: var(--td-text-color-secondary, #6b7280);
    display: block;
    font-size: 12px;
    line-height: 16px;
    margin-bottom: 6px;
}

.summary-item strong,
.rank-value {
    border-radius: 7px;
    display: inline-block;
    font-size: 13px;
    font-weight: 700;
    line-height: 18px;
    max-width: 100%;
    overflow: hidden;
    padding: 2px 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.metric-cell strong {
    color: var(--td-text-color-primary, #111827);
    display: block;
    font-size: 18px;
    line-height: 24px;
    margin-top: 4px;
}

.badge-good {
    background: #dcfce7;
    color: #15803d;
}

.badge-elite {
    background: #fee2e2;
    color: #7f1d1d;
}

.badge-q1 {
    background: #dcfce7;
    color: #14532d;
}

.badge-q2 {
    background: #e0f2fe;
    color: #075985;
}

.badge-q3 {
    background: #fef3c7;
    color: #854d0e;
}

.badge-q4 {
    background: #f3e8ff;
    color: #7e22ce;
}

.badge-metric {
    background: #dbeafe;
    color: #1e3a8a;
}

.badge-core {
    background: #f3f4f6;
    color: #374151;
}

.badge-custom {
    background: #ccfbf1;
    color: #065f46;
}

.badge-warning {
    background: #fecaca;
    color: #991b1b;
}

.badge-mid {
    background: #fef3c7;
    color: #b45309;
}

.badge-low {
    background: #fee2e2;
    color: #b91c1c;
}

.badge-normal {
    background: #e0f2fe;
    color: #0369a1;
}

.rank-note {
    background: var(--td-bg-color-secondarycontainer, #f1f5f9);
    border-radius: 8px;
    color: var(--td-text-color-secondary, #475569);
    font-size: 12px;
    line-height: 1.6;
    margin-top: 10px;
    padding: 8px 10px;
}

.custom-ranks {
    display: grid;
    gap: 8px;
}

.custom-rank {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(54px, 1fr) auto;
}

.custom-rank span {
    color: #15803d;
    font-size: 13px;
    font-weight: 700;
}

.custom-rank button {
    border: none;
    border-radius: 8px;
    font-weight: 700;
    min-height: 28px;
    padding: 0 12px;
}

.panel-footer {
    padding: 0 4px 4px;
}
</style>
