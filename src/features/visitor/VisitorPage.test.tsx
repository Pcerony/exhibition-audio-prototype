import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRepository } from '../../storage/repository';
import { VisitorPage } from './VisitorPage';
import { I18nProvider } from '../../i18n/I18nProvider';

const repository = createMemoryRepository();

beforeEach(async () => {
  vi.restoreAllMocks();
  for (const tag of await repository.listTags()) await repository.resetTag(tag.token);
  if (!(await repository.getTag('visitor-token'))) {
    await repository.createTag({ id: 'tag-1', token: 'visitor-token', label: '展签 01' });
  }
});

describe('visitor page', () => {
  it('offers recording and explains public playback for an unbound tag', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('button', { name: /开始录音/ })).toBeInTheDocument();
    expect(screen.getByText(/扫描这枚展签的人都可以收听/)).toBeInTheDocument();
  });

  it('shows the bound recording instead of recording controls', async () => {
    await repository.claim('visitor-token', {
      id: 'audio-1',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      nickname: '小林',
      duration: 12,
    });

    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('heading', { name: '小林的声音' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始录音/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('播放录音')).toBeInTheDocument();
  });

  it('shows an unavailable state for an unknown token', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="missing-token" /></I18nProvider>);

    expect(await screen.findByText('没有找到这枚展签')).toBeInTheDocument();
  });

  it('translates recording controls on the visitor page', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await screen.findByRole('button', { name: /开始录音/ });
    fireEvent.click(screen.getByRole('button', { name: '日本語' }));
    expect(await screen.findByRole('heading', { name: '今、何を伝えたいですか？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を開始' })).toBeInTheDocument();
  });
});
