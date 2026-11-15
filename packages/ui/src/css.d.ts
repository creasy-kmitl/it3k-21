// Lets components import stylesheets for their side effect (the map imports
// maplibre's CSS); Vite bundles them, TypeScript only needs to know they exist.
declare module "*.css";
