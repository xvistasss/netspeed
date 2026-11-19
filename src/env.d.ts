declare module "cloudflare:workers" {
  export const env: {
    TURNSTILE_SECRET?: string;
    TURNSTILE_HOSTNAMES?: string;
  };
}
