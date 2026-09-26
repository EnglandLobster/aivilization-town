import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createTownClient } from './store';
import './styles.css';
const root = document.getElementById('root');
if (!root) throw new Error('The town application root is missing');
createRoot(root).render(<App client={createTownClient()} />);
