/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/** package.json `version`, injected at build and test time (vite.config.ts `define`). */
declare const __APP_VERSION__: string;
