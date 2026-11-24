// Each release bumps VERSION here and in sw.js: the service worker checks that both match.
export const VERSION = '1.1.1';
export const DB_VERSION = 1;

// Photos go to the model with the bigger free daily limit, typed meals to the lighter one; each falls back to the other.
export const MAIN = 'gemini-4-hydrogen';
export const LITE = 'gemini-3.5-flash-lite';
export const CHAINS = { photo: [MAIN, LITE], text: [LITE, MAIN] };
// Hydrogen and 3.8 Flash reject 'minimal' with a 400.
export const THINKING = { 'gemini-4-hydrogen': 'low', 'gemini-3.8-flash': 'low', 'gemini-3.5-flash-lite': 'minimal' };

export const API_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
export const DEMO_KEY = 'demo';
