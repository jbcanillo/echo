import './install'; // first, so the browser's install offer is captured before anything renders
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource-variable/geist/wght.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './index.css'; // Import the CSS file

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);