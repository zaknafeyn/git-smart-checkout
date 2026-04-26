import styles from './Footer.module.css';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout';
const OPEN_VSX_URL = 'https://open-vsx.org/extension/vradchuk/git-smart-checkout';
const GITHUB_URL = 'https://github.com/zaknafeyn/git-smart-checkout';
const ISSUES_URL = 'https://github.com/zaknafeyn/git-smart-checkout/issues';
const CHANGELOG_URL = 'https://github.com/zaknafeyn/git-smart-checkout/blob/main/CHANGELOG.md';
const LINKEDIN_URL = 'https://www.linkedin.com/in/valentineradchuk/';
const GITHUB_PROFILE_URL = 'https://github.com/zaknafeyn';
const PERSONAL_SITE_URL = 'https://vradchuk.info/';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          <div className={styles.brand}>
            <a href="#" className={styles.logo}>
              <span>⚡</span>
              <span>Git Smart Checkout</span>
            </a>
            <p className={styles.tagline}>
              Intelligent branch switching with automatic stash management for VS Code.
            </p>
            <div className={styles.badges}>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={styles.badge}>
                MIT License
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={styles.badge}>
                Open Source
              </a>
            </div>
          </div>

          <div className={styles.links}>
            <div className={styles.linkGroup}>
              <h4 className={styles.linkGroupTitle}>Install</h4>
              <a href={MARKETPLACE_URL} target="_blank" rel="noreferrer" className={styles.link}>
                VS Code Marketplace
              </a>
              <a href={OPEN_VSX_URL} target="_blank" rel="noreferrer" className={styles.link}>
                Open VSX Registry
              </a>
            </div>

            <div className={styles.linkGroup}>
              <h4 className={styles.linkGroupTitle}>Resources</h4>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={styles.link}>
                Source Code
              </a>
              <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" className={styles.link}>
                Changelog
              </a>
              <a href={ISSUES_URL} target="_blank" rel="noreferrer" className={styles.link}>
                Report an Issue
              </a>
            </div>

            <div className={styles.linkGroup}>
              <h4 className={styles.linkGroupTitle}>On this page</h4>
              <a href="#features" className={styles.link}>Features</a>
              <a href="#stash-modes" className={styles.link}>Stash Modes</a>
              <a href="#roadmap" className={styles.link}>Roadmap</a>
              <a href="#install" className={styles.link}>Installation</a>
              <a href="#contact" className={styles.link}>Contact</a>
            </div>

            <div className={styles.linkGroup}>
              <h4 className={styles.linkGroupTitle}>Author</h4>
              <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className={styles.link}>LinkedIn</a>
              <a href={GITHUB_PROFILE_URL} target="_blank" rel="noreferrer" className={styles.link}>GitHub Profile</a>
              <a href={PERSONAL_SITE_URL} target="_blank" rel="noreferrer" className={styles.link}>vradchuk.info</a>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p className={styles.copyright}>
            © {new Date().getFullYear()} Valentyn Radchuk. Released under the{' '}
            <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              MIT License
            </a>.
          </p>
          <p className={styles.madeWith}>
            Git requirements: Git 2.38+
          </p>
        </div>
      </div>
    </footer>
  );
}
