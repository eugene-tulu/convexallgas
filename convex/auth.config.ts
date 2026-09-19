// `auth.config.ts` is evaluated by the Convex CLI in Node, but this app's
// TypeScript configuration intentionally exposes only browser globals.
// Keep the platform-provided value typed locally instead of adding Node types
// to the client application.
declare const process: {
  env: {
    CONVEX_SITE_URL: string;
  };
};

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
