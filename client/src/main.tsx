import '@fontsource-variable/saira/wdth.css';
import '@fontsource-variable/saira/wdth-italic.css';
import '@fontsource/silkscreen/400.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// Gate signs and number plates are drawn to canvas, so their fonts have to be in first.
await Promise.allSettled([
  document.fonts.load('italic 800 40px "Saira Variable"'),
  document.fonts.load('400 30px Silkscreen'),
]);

createRoot(document.getElementById('root')!).render(<App />);
