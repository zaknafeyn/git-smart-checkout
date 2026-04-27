import { useState, useEffect } from 'react';

import styles from './Header.module.css';

const GITHUB_URL = 'https://github.com/zaknafeyn/git-smart-checkout';
const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ''}`}>
      <div className={`container ${styles.inner}`}>
        <a href="#" className={styles.logo}>
          <span className={styles.logoIcon}>⚡</span>
          <span className={styles.logoText}>Git Smart Checkout</span>
        </a>

        <button
          className={styles.menuToggle}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}>
          <a href="#features" className={styles.navLink} onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#stash-modes" className={styles.navLink} onClick={() => setMenuOpen(false)}>Stash Modes</a>
          <a href="#roadmap" className={styles.navLink} onClick={() => setMenuOpen(false)}>Roadmap</a>
          <a href="#install" className={styles.navLink} onClick={() => setMenuOpen(false)}>Install</a>
          <a href={GITHUB_URL} className={styles.navLink} target="_blank" rel="noreferrer">GitHub</a>
          <a href={MARKETPLACE_URL} className={styles.installBtn} target="_blank" rel="noreferrer">
            Install Free
          </a>
        </nav>
      </div>
    </header>
  );
}
