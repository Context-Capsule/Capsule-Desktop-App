import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import './glass-overrides.css';
import 'simple-liquid-glass/web-component';

mount(App, { target: document.getElementById('app')! });
