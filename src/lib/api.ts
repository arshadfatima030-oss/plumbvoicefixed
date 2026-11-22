const MAX_CONFLICT_RETRIES = 3;

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

/** The app registers a function that asks the user for an emailed code (true = confirmed). */
export function setStepUpHandler(handler: StepUpHandler | null) {
  stepUpHandler = handler;
}

/**
 * JSON fetch helper.
 * - 409 {retryable:true}: two servers saved the same workspace at once; nothing was written, so retrying is safe.
 * - 403 {stepUpRequired:true}: a sensitive change on an unsaved device needs an emailed code; we ask, then retry once.
 */
export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  let conflicts = 0;
  let askedForCode = false;
  // One key per user action, reused on every automatic retry (409 conflict, step-up). The server derives record ids from it
  // and queues texts/webhooks with it, so a retry can never create or send the same thing twice.
  const method = (options.method || 'GET').toUpperCase();
  const idempotencyKey = method === 'GET' || method === 'HEAD' ? undefined : newIdempotencyKey();
  for (;;) {
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}),
        ...(options.headers || {}),
      },
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    }

    let message = `Request failed (${res.status})`;
    let retryable = false;
    let stepUpRequired = false;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
      retryable = data?.retryable === true;
      stepUpRequired = data?.stepUpRequired === true;
    } catch {
      // ignore non-json error bodies
    }

    if (res.status === 409 && retryable && conflicts < MAX_CONFLICT_RETRIES) {
      conflicts++;
      await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
      continue;
    }
    if (res.status === 403 && stepUpRequired && stepUpHandler && !askedForCode) {
      askedForCode = true;
      if (await stepUpHandler()) continue;
      throw new Error('Change cancelled: confirmation code was not entered.');
    }
    throw new Error(message);
  }
}
