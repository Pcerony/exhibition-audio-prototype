import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRepository } from '../../storage/repository';
import { AdminPage } from './AdminPage';
import { I18nProvider } from '../../i18n/I18nProvider';

describe('operator page', () => {
  let repository: ReturnType<typeof createMemoryRepository>;

  beforeEach(() => {
    repository = createMemoryRepository();
    localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('creates a tag with an openable visitor URL', async () => {
    render(<I18nProvider><AdminPage repository={repository} baseUrl="https://museum.example/exhibition-audio-prototype/" /></I18nProvider>);

    fireEvent.change(screen.getByLabelText('展签编号'), { target: { value: '展签 01' } });
    fireEvent.click(screen.getByRole('button', { name: '新增展签' }));

    expect(await screen.findByText('展签 01')).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/museum\.example\/exhibition-audio-prototype\/#\/t\//)).toBeInTheDocument();
  });

  it('does not create a duplicate display label', async () => {
    await repository.createTag({ id: 'tag-1', token: 'token-1', label: '展签 01' });
    render(<I18nProvider><AdminPage repository={repository} baseUrl="https://museum.example" /></I18nProvider>);

    fireEvent.change(screen.getByLabelText('展签编号'), { target: { value: '展签 01' } });
    fireEvent.click(screen.getByRole('button', { name: '新增展签' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('展签编号已存在');
    expect((await repository.listTags())).toHaveLength(1);
  });

  it('resets a bound tag after operator confirmation', async () => {
    await repository.createTag({ id: 'tag-1', token: 'token-1', label: '展签 01' });
    await repository.claim('token-1', {
      id: 'audio-1', blob: new Blob(['voice'], { type: 'audio/webm' }), nickname: '', duration: 6,
    });
    render(<I18nProvider><AdminPage repository={repository} baseUrl="https://museum.example" /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '重置展签' }));

    expect(await screen.findByText('待录制')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalled();
  });

  it('translates operator controls when Japanese is selected', async () => {
    render(<I18nProvider><AdminPage repository={repository} baseUrl="https://museum.example" /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: '日本語' }));
    expect(await screen.findByRole('heading', { name: '展示タグ管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'タグを追加' })).toBeInTheDocument();
  });
});
