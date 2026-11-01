/** @type {import('next').NextConfig} */
const nextConfig = {
  // The marketing site (Classic) is a static page in /public, served at "/".
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
    };
  },
};

export default nextConfig;
