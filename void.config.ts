import { defineConfig } from 'void/config';

export default defineConfig({
  target: 'cloudflare',
  routing: {
    headers: { '/assets/*': ['Access-Control-Allow-Origin: *'] },
  },
});
