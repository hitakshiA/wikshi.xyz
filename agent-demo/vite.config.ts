import {defineConfig} from 'vite';
export default defineConfig({base:process.env.WIKSHI_CHAT_BASE||'/',publicDir:'../public',server:{proxy:{'/chat-api':'http://127.0.0.1:8081'}},build:{outDir:'dist'}});
