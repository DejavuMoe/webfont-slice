import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PreferencesProvider } from './i18n/PreferencesProvider';
import './styles/index.css';

// Service Worker 由 App 通过 ServiceWorkerPort 注册，以便更新提示能感知重型任务。

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('找不到应用挂载节点 #root');
}

createRoot(rootElement).render(
  <StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </StrictMode>,
);
