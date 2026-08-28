import { useState } from 'react';
import {
  createMcpInstance,
  deleteMcpInstance,
  reissueMcpToken,
  revokeMcpInstance,
  setMcpInstanceAuth,
  type McpAuthMode,
  type McpInstance,
} from '../lib/api';
import { siteLabel, validateSite, type SiteConfig } from '../lib/settings';

type Props = {
  site: SiteConfig;
  instances: McpInstance[];
  onChanged: () => void;
};

function endpointUrl(instance: McpInstance) {
  return `${window.location.origin}/mcp/${instance.id}`;
}

function clientConfig(instance: McpInstance, token: string | null) {
  const url = token ? `${endpointUrl(instance)}?token=${token}` : endpointUrl(instance);
  return JSON.stringify(
    { mcpServers: { [`ga4-gsc-${instance.name || instance.id}`]: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    null,
    2,
  );
}

export default function McpServerPanel({ site, instances, onChanged }: Props) {
  const [auth, setAuth] = useState<McpAuthMode>('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  const incomplete = Object.keys(validateSite(site)).length > 0;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const { instance, token } = await createMcpInstance({
        name: siteLabel(site),
        project: site.project,
        ga4Dataset: site.ga4Dataset,
        gscDataset: site.gscDataset,
        auth,
      });
      if (token) {
        setTokens((current) => ({ ...current, [instance.id]: token }));
      }
    });

  return (
    <div className="form-row">
      <span className="form-label">MCP サーバー</span>
      <p className="form-help">
        このサイトの Project / データセットを対象にした MCP エンドポイントを発行します。エンドポイントは MCP
        クライアント（Claude Desktop、Cursor など）から利用できます。
      </p>

      <div className="mcp-generate">
        <select className="input" value={auth} onChange={(event) => setAuth(event.target.value as McpAuthMode)}>
          <option value="token">認証あり（トークン必須・推奨）</option>
          <option value="none">認証なし（URL を知る誰でもアクセス可）</option>
        </select>
        <button className="button" type="button" disabled={busy || incomplete} onClick={generate}>
          MCP サーバー生成
        </button>
      </div>
      {incomplete ? (
        <p className="form-help is-error">Project / GA4 Dataset / GSC Dataset を入力すると生成できます。</p>
      ) : null}
      {auth === 'none' ? (
        <p className="alert">
          認証なしのエンドポイントは URL を知っている全員が BigQuery のデータを読み取れます。クエリ費用も発生するため、
          共有範囲に注意してください。
        </p>
      ) : null}
      {error ? <p className="alert">{error}</p> : null}

      {instances.length > 0 ? (
        <ul className="mcp-list">
          {instances.map((instance) => {
            const token = tokens[instance.id] ?? null;
            return (
              <li className="mcp-item" key={instance.id}>
                <div className="mcp-item-head">
                  <code className="mcp-endpoint">{endpointUrl(instance)}</code>
                  <span className={instance.revokedAt ? 'badge' : 'badge is-success'}>
                    {instance.revokedAt ? '失効' : instance.auth === 'token' ? '認証あり' : '認証なし'}
                  </span>
                </div>
                <p className="form-help">
                  作成 {instance.createdAt.slice(0, 19).replace('T', ' ')} / 最終利用{' '}
                  {instance.lastUsedAt ? instance.lastUsedAt.slice(0, 19).replace('T', ' ') : '—'}
                </p>
                {token ? (
                  <>
                    <p className="form-help is-error">
                      トークンは今だけ表示されます。閉じると再表示できません（再発行は可能です）。
                    </p>
                    <code className="mcp-token">{token}</code>
                    <pre className="mcp-config">{clientConfig(instance, token)}</pre>
                  </>
                ) : (
                  <pre className="mcp-config">{clientConfig(instance, null)}</pre>
                )}
                <div className="form-actions">
                  <button
                    className="button is-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await reissueMcpToken(instance.id);
                        if (result.token) {
                          setTokens((current) => ({ ...current, [instance.id]: result.token as string }));
                        }
                      })
                    }
                  >
                    トークンを再発行
                  </button>
                  <button
                    className="button is-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const next = instance.auth === 'token' ? 'none' : 'token';
                        const result = await setMcpInstanceAuth(instance.id, next);
                        setTokens((current) => {
                          const copy = { ...current };
                          if (result.token) {
                            copy[instance.id] = result.token;
                          } else {
                            delete copy[instance.id];
                          }
                          return copy;
                        });
                      })
                    }
                  >
                    {instance.auth === 'token' ? '認証なしに変更' : '認証ありに変更'}
                  </button>
                  {instance.revokedAt ? null : (
                    <button
                      className="button is-ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => run(async () => void (await revokeMcpInstance(instance.id)))}
                    >
                      失効
                    </button>
                  )}
                  <button
                    className="button is-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => run(async () => void (await deleteMcpInstance(instance.id)))}
                  >
                    削除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
