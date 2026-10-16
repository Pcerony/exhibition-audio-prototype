import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { createMemoryRepository, type VisitorRepository } from '../../storage/repository';
import { useI18n } from '../../i18n/I18nProvider';
import { VisitorPage } from './VisitorPage';

export function createPreviewRepository(): VisitorRepository {
  const repository = createMemoryRepository();
  const ready = repository.createTag({ id: 'preview', token: 'preview', label: 'PREVIEW' });
  return {
    async getTag(token) { await ready; return repository.getTag(token); },
    async claim(token, recording) { await ready; return repository.claim(token, recording); },
    async getVisitorPlaybackUrl(token) { await ready; return repository.getVisitorPlaybackUrl(token); },
  };
}

const copy = {
  'ja-JP': ['テスト · アップロードなし', '最初から'],
  'zh-CN': ['测试 · 不上传', '重新开始'],
  'zh-TW': ['測試 · 不上傳', '重新開始'],
  en: ['Preview · No upload', 'Start again'],
  ko: ['테스트 · 업로드 없음', '처음부터'],
};

export function VisitorPreviewPage() {
  const { locale } = useI18n();
  const [run, setRun] = useState(() => ({ id: 0, repository: createPreviewRepository() }));
  const [label, restart] = copy[locale];
  return <>
    <VisitorPage key={run.id} repository={run.repository} token="preview" />
    <aside className="preview-controls"><span>{label}</span><button type="button" onClick={() => setRun(previous => ({ id: previous.id + 1, repository: createPreviewRepository() }))}><RotateCcw size={18} />{restart}</button></aside>
  </>;
}
