import { mount } from 'svelte';
import '../../ui/tokens.css';
import App from '../reorder/App.svelte';

// Same reorder steps as reorder.html, laid out for a narrow panel next to Google's sign-in page.
export default mount(App, { target: document.getElementById('app')!, props: { panel: true } });
