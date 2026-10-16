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
const tag: ManagedTag = {
  id: "t1",
  token: "opaque",
  label: "A001",
  batch: "食品",
  categoryId: "c1",
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
    listJobs: vi.fn().mockResolvedValue([]),
    provision: vi.fn(),
    getAudit: vi.fn().mockResolvedValue([]),
    maintenance: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([
      { id: "c1", name: "食品", code: "A", nextNumber: 2 },
      { id: "c2", name: "景点", code: "B", nextNumber: 1 },
    ]),
    createCategory: vi.fn(),
    renameCategory: vi.fn(),
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
function show(r: AdminRepository) {
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
  expect(screen.getByRole('button', { name: '分類を追加' })).toBeVisible();
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
  fireEvent.change(screen.getByLabelText("作成する分類"), {
    target: { value: "c1" },
  });
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
  fireEvent.change(screen.getByLabelText("作成する分類"), {
    target: { value: "c1" },
  });
  fireEvent.change(screen.getByLabelText("枚数"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "空カードを作成" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "作成を再試行" }));
  await waitFor(() => expect(r.createCards).toHaveBeenCalledTimes(2));
  expect(vi.mocked(r.createCards).mock.calls[0]).toEqual(
    vi.mocked(r.createCards).mock.calls[1],
  );
  expect(r.createCards).toHaveBeenCalledWith("c1", 30, expect.any(String));
});
it("filters classification and clears selected cards", async () => {
  const r = repository();
  show(r);
  fireEvent.click(await screen.findByLabelText("選択 A001"));
  fireEvent.click(screen.getByRole("button", { name: "A 食品" }));
  await waitFor(() =>
    expect(r.listTags).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "c1" }),
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
it("moves selected cards to explicit destination and preserves retry key", async () => {
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
  fireEvent.change(screen.getByLabelText("移動先の分類"), {
    target: { value: "c2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "一括移動" }));
  const d = await screen.findByRole("dialog");
  expect(r.previewBulk).toHaveBeenCalledWith(["t1"], "move", "c2");
  fireEvent.click(within(d).getByRole("checkbox"));
  fireEvent.click(within(d).getByRole("button", { name: "移動を確定" }));
  await screen.findByRole("alert");
  fireEvent.click(within(d).getByRole("button", { name: "移動を確定" }));
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
  await waitFor(() => expect(r.previewBulk).toHaveBeenLastCalledWith(["t1"], "delete", undefined));
});
it("creates and renames category without changing its code", async () => {
  const r = repository();
  show(r);
  await screen.findByText("A001");
  fireEvent.click(screen.getByRole("button", { name: "分類を追加" }));
  fireEvent.change(screen.getByLabelText("分類名"), {
    target: { value: "其他" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(r.createCategory).toHaveBeenCalledWith("其他", expect.any(String)),
  );
  fireEvent.click(screen.getByRole("button", { name: "A 食品" }));
  fireEvent.click(screen.getByRole("button", { name: "分類名を変更" }));
  fireEvent.change(screen.getByLabelText("分類名"), {
    target: { value: "食べ物" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(r.renameCategory).toHaveBeenCalledWith("c1", "食べ物"),
  );
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
