import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Cargar variables de entorno del monorepo para que Next
// conozca NEXT_PUBLIC_API_BASE_URL y API_KEY (solo server-side/BFF)
const rootDir = path.resolve(process.cwd(), '..', '..');
const baseEnvPath = path.join(rootDir, '.env');
const prodEnvPath = path.join(rootDir, '.env.production');

const envPath =
  process.env.NODE_ENV === 'production' && fs.existsSync(prodEnvPath)
    ? prodEnvPath
    : baseEnvPath;

dotenv.config({ path: envPath });

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['next/font/google/target.css'] = path.resolve(process.cwd(), 'src/styles/next-font-placeholder.css');
    config.resolve.alias['next/font/local/target.css'] = path.resolve(process.cwd(), 'src/styles/next-font-placeholder.css');
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        pathname: '/icons/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        pathname: '/avatars/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        pathname: '/embed/avatars/**',
      },
      {
        protocol: 'https',
        hostname: 'images.discordapp.net',
        pathname: '/**',
      },
    ],
  },
  typescript: {
    // La validación de tipos la realiza el monorepo con `tsc`.
    // Evitamos que una incompatibilidad puntual de tipos de next-auth v5 bloquee el build.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
