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

登録サイト（複数登録している場合はヘッダのセレクトで切替、選択は保存されます）・GSC プロパティ・期間・しきい値を指定してレポートを実行します。カードに並ぶのは Settings でそのサイトに構成したレポートユニットです。サーバが提供するレポート種別は以下の 17 種です。

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
| GA4 ページ別アクセス数（基本） | GA4 | GA4 データセットに入っているページ別の素データ |
| GA4 イベントログ（基本） | GA4 | GA4 データセットに入っているイベントの種類と件数 |
| GA4 日別アクセス数（基本） | GA4 | GA4 データセットの日別のセッション・ユーザー数 |
| GSC 日別検索キーワード（基本） | SC | Search Console データセットの日別・検索語別の素データ |
| GSC 日別サマリー（基本） | SC | Search Console データセットの日別の総表示・クリック |

「（基本）」の 5 種は指定したデータセットに実際どんなデータが入っているかを確認するためのレポートで、集計や結合を最小限にした素の値を返します。

トレンド比較型のレポート（検索需要急上昇検知・ページ劣化・リライト候補・ページ更新効果測定）は、指定期間を前半（前期）と後半（後期）に分割して比較します。検索語を扱うレポートは `searchdata_url_impression` の `query` を使い、匿名化クエリは除外します。

各レポートは表に加えてグラフ（棒グラフ・散布図）を表示します。表は列名をクリックすると、その列の値でソート（昇順・降順をトグル）できます。

「ページ別「流入後品質」」は GSC と GA4 のページを突き合わせるため、ホスト（`www.` の有無・大文字小文字）とパス（末尾スラッシュ・URL エンコード・大文字小文字）を正規化した上で GSC 側を基準に LEFT JOIN します。GA4 側に該当ページが無い場合は GA4 指標が空になり、画面に GSC 側のドメイン・現在の GA4 Dataset と、ドメインが一致する GA4 Dataset の候補を表示します。候補は `POST /api/ga4-datasets` がプロジェクト内の `analytics_*` データセットを調べて返します（Settings の「GA4 Dataset を検出」からも実行できます）。

「ページ」列を持つレポートのページタイトルは、レポート実行後に GA4 の `page_view` の `page_title` を引いて付与します。GSC 側のページと突き合わせるためホストとパスを正規化して一致を取り、探索期間はレポート期間の 30 日前から当日までに広げます（レポート期間内に `page_view` が無いページでもタイトルを拾うため）。

GA4 のワイルドカード `events_*` は日次テーブル `events_YYYYMMDD` と当日分の `events_intraday_YYYYMMDD` の両方に一致します。期間の絞り込みは `_TABLE_SUFFIX` から末尾の 8 桁を取り出した日付で行うため、`events_intraday_*` しか無いデータセットでもレポートを表示できます。同じ日の日次テーブルと intraday テーブルが両方ある場合は、二重計上を避けるため日次テーブルのみを使います。

前提とするテーブルは GSC 側が `<GSC Dataset>.searchdata_url_impression`（`data_date`, `site_url`, `url`, `query`, `is_anonymized_query`, `search_type`, `impressions`, `clicks`, `sum_position`）、GA4 側が `<GA4 Dataset>.events_*`（`event_name`, `event_timestamp`, `user_pseudo_id`, `event_params`）です。

## API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/health` | 疎通確認。BigQuery クライアントの初期化状態を返す |
| `GET /api/reports` | レポートのカタログ（表示名・データソース・列定義・既定しきい値） |
| `POST /api/sites` | GSC データセットに含まれる `site_url` の一覧 |
| `POST /api/reports/:reportId` | レポートを実行し、列定義・行・スキャンバイト数を返す |
| `POST /api/ga4-datasets` | GSC データセットのドメインと一致する GA4 データセットの候補を返す |
| `POST /api/mcp/endpoints` | MCP エンドポイントを発行（署名付き ID とトークンを返す） |

プロジェクト ID・データセット ID は SQL の識別子として展開するため形式を検証し、それ以外の値は BigQuery のクエリパラメータとして渡します。

## MCP サーバー

Settings のサイトごとに「MCP サーバーを生成」でき、そのサイトの Project / GA4 Dataset / GSC Dataset だけを対象とする MCP エンドポイントが即時発行されます。Cloud Run サービスは 1 つのまま、`/mcp/:instanceId` でインスタンスを区別します。

サーバは状態を持ちません。対象の Project / データセット・認証方式・トークンのハッシュを JSON にまとめ、`MCP_SEAL_KEY` から導出した鍵で AES-256-GCM 暗号化（認証付き）した文字列がそのまま URL の `:instanceId` になります。リクエストごとに復号して対象データセットを決めるため、Firestore などのデータストアは不要です。改竄・鍵不一致の場合は復号に失敗して 404 を返します。

発行済みエンドポイントの一覧は、他のサイト設定と同じくブラウザの localStorage に保存されます（サーバには残りません）。

| エンドポイント | 内容 |
| --- | --- |
| `POST /mcp/:instanceId` | MCP の JSON-RPC 2.0 エンドポイント（`initialize` / `ping` / `tools/list` / `tools/call`） |
| `GET /mcp/:instanceId` | 接続情報（対象データセット・認証方式・ツール一覧） |

公開しているツールは以下の 4 つで、任意 SQL の実行は提供しません。

| ツール | 内容 |
| --- | --- |
| `list_reports` | 利用できるレポート種別・列定義・既定しきい値 |
| `run_report` | レポートを実行（`reportId`, `startDate`, `endDate`, `site`, `threshold`, `limit`） |
| `list_sites` | GSC データセットに含まれる `site_url` の一覧 |
| `describe_tables` | 対象 GA4 / GSC データセットのテーブルとスキーマ |

### 認証

生成時に「トークン認証」（既定）か「認証なし」を選べます。トークンは `Authorization: Bearer <token>` か `?token=<token>` で渡します。URL にトークンを載せる方式はブラウザ履歴やアクセスログに残るため、可能なら Authorization ヘッダを使ってください。

トークン自体はサーバにも URL の中にも保存されず、SHA-256 ハッシュのみが暗号化ペイロードに含まれます（検証はタイミングセーフ比較）。

「認証なし」を選ぶと、エンドポイント URL を知っていれば誰でも対象データセットを参照でき、BigQuery のクエリ課金も発生します。社外に共有される可能性がある場合はトークン認証を使ってください。

MCP クライアント（Claude Desktop など）からは `mcp-remote` 経由で接続します。

```json
{
  "mcpServers": {
    "ga4-gsc-example": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<Cloud Run のホスト>/mcp/<instanceId>?token=<token>"]
    }
  }
}
```

### 失効

サーバが状態を持たないため、エンドポイントを 1 件ずつ失効させることはできません。発行済みのエンドポイントをまとめて無効化するには鍵の元になる値（`MCP_SEAL_KEY`、未設定ならサービスアカウントキー）をローテートしてください（以後、既存の URL はすべて 404 になります）。Settings の「一覧から削除」はブラウザの一覧から消すだけで、URL は有効なままです。

### 必要な設定

設定作業は不要です。暗号鍵は以下の順で導出されます。

1. `MCP_SEAL_KEY`（任意。例: `openssl rand -base64 32` をリポジトリシークレットに登録）
2. 未設定なら `GCP_SA_KEY_BASE64`（既にデプロイ時に Cloud Run に渡している値）

いずれもデプロイ間で値が安定しているため、発行済みエンドポイントは再デプロイ後も使えます（フォールバック使用時にサービスアカウントキーを差し替えると、全エンドポイントが無効になります。鍵の寿命を SA キーと分けたい場合は `MCP_SEAL_KEY` を登録してください）。どちらの値を使っているかは `/api/health` の `mcpSealKeySource` で確認できます。Firestore などの追加サービスや IAM ロールの追加は不要で、BigQuery の権限は既存レポートと同じサービスアカウントをそのまま使います。

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
| `MCP_SEAL_KEY` | （任意）MCP エンドポイントの暗号鍵の元になるランダム文字列。未設定の場合は `GCP_SA_KEY_BASE64` から導出します |

### Cloud Run の環境変数

| 環境変数 | 用途 |
| --- | --- |
| `PROJECT_NAME` | BigQuery クライアントの `projectId` |
| `GCP_SA_KEY_BASE64` | base64 エンコードされたサービスアカウントキー JSON。`server/bigquery.js` でデコードして BigQuery の認証情報に使用 |
| `PORT` | リッスンポート（既定 8080） |
| `MCP_SEAL_KEY` | （任意）MCP エンドポイントの暗号鍵の元。未設定の場合は `GCP_SA_KEY_BASE64` を使います |
| `MCP_MAX_BYTES_BILLED` | MCP 経由の BigQuery クエリの課金バイト上限（既定 50GiB） |

## main ブランチの同期

`.github/workflows/sync-main.yml` は `main` への push 時に、リポジトリ変数 `SYNC_TARGET_REPOSITORY` で指定した別リポジトリの `main` へミラー push します。シークレット `SYNC_TOKEN` が必要です。
