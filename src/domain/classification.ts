export const MEMORY_CATEGORIES = [
  { code: 'A', id: '00000000-0000-4000-8000-000000000001' },
  { code: 'B', id: '00000000-0000-4000-8000-000000000002' },
  { code: 'C', id: '00000000-0000-4000-8000-000000000003' },
  { code: 'D', id: '00000000-0000-4000-8000-000000000004' },
] as const;
export type MemoryCategoryCode = typeof MEMORY_CATEGORIES[number]['code'];

export function isMemoryCategoryCode(value: unknown): value is MemoryCategoryCode {
  return typeof value === 'string' && MEMORY_CATEGORIES.some(category => category.code === value);
}

export function memoryBatchDate(createdAt: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(createdAt));
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

// Local preview only. Production numbering is allocated atomically by Postgres.
export function formatMemorySerial(date: string, code: MemoryCategoryCode, sequence: number): string {
  return `${date.replaceAll('-', '').slice(2)}-${code}${String(sequence).padStart(3, '0')}`;
}
