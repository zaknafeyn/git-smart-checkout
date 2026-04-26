import styles from './Features.module.css';

interface Feature {
  icon: string;
  title: string;
  description: string;
  command?: string;
  tag?: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}

const features: Feature[] = [
  {
    icon: '🔄',
    title: 'Smart Branch Checkout',
    description:
      'Switch branches without worrying about uncommitted changes. Choose your stash strategy once or per checkout — the extension handles everything else.',
    command: 'Git: Checkout to... (With Stash)',
    color: 'blue',
  },
  {
    icon: '📥',
    title: 'Pull with Stash',
    description:
      'Pull the latest changes from remote without losing your local work. Changes are stashed before the pull and restored automatically after.',
    command: 'Git: Pull (With Stash)',
    color: 'green',
  },
  {
    icon: '⬅️',
    title: 'Checkout Previous Branch',
    description:
      'Instantly jump back to the branch you were on before, with the same auto-stash magic. Think of it as Ctrl+Z for branch switching.',
    command: 'Git: Checkout previous branch (With Stash)',
    color: 'purple',
  },
  {
    icon: '🍒',
    title: 'GitHub PR Clone',
    description:
      'Cherry-pick individual commits from any GitHub PR into a new branch and open a new pull request — without merging the entire PR.',
    command: 'GitHub: Clone pull request...',
    tag: 'Beta',
    color: 'orange',
  },
  {
    icon: '🏷️',
    title: 'Tag from Template',
    description:
      'Generate version tags from a configurable template. Read values from package.json, extract ticket IDs from branch names, and auto-increment to avoid collisions.',
    command: 'Git: Create Git Tag from Template',
    color: 'blue',
  },
  {
    icon: '🛡️',
    title: 'Conflict Prediction',
    description:
      'Before switching branches, the extension detects which files would conflict with your stash. No more surprise merge disasters mid-checkout.',
    color: 'green',
  },
  {
    icon: '📊',
    title: 'Status Bar Integration',
    description:
      'See your current stash mode at a glance in the VS Code status bar. Click once to switch modes — no need to open settings.',
    color: 'purple',
  },
];

export function Features() {
  return (
    <section id="features" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>What's included</span>
          <h2 className={styles.title}>Everything you need for seamless branch switching</h2>
          <p className={styles.subtitle}>
            Seven powerful features that eliminate the friction between you and your Git workflow.
          </p>
        </div>

        <div className={styles.grid}>
          {features.map((f) => (
            <article key={f.title} className={`${styles.card} ${styles[f.color]}`}>
              <div className={styles.cardIcon}>{f.icon}</div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{f.title}</h3>
                  {f.tag && <span className={styles.tag}>{f.tag}</span>}
                </div>
                <p className={styles.cardDesc}>{f.description}</p>
                {f.command && (
                  <div className={styles.cardCommand}>
                    <span className={styles.cmdIcon}>⌘</span>
                    <code>{f.command}</code>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
