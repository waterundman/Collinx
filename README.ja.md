<p align="center">
  <img src="icon.png" alt="Collinx" width="128" />
</p>

# Collinx

> エージェントネイティブな音楽IDE — 創作目標、音楽オブジェクト、ビュー、レンダリング、審美記憶を単一のプロジェクトグラフに統合。

Collinx は従来のDAWではありません。**プロジェクトグラフ**（型付きプロパティグラフ）上で構築された音楽制作環境であり、8つの専門**エージェント**がグラフを直接操作して、作曲、編曲、オーケストラ、ミキシング、記譜、教育、審美学習を処理します。すべてのエージェント操作は構造化された**DiffEnvelope**を生成し、ユーザー確認後にメインブランチにコミットされます。完全な監査、ロールバック、ドメイン説明をサポートします。

---

## コアコンセプト

### プロジェクトグラフ

すべての音楽データ（ノート、コード、フォーム、トラック、エフェクト、スコア、審美的証拠）は単一の型付きプロパティグラフに存在します。ノードタイプには `CompositionUnit`、`Phrase`、`Motif`、`Track`、`Player`、`PartLayout`、`NoteSpan`、`AutomationCurve`、`AudioBus`、`RenderArtifact`、`TasteEvidence`、`ExportVersion` が含まれます。エッジタイプには `contains`、`realizes`、`notates`、`performed_as`、`routed_to`、`rendered_to`、`derived_from`、`suggested_by_agent`、`confirmed_by_user`、`updates_taste` が含まれます。完全なバージョン管理とブランチ管理をサポートします。

### DiffEnvelope

すべてのエージェント操作の出力フォーマット。操作サマリー、ドメイン説明、証拠参照、リスクフラグ、ロールバックトークンを含みます。デフォルトの権限スコープは `proposal_only` — エージェントは提案のみ可能で、ユーザー確認後にメイングラフに書き込まれます。

### Taste Genome

3つの層にわたるユーザー審美の長期記憶モデル：
- **説明可能層**：人間が読めるパラメータ（例：`harmony.chromatic_color = 0.33`）
- **分布層**：ベイズ分布（Beta、Dirichlet、Bernoulli、Gaussian）
- **埋め込み層**：タグベースの埋め込みベクトル

8つの審美ドメインをカバー：Harmony、Melody、Rhythm、Texture、Timbre、Form、Mix、Reject。

### 4層音楽パイプライン

| 層 | 内容 |
|----|------|
| Composition Layer | 何が書かれたか — ノート、コード、リズム、フォーム |
| Notation Layer | どう見えるか — スコア、レイアウト、パート |
| Performance Layer | どう演奏されるか — テンポカーブ、ダイナミクス、表現 |
| Audio Layer | どう聞こえるか — ミキシング、エフェクト、エクスポート |

---

## アーキテクチャ

```
Collinx/
├── packages/
│   ├── core/        @collinx/core       ドメインモデル、グラフ、Diff、Taste、IO
│   ├── agent/       @collinx/agent      8つの専門エージェント
│   ├── ui/          @collinx/ui         React + Vite フロントエンド（9タブ）
│   └── audio/       collinx-audio-engine  C++20/JUCE オーディオエンジン
├── docs/            ドキュメント
└── .github/         CIパイプライン
```

**技術スタック**：TypeScript、React 18、Vite 5、pnpm 9 + Turborepo 2、Zod、pdfkit、fflate、VexFlow 5、i18next、Vitest、Playwright、JUCE 8（C++20）

---

## パッケージ

### @collinx/core

コアドメイン層：
- **モデル**（16モジュール）：NoteEvent、TempoMap、HarmonyPlan、Motif、Phrase、Section、FormRole、FormTemplate、EnergyCurve、Instrument、MixerState、FXChain、DSPエフェクト、ScoreModel、EngravingEngine、StemRenderer
- **グラフシステム**：ProjectGraph（CRUD、トラバーサル、バリデーション、シリアライゼーション）、RevisionStore（コミット、チェックポイント、リストア）
- **Diffシステム**：DiffEnvelope、DiffEngine（適用、ロールバック、バリデーション、マージ、競合検出）、DiffLog
- **Tasteシステム**（12モジュール）：TasteGenome、TasteStore、EvidenceExtractor、ExportAnalyzer、UpdateEngine、ScoringEngine、ReportGenerator、TentativeBuffer、ProjectOverlay、ABPlayer
- **IO**：MIDIインポート/エクスポート、MusicXML 4.0、PDFスコア、WAVオーディオ、`.agentmusic`コンテナフォーマット
- **エージェントインフラストラクチャ**：ToolRegistry（14の組み込みツール）、AgentBus（ポイントツーポイント、リクエスト/レスポンス、Pub/Sub）

### @collinx/agent

8つの専門エージェント：

| エージェント | 責任 |
|------------|------|
| **Planner** | 自然言語の目標をタスクグラフに分解、キーワードをツールにマッピング |
| **Composer** | メロディとハーモニーを生成（13スケール、6スタイルテンプレート、8リズムテンプレート） |
| **Arranger** | モチーフを完全なアレンジに拡張、フォーム構造とエネルギーカーブを設計 |
| **Orchestrator** | 楽器編成、ボイス割り当て、レジスタ競合検出、演奏可能性検証（30+楽器、7ファミリー） |
| **EngravingAgent** | スコアレイアウト、衝突検出、パート抽出（4ハウススタイル） |
| **MixingAgent** | ゲイン構造、FXチェーン、ステレオパンニングを提案 |
| **TeachingAgent** | 4つの難易度レベルで音楽的意思決定を説明（初心者/中級/上級/プロフェッショナル） |
| **TasteMemoryAgent** | エクスポートを分析、審美的証拠を確認/拒否、ゲノムをロールバック、 tasteで候補をランク付け |

### @collinx/ui

React 18 + Vite 5フロントエンド、9タブ：

| タブ | コンポーネント | 機能 |
|------|--------------|------|
| **compose** | PianoRollView、ScorePanel、ArrangementView | ピアノロール編集 + コンパクトスコア + アレンジメントタイムライン |
| **arrange** | ArrangementView、ArrangerPanel | セクションアレンジ + Diffプレビュー |
| **orchestrate** | ArrangementView、OrchestratorPanel | 楽器割り当て + 競合表示 |
| **mixer** | MixerConsole | フルミキサー（ゲイン、パン、ミュート、ソロ、FXチェーン） |
| **score** | ScorePanel | フルスコア（自動レイアウト、パート抽出、MusicXMLエクスポート） |
| **taste** | TasteTimelineView、TasteLibraryPanel、TasteDiffPanel | Tasteゲノムタイムライン + パラメータライブラリ + Diffレポート |
| **teaching** | TeachingPanel | マルチレベル音楽理論説明 |
| **agent** | AgentPanel、AgentChat | Diffキュー + チャットインターフェース |
| **graph** | GraphView、NodeDetail | プロジェクトグラフ可視化（Canvas 2D、力指向レイアウト） |

### collinx-audio-engine

C++20オーディオエンジン（JUCE 8.0.1）：
- VST3およびCLAPプラグインホスティング（サンドボックス化されたクラッシュ検出）
- 組み込みウェーブテーブルシンセサイザー
- DSP：並列処理、レイテンシ補償
- MIDIエフェクトチェーンとルーティング
- プリセット管理
- 非同期プラグインスキャン
- パフォーマンスモニタリングとプロファイリング
- オートメーションカーブ

---

## クイックスタート

### 前提条件

- Node.js >= 18
- pnpm 9.0.0
- CMake 3.22+（オーディオエンジン）
- C++20コンパイラ（オーディオエンジン）

### インストール

```bash
pnpm install
```

### 開発

```bash
pnpm dev          # すべての開発サーバーを起動
pnpm dev:ui       # UIのみ起動（ポート5180）
```

### ビルド

```bash
pnpm build        # Turborepoで全パッケージをビルド
```

### テスト

```bash
pnpm test         # 全テストを実行（Vitest単体テスト）
pnpm test:core    # コアパッケージテストのみ
pnpm test:agent   # エージェントパッケージテストのみ
pnpm test:e2e     # Playwright E2Eテスト（84テストケース）
```

### その他

```bash
pnpm typecheck    # TypeScript型チェック
pnpm lint         # ESLint
pnpm format       # Prettierフォーマット
```

---

## テストカバレッジ

- **62+単体テストファイル**：すべてのモデル、グラフシステム、Diffシステム、Tasteシステム、IO、エージェントインフラストラクチャ、8エージェントをカバー
- **12 E2Eテストファイル**（Playwright）：9タブのコアインタラクションフローをすべてカバー
- **統合テスト**：ノートからエクスポート、ミキサーレンダリングチェーン、グラフからDiff、フォームオーケストレーション、エージェントツールチェーン
- **パフォーマンスおよび安定性テストスイート**

---

## 反復計画

現在のバージョン：v0.6.0（UI）/ v0.1.0（パッケージ）

| フェーズ | 説明 | ステータス |
|---------|------|----------|
| Phase 0 (PoC) | グラフ + Diff + エージェント | 100% |
| Phase 1 (MVP) | アレンジ + ピアノロール + スコア + ミキサー + Taste + エクスポート | 99% |
| Phase 2 (可用性) | エングレービング + A/B + オーバーレイ + パフォーマンス | 95% |
| Phase 3 (プラグイン) | VST3 + サンドボックス | 25% |
| Phase 4 (エコシステム) | CLAP + マーケット + SDK | 0% |

---

## プロジェクト構造

```
Collinx/
├── .github/workflows/       CIパイプライン
├── .playwright-mcp/         Playwright MCPログ
├── docs/
│   ├── CONTEXT.md           用語と概念の定義
│   ├── ITERATION-PLAN.md    反復計画
│   ├── deep-research-report.md
│   ├── audio/               オーディオ研究ドキュメント
│   ├── bayesian-history/    ベイズ計画履歴
│   └── ui/                  UI開発ドキュメント
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── schema/      Zodグラフスキーマ定義
│   │       ├── graph/       ProjectGraph + RevisionStore
│   │       ├── model/       16ドメインモデル
│   │       ├── diff/        DiffEnvelope + DiffEngine + DiffLog
│   │       ├── taste/       Taste Genomeシステム（12モジュール）
│   │       ├── agent/       ToolRegistry + AgentBus
│   │       ├── io/          MIDI/MusicXML/PDF/WAV/.agentmusic
│   │       └── util/        ユーティリティ関数
│   ├── agent/
│   │   └── src/
│   │       ├── planner.ts       タスク計画
│   │       ├── composer.ts      メロディ/ハーモニー生成
│   │       ├── arranger/        アレンジメント（バリエーション、モチーフ変形、エネルギーカーブ）
│   │       ├── orchestrator/    オーケストレーション（ボイシング、競合検出）
│   │       ├── engraving/       記譜（レイアウト、衝突、パート）
│   │       ├── mixing/          ミックス提案
│   │       ├── teaching/        教育説明
│   │       ├── taste-memory/    審美記憶
│   │       └── tools.ts         ツール登録
│   ├── ui/
│   │   ├── e2e/             Playwright E2Eテスト
│   │   └── src/
│   │       ├── components/  15コンポーネントディレクトリ
│   │       ├── contexts/    React Context
│   │       ├── hooks/       カスタムフック
│   │       ├── i18n/        国際化
│   │       ├── styles/      デザイントークン + テーマ
│   │       └── data/        デモデータ
│   └── audio/
│       └── src/             C++20/JUCEオーディオエンジン
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## ライセンス

Private — 未公開リリース。
