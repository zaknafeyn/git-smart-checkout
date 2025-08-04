import { createRoot } from 'react-dom/client';
import { PrCloneApp } from './pages/PrCloneApp';
import './global.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<PrCloneApp />);
}
