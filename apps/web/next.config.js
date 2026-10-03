/**
 * The engine is a plain ES module package that ships no build output, so Next
 * compiles it along with the app.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  transpilePackages: ['@cadence/engine'],
  devIndicators: false,
};

export default config;
