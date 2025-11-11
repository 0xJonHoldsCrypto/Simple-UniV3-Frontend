// next.config.mjs
import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { esmExternals: true },
  images: { unoptimized: true },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@react-native-async-storage/async-storage': path.resolve(
        process.cwd(),
        'src/shims/asyncStorage.ts'
      ),
    }
    return config
  },
}

export default nextConfig