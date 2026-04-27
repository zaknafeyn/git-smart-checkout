import { Features } from './components/Features/Features';
import { Footer } from './components/Footer/Footer';
import { Header } from './components/Header/Header';
import { Hero } from './components/Hero/Hero';
import { Installation } from './components/Installation/Installation';
import { PlannedFeatures } from './components/PlannedFeatures/PlannedFeatures';
import { StashModes } from './components/StashModes/StashModes';

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
