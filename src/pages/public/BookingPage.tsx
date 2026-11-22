import {useEffect, useState} from 'react';
import {CheckCircle2, Phone} from 'lucide-react';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';

interface BusinessInfo {
  businessName: string;
  intro: string;
  phone: string;
}

const SERVICES = ['Leak repair', 'Clogged drain or toilet', 'Water heater', 'Faucet / fixture', 'Pipe or sewer problem', 'Electrical repair', 'Inspection / estimate', 'Something else'];
const TIMES = ['Morning', 'Afternoon', 'Evening', 'Anytime'];

/** Public page a plumber shares with customers (/book/<organizationId>). Sends a request, not a confirmed slot. */
export function BookingPage({orgId}: {orgId: string}) {
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{emergency: boolean} | null>(null);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', serviceType: SERVICES[0], details: '', address: '', zip: '',
    preferredDay: '', preferredTime: 'Anytime', consent: false, website: '',
  });

  usePageSeo({
    title: info ? `Request a visit — ${info.businessName}` : 'Request a visit',
    description: 'Request a service visit online.',
    path: `/book/${orgId}`,
    noindex: true,
  });

  useEffect(() => {
    let alive = true;
    apiRequest<BusinessInfo>(`/api/public/book/${encodeURIComponent(orgId)}`)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setUnavailable(true));
    return () => {
      alive = false;
    };
  }, [orgId]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({...f, [k]: v}));
  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await apiRequest<{ok: boolean; emergency?: boolean}>(`/api/public/book/${encodeURIComponent(orgId)}`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setDone({emergency: r.emergency === true});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request. Please call us instead.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-8 sm:py-12">
      <div className="max-w-[560px] mx-auto">{children}</div>
    </div>
  );

  if (unavailable) {
    return shell(
      <div className="card-tier-1 p-8 text-center space-y-2">
        <h1 className="headline-md text-[#1C1F22]">Online booking is not available</h1>
        <p className="text-[14px] text-[#7A746B]">Please contact the business directly.</p>
      </div>
    );
  }
  if (!info) return shell(<p className="text-center text-[14px] text-[#7A746B]">Loading…</p>);

  if (done) {
    return shell(
      <div className="card-tier-1 p-8 text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-[#2E8B57] mx-auto" />
        <h1 className="headline-md text-[#1C1F22]">Request sent</h1>
        <p className="text-[14px] text-[#23282D]">
          {info.businessName} will contact you to confirm a time. This is a request, not a confirmed appointment.
        </p>
        {done.emergency && (
          <p className="text-[14px] font-semibold text-[#B42318]">
            This sounds urgent. If anyone is in danger, call 911. Otherwise please also call us now{info.phone ? ` at ${info.phone}` : ''}.
          </p>
        )}
      </div>
    );
  }

  return shell(
    <form onSubmit={submit} className="card-tier-1 p-6 sm:p-8 space-y-4">
      <div>
        <h1 className="headline-md text-[#1C1F22]">Request a visit</h1>
        <p className="text-[14px] text-[#7A746B] mt-1">
          {info.businessName} · {info.intro}
        </p>
      </div>
      <div role="note" className="rounded-xl bg-[#FDECEA] border border-[#D64545]/30 px-4 py-3 text-[13px] text-[#8A1F1F]">
        Smell gas, flooding, sparks or fire? Do not use this form. Call 911 for danger, and call us right away
        {info.phone ? (
          <>
            {' '}
            at{' '}
            <a href={`tel:${info.phone.replace(/[^\d+]/g, '')}`} className="font-semibold underline inline-flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" />
              {info.phone}
            </a>
          </>
        ) : null}
        .
      </div>

      <label className="block space-y-1.5">
        <span className="label-caps text-[#7A746B]">Your name</span>
        <input required maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} className="input-crafted w-full px-3" autoComplete="name" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="label-caps text-[#7A746B]">Mobile phone</span>
          <input required type="tel" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => set('phone', e.target.value)} className="input-crafted w-full px-3" autoComplete="tel" />
        </label>
        <label className="block space-y-1.5">
          <span className="label-caps text-[#7A746B]">Email (optional)</span>
          <input type="email" maxLength={120} value={form.email} onChange={(e) => set('email', e.target.value)} className="input-crafted w-full px-3" autoComplete="email" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="label-caps text-[#7A746B]">What do you need?</span>
        <select value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} className="input-crafted w-full px-3">
          {SERVICES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="label-caps text-[#7A746B]">Details (optional)</span>
        <textarea rows={3} maxLength={600} value={form.details} onChange={(e) => set('details', e.target.value)} className="input-crafted w-full px-3 py-2" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="label-caps text-[#7A746B]">Service address (optional)</span>
          <input maxLength={200} value={form.address} onChange={(e) => set('address', e.target.value)} className="input-crafted w-full px-3" autoComplete="street-address" />
        </label>
        <label className="block space-y-1.5">
          <span className="label-caps text-[#7A746B]">ZIP</span>
          <input inputMode="numeric" maxLength={5} value={form.zip} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} className="input-crafted w-full px-3" autoComplete="postal-code" />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="label-caps text-[#7A746B]">Preferred day</span>
          <input type="date" min={today} max={max} value={form.preferredDay} onChange={(e) => set('preferredDay', e.target.value)} className="input-crafted w-full px-3" />
        </label>
        <label className="block space-y-1.5">
          <span className="label-caps text-[#7A746B]">Preferred time</span>
          <select value={form.preferredTime} onChange={(e) => set('preferredTime', e.target.value)} className="input-crafted w-full px-3">
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Honeypot: real people never see or fill this. */}
      <div aria-hidden="true" style={{position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden'}}>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-[#23282D]">
        <input type="checkbox" className="checkbox-crafted mt-0.5" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
        <span>I agree that {info.businessName} may call or text me about this request. Message and data rates may apply. Reply STOP to opt out of texts.</span>
      </label>

      {error && <p className="text-[13px] text-[#B42318]">{error}</p>}
      <button type="submit" disabled={busy || !form.consent} className="btn-primary w-full px-4 py-3 text-[14px] disabled:opacity-60">
        {busy ? 'Sending…' : 'Send request'}
      </button>
      <p className="text-[12px] text-[#7A746B] text-center">This sends a request. {info.businessName} confirms the time with you.</p>
    </form>
  );
}
