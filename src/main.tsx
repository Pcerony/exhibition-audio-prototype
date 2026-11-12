import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n/I18nProvider';
import AndroidLocationMap from './features/staff/AndroidLocationMap';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const hash = window.location.hash;
if (hash.startsWith('#/android-location?')) {
  // The embedded preview receives its language in the URL; it must work without DOM storage.
  root.render(<AndroidLocationMap hash={hash} />);
} else {
  void import('./App').then(({ App }) => {
    root.render(<React.StrictMode><I18nProvider><App /></I18nProvider></React.StrictMode>);
  });
}
