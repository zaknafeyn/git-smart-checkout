import styles from './Installation.module.css';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout';
const OPEN_VSX_URL = 'https://open-vsx.org/extension/vradchuk/git-smart-checkout';

export function Installation() {
  return (
    <section id="install" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>Get started in seconds</span>
          <h2 className={styles.title}>Easy installation</h2>
          <p className={styles.subtitle}>
            Install from the VS Code Marketplace or Open VSX Registry — no configuration required.
          </p>
        </div>

        <div className={styles.methods}>
          <div className={styles.method}>
            <div className={styles.methodHeader}>
              <span className={styles.methodNum}>1</span>
              <div>
                <h3 className={styles.methodTitle}>VS Code Marketplace</h3>
                <p className={styles.methodDesc}>For VS Code, Cursor, and other compatible editors</p>
              </div>
            </div>
            <ol className={styles.steps}>
              <li>Open VS Code and press <kbd>Ctrl+Shift+X</kbd> (or <kbd>⌘ Shift X</kbd> on Mac)</li>
              <li>Search for <strong>Git Smart Checkout</strong></li>
              <li>Click <strong>Install</strong></li>
              <li>That's it — the command is ready in the palette</li>
            </ol>
            <a href={MARKETPLACE_URL} className={styles.methodBtn} target="_blank" rel="noreferrer">
              Open in Marketplace →
            </a>
          </div>

          <div className={styles.method}>
            <div className={styles.methodHeader}>
              <span className={styles.methodNum}>2</span>
              <div>
                <h3 className={styles.methodTitle}>Open VSX Registry</h3>
                <p className={styles.methodDesc}>For VSCodium, Eclipse Theia, and open-source builds</p>
              </div>
            </div>
            <ol className={styles.steps}>
              <li>Open the Extensions panel in your editor</li>
              <li>Search for <strong>vradchuk.git-smart-checkout</strong></li>
              <li>Click <strong>Install</strong></li>
              <li>Reload if prompted</li>
            </ol>
            <a href={OPEN_VSX_URL} className={styles.methodBtn} target="_blank" rel="noreferrer">
              Open on Open VSX →
            </a>
          </div>
        </div>

        <div className={styles.quickstart}>
          <h3 className={styles.qsTitle}>Quick start</h3>
          <div className={styles.qsSteps}>
            <div className={styles.qsStep}>
              <div className={styles.qsNum}>1</div>
              <div>
                <p className={styles.qsLabel}>Open the Command Palette</p>
                <kbd className={styles.kbd}>⌘ Shift P</kbd>
              </div>
            </div>
            <div className={styles.qsArrow}>→</div>
            <div className={styles.qsStep}>
              <div className={styles.qsNum}>2</div>
              <div>
                <p className={styles.qsLabel}>Type the command</p>
                <code className={styles.code}>Git: Checkout to... (With Stash)</code>
              </div>
            </div>
            <div className={styles.qsArrow}>→</div>
            <div className={styles.qsStep}>
              <div className={styles.qsNum}>3</div>
              <div>
                <p className={styles.qsLabel}>Pick a branch &amp; stash mode</p>
                <p className={styles.qsHint}>Your changes are handled automatically</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
