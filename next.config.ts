import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * policy/v1.yaml must ship inside the serverless function.
   *
   * `loadPolicy()` reads it with `readFileSync(path.join(process.cwd(), ...))`
   * (lib/policy/engine.ts). That path is built at runtime, so Next's file
   * tracing cannot see it and would not bundle the file — the route would work
   * on a laptop and throw ENOENT in production, which is the worst place to
   * find out. Naming it here is what puts it in the deployment.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./policy/**"],
  },
};

export default nextConfig;
