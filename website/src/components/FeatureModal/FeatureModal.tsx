import { useEffect, useRef, type MouseEvent } from 'react';

import type { Feature } from '../Features/featuresData';
import styles from './FeatureModal.module.css';

interface FeatureModalProps {
  feature: Feature;
  onClose: () => void;
}

export function FeatureModal({ feature, onClose }: FeatureModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { details } = feature;
  const { media } = details;

  useEffect(() => {
    ref.current?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      ref.current?.close();
    }
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="feature-modal-title"
    >
      <div className={styles.inner}>
        <div className={styles.media}>
          {media?.kind === 'video' ? (
            <video src={media.src} poster={media.poster} controls playsInline preload="metadata" />
          ) : media?.kind === 'youtube' ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${media.src}`}
              title={`${feature.title} demo`}
              allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <div className={styles.placeholder}>
              <span className={styles.playCircle} aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="currentColor" />
                </svg>
              </span>
              <span>Demo video coming soon</span>
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => ref.current?.close()}
          aria-label="Close dialog"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6L18 18M6 18L18 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className={styles.body}>
          <header className={styles.titleRow}>
            <span className={styles.icon} aria-hidden="true">
              {feature.icon}
            </span>
            <h3 id="feature-modal-title">{feature.title}</h3>
            {feature.tag && <span className={styles.tag}>{feature.tag}</span>}
          </header>
          <div className={styles.longDesc}>{details.longDescription}</div>
          <section>
            <h4>Highlights</h4>
            <ul>
              {details.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
          {details.commands && (
            <section>
              <h4>Commands</h4>
              {details.commands.map((command) => (
                <div key={command} className={styles.row}>
                  <code>{command}</code>
                </div>
              ))}
            </section>
          )}
          {details.settings && (
            <section>
              <h4>Settings</h4>
              {details.settings.map((setting) => (
                <div key={setting} className={styles.row}>
                  <code className={styles.settingCode}>{setting}</code>
                </div>
              ))}
            </section>
          )}
          {details.docsUrl && (
            <a href={details.docsUrl} target="_blank" rel="noreferrer" className={styles.docsLink}>
              Read the docs →
            </a>
          )}
        </div>
      </div>
    </dialog>
  );
}
