import { Header } from './components/Header/Header';
import { Hero } from './components/Hero/Hero';
import { Features } from './components/Features/Features';
import { StashModes } from './components/StashModes/StashModes';
import { PlannedFeatures } from './components/PlannedFeatures/PlannedFeatures';
import { Installation } from './components/Installation/Installation';
import { Footer } from './components/Footer/Footer';

export function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
        <StashModes />
        <PlannedFeatures />
        <Installation />
      </main>
      <Footer />
    </>
  );
}
