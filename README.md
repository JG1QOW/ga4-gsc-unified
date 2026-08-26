# GA4 GSC Unified

GA4（Google Analytics 4）と GSC（Google Search Console）のデータを統合して閲覧するための Web アプリケーションです。

- フロントエンド: React + TypeScript + Vite（`src/`）
- バックエンド: Node.js / Express（`server.js`）。Vite のビルド成果物 `dist/` を静的配信し、SPA フォールバックと `/api/*` を提供
- データアクセス: `@google-cloud/bigquery`（BigQuery）
- 実行環境: Cloud Run（`asia-northeast1`、サービス名 `ga4-gsc-unified`）
- コンテナレジストリ: Artifact Registry `asia-northeast1-docker.pkg.dev/<PROJECT_NAME>/ga4-gsc-unified/app`

## 画面構成

| パス | 内容 |
| --- | --- |
| `/page1` | 空白ページ1（内容は後日定義） |
| `/page2` | 空白ページ2（内容は後日定義） |

サイドバーのメニューから 2 ページを切り替えられます。

## API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/health` | 疎通確認。BigQuery クライアントの初期化状態を返す |
| `GET /api/bigquery/ping` | `SELECT 1` を実行して BigQuery 接続を確認するスタブ |

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
| `GCP_SA_KEY_BASE64` | base64 エンコードされたサービスアカウントキー JSON。`server.js` でデコードして BigQuery の認証情報に使用 |
| `PORT` | リッスンポート（既定 8080） |

## main ブランチの同期

`.github/workflows/sync-main.yml` は `main` への push 時に、リポジトリ変数 `SYNC_TARGET_REPOSITORY` で指定した別リポジトリの `main` へミラー push します。シークレット `SYNC_TOKEN` が必要です。
