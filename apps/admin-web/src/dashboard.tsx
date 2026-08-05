import { useCallback, useEffect, useState } from 'react';

import type { AdminApi } from './api';
import { GraduationIcon, GridIcon, UsersIcon } from './icons';
import type { DashboardMetrics } from './types';

const formatter = new Intl.NumberFormat('pt-BR');

export function Dashboard({ api }: { readonly api: AdminApi }): React.JSX.Element {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        setMetrics(await api.dashboard(signal));
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Os indicadores não puderam ser atualizados agora.');
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(), 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  const cards =
    metrics === null
      ? []
      : [
          {
            label: 'Professores cadastrados',
            value: metrics.teachers,
            tone: 'violet',
            icon: <UsersIcon />,
          },
          {
            label: 'Alunos cadastrados',
            value: metrics.students,
            tone: 'blue',
            icon: <GraduationIcon />,
          },
          {
            label: 'Professores online',
            value: metrics.onlineTeachers,
            tone: 'emerald',
            icon: <UsersIcon />,
          },
          {
            label: 'Alunos online',
            value: metrics.onlineStudents,
            tone: 'cyan',
            icon: <GraduationIcon />,
          },
          {
            label: 'Em atendimento',
            value: metrics.activeAttendances,
            tone: 'amber',
            icon: <GridIcon />,
          },
          {
            label: 'Finalizados',
            value: metrics.finishedAttendances,
            tone: 'slate',
            icon: <GridIcon />,
          },
        ];

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Visão geral</span>
          <h1>Dashboard</h1>
          <p>Acompanhe sua instituição e os atendimentos em um só lugar.</p>
        </div>
        <div className="live-indicator">
          <span /> Atualização automática
        </div>
      </div>
      {error === null ? null : (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      {metrics === null ? (
        <div className="metric-grid" aria-label="Carregando indicadores">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="metric-card metric-card--loading skeleton" key={index} />
          ))}
        </div>
      ) : (
        <>
          <section className="metric-grid" aria-label="Indicadores da instituição">
            {cards.map((card) => (
              <article className="metric-card" key={card.label}>
                <span className={`metric-card__icon metric-card__icon--${card.tone}`}>
                  {card.icon}
                </span>
                <div>
                  <p>{card.label}</p>
                  <strong>{formatter.format(card.value)}</strong>
                </div>
              </article>
            ))}
          </section>
          <section className="overview-grid">
            <article className="overview-card overview-card--total">
              <div>
                <span className="eyebrow eyebrow--light">Comunidade</span>
                <h2>{formatter.format(metrics.totalUsers)}</h2>
                <p>usuários na instituição</p>
              </div>
              <div className="overview-ring">
                <span>{metrics.onlineTeachers + metrics.onlineStudents}</span>
                <small>online</small>
              </div>
            </article>
            <article className="overview-card">
              <div className="overview-card__header">
                <div>
                  <span className="eyebrow">Atendimentos</span>
                  <h3>Resumo operacional</h3>
                </div>
                <span className="status-dot">
                  <i /> Operacional
                </span>
              </div>
              <div className="progress-stat">
                <div>
                  <span>Em andamento</span>
                  <strong>{metrics.activeAttendances}</strong>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: progressWidth(metrics.activeAttendances, metrics.finishedAttendances),
                    }}
                  />
                </div>
              </div>
              <p className="overview-card__footnote">
                Última atualização às{' '}
                {new Date(metrics.generatedAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </article>
          </section>
        </>
      )}
    </div>
  );
}

function progressWidth(active: number, finished: number): string {
  const total = active + finished;
  return total === 0 ? '0%' : `${Math.max(6, Math.round((active / total) * 100))}%`;
}
