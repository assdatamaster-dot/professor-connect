import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AdminApi } from './api';
import { GridIcon } from './icons';
import type { UpdateMetrics } from './types';

export function UpdatesPage({ api }: { readonly api: AdminApi }): React.JSX.Element {
  const [metrics, setMetrics] = useState<UpdateMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setMetrics(await api.updateMetrics(signal));
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Não foi possível carregar o inventário de versões.');
      }
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);
  const summary = useMemo(() => {
    const items = metrics?.items ?? [];
    return {
      clients: items.reduce((total, item) => total + item.totalClients, 0),
      updated: items.reduce((total, item) => total + item.updatedClients, 0),
      outdated: items.reduce((total, item) => total + item.outdatedClients, 0),
    };
  }, [metrics]);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Distribuição</span>
          <h1>Atualizações</h1>
          <p>Acompanhe versões, canais e a adoção nos aplicativos instalados.</p>
        </div>
        <div className="live-indicator">
          <span /> Monitoramento ativo
        </div>
      </div>
      {error === null ? null : (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      <section className="metric-grid update-metric-grid">
        {[
          ['Instalações monitoradas', summary.clients, 'blue'],
          ['Clientes atualizados', summary.updated, 'emerald'],
          ['Clientes desatualizados', summary.outdated, 'amber'],
        ].map(([label, value, tone]) => (
          <article className="metric-card" key={String(label)}>
            <span className={`metric-card__icon metric-card__icon--${tone}`}>
              <GridIcon />
            </span>
            <div>
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          </article>
        ))}
      </section>
      <section className="users-card update-inventory">
        <div className="overview-card__header">
          <div>
            <span className="eyebrow">Inventário</span>
            <h3>Versões publicadas</h3>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aplicativo</th>
                <th>Canal</th>
                <th>Última versão</th>
                <th>Atualizados</th>
                <th>Desatualizados</th>
                <th>Publicação</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.items ?? []).map((item) => (
                <tr key={`${item.application}-${item.channel}`}>
                  <td>
                    <strong>{item.application === 'teacher' ? 'Professor' : 'Aluno'}</strong>
                  </td>
                  <td>
                    <span className="status-pill">{channelLabel(item.channel)}</span>
                  </td>
                  <td>{item.latestVersion ?? 'Não publicada'}</td>
                  <td>{item.updatedClients}</td>
                  <td>{item.outdatedClients}</td>
                  <td>
                    {item.publishedAt === null
                      ? '—'
                      : new Date(item.publishedAt).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function channelLabel(channel: 'stable' | 'beta' | 'development'): string {
  if (channel === 'stable') return 'Stable';
  if (channel === 'beta') return 'Beta';
  return 'Development';
}
