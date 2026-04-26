import styles from './Contact.module.css';

const contacts = [
  {
    id: 'linkedin',
    href: 'https://www.linkedin.com/in/valentineradchuk/',
    label: 'LinkedIn',
    handle: 'valentineradchuk',
    description: 'Professional profile & career updates',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    color: 'linkedin',
  },
  {
    id: 'github',
    href: 'https://github.com/zaknafeyn',
    label: 'GitHub',
    handle: 'zaknafeyn',
    description: 'Open source projects & contributions',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    ),
    color: 'github',
  },
  {
    id: 'website',
    href: 'https://vradchuk.info/',
    label: 'Personal Website',
    handle: 'vradchuk.info',
    description: 'Blog, projects & personal updates',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm1 16.057v-3h-2v4H9.38c.476 1.119.999 2.169 1.556 3.118A10.024 10.024 0 0 1 2.049 13H6v-2H2.049C2.5 6.81 6.866 3 12 3s9.5 3.81 9.951 8H18v2h3.951a10.024 10.024 0 0 1-8.887 7.175c.557-.95 1.08-2 1.556-3.118H13v-1z" />
      </svg>
    ),
    color: 'website',
  },
];

export function Contact() {
  return (
    <section id="contact" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>Author</span>
          <h2 className={styles.title}>Get in touch</h2>
          <p className={styles.subtitle}>
            Built and maintained by Valentyn Radchuk. Reach out for feedback,
            questions, or just to say hello.
          </p>
        </div>

        <div className={styles.cards}>
          {contacts.map((c) => (
            <a
              key={c.id}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className={`${styles.card} ${styles[c.color]}`}
            >
              <div className={styles.cardIcon}>{c.icon}</div>
              <div className={styles.cardBody}>
                <div className={styles.cardMeta}>
                  <span className={styles.cardLabel}>{c.label}</span>
                  <span className={styles.cardHandle}>@{c.handle}</span>
                </div>
                <p className={styles.cardDesc}>{c.description}</p>
              </div>
              <svg
                className={styles.arrow}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
