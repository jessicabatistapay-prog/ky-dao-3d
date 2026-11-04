import { createRoot } from 'react-dom/client';
import '@fontsource/noto-serif/vietnamese-400.css';
import '@fontsource/noto-serif/vietnamese-600.css';
import '@fontsource/noto-serif/vietnamese-700.css';
import '@fontsource/noto-serif/latin-400.css';
import '@fontsource/noto-serif/latin-600.css';
import '@fontsource/noto-serif/latin-700.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
