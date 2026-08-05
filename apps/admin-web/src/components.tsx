import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AdminApi } from './api';
import { CloseIcon } from './icons';
import { initials } from './validation';

export function Avatar({
  api,
  userId,
  name,
  hasAvatar,
  version,
  size = 'medium',
}: {
  readonly api: AdminApi;
  readonly userId: string;
  readonly name: string;
  readonly hasAvatar: boolean;
  readonly version?: string | null;
  readonly size?: 'small' | 'medium' | 'large';
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (!hasAvatar) {
      setSource(null);
      return undefined;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void api
      .avatarUrl(userId, controller.signal)
      .then((url) => {
        objectUrl = url;
        setSource(url);
      })
      .catch(() => setSource(null));
    return () => {
      controller.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [api, hasAvatar, userId, version]);
  return (
    <span className={`avatar avatar--${size}`} aria-label={`Avatar de ${name}`}>
      {source === null ? initials(name) : <img alt="" src={source} />}
    </span>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  width = 'regular',
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly width?: 'small' | 'regular';
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        aria-modal="true"
        className={`modal modal--${width}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <h2>{title}</h2>
            {description === undefined ? null : <p>{description}</p>}
          </div>
          <button aria-label="Fechar" className="icon-button" type="button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FieldError({
  message,
}: {
  readonly message: string | undefined;
}): React.JSX.Element | null {
  return message === undefined ? null : <span className="field-error">{message}</span>;
}

export function Spinner({ label = 'Carregando' }: { readonly label?: string }): React.JSX.Element {
  return <span aria-label={label} className="spinner" role="status" />;
}

export function TableSkeleton(): React.JSX.Element {
  return (
    <div aria-label="Carregando usuários" className="table-skeleton" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton skeleton--avatar" />
          <span className="skeleton skeleton--wide" />
          <span className="skeleton skeleton--medium" />
          <span className="skeleton skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-state__mark">PC</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
