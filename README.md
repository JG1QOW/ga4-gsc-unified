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

`SYNC_TARGET_REPOSITORY` は、同期元リポジトリの **Settings > Secrets and variables >
Actions > Variables**（**Secrets** ではありません）に登録します。値には URL ではなく、
`matsuri-tech/example-repository` のように所有者名とリポジトリ名だけを入力してください。
誤って Repository secret として登録済みの場合にもワークフローは動作しますが、秘密情報
ではないため Repository variable としての登録を推奨します。

### Repository secret

| 名前 | 値 |
| --- | --- |
| `SYNC_TOKEN` | 同期先リポジトリの Contents に書き込み可能な GitHub Personal Access Token |

Fine-grained personal access token を使う場合は、対象リソースを同期先リポジトリに
限定し、Repository permissions の **Contents: Read and write** を付与してください。
同期先 Organization のポリシーによっては、Organization 管理者によるトークンの
承認が必要です。

#### `SYNC_TOKEN` の作成・登録手順

1. 同期先リポジトリへ書き込み権限を持つ GitHub ユーザーでログインします。
2. GitHub 右上のプロフィール画像から **Settings** を開き、左メニュー下部の
   **Developer settings > Personal access tokens > Fine-grained tokens** を選択し、
   画面右上の **Generate new token** を押します（ログイン済みなら
   <https://github.com/settings/personal-access-tokens/new> を直接開くこともできます）。
3. **New fine-grained personal access token** 画面中央のフォームを上から順に設定します。
   - **Token name**: 用途が分かる名前（例: `ga4-gsc-unified-sync`）
   - **Expiration**: 運用ポリシーに沿った有効期限
   - **Resource owner**: 同期先リポジトリを所有するユーザーまたは Organization
4. 同じフォームを下へスクロールします。Token name、Expiration、Resource owner などの
   基本設定より下に **Repository access** という見出しが表示されます。これは左メニュー
   内の項目ではありません。
5. **Repository access** で **Only select repositories** のラジオボタンを選びます。
   直下に現れる **Select repositories** プルダウンを開き、同期先リポジトリだけに
   チェックを入れます。
6. さらに下の **Permissions > Repository permissions** を開き、**Contents** 行の
   **Access: No access** プルダウンを **Read and write** に変更します。ほかの権限は
   このワークフローには不要です。
7. ページ最下部の **Generate token** を押し、表示されたトークンを直ちにコピーします。トークンは
   画面を離れると再表示できません。
8. 同期元の `matsuri-tech/ga4-gsc-unified` を開き、**Settings > Secrets and
   variables > Actions > Secrets > New repository secret** を選択します。
9. **Name** に `SYNC_TOKEN`、**Secret** に手順 7 でコピーしたトークンを入力し、
   **Add secret** を押します。トークン文字列を `SYNC_TARGET_REPOSITORY` の値や
   README、ソースコードへ記載しないでください。
10. 同じ Actions 設定画面の **Variables > New repository variable** から、
   `SYNC_TARGET_REPOSITORY` に同期先の `owner/repository` を登録します。

#### `SYNC_TARGET_REPOSITORY is missing or invalid` と表示された場合

Actions のログで `TARGET_REPOSITORY:` が空欄なら、`SYNC_TOKEN` は設定できていますが、
同期先の設定がワークフローから読み取れていません。同期元の
`matsuri-tech/ga4-gsc-unified` で次の操作を行ってください。

1. **Settings > Secrets and variables > Actions** を開きます。
2. **Variables** タブを選び、**New repository variable** を押します。
3. **Name** に `SYNC_TARGET_REPOSITORY` と入力します。
4. **Value** に同期先を `owner/repository` 形式で入力します。`https://github.com/`、
   末尾の `.git`、スペースは含めません。
5. **Add variable** を押し、失敗したワークフローを **Re-run jobs** します。

Environment variable に登録した値は、その Environment をジョブで指定しない限り
読み込まれません。必ず **Repository variables** に登録してください。Organization
variable を利用する場合は、Repository access にこのリポジトリを含めてください。

**Repository access が見つからない場合:** まず **Resource owner** を選択し、フォームを
下へスクロールしてください。同期先が `matsuri-tech` 所有なら、Resource owner に
`matsuri-tech` を指定する必要があります。Resource owner の候補に Organization が
表示されない、またはリポジトリ選択欄に同期先が表示されない場合は、そのユーザーが
同期先へのアクセス権を持っているか、および Organization が Fine-grained personal
access token の利用を許可しているかを Organization 管理者に確認してください。

Organization のポリシーによって Fine-grained token の承認が必要な場合、作成直後は
`pending` となります。その場合は同期先 Organization の管理者に承認を依頼してから
ワークフローを実行してください。有効期限の到来やトークンの失効時には、新しい
トークンを作成して `SYNC_TOKEN` の値を更新する必要があります。

> [!WARNING]
> 同期は `--force` で行います。同期先の `main` に直接加えられた変更は、次回の同期で
> 上書きされます。同期先で branch protection/ruleset を設定している場合は、トークンの
> 所有者に force push を許可してください。同期先はミラー専用として運用してください。
