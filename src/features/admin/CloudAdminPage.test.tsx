import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import type {
  AdminRepository,
  ManagedTag,
} from "../../storage/adminRepository";
import { I18nProvider } from "../../i18n/I18nProvider";
import { CloudAdminPage } from "./CloudAdminPage";
const categoryA = '00000000-0000-4000-8000-000000000001';
const categoryB = '00000000-0000-4000-8000-000000000002';
const tag: ManagedTag = {
  id: "t1",
  token: "opaque",
  label: "A001",
  batch: "食品",
  categoryId: categoryA,
  version: 2,
  createdAt: "2026-01-01",
  status: "bound",
  provisioning: null,
  recording: {
    id: "r1",
    nickname: "Guest",
    duration: 4,
    mimeType: "audio/webm",
    createdAt: "2026-01-02",
    pieceAssignment: {
      state: 'needs_review', pieceCode: 'A2', source: 'automatic', mapVersion: 'fukuoka-road-73-v13', version: 2,
      updatedAt: '2026-01-02T01:00:00Z',
    },
  },
};
function repository(): AdminRepository {
  return {
    getSession: vi.fn().mockResolvedValue({ userId: "op", role: "admin" }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    listTags: vi.fn().mockResolvedValue({ tags: [tag], total: 51 }),
    createBatch: vi.fn(),
    resetTag: vi.fn(),
    setEnabled: vi.fn(),
    getPlaybackUrl: vi.fn(),
    getTranscription: vi.fn().mockResolvedValue({ configured: false, consented: false, transcription: null }),
    retryTranscription: vi.fn(),
    saveTranscription: vi.fn(),
    setPieceAssignment: vi.fn().mockResolvedValue({ version: 3, state: 'assigned', pieceCode: 'B2', source: 'manual', mapVersion: 'fukuoka-road-73-v13' }),
    listJobs: vi.fn().mockResolvedValue([]),
    provision: vi.fn(),
    getAudit: vi.fn().mockResolvedValue([]),
    maintenance: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([
      { id: categoryA, name: "美食", code: "A", nextNumber: 2 },
      { id: categoryB, name: "旅行", code: "B", nextNumber: 1 },
      { id: 'legacy', name: "旧分類", code: "E", nextNumber: 1 },
    ]),
    createCategory: vi.fn(),
    renameCategory: vi.fn(),
    createQrEntry: vi.fn().mockResolvedValue({ id: 'qr-tag', label: 'U000010', entryChannel: 'qr', visitorUrl: 'https://voice.heisei.space/#/t/qr-token' }),
    createCards: vi.fn().mockResolvedValue({ tags: [] }),
    previewBulk: vi.fn().mockResolvedValue({
      groups: [
        {
          kind: "empty",
          cards: [{ id: "t2", version: 1, label: "A002" }],
          recordingCount: 0,
        },
        {
          kind: "recorded",
          cards: [{ id: "t1", version: 2, label: "A001" }],
          recordingCount: 1,
        },
      ],
    }),
    applyBulk: vi.fn().mockResolvedValue(undefined),
  };
}

it('offers the isolated QR fallback subpage from the existing operator console', async () => {
  show(repository(), 'zh-CN');
  await screen.findByText('A001');
  expect(screen.getByRole('link', { name: '二维码备用入口' })).toHaveAttribute('href', '#/admin/qr');
});

it('shows QR-only identities as QR-only instead of claiming their card is pending', async () => {
  const r = repository();
  vi.mocked(r.listTags).mockResolvedValue({
    tags: [{ ...tag, id: 'qr-tag', token: 'qr-token', label: 'U000010', entryChannel: 'qr', status: 'unbound', recording: null, provisioning: null }],
    total: 1,
  });
  show(r, 'zh-CN');
  expect(await screen.findByText('仅二维码')).toBeVisible();
});

it('shows all 73 map pieces, filters records by selected piece and displays estimates as unconfirmed', async () => {
  const r = repository();
  show(r, 'zh-CN');
  await screen.findByText('A001');
  const map = await screen.findByRole('group', { name: /73/ }, { timeout: 5_000 });
  expect(within(map).getAllByRole('button')).toHaveLength(73);
  expect(within(map).getByRole('button', { name: 'A1' })).toBeInTheDocument();
  expect(screen.getByText(/系统推算/)).toBeVisible();
  expect(screen.getByText(/需要核对/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /A2 A001/ }));
  expect(within(map).getByRole('button', { name: 'A2' })).toHaveClass('is-highlighted');
  fireEvent.click(within(map).getByRole('button', { name: 'A2' }));
  await waitFor(() => expect(r.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ pieceCode: 'A2', offset: 0 })));
  expect(screen.queryByText('private transcript sentinel')).not.toBeInTheDocument();
  expect(screen.queryByText('130.4063520063')).not.toBeInTheDocument();
});

it('keeps a conflicted manual correction open and does not overwrite the stale version', async () => {
  const r = repository();
  vi.mocked(r.setPieceAssignment).mockRejectedValue(new Error('VERSION_CONFLICT'));
  show(r, 'zh-CN');
  await screen.findByText('A001');
  fireEvent.click(screen.getByRole('button', { name: '手动修正拼装板 A001' }));
  const dialog = screen.getByRole('dialog', { name: '修正拼装板位置' });
  fireEvent.change(within(dialog).getByLabelText('实体拼装板'), { target: { value: 'piece:B2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存修正' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('记录已更新');
  expect(screen.getByRole('dialog', { name: '修正拼装板位置' })).toBeInTheDocument();
  expect(r.setPieceAssignment).toHaveBeenCalledTimes(1);
});

it('reloads the latest assignment after a version conflict before allowing a retry', async () => {
  const r = repository();
  const latestTag: ManagedTag = {
    ...tag,
    recording: { ...tag.recording!, pieceAssignment: { ...tag.recording!.pieceAssignment!, pieceCode: 'A3', version: 3 } },
  };
  vi.mocked(r.listTags).mockResolvedValueOnce({ tags: [tag], total: 1 }).mockResolvedValueOnce({ tags: [latestTag], total: 1 });
  vi.mocked(r.setPieceAssignment)
    .mockRejectedValueOnce(new Error('VERSION_CONFLICT'))
    .mockResolvedValueOnce({ version: 4, state: 'assigned', pieceCode: 'B2', source: 'manual', mapVersion: 'fukuoka-road-73-v13', updatedAt: null });
  show(r, 'zh-CN');
  await screen.findByText('A001');
  fireEvent.click(screen.getByRole('button', { name: '手动修正拼装板 A001' }));
  let dialog = screen.getByRole('dialog', { name: '修正拼装板位置' });
  fireEvent.change(within(dialog).getByLabelText('实体拼装板'), { target: { value: 'piece:B2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存修正' }));
  await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button', { name: '重新加载列表' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '修正拼装板位置' })).not.toBeInTheDocument());
  await waitFor(() => expect(r.listTags).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '手动修正拼装板 A001' }));
  dialog = screen.getByRole('dialog', { name: '修正拼装板位置' });
  fireEvent.change(within(dialog).getByLabelText('实体拼装板'), { target: { value: 'piece:B2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存修正' }));
  await waitFor(() => expect(r.setPieceAssignment).toHaveBeenLastCalledWith({
    recordingId: 'r1', expectedVersion: 3, state: 'assigned', pieceCode: 'B2', mapVersion: 'fukuoka-road-73-v13',
  }));
});

it('saves an operator-selected map piece with the observed assignment version', async () => {
  const r = repository();
  show(r, 'zh-CN');
  await screen.findByText('A001');
  fireEvent.click(screen.getByRole('button', { name: '手动修正拼装板 A001' }));
  const dialog = screen.getByRole('dialog', { name: '修正拼装板位置' });
  fireEvent.change(within(dialog).getByLabelText('实体拼装板'), { target: { value: 'piece:B2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存修正' }));
  await waitFor(() => expect(r.setPieceAssignment).toHaveBeenCalledWith({
    recordingId: 'r1', expectedVersion: 2, state: 'assigned', pieceCode: 'B2', mapVersion: 'fukuoka-road-73-v13',
  }));
  await waitFor(() => expect(r.listTags).toHaveBeenCalledTimes(2));
});
function show(r: AdminRepository, locale?: string) {
  if (locale) localStorage.setItem('exhibition-audio-language-v2', locale);
  render(
    <I18nProvider>
      <CloudAdminPage repository={r} baseUrl="https://example.test" />
    </I18nProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
it('opens management when a visitor previously selected English', async () => {
  localStorage.setItem('exhibition-audio-language-v2', 'en');
  show(repository());
  expect(await screen.findByText('A001')).toBeVisible();
  expect(screen.queryByRole('button', { name: '分類を追加' })).not.toBeInTheDocument();
  expect(localStorage.getItem('exhibition-audio-language-v2')).toBe('en');
});
it("shows invalid login safely and never loads protected data", async () => {
  const r = repository();
  vi.mocked(r.getSession).mockResolvedValue(null);
  vi.mocked(r.signIn).mockRejectedValue(new Error("LOGIN_FAILED"));
  show(r);
  fireEvent.change(await screen.findByLabelText("メールアドレス"), {
    target: { value: "operator@example.test" },
  });
  fireEvent.change(screen.getByLabelText("パスワード"), {
    target: { value: "password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("パスワード");
  expect(r.listTags).not.toHaveBeenCalled();
});
it("exports every page and preserves pagination", async () => {
  const r = repository();
  show(r);
  await screen.findByText("A001");
  vi.mocked(r.listTags)
    .mockResolvedValueOnce({
      tags: Array.from({ length: 50 }, (_, index) => ({
        ...tag,
        id: String(index),
      })),
      total: 51,
    })
    .mockResolvedValueOnce({ tags: [tag], total: 51 });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:csv"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "全タグCSV" }));
  await waitFor(() =>
    expect(r.listTags).toHaveBeenCalledWith({ offset: 50, limit: 50 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "次へ" }));
  await waitFor(() =>
    expect(r.listTags).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 50, sort: "recorded_desc" }),
    ),
  );
});
it("can cancel uncertain creation after warning to correct next request", async () => {
  const r = repository();
  vi.mocked(r.createCards).mockRejectedValue(new Error("NETWORK"));
  show(r);
  await screen.findByText("A001");
  fireEvent.click(screen.getByRole("button", { name: "空カードを作成" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("枚数")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "作成を取り消す" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("枚数")).toBeEnabled();
});
it("clears protected data on search role denial and can sign out", async () => {
  const r = repository();
  show(r);
  await screen.findByText("A001");
  vi.mocked(r.listTags).mockRejectedValueOnce(new Error("OPERATOR_REQUIRED"));
  fireEvent.change(screen.getByLabelText("検索"), {
    target: { value: "denied" },
  });
  await screen.findByRole("button", { name: "ログイン" });
  expect(screen.queryByText("A001")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
  await waitFor(() => expect(r.signOut).toHaveBeenCalled());
});
it("gates protected data behind auth", async () => {
  const r = repository();
  vi.mocked(r.getSession).mockResolvedValue(null);
  show(r);
  await screen.findByRole("button", { name: "ログイン" });
  expect(r.listTags).not.toHaveBeenCalled();
});
it("creates automatic cards and preserves uncertain request key", async () => {
  const r = repository();
  vi.mocked(r.createCards)
    .mockRejectedValueOnce(new Error("NETWORK"))
    .mockResolvedValue({ tags: [] });
  show(r);
  await screen.findByText("A001");
  fireEvent.change(screen.getByLabelText("枚数"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "空カードを作成" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "作成を再試行" }));
  await waitFor(() => expect(r.createCards).toHaveBeenCalledTimes(2));
  expect(vi.mocked(r.createCards).mock.calls[0]).toEqual(
    vi.mocked(r.createCards).mock.calls[1],
  );
  expect(r.createCards).toHaveBeenCalledWith(30, expect.any(String));
  expect(screen.queryByLabelText("作成する分類")).not.toBeInTheDocument();
});
it("filters by recording date and sort, clearing selected cards", async () => {
  const r = repository();
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.change(screen.getByLabelText("録音日バッチ"), { target: { value: "2026-10-17" } });
  await waitFor(() =>
    expect(r.listTags).toHaveBeenCalledWith(
      expect.objectContaining({ batchDate: "2026-10-17" }),
    ),
  );
  expect(screen.getByLabelText("選択 A001")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("並び順"), {
    target: { value: "recorded_asc" },
  });
  await waitFor(() =>
    expect(r.listTags).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "recorded_asc" }),
    ),
  );
});
it("confirms deletion groups independently", async () => {
  const r = repository();
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.click(screen.getByRole("button", { name: "一括削除" }));
  let d = await screen.findByRole("dialog");
  expect(d).toHaveTextContent("未録音");
  fireEvent.click(
    within(d).getByRole("button", { name: "このグループをスキップ" }),
  );
  d = await screen.findByRole("dialog");
  expect(d).toHaveTextContent("録音済み");
  fireEvent.click(within(d).getByRole("checkbox"));
  fireEvent.click(within(d).getByRole("button", { name: "削除を確定" }));
  await waitFor(() =>
    expect(r.applyBulk).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "delete",
        kind: "recorded",
        cards: [{ id: "t1", version: 2, label: "A001" }],
      }),
    ),
  );
  expect(r.applyBulk).toHaveBeenCalledTimes(1);
});
it("resets selected cards and preserves retry key", async () => {
  const r = repository();
  vi.mocked(r.previewBulk).mockResolvedValue({
    groups: [
      {
        kind: "recorded",
        cards: [{ id: "t1", version: 2, label: "A001" }],
        recordingCount: 1,
      },
    ],
  });
  vi.mocked(r.applyBulk)
    .mockRejectedValueOnce(new Error("NETWORK"))
    .mockResolvedValue(undefined);
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.click(screen.getByRole("button", { name: "一括リセット" }));
  const d = await screen.findByRole("dialog");
  expect(r.previewBulk).toHaveBeenCalledWith(["t1"], "reset");
  fireEvent.click(within(d).getByRole("checkbox"));
  fireEvent.click(within(d).getByRole("button", { name: "リセットを確定" }));
  await screen.findByRole("alert");
  fireEvent.click(within(d).getByRole("button", { name: "リセットを確定" }));
  await waitFor(() => expect(r.applyBulk).toHaveBeenCalledTimes(2));
  expect(vi.mocked(r.applyBulk).mock.calls[0]).toEqual(
    vi.mocked(r.applyBulk).mock.calls[1],
  );
});
it("requires a new preview after a stale conflict", async () => {
  const r = repository();
  vi.mocked(r.previewBulk).mockResolvedValue({
    groups: [
      {
        kind: "recorded",
        cards: [{ id: "t1", version: 2, label: "A001" }],
        recordingCount: 1,
      },
    ],
  });
  vi.mocked(r.applyBulk).mockRejectedValue(new Error("STALE_PREVIEW"));
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.click(screen.getByRole("button", { name: "一括リセット" }));
  const d = await screen.findByRole("dialog");
  fireEvent.click(within(d).getByRole("checkbox"));
  fireEvent.click(within(d).getByRole("button", { name: "リセットを確定" }));
  await screen.findByRole("alert");
  expect(
    within(d).getByRole("button", { name: "リセットを確定" }),
  ).toBeDisabled();
  fireEvent.click(within(d).getByRole("button", { name: "再確認" }));
  await waitFor(() => expect(r.previewBulk).toHaveBeenCalledTimes(2));
  expect(within(d).getByRole("checkbox")).not.toBeChecked();
});
it("rechecks only remaining groups after an earlier delete succeeded", async () => {
  const r = repository();
  vi.mocked(r.listTags).mockResolvedValue({ tags: [tag, { ...tag, id: "t2", label: "A002", recording: null, status: "unbound" }], total: 2 });
  vi.mocked(r.applyBulk).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("VERSION_CONFLICT"));
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.click(screen.getByLabelText("選択 A002"));
  fireEvent.click(screen.getByRole("button", { name: "一括削除" }));
  let dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "削除を確定" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("録音済み"));
  dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "削除を確定" }));
  await screen.findByRole("alert");
  fireEvent.click(within(dialog).getByRole("button", { name: "再確認" }));
  await waitFor(() => expect(r.previewBulk).toHaveBeenLastCalledWith(["t1"], "delete"));
});
it("has no manual theme navigation or controls and never fetches categories", async () => {
  const r = repository();
  show(r);
  await screen.findByText("A001");
  for (const name of ['A 食べ物', 'B 旅行', 'C 出会い', 'D その他の思い出', '未分類', '一括移動'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: '分類' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('移動先の分類')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '分類を追加' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '分類名を変更' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /旧分類/ })).not.toBeInTheDocument();
  expect(r.createCategory).not.toHaveBeenCalled();
  expect(r.renameCategory).not.toHaveBeenCalled();
  expect(r.listCategories).not.toHaveBeenCalled();
  expect(screen.getByText('食べ物')).toBeVisible();
});
it('lists recordings without theme filters while date, search and status remain available', async () => {
  const r = repository();
  show(r);
  await screen.findByText('A001');
  fireEvent.change(screen.getByLabelText('録音日バッチ'), { target: { value: '2026-10-17' } });
  await waitFor(() => expect(r.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ batchDate: '2026-10-17' })));
  fireEvent.change(screen.getByLabelText('検索'), { target: { value: 'A001' } });
  fireEvent.change(screen.getByRole('combobox', { name: '録音' }), { target: { value: 'bound' } });
  await waitFor(() => expect(r.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'A001', status: 'bound', batchDate: '2026-10-17' })));
  for (const [query] of vi.mocked(r.listTags).mock.calls) {
    expect(query).not.toHaveProperty('categoryId');
    expect(query).not.toHaveProperty('uncategorized');
  }
});
it('shows transcription consent and progress without text and filters the global list state', async () => {
  const r = repository();
  const summaries = [
    { consented: false, status: null, published: false },
    { consented: true, status: 'pending' as const, published: false },
    { consented: true, status: 'processing' as const, published: false },
    { consented: true, status: 'ready' as const, published: false },
    { consented: true, status: 'ready' as const, published: true },
    { consented: true, status: 'failed' as const, published: false },
  ];
  vi.mocked(r.listTags).mockResolvedValue({
    tags: summaries.map((transcriptionSummary, index) => ({
      ...tag,
      id: `tag-${index}`,
      label: `A00${index}`,
      recording: { ...tag.recording!, id: `recording-${index}`, transcriptionSummary },
    })),
    total: summaries.length,
  });
  show(r, 'zh-CN');
  await waitFor(() => expect(document.querySelectorAll('.transcription-status')).toHaveLength(6));
  expect(Array.from(document.querySelectorAll('.transcription-status')).map((node) => node.textContent)).toEqual([
    '未同意', '待处理', '处理中', '草稿待审核', '已发布', '失败',
  ]);
  expect(screen.queryByText('private-sentinel')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: '文字转写' })[0]);
  expect(await screen.findByRole('dialog')).toBeVisible();
  fireEvent.change(screen.getByLabelText('转写状态'), { target: { value: 'draft' } });
  await waitFor(() => expect(r.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ transcriptionState: 'draft' })));
});
it('keeps reset and delete available for mixed recorded and empty selection', async () => {
  const r = repository();
  vi.mocked(r.listTags).mockResolvedValue({ tags: [tag, { ...tag, id: 'empty', label: 'U000002', categoryId: null, recording: null }], total: 2 });
  show(r);
  fireEvent.click(await screen.findByLabelText('選択 A001'));
  fireEvent.click(screen.getByLabelText('選択 U000002'));
  expect(screen.getByRole('button', { name: '一括リセット' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '一括削除' })).toBeEnabled();
  expect(r.previewBulk).not.toHaveBeenCalled();
});
it('shows current serial, stable inventory, recording date and legacy labels separately', async () => {
  const r = repository();
  vi.mocked(r.listTags).mockResolvedValue({ tags: [{ ...tag, label: '261017-A003', serialNumber: '261017-A003', inventoryLabel: 'U000001', batchDate: '2026-10-17', categoryCode: 'A', batch: '2026-10-17' }, { ...tag, id: 'old', label: 'OLD001', batch: '旧展示' }], total: 2 });
  show(r);
  expect(await screen.findByText('261017-A003')).toBeVisible();
  expect(screen.getByText('U000001')).toBeVisible();
  expect(screen.getByText('2026-10-17')).toBeVisible();
  expect(screen.getByText('旧バッチ: 旧展示')).toBeVisible();
});
it('keeps recording date and inventory visible in writing jobs', async () => {
  const r = repository();
  vi.mocked(r.listJobs).mockResolvedValue([{ id: 'job', tagId: 't1', label: '261017-A003', batch: '2026-10-17', visitorUrl: 'https://example.test/#/t/opaque', version: 1, status: 'pending', errorCode: null, inventoryLabel: 'U000001', serialNumber: '261017-A003', batchDate: '2026-10-17', categoryCode: 'A' }]);
  show(r);
  fireEvent.click(await screen.findByRole('button', { name: '書き込み作業' }));
  const job = await screen.findByText(/261017-A003/, { selector: 'li' });
  expect(job).toHaveTextContent('U000001');
  expect(job).toHaveTextContent('2026-10-17');
});
it("clears protected data after revoked authentication", async () => {
  const r = repository();
  vi.mocked(r.setEnabled).mockRejectedValue(new Error("AUTH_REQUIRED"));
  show(r);
  fireEvent.click(await screen.findByRole("button", { name: "無効化" }));
  await screen.findByRole("button", { name: "ログイン" });
  expect(screen.queryByText("A001")).not.toBeInTheDocument();
});
it("contains private error messages", async () => {
  const r = repository();
  vi.mocked(r.getPlaybackUrl).mockRejectedValue(new Error("SECRET"));
  show(r);
  fireEvent.click(await screen.findByRole("button", { name: "試聴" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("SECRET");
});
it('loads transcription only when its recording action is opened', async () => {
  const r = repository();
  show(r);
  const button = await screen.findByRole('button', { name: '文字起こし' });
  expect(button).toHaveAttribute('title', '文字起こし');
  expect(r.getTranscription).not.toHaveBeenCalled();
  button.focus();
  fireEvent.click(button);
  expect(await screen.findByRole('dialog')).toHaveTextContent('A001');
  await waitFor(() => expect(r.getTranscription).toHaveBeenCalledWith('r1'));
  expect(r.retryTranscription).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(button).toHaveFocus();
});
