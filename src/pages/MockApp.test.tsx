import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from '../theme'
import { MockApp } from './MockApp'

function renderMock() {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <MockApp mode="dark" onBackToFoundation={vi.fn()} onModeChange={vi.fn()} />
    </ThemeProvider>,
  )
}

describe('review workspace UI mock', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('filters the review queue by title and description', () => {
    renderMock()

    fireEvent.change(screen.getByRole('textbox', { name: 'タイトル・説明を検索' }), { target: { value: '429' } })

    expect(screen.getByRole('button', { name: /!118 GitLab APIの429待機を接続単位で扱う/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /!42 MR一覧の検索結果をSQLite/ })).not.toBeInTheDocument()
  })

  it('keeps navigation usable after collapsing the desktop sidebar', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))
    expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクト 対象を切り替える' }))
    expect(screen.getByRole('heading', { name: 'プロジェクトを選ぶ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  })

  it('opens a selected merge request and preserves the real fixture title', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: /!39 差分ビューの行描画を可視範囲だけに制限する/ }))

    expect(screen.getByRole('heading', { name: '差分ビューの行描画を可視範囲だけに制限する' })).toBeInTheDocument()
    expect(screen.getByText('perf/virtual-diff-rows → main')).toBeInTheDocument()
  })

  it('keeps a local draft and labels the simulated submission clearly', () => {
    renderMock()
    const composer = screen.getByRole('textbox', { name: 'レビューコメント' })

    fireEvent.change(composer, { target: { value: 'キャッシュキーの境界をもう一度確認したいです。' } })
    fireEvent.click(screen.getByRole('tab', { name: '概要' }))
    expect(screen.queryByRole('textbox', { name: 'レビューコメント' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '議論に戻る' }))
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('キャッシュキーの境界をもう一度確認したいです。')
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿シミュレーション' }))

    expect(screen.getByText('コメントをローカルに追加しました。GitLabへは送信されません。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('')
  })

  it('keeps replies attached to a discussion created in the mock session', () => {
    renderMock()

    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: 'この境界を確認する新しい議論です。' } })
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿シミュレーション' }))
    fireEvent.click(screen.getByRole('tab', { name: /議論/ }))
    fireEvent.click(screen.getByRole('button', { name: '自分の議論に返信' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: '新しく作った議論への返信です。' } })
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿シミュレーション' }))

    expect(screen.getByText('この境界を確認する新しい議論です。')).toBeInTheDocument()
    expect(screen.getByText('新しく作った議論への返信です。')).toBeInTheDocument()
  })

  it('isolates drafts and their saved indicator by merge request', () => {
    renderMock()
    const firstDraft = screen.getByRole('textbox', { name: 'レビューコメント' })
    fireEvent.change(firstDraft, { target: { value: 'MR 42だけの下書き' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(screen.getByRole('button', { name: '下書きを保存' })).toHaveTextContent('保存しました')

    fireEvent.click(screen.getByRole('button', { name: /!39 差分ビューの行描画を可視範囲だけに制限する/ }))
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '下書きを保存' })).toHaveTextContent('下書き保存')

    fireEvent.click(screen.getByRole('button', { name: /!42 MR一覧の検索結果をSQLiteキャッシュから再利用する/ }))
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('MR 42だけの下書き')
    expect(screen.getByRole('button', { name: '下書きを保存' })).toHaveTextContent('下書き保存')
  })

  it('opens a merge request on the discussion-first detail tab order', () => {
    renderMock()

    const detailTabs = within(screen.getByRole('tablist', { name: 'MR詳細タブ' })).getAllByRole('tab')
    expect(detailTabs.map((tab) => tab.textContent?.trim())).toEqual(['議論 4', '変更 2', '概要'])
    expect(detailTabs[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: /!39 差分ビューの行描画を可視範囲だけに制限する/ }))

    expect(within(screen.getByRole('tablist', { name: 'MR詳細タブ' })).getByRole('tab', { name: /議論/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps a queued comment unpublished until the review is sent', async () => {
    renderMock()
    const body = '保留してから公開するコメントです。'

    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: body } })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを開始' }))

    expect(screen.getByRole('button', { name: 'レビューを送信 (1)' })).toBeInTheDocument()
    expect(screen.queryByText(body)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (1)' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信シミュレーション' }))

    expect(screen.getByText(body)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'レビューを送信 (0)' })).toBeDisabled())
  })

  it('captures a line comment with the selected file version and side', () => {
    renderMock()
    fireEvent.click(screen.getByRole('tab', { name: /変更/ }))
    fireEvent.click(screen.getByRole('button', { name: '新4行目にコメント' }))

    expect(screen.getByRole('tab', { name: /議論/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('src/lib/review-cache.ts:4 · 変更後 · b7c2e81')).toBeInTheDocument()
  })

  it('keeps drafts isolated by the captured comment position', () => {
    renderMock()
    fireEvent.click(screen.getByRole('tab', { name: /変更/ }))
    fireEvent.click(screen.getByRole('button', { name: '新4行目にコメント' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: '4行目だけの下書き' } })

    fireEvent.click(screen.getByRole('tab', { name: /変更/ }))
    fireEvent.click(screen.getByRole('button', { name: '新5行目にコメント' }))
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('')

    fireEvent.click(screen.getByRole('tab', { name: /変更/ }))
    fireEvent.click(screen.getByRole('button', { name: '新4行目にコメント' }))
    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveValue('4行目だけの下書き')
  })

  it('defers resolving a reply until the queued review is published', () => {
    renderMock()
    fireEvent.click(screen.getByRole('button', { name: '佐藤 健の議論に返信' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '返信と同時に解決' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: 'この返信と同時に解決します。' } })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを開始' }))

    expect(screen.getAllByText('未解決').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信シミュレーション' }))

    expect(screen.getByText('この返信と同時に解決します。')).toBeInTheDocument()
    expect(screen.getAllByText('解決済み').length).toBeGreaterThan(0)
  })

  it('allows editing and deleting only the current user\'s published comment', () => {
    renderMock()
    const body = '自分のコメントをあとで編集します。'

    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: body } })
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿シミュレーション' }))
    fireEvent.click(screen.getByRole('button', { name: 'コメントを編集' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'コメントを編集' }), { target: { value: '編集後の自分のコメントです。' } })
    fireEvent.click(screen.getByRole('button', { name: '編集を保存' }))

    expect(screen.getByText('編集後の自分のコメントです。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }))
    fireEvent.click(screen.getByRole('button', { name: '削除を確定' }))

    expect(screen.queryByText('編集後の自分のコメントです。')).not.toBeInTheDocument()
  })

  it('keeps pending review items isolated when switching merge requests', () => {
    renderMock()
    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: 'MR 42だけで保留するレビューです。' } })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを開始' }))

    fireEvent.click(screen.getByRole('button', { name: /!39 差分ビューの行描画を可視範囲だけに制限する/ }))
    expect(screen.getByRole('button', { name: 'レビューを送信 (0)' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /!42 MR一覧の検索結果をSQLiteキャッシュから再利用する/ }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (1)' }))
    expect(screen.getByText('MR 42だけで保留するレビューです。')).toBeInTheDocument()
  })

  it('publishes a review summary and optional approval together', () => {
    renderMock()
    fireEvent.change(screen.getByRole('textbox', { name: 'レビューコメント' }), { target: { value: '承認と一緒に公開するコメントです。' } })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを開始' }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (1)' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'レビュー概要（任意）' }), { target: { value: '確認したので承認します。' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'このレビューを承認として送信' }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信シミュレーション' }))

    expect(screen.getByText('確認したので承認します。')).toBeInTheDocument()
    expect(screen.getByText('承認済み')).toBeInTheDocument()
    expect(screen.getByText('承認と一緒に公開するコメントです。')).toBeInTheDocument()
  })

  it('updates approval state and queue counts while keeping the selected detail visible', () => {
    renderMock()

    expect(screen.getByRole('tab', { name: '要レビュー 3' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MRを承認' }))

    expect(screen.getByText('承認済み')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '要レビュー 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'MR一覧の検索結果をSQLiteキャッシュから再利用する' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'すべて 7' }))
    fireEvent.click(screen.getByRole('button', { name: /!37 Self-Managed接続先の資格情報をOSストアへ移す/ }))

    expect(screen.getByRole('button', { name: '承認を取り消す' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '承認を取り消す' }))
    expect(screen.getByRole('button', { name: 'MRを承認' })).toBeInTheDocument()
  })

  it('searches historical merge requests and opens the result in the review workspace', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: 'MRを検索 過去の変更を探す' }))
    fireEvent.change(screen.getByRole('textbox', { name: '過去のMRをタイトル・説明で検索' }), { target: { value: '資格情報' } })
    fireEvent.click(screen.getByRole('button', { name: /資格情報をOSストアへ移す/ }))

    expect(screen.getByRole('heading', { name: 'Self-Managed接続先の資格情報をOSストアへ移す' })).toBeInTheDocument()
    expect(screen.getByText('UIモック · サンプルデータ / 未接続')).toBeInTheDocument()
  })

  it('opens a project-scoped merge request screen with title and description search', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクト 対象を切り替える' }))
    fireEvent.click(screen.getByText('Desktop Client'))

    expect(screen.getByRole('heading', { name: 'Desktop Client' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'すべて 3' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open 3' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Desktop ClientのMRをタイトル・説明で検索' }), { target: { value: 'SQLite' } })

    expect(screen.getByRole('button', { name: 'MR !42を開く' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MR !39を開く' })).not.toBeInTheDocument()
  })

  it('keeps a project with no open merge requests useful for historical review', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクト 対象を切り替える' }))
    fireEvent.click(screen.getByText('Data Catalog'))

    expect(screen.getByRole('heading', { name: 'Data Catalog' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open 0' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Merged 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MR !64を開く' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Open 0' }))

    expect(screen.getByText('オープンのMRがありません')).toBeInTheDocument()
    expect(screen.getByText(/過去のMRは/)).toBeInTheDocument()
  })

  it('returns from a project MR to the same project page', () => {
    renderMock()

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクト 対象を切り替える' }))
    fireEvent.click(screen.getByText('Desktop Client'))
    fireEvent.click(screen.getByRole('button', { name: 'MR !42を開く' }))

    expect(screen.getByRole('button', { name: 'Desktop Client に戻る' })).toBeInTheDocument()
    expect(screen.getAllByText(/platform\/desktop-client/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Desktop Client に戻る' }))

    expect(screen.getByRole('heading', { name: 'Desktop Client' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'すべて 3' })).toBeInTheDocument()
  })
})
