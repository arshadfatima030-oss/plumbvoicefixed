import {useEffect, useState} from 'react';
import {CheckCircle2, Phone, XCircle} from 'lucide-react';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';

interface PublicQuote {
  businessName: string;
  phone: string;
  customerName: string;
  title: string;
  items: {description: string; amount: number}[];
  total: number;
  notes: string;
  status: 'Open' | 'Accepted' | 'Declined' | 'Voided';
  validUntilISO: string;
  expired: boolean;
  respondedByName: string;
}

const money = (n: number) => n.toLocaleString('en-US', {style: 'currency', currency: 'USD'});

/** Private link a customer opens from a text/email to approve or decline an estimate. */
export function QuotePage({orgId, quoteId}: {orgId: string; quoteId: string}) {
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const api = `/api/public/quote/${encodeURIComponent(orgId)}/${encodeURIComponent(quoteId)}`;

  usePageSeo({title: q ? `Estimate from ${q.businessName}` : 'Estimate', description: 'Review your estimate.', path: `/quote/${orgId}/${quoteId}`, noindex: true});

  useEffect(() => {
    let alive = true;
    apiRequest<PublicQuote>(api)
      .then((r) => alive && setQ(r))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [api]);

  const respond = async (action: 'accept' | 'decline') => {
    setBusy(true);
    setError('');
    try {
      const r = await apiRequest<{status: 'Accepted' | 'Declined'}>(api, {method: 'POST', body: JSON.stringify({action, name})});
      setQ((cur) => (cur ? {...cur, status: r.status, respondedByName: name || cur.customerName} : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please call us.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (c: React.ReactNode) => (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-8 sm:py-12">
      <div className="max-w-[560px] mx-auto">{c}</div>
    </div>
  );

  if (missing) return shell(<div className="card-tier-1 p-8 text-center"><h1 className="headline-md text-[#1C1F22]">This quote link is not valid</h1><p className="text-[14px] text-[#7A746B] mt-2">It may have been replaced. Please contact the business.</p></div>);
  if (!q) return shell(<p className="text-center text-[14px] text-[#7A746B]">Loading…</p>);

  const open = q.status === 'Open' && !q.expired;
  return shell(
    <div className="card-tier-1 p-6 sm:p-8 space-y-5">
      <div>
        <p className="label-caps text-[#7A746B]">{q.businessName}</p>
        <h1 className="headline-md text-[#1C1F22]">{q.title}</h1>
        <p className="text-[13px] text-[#7A746B] mt-1">Prepared for {q.customerName}</p>
      </div>
      <div className="divide-y divide-[#ECE6DC] border border-[#ECE6DC] rounded-xl bg-white">
        {q.items.map((i, idx) => (
          <div key={idx} className="flex justify-between gap-4 px-4 py-3 text-[14px]">
            <span className="text-[#23282D]">{i.description}</span>
            <span className="font-mono">{money(i.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-3 text-[15px] font-bold">
          <span>Total</span>
          <span className="font-mono">{money(q.total)}</span>
        </div>
      </div>
      {q.notes && <p className="text-[13.5px] text-[#23282D] whitespace-pre-wrap">{q.notes}</p>}

      {q.status === 'Accepted' && (
        <div className="flex items-start gap-2 text-[#2E8B57] text-[14px]">
          <CheckCircle2 className="w-5 h-5 shrink-0" /> Approved{q.respondedByName ? ` by ${q.respondedByName}` : ''}. {q.businessName} will contact you to schedule the work.
        </div>
      )}
      {q.status === 'Declined' && (
        <div className="flex items-start gap-2 text-[#7A746B] text-[14px]">
          <XCircle className="w-5 h-5 shrink-0" /> You declined this estimate. Call us if you would like changes.
        </div>
      )}
      {q.status === 'Open' && q.expired && <p className="text-[14px] text-[#B42318]">This estimate has expired. Please contact {q.businessName} for a new one.</p>}

      {open && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="label-caps text-[#7A746B]">Type your full name to approve</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="input-crafted w-full px-3" autoComplete="name" />
          </label>
          {error && <p className="text-[13px] text-[#B42318]">{error}</p>}
          <div className="flex gap-3">
            <button type="button" disabled={busy || name.trim().length < 2} onClick={() => respond('accept')} className="btn-primary flex-1 px-4 py-3 text-[14px] disabled:opacity-60">
              Approve {money(q.total)}
            </button>
            <button type="button" disabled={busy} onClick={() => respond('decline')} className="btn-secondary px-4 py-3 text-[14px] disabled:opacity-60">
              Decline
            </button>
          </div>
          <p className="text-[12px] text-[#7A746B]">Valid until {new Date(q.validUntilISO).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}. Approving is a request to schedule the work at this price; it is not a payment.</p>
        </div>
      )}
      {q.phone && (
        <p className="text-[13px] text-[#7A746B] flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5" /> Questions? Call <a className="underline" href={`tel:${q.phone.replace(/[^\d+]/g, '')}`}>{q.phone}</a>
        </p>
      )}
    </div>
  );
}
