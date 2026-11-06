import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['pdf-parse'], poweredByHeader: false, distDir: process.env.NEXT_DIST_DIR || '.next' };
export default config;
