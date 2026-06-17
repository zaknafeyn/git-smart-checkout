import { FeatureCard } from '../FeatureCard/FeatureCard';
import styles from './PlannedFeatures.module.css';

interface PlannedFeature {
  icon: string;
  title: string;
  description: string;
  tier: 1 | 2;
}

const planned: PlannedFeature[] = [
  {
    icon: '🕒',
    tier: 1,
    title: 'Recent Branches',
    description:
      'Automatically surface the last 5–10 branches you visited using reflog data, so your most relevant branches are always first.',
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
    icon: '🗂️',
    tier: 2,
    title: 'Multi-root Workspace',
    description:
      'Proper support for workspaces with multiple git repositories — pick the target repo when a command is ambiguous.',
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
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                description={f.description}
                compact
                titleLevel={4}
              />
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
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                description={f.description}
                compact
                titleLevel={4}
              />
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
