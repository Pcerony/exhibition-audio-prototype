import type { Tag } from '../../domain/tags';
import { jaJP, zhCN } from '../../i18n/messages';
import type { Locale } from '../../i18n/I18nProvider';

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseTagCsv(input: string): Array<{ label: string; batch: string }> {
  const rows = parseRows(input);
  if (!rows.length) throw new Error('CSV_EMPTY');
  const firstCell = rows[0][0]?.replace(/^\uFEFF/, '');
  const hasHeader = firstCell === zhCN['csv.label'] || firstCell === jaJP['csv.label'];
  const entries = rows.slice(hasHeader ? 1 : 0).map((row) => ({ label: row[0]?.trim() ?? '', batch: row[1]?.trim() ?? '' }));
  const labels = new Set<string>();
  for (const entry of entries) {
    if (!entry.label) throw new Error('CSV_EMPTY_LABEL');
    const normalized = entry.label.toLocaleLowerCase();
    if (labels.has(normalized)) throw new Error('CSV_DUPLICATE_LABEL');
    labels.add(normalized);
  }
  if (!entries.length) throw new Error('CSV_EMPTY');
  return entries;
}

function escapeCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeTags(tags: Tag[], baseUrl: string, locale: Locale = 'zh-CN') {
  const messages = locale === 'ja-JP' ? jaJP : zhCN;
  const rows = [[messages['csv.label'], messages['csv.batch'], messages['csv.url'], messages['csv.status'], messages['csv.nickname']]];
  for (const tag of tags) {
    rows.push([tag.label, tag.batch, `${baseUrl.replace(/\/$/, '')}#/t/${tag.token}`, tag.recording ? messages['csv.statusBound'] : messages['csv.statusUnbound'], tag.recording?.nickname ?? '']);
  }
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}
