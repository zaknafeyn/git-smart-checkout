import { config } from '@fortawesome/fontawesome-svg-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

import '@fortawesome/fontawesome-svg-core/styles.css';
import './index.css';

// Ship Font Awesome's CSS in the stylesheet bundle (imported above) instead of
// letting the core inject it at runtime — avoids icons flashing at full size
// before first paint.
config.autoAddCss = false;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
