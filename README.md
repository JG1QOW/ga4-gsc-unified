# ga4-gsc-unified

## `main` ブランチの別リポジトリへの同期

`main` ブランチへの push（Pull Request のマージを含む）をトリガーに、別の
GitHub リポジトリの `main` ブランチへ同じコミット履歴を同期します。必要に応じて
Actions 画面の **Run workflow** から手動実行することもできます。

同期元（`matsuri-tech/ga4-gsc-unified`）の **Settings > Secrets and variables >
Actions** で、次を設定してください。

### Repository variable

| 名前 | 値 |
| --- | --- |
| `SYNC_TARGET_REPOSITORY` | 同期先を `owner/repository` 形式で指定（例: `example/example-repository`） |

### Repository secret

| 名前 | 値 |
| --- | --- |
| `SYNC_TOKEN` | 同期先リポジトリの Contents に書き込み可能な GitHub Personal Access Token |

Fine-grained personal access token を使う場合は、対象リソースを同期先リポジトリに
限定し、Repository permissions の **Contents: Read and write** を付与してください。
同期先が Organization 配下で SAML SSO を必須としている場合は、その Organization
に対してトークンを承認する必要もあります。

> [!WARNING]
> 同期は `--force` で行います。同期先の `main` に直接加えられた変更は、次回の同期で
> 上書きされます。同期先で branch protection/ruleset を設定している場合は、トークンの
> 所有者に force push を許可してください。同期先はミラー専用として運用してください。
