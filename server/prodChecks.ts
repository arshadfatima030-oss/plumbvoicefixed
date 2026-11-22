/**
 * Startup configuration audit for production. Pure (takes the env as a parameter) so it can be unit tested.
 * "fatal" items are settings that make the deployment unsafe on purpose, so the server refuses to start with them
 * (override with ALLOW_INSECURE_PROD=true only for local production-mode testing). "warnings" are logged loudly.
 */
export interface ConfigReport {
  fatal: string[];
  warnings: string[];
}

export function productionConfigReport(env: Record<string, string | undefined>): ConfigReport {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const has = (k: string) => Boolean(env[k]?.trim());

  if (env.COOKIE_SECURE === 'false') fatal.push('COOKIE_SECURE=false: session cookies would travel over plain http. Remove it in production.');
  if (has('APP_URL') && !/^https:\/\//i.test(env.APP_URL!.trim())) fatal.push('APP_URL must be a real https:// URL (it is used for CSRF checks and e-mail links).');
  if (!has('APP_URL')) warnings.push('APP_URL is not set: e-mail links and strict origin checks need it.');

  if (!has('DATABASE_URL')) warnings.push('DATABASE_URL is not set: data lives in memory/local files and is lost on redeploy.');
  if (has('DATABASE_URL')) {
    const url = env.DATABASE_URL!;
    const local = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(url);
    if (!local && env.DATABASE_SSL !== 'true' && !/sslmode=(require|verify-ca|verify-full)/.test(url)) warnings.push('DATABASE_URL points to a remote database but SSL is not enabled (set DATABASE_SSL=true or add ?sslmode=require).');
    if (env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false') warnings.push('DATABASE_SSL_REJECT_UNAUTHORIZED=false turns off database certificate checking. Remove it unless your provider requires it.');
  }
  if (has('SECRETS_KEY') && env.SECRETS_KEY!.trim().length < 32) warnings.push('SECRETS_KEY is shorter than 32 characters. Use a long random value (e.g. `openssl rand -base64 48`). Changing it makes already-saved integration tokens and the ring-first Telnyx URL unusable, so keep a backup of it.');
  if (!has('SECRETS_KEY')) warnings.push('SECRETS_KEY is not set: Google Calendar and other stored integration tokens cannot be saved.');
  if (!has('SENDGRID_API_KEY') || !has('MAIL_FROM')) warnings.push('SENDGRID_API_KEY / MAIL_FROM missing: e-mail verification and login codes cannot be sent.');
  if (!has('CRON_SECRET') || env.CRON_SECRET!.trim().length < 16) warnings.push('CRON_SECRET is missing or shorter than 16 characters: scheduled reminders will not run.');

  const stripeKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PROFESSIONAL', 'STRIPE_PRICE_BUSINESS'];
  const stripeSet = stripeKeys.filter(has);
  if (stripeSet.length && stripeSet.length < stripeKeys.length) warnings.push(`Stripe is half configured; missing: ${stripeKeys.filter((k) => !has(k)).join(', ')}.`);
  if (has('STRIPE_SECRET_KEY') && /^sk_test_/.test(env.STRIPE_SECRET_KEY!)) warnings.push('STRIPE_SECRET_KEY is a TEST key while NODE_ENV=production.');

  if (env.TEXML_REQUIRE_SIGNATURE?.trim().toLowerCase() === 'false') warnings.push('TEXML_REQUIRE_SIGNATURE=false: ring-first (TeXML) requests are protected only by the secret in the URL. Remove it once a live call shows Telnyx signs TeXML requests.');
  if (has('TELNYX_API_KEY') !== has('TELNYX_PUBLIC_KEY')) warnings.push('Telnyx needs BOTH TELNYX_API_KEY and TELNYX_PUBLIC_KEY (the public key verifies webhook signatures).');
  if (has('TRUST_PROXY') && /^(true|1)$/i.test(env.TRUST_PROXY!.trim()) === false && Number.isNaN(Number(env.TRUST_PROXY))) {
    // A list of subnets / names is fine; just remind that it must match the real proxy chain.
    warnings.push('TRUST_PROXY is set to a custom value: make sure it matches your actual proxy chain (wrong values let clients fake their IP and dodge rate limits).');
  }
  if (!has('TRUST_PROXY') && !env.VERCEL) warnings.push('TRUST_PROXY is not set. Behind Render, Nginx or a load balancer every visitor then looks like the proxy, so all rate limits share one bucket. Set TRUST_PROXY=1 (number of proxies in front of the app).');
  if (env.TRUST_PROXY === 'true') warnings.push('TRUST_PROXY=true trusts every proxy header. Prefer a hop count (e.g. 1) that matches your host.');
  return {fatal, warnings};
}
