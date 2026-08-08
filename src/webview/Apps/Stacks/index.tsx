import { createRoot } from 'react-dom/client';

import { StacksApp } from './App';
import '../../global.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<StacksApp />);
}
