import { render } from 'preact';
import { App } from './App';
import { initPwa } from './state/install';
import './styles.css';

render(<App />, document.getElementById('app')!);
initPwa();
