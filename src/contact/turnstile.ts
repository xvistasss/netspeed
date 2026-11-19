export const TURNSTILE_SITE_KEY = "0x4AAAAAAGIH9LGrUh4hHozm";
export const TURNSTILE_ACTION = "contact";

type TurnstileEnvironment = {
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
};

export async function verifyTurnstileToken(
  token: unknown,
  environment: TurnstileEnvironment,
): Promise<boolean> {
  const secret = environment.TURNSTILE_SECRET;
  const hostnames = new Set(
    (environment.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );

  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 2048 ||
    !secret?.trim() ||
    hostnames.size === 0
  ) {
    return false;
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({ secret, response: token }),
      },
    );
    if (!response.ok) {
      throw new Error(`siteverify ${response.status}`);
    }

    const result: unknown = await response.json();
    if (!result || typeof result !== "object") {
      return false;
    }

    const verification = result as Record<string, unknown>;
    return (
      verification.success === true &&
      verification.action === TURNSTILE_ACTION &&
      typeof verification.hostname === "string" &&
      hostnames.has(verification.hostname)
    );
  } catch (error) {
    console.error("[Turnstile Siteverify Error]", error);
    return false;
  }
}
