import styles from './StashModes.module.css';

interface Mode {
  icon: string;
  name: string;
  badge: string;
  description: string;
  useCase: string;
}

const modes: Mode[] = [
  {
    icon: '⚙️',
    name: 'Manual',
    badge: 'Default',
    description: 'You choose the stash strategy each time you run a checkout command.',
    useCase: 'Best when: you want full control over every checkout decision.',
  },
  {
    icon: '📌',
    name: 'Auto stash in current branch',
    badge: 'Recommended',
    description:
      'Creates a named stash tied to the current branch. When you return to the same branch, the stash is popped automatically.',
    useCase: 'Best when: you frequently context-switch between long-running branches.',
  },
  {
    icon: '📤',
    name: 'Auto stash and pop',
    badge: 'Transfer',
    description:
      'Stashes your changes, switches to the target branch, then pops the stash there. Your in-progress work follows you.',
    useCase: 'Best when: you started work on the wrong branch and need to move it.',
  },
  {
    icon: '📋',
    name: 'Auto stash and apply',
    badge: 'Non-destructive',
    description:
      'Same as pop, but the stash is applied without being removed from the stash stack. The original stash stays intact.',
    useCase: 'Best when: you want to transfer changes while keeping a backup copy.',
  },
];

export function StashModes() {
  return (
    <section id="stash-modes" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>Checkout strategies</span>
          <h2 className={styles.title}>Four stash modes, one command</h2>
          <p className={styles.subtitle}>
            Pick a default mode in the status bar, or let the extension ask you each time.
            Switch at any moment — your workflow, your rules.
          </p>
        </div>

        <div className={styles.grid}>
          {modes.map((mode) => (
            <article key={mode.name} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.icon}>{mode.icon}</span>
                <span className={styles.badge}>{mode.badge}</span>
              </div>
              <h3 className={styles.modeName}>{mode.name}</h3>
              <p className={styles.desc}>{mode.description}</p>
              <p className={styles.useCase}>{mode.useCase}</p>
            </article>
          ))}
        </div>

        <div className={styles.tip}>
          <span className={styles.tipIcon}>💡</span>
          <p>
            Set your default mode once in the status bar — the extension remembers it per workspace.
            Override it any time with a single click.
          </p>
        </div>
      </div>
    </section>
  );
}
