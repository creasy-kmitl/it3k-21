// Vite's `?url` suffix resolves an imported asset to its final URL.
declare module "*.woff2?url" {
  const url: string;
  export default url;
}
