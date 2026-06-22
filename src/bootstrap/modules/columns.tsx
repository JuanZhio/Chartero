import { config } from '../../../package.json';
import {
    getVisiblePublicationRanks,
    sanitizePublicationRankText,
    schedulePublicationRankUpdate,
} from './easyScholar';
import { React } from './global';
import { toTimeString } from './utils';

function rankBadgeStyles(rank: string) {
    const kind = rankKind(rank),
        palette = {
            elite: { fg: '#7f1d1d', bg: '#fee2e2', border: '#fca5a5' },
            q1: { fg: '#14532d', bg: '#dcfce7', border: '#86efac' },
            q2: { fg: '#075985', bg: '#e0f2fe', border: '#7dd3fc' },
            q3: { fg: '#854d0e', bg: '#fef3c7', border: '#facc15' },
            q4: { fg: '#7e22ce', bg: '#f3e8ff', border: '#d8b4fe' },
            metric: { fg: '#1e3a8a', bg: '#dbeafe', border: '#93c5fd' },
            core: { fg: '#374151', bg: '#f3f4f6', border: '#d1d5db' },
            custom: { fg: '#065f46', bg: '#ccfbf1', border: '#5eead4' },
            warning: { fg: '#991b1b', bg: '#fecaca', border: '#f87171' },
            neutral: { fg: 'var(--fill-primary)', bg: 'var(--material-mix-quinary)', border: 'transparent' },
        }[kind];
    return {
        display: 'inline-block',
        maxWidth: '9em',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
        marginInlineEnd: '4px',
        padding: '0 6px',
        borderRadius: '4px',
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        backgroundColor: palette.bg,
        fontWeight: ['elite', 'q1', 'warning'].includes(kind) ? '600' : '500',
        lineHeight: '18px',
    };
}

function rankKind(rank: string) {
    const text = rank.toUpperCase(),
        grade = text.split(/\s+/).at(-1) ?? text;
    if (/预警|WARN|WARNING|RETRACT/.test(rank)) return 'warning';
    if (/^(TOP|AA|A\+?)$/.test(grade) || /\b(TOP|FT50|UTD24)\b/.test(text)) return 'elite';
    if (/^(A|Q1|T1|1)$/.test(grade) || /(^|\s)(1区|一区)(\s|$)/.test(rank)) return 'q1';
    if (/^(B\+?|Q2|T2|2)$/.test(grade) || /(^|\s)(2区|二区)(\s|$)/.test(rank)) return 'q2';
    if (/^(C\+?|Q3|T3|3)$/.test(grade) || /(^|\s)(3区|三区)(\s|$)/.test(rank)) return 'q3';
    if (/^(D\+?|E|Q4|T4|4|5)$/.test(grade) || /(^|\s)(4区|四区)(\s|$)/.test(rank)) return 'q4';
    if (/^(EI|SCI|SSCI|CSSCI|CSCD|AHCI|ESI)$/.test(grade) || /核心|北核|南核|科核/.test(rank)) return 'core';
    if (/预警|WARN|WARNING/.test(rank)) return 'warning';
    if (/^(IF|5IF|JCI)\s/i.test(rank) || /影响因子/.test(rank)) {
        const value = Number(grade);
        if (value >= 10) return 'elite';
        if (value > 0) return 'metric';
    }
    if (/^(TOP|AA|A\+?|Q1|T1|1|1区|一区)$/.test(grade) || /TOP|FT50|UTD24/.test(text)) return 'elite';
    if (/^(B\+?|Q2|T2|2|2区|二区|EI|科核|CSSCI|CSCD|北核)$/.test(grade)) return 'q2';
    if (/^(C\+?|Q3|T3|3|3区|三区)$/.test(grade)) return 'q3';
    if (/^(D\+?|E|Q4|T4|4|5|4区|四区)$/.test(grade)) return 'q4';
    if (!/(中科院|JCR|IF|5IF|JCI|SCI|SSCI|CSSCI|CSCD|EI|AHCI|ESI|Q[1-4]|T[1-4])/.test(text)) return 'custom';
    return 'neutral';
}

function getColumnClassList(column: { className?: string }) {
    return ['cell', ...(column.className ?? '').split(' ').filter(Boolean)];
}

export default function addItemColumns() {
    Zotero.ItemTreeManager.registerColumn({
        dataKey: 'totalSeconds',
        label: addon.locale.totalTime,
        iconLabel: (
            <>
                <span
                    className="icon icon-bg"
                    style={{
                        backgroundImage: `url(
                        ${rootURI}content/icons/icon.svg
                    )`,
                    }}
                />
                &nbsp;
                <span>{addon.locale.totalTime}</span>
            </>
        ),
        columnPickerSubMenu: true,
        pluginID: config.addonID,
        zoteroPersist: ['width', 'hidden', 'sortDirection'],
        minWidth: 24,
        dataProvider: (item: Zotero.Item) => {
            try {
                if (!addon.history.cacheLoaded) return '';
                return addon.history.getTotalSeconds(item).toString();
            } catch (e) {
                addon.log(e);
                return '';
            }
        },
        renderCell: (_, data, column) => {
            const doc = Zotero.getMainWindow().document;
            try {
                return addon.ui.createElement(doc, 'span', {
                    properties: { textContent: toTimeString(data ?? 0) },
                    classList: getColumnClassList(column),
                    enableElementDOMLog: false,
                    enableElementRecord: false,
                });
            } catch (error) {
                addon.log(error);
                return doc.createElement('span');
            }
        },
    });

    Zotero.ItemTreeManager.registerColumn({
        dataKey: 'easyScholarRank',
        label: addon.locale.journalRank,
        columnPickerSubMenu: true,
        pluginID: config.addonID,
        enabledTreeIDs: ['main'],
        zoteroPersist: ['width', 'hidden', 'sortDirection'],
        minWidth: 72,
        dataProvider: (item: Zotero.Item) => {
            try {
                const ranks = getVisiblePublicationRanks(item);
                if (!ranks) schedulePublicationRankUpdate(item);
                return ranks;
            } catch (e) {
                addon.log(e);
                return '';
            }
        },
        renderCell: (_, data, column) => {
            const doc = Zotero.getMainWindow().document;
            try {
                const cleanedData = sanitizePublicationRankText(data),
                    cell = addon.ui.createElement(doc, 'span', {
                        classList: getColumnClassList(column),
                        enableElementDOMLog: false,
                        enableElementRecord: false,
                    });
                cell.setAttribute('title', cleanedData);
                cleanedData
                    .split(/\s*\|\s*/)
                    .filter(Boolean)
                    .forEach(rank => {
                        const badge = addon.ui.createElement(doc, 'span', {
                            properties: { textContent: rank },
                            styles: rankBadgeStyles(rank),
                            enableElementDOMLog: false,
                            enableElementRecord: false,
                        });
                        cell.append(badge);
                    });
                return cell;
            } catch (error) {
                addon.log(error);
                return doc.createElement('span');
            }
        },
    });
}
