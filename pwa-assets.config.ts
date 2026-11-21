import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerate PNG icons after editing public/favicon.svg:
//   npm run generate-pwa-assets
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/favicon.svg'],
});
