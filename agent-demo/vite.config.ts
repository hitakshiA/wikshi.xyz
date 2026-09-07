import {defineConfig} from 'vite';
export default defineConfig({publicDir:'../public',server:{proxy:{'/chat-api':'http://127.0.0.1:8081'}},build:{outDir:'dist'}});
