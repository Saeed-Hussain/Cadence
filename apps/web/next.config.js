/**
 * The engine is a plain ES module package that ships no build output, so Next
 * compiles it along with the app.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  transpilePackages: ['@cadence/engine'],
  devIndicators: false,

  // The inference runtime has a Node build and a browser build. The browser
  // never needs the Node one, nor the image library it optionally imports.
  webpack(config, { isServer }) {
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      'onnxruntime-node$': false,
    };
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, 'fs/promises': false, path: false };
    }
    return config;
  },

  // Cross-origin isolation unlocks SharedArrayBuffer, which is what lets the
  // WebAssembly runtime use every core instead of one. `credentialless` keeps
  // cross-origin fetches (the weights) working without CORP headers.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default config;
