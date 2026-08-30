import { StrictMode } from 'react';

import { App } from './app/App';
import { mountApplication } from './platform/browser-capabilities';
import './styles/global.css';

mountApplication(
  <StrictMode>
    <App />
  </StrictMode>,
);
