import styles from './PlannedFeatures.module.css';

interface PlannedFeature {
  icon: string;
  title: string;
  description: string;
  tier: 1 | 2;
}

const planned: PlannedFeature[] = [
  {
    icon: '⭐',
    tier: 1,
    title: 'Preferred Branches',
    description:
      'Star your most-used branches and see them at the top of the checkout picker — separated from the full branch list.',
  },
  {
    icon: '🕒',
    tier: 1,
    title: 'Recent Branches',
    description:
      'Automatically surface the last 5–10 branches you visited using reflog data, so your most relevant branches are always first.',
  },
  {
    icon: '📋',
    tier: 1,
    title: 'Stash Manager',
    description:
      'A dedicated side panel listing all auto-created stashes with branch, age, file count, diff preview, and one-click Apply / Pop / Drop actions.',
  },
  {
    icon: '🔃',
    tier: 1,
    title: 'Pull with Rebase',
    description:
      'Choose between merge, rebase, or fast-forward-only when pulling. Configurable globally or per-repo.',
  },
  {
    icon: '⚡',
    tier: 1,
    title: 'Inline Branch Actions',
    description:
      'Delete, rename, and push branches right from the checkout quick-pick using VS Code\'s per-item buttons — no terminal needed.',
  },
  {
    icon: '📡',
    tier: 1,
    title: 'Upstream Indicator',
    description:
      'See ⇡N ⇣M (ahead/behind) counts in the status bar for the current branch, with a click-to-fetch shortcut.',
  },
  {
    icon: '🌿',
    tier: 2,
    title: 'Branch Templates',
    description:
      'Auto-fill new branch names from configurable templates like feature/{issue}-{slug}, parsing issue IDs from clipboard or active ticket.',
  },
  {
    icon: '🗂️',
    tier: 2,
    title: 'Multi-root Workspace',
    description:
      'Proper support for workspaces with multiple git repositories — pick the target repo when a command is ambiguous.',
  },
  {
    icon: '🌲',
    tier: 2,
    title: 'Worktree Support',
    description:
      'Open any branch in a new git worktree without touching your current workspace. Ideal for running two branches side-by-side.',
  },
  {
    icon: '🌐',
    tier: 2,
    title: 'GitLab & Bitbucket',
    description:
      'Extend PR Clone to support non-GitHub providers. GitLab (glab) and Bitbucket adapters behind a shared PrProvider interface.',
  },
];

export function PlannedFeatures() {
  const tier1 = planned.filter((f) => f.tier === 1);
  const tier2 = planned.filter((f) => f.tier === 2);

  return (
    <section id="roadmap" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>Roadmap</span>
          <h2 className={styles.title}>What's coming next</h2>
          <p className={styles.subtitle}>
            Planned features prioritised by user impact. High-priority items address the
            most common daily-workflow pain points.
          </p>
        </div>

        <div className={styles.tier}>
          <div className={styles.tierHeader}>
            <div className={styles.tierBadge} data-tier="1">Tier 1</div>
            <h3 className={styles.tierTitle}>High-impact, daily workflow</h3>
          </div>
          <div className={styles.grid}>
            {tier1.map((f) => (
              <article key={f.title} className={styles.card}>
                <span className={styles.cardIcon}>{f.icon}</span>
                <div>
                  <h4 className={styles.cardTitle}>{f.title}</h4>
                  <p className={styles.cardDesc}>{f.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.tier}>
          <div className={styles.tierHeader}>
            <div className={styles.tierBadge} data-tier="2">Tier 2</div>
            <h3 className={styles.tierTitle}>Frequent but less universal</h3>
          </div>
          <div className={styles.grid}>
            {tier2.map((f) => (
              <article key={f.title} className={styles.card}>
                <span className={styles.cardIcon}>{f.icon}</span>
                <div>
                  <h4 className={styles.cardTitle}>{f.title}</h4>
                  <p className={styles.cardDesc}>{f.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.cta}>
          <p>Have a feature idea? Contributions and feedback are very welcome.</p>
          <a
            href="https://github.com/zaknafeyn/git-smart-checkout/issues"
            className={styles.ctaLink}
            target="_blank"
            rel="noreferrer"
          >
            Open an issue on GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}
