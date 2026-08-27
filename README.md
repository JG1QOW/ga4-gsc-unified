# GA4 GSC Unified

GA4（Google Analytics 4）と GSC（Google Search Console）のデータを統合して閲覧するための Web アプリケーションです。

- フロントエンド: React + TypeScript + Vite（`src/`）
- バックエンド: Node.js / Express（`server/index.js`）。Vite のビルド成果物 `dist/` を静的配信し、SPA フォールバックと `/api/*` を提供
- データアクセス: `@google-cloud/bigquery`（BigQuery）
- 実行環境: Cloud Run（`asia-northeast1`、サービス名 `ga4-gsc-unified`）
- コンテナレジストリ: Artifact Registry `asia-northeast1-docker.pkg.dev/<PROJECT_NAME>/ga4-gsc-unified/app`

## 画面構成

| パス | 内容 |
| --- | --- |
| `/settings` | サイト（サイト名 / Project / GA4 Dataset / GSC Dataset）を複数登録 |
| `/analytics` | 登録サイトを切り替えてレポートを実行 |

サイドバーのメニューから 2 ページを切り替えられます。`/` は `/settings` にリダイレクトします。

### Settings

サイトは複数登録でき、「サイトを追加」で行を増やしてまとめて保存します。

| 項目 | 内容 |
| --- | --- |
| サイト名 | Analytics のサイト切替に表示する名前 |
| Project | BigQuery のデータセットが存在する GCP プロジェクト ID |
| GA4 Dataset | GA4 BigQuery Export のデータセット（`events_*` を含む） |
| GSC Dataset | Search Console 一括データエクスポートのデータセット（`searchdata_url_impression` を含む） |

さらにサイトごとに「レポートユニット」を構成できます。1 ユニットは「レポート種別 / 表示名 / しきい値 / 最大行数」の組で、同じレポート種別を異なるしきい値で複数登録することもできます。ユニットを登録していないサイトは全レポートが既定値で表示されます。

設定はブラウザの localStorage（キー `ga4-gsc-unified:settings`）に `{ sites: [...], activeSiteId }` 形式で保存され（単一サイトの旧形式は読み込み時に自動移行）、Analytics のリクエストごとにサーバへ渡されます。サーバ側は状態を保持しません。

### Analytics

登録サイト（複数登録している場合はヘッダのセレクトで切替、選択は保存されます）・GSC プロパティ・期間・しきい値を指定してレポートを実行します。カードに並ぶのは Settings でそのサイトに構成したレポートユニットです。サーバが提供するレポート種別は以下の 12 種です。

| レポート | データソース | 分析意図 |
| --- | --- | --- |
| Discover ページライフサイクル | SC | Discover に載ってから何日伸びるか |
| SEO 改善候補ランキング | SC | 表示は多いのに CTR・順位が悪いページ |
| ページ別「流入後品質」 | GA4×SC | 検索 / Discover で来た読者が実際に読んだか |
| ページ回遊力ランキング | GA4 | 次のページへ送客できるページ |
| Discoverヒットページ分析 | SC＋ページ属性 | Discover で伸びるページの特徴（第 1 階層・パス階層数・スラッグ長） |
| 検索需要急上昇検知 | SC | 最近急に検索され始めたテーマ |
| SEOカニバリゼーション | SC | 同じ検索語で複数ページが競合 |
| ページ劣化・リライト候補 | SC×GA4 | 検索流入が落ち始めたページ |
| 検索→読了→回遊ファネル | SC×GA4 | SEO 流入の「質」 |
| リピーター創出力 | GA4 | 新規読者を再訪させるページ |
| ページ更新効果測定 | SC×GA4 | リライト前後の改善度 |
| 検索意図クラスタ分析 | SC | サイトが獲得している検索需要の構造 |

トレンド比較型のレポート（検索需要急上昇検知・ページ劣化・リライト候補・ページ更新効果測定）は、指定期間を前半（前期）と後半（後期）に分割して比較します。検索語を扱うレポートは `searchdata_url_impression` の `query` を使い、匿名化クエリは除外します。

各レポートは表に加えてグラフ（棒グラフ・散布図）を表示します。表は列名をクリックすると、その列の値でソート（昇順・降順をトグル）できます。

「ページ別「流入後品質」」は GSC と GA4 のページを突き合わせるため、ホスト（`www.` の有無・大文字小文字）とパス（末尾スラッシュ・URL エンコード・大文字小文字）を正規化した上で GSC 側を基準に LEFT JOIN します。GA4 側に該当ページが無い場合は GA4 指標が空になり、画面に GA4 プロパティとサイトの対応を確認する案内を表示します。

前提とするテーブルは GSC 側が `<GSC Dataset>.searchdata_url_impression`（`data_date`, `site_url`, `url`, `query`, `is_anonymized_query`, `search_type`, `impressions`, `clicks`, `sum_position`）、GA4 側が `<GA4 Dataset>.events_*`（`event_name`, `event_timestamp`, `user_pseudo_id`, `event_params`）です。

## API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/health` | 疎通確認。BigQuery クライアントの初期化状態を返す |
| `GET /api/reports` | レポートのカタログ（表示名・データソース・列定義・既定しきい値） |
| `POST /api/sites` | GSC データセットに含まれる `site_url` の一覧 |
| `POST /api/reports/:reportId` | レポートを実行し、列定義・行・スキャンバイト数を返す |

プロジェクト ID・データセット ID は SQL の識別子として展開するため形式を検証し、それ以外の値は BigQuery のクエリパラメータとして渡します。

## デプロイ

ローカル環境でのセットアップは不要です。依存関係のインストールとビルドは `package.json` と `Dockerfile` に定義されており、デプロイ時に実行されます。

デプロイ経路は 2 つあり、いずれも同じ Artifact Registry のイメージパスと Cloud Run サービスを使用します。

1. **GitHub Actions** — `main` への push で `.github/workflows/deploy-to-cloud-run.yml` が実行され、イメージのビルド・push と Cloud Run へのデプロイ、および環境変数（`GCP_SA_KEY_BASE64`, `PROJECT_NAME`）の設定を行います。
2. **Cloud Build トリガー** — `cloudbuild.yaml` を参照し、build → push → `gcloud run deploy` を実行します。環境変数の設定は行いません（GitHub Actions 側と重複させないため）。

### 必要なリポジトリシークレット

| シークレット | 用途 |
| --- | --- |
| `PROJECT_NAME` | デプロイ先の GCP プロジェクト ID。コードや設定ファイルにハードコードしません |
| `GCP_SA_KEY` | サービスアカウントキー（JSON）。GitHub Actions での認証に使用し、base64 エンコードして `GCP_SA_KEY_BASE64` として Cloud Run に渡されます |

### Cloud Run の環境変数

| 環境変数 | 用途 |
| --- | --- |
| `PROJECT_NAME` | BigQuery クライアントの `projectId` |
| `GCP_SA_KEY_BASE64` | base64 エンコードされたサービスアカウントキー JSON。`server/bigquery.js` でデコードして BigQuery の認証情報に使用 |
| `PORT` | リッスンポート（既定 8080） |

## main ブランチの同期

`.github/workflows/sync-main.yml` は `main` への push 時に、リポジトリ変数 `SYNC_TARGET_REPOSITORY` で指定した別リポジトリの `main` へミラー push します。シークレット `SYNC_TOKEN` が必要です。
