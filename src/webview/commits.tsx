import { createRoot } from 'react-dom/client';

import { CommitsApp } from '@/pages/CommitsApp';

import './global.css';

const container = document.getElementById('commits-root');
if (container) {
  const root = createRoot(container);
  root.render(<CommitsApp />);
}