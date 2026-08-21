import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import { App } from './App';
import { ThemeProvider, getInitialTheme } from './theme';
import { ConfirmProvider } from './components/ConfirmProvider';

// Apply the persisted theme before first paint to avoid a flash.
document.documentElement.dataset.theme = getInitialTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
