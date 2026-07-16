import { useState } from 'react';

import { FeatureCard } from '../FeatureCard/FeatureCard';
import { FeatureModal } from '../FeatureModal/FeatureModal';
import { features, type Feature } from './featuresData';
import styles from './Features.module.css';

export function Features() {
  const [active, setActive] = useState<Feature | null>(null);

  return (
    <section id="features" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>What's included</span>
          <h2 className={styles.title}>Everything you need for seamless branch switching</h2>
          <p className={styles.subtitle}>
            Powerful features that eliminate the friction between you and your Git workflow.
          </p>
        </div>

        <div className={styles.grid}>
          {features.map((f) => (
            <FeatureCard
              key={f.id}
              icon={f.icon}
              title={f.title}
              description={f.description}
              command={f.command}
              tag={f.tag}
              onClick={() => setActive(f)}
            />
          ))}
        </div>
      </div>
      {active && <FeatureModal feature={active} onClose={() => setActive(null)} />}
    </section>
  );
}
