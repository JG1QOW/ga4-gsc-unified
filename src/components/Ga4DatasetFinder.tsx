import { useState } from 'react';
import { inspectGa4Datasets, type Ga4DatasetInspection } from '../lib/api';

type Props = {
  project: string;
  ga4Dataset: string;
  gscDataset: string;
  onSelect: (dataset: string) => void;
};

export default function Ga4DatasetFinder({ project, ga4Dataset, gscDataset, onSelect }: Props) {
  const [inspection, setInspection] = useState<Ga4DatasetInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = async () => {
    setLoading(true);
    setError(null);
    try {
      setInspection(await inspectGa4Datasets({ project, gscDataset, site: null }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInspection(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dataset-finder">
      <button className="button is-ghost" type="button" disabled={!project || !gscDataset || loading} onClick={detect}>
        {loading ? '検出中…' : 'GA4 Dataset を検出'}
      </button>
      <p className="form-help">
        GSC Dataset のドメインと一致する GA4 Dataset を、プロジェクト内の GA4 エクスポートから探します。
      </p>
      {error ? <p className="alert">{error}</p> : null}
      {inspection ? (
        <div className="dataset-candidates">
          <p className="form-help">
            GSC のドメイン: {inspection.gscHosts.map((entry) => entry.host).join(', ') || '（データなし）'}
          </p>
          {inspection.candidates.length === 0 ? (
            <p className="form-help">GA4 エクスポートのデータセットが見つかりませんでした。</p>
          ) : (
            inspection.candidates.map((candidate) => (
              <div className="dataset-candidate" key={candidate.dataset}>
                <button
                  className={candidate.dataset === ga4Dataset ? 'button' : 'button is-ghost'}
                  type="button"
                  onClick={() => onSelect(candidate.dataset)}
                >
                  {candidate.dataset}
                </button>
                <span className="form-help">{candidate.hosts.map((entry) => entry.host).join(', ')}</span>
                {candidate.matches ? <span className="badge is-success">ドメイン一致</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
