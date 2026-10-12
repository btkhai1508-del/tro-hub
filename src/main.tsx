import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root') || document.getElementById('app');
if (container) {
  createRoot(container).render(<App />);
}
