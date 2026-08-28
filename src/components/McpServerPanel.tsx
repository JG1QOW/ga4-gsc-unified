import { useState } from 'react';
import { createMcpEndpoint, type McpAuthMode } from '../lib/api';
import { siteLabel, validateSite, type McpEndpoint, type SiteConfig } from '../lib/settings';

type Props = {
  site: SiteConfig;
  onChange: (endpoints: McpEndpoint[]) => void;
};

function endpointUrl(endpoint: McpEndpoint) {
  const base = `${window.location.origin}/mcp/${endpoint.id}`;
  return endpoint.token ? `${base}?token=${endpoint.token}` : base;
}

function clientConfig(endpoint: McpEndpoint) {
  return JSON.stringify(
    {
      mcpServers: {
        [`ga4-gsc-${endpoint.name || 'site'}`]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpointUrl(endpoint)],
        },
      },
    },
    null,
    2,
  );
}

export default function McpServerPanel({ site, onChange }: Props) {
  const [auth, setAuth] = useState<McpAuthMode>('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incomplete = Object.keys(validateSite(site)).length > 0;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createMcpEndpoint({
        name: siteLabel(site),
        project: site.project,
        ga4Dataset: site.ga4Dataset,
        gscDataset: site.gscDataset,
        auth,
      });
      onChange([
        ...site.endpoints,
        {
          id: created.id,
          name: created.name,
          auth: created.auth,
          createdAt: created.createdAt,
          token: created.token,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-row">
      <span className="form-label">MCP サーバー</span>
      <p className="form-help">
        このサイトの Project / データセットを対象にした MCP エンドポイントを発行します。エンドポイントは MCP
        クライアント（Claude Desktop、Cursor など）から利用できます。発行内容はサーバに保存されず、URL 自体に
        暗号化して埋め込まれます。
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

      {site.endpoints.length > 0 ? (
        <ul className="mcp-list">
          {site.endpoints.map((endpoint) => (
            <li className="mcp-item" key={endpoint.id}>
              <div className="mcp-item-head">
                <span className="badge is-success">{endpoint.auth === 'token' ? '認証あり' : '認証なし'}</span>
                <span className="form-help">発行 {endpoint.createdAt.slice(0, 19).replace('T', ' ')}</span>
              </div>
              <code className="mcp-endpoint">{endpointUrl(endpoint)}</code>
              <pre className="mcp-config">{clientConfig(endpoint)}</pre>
              <div className="form-actions">
                <button
                  className="button is-ghost"
                  type="button"
                  onClick={() => onChange(site.endpoints.filter((item) => item.id !== endpoint.id))}
                >
                  一覧から削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {site.endpoints.length > 0 ? (
        <p className="form-help">
          この一覧はブラウザに保存されているだけです。「一覧から削除」しても URL は無効になりません。発行済みの
          エンドポイントをまとめて無効化するには、サーバの署名鍵（<code>MCP_SEAL_KEY</code>）をローテートしてください。
        </p>
      ) : null}
    </div>
  );
}
