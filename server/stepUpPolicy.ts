/**
 * One table that says which requests need a recent emailed code (step-up) on a device that is not saved.
 * Keeping it in one place means a route cannot be "forgotten": the gate runs before every handler.
 * Paths are relative to /api. Routes that already call requireStepUp themselves (team, billing, change-password)
 * are listed too, so the policy reads as the complete picture.
 */
interface Rule {
  method: string;
  path: RegExp;
  /** Only when the JSON body contains one of these keys (e.g. changing where alerts are sent). */
  whenBodyHas?: string[];
}

const RULES: Rule[] = [
  // Account takeover surface
  {method: 'POST', path: /^\/auth\/change-password$/},
  {method: 'POST', path: /^\/team$/},
  {method: 'PATCH', path: /^\/team\/[^/]+$/},
  {method: 'DELETE', path: /^\/team\/[^/]+$/},
  // Money and plan
  {method: 'PATCH', path: /^\/billing$/},
  {method: 'POST', path: /^\/billing\/(checkout|portal)$/},
  // Where customer data and alerts go (outgoing webhook, owner phone, widget domains, alert mailbox, forwarding number)
  {method: 'PATCH', path: /^\/extras$/},
  {method: 'POST', path: /^\/extras\/webhook\/test$/},
  // emergencyRules holds the number emergency texts are sent to; notificationPreferences can switch those alerts off.
  {method: 'PATCH', path: /^\/settings$/, whenBodyHas: ['dispatchEmail', 'emergencyRules', 'notificationPreferences']},
  {method: 'PATCH', path: /^\/phone-setup$/, whenBodyHas: ['businessPhone']},
  {method: 'PATCH', path: /^\/agent-config$/},
  {method: 'POST', path: /^\/knowledge\/approve$/},
  {method: 'POST', path: /^\/integrations\/google\/disconnect$/},
  // Destructive or irreversible
  {method: 'DELETE', path: /^\/leads\/[^/]+$/},
  {method: 'POST', path: /^\/leads\/merge$/},
  {method: 'DELETE', path: /^\/calls\/[^/]+\/recording$/},
  // Bulk personal data and secrets leaving the app
  {method: 'GET', path: /^\/export\/json$/},
  {method: 'GET', path: /^\/leads\/export\/csv$/},
  {method: 'GET', path: /^\/tools\/token$/},
  {method: 'GET', path: /^\/extras\/ring-token$/},
  {method: 'POST', path: /^\/extras\/ring-token\/rotate$/},
];

export function needsStepUp(method: string, path: string, body: unknown): boolean {
  const m = method.toUpperCase();
  const p = path.replace(/\/+$/, '') || '/';
  return RULES.some((r) => {
    if (r.method !== m || !r.path.test(p)) return false;
    if (!r.whenBodyHas) return true;
    return typeof body === 'object' && body !== null && r.whenBodyHas.some((k) => k in (body as Record<string, unknown>));
  });
}
