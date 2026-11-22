import {useCallback, useEffect, useState} from 'react';
import {CheckCircle2, Copy, Globe, Lock, MessageSquare, Webhook, CalendarCheck, Star, CalendarPlus, PhoneCall, Mic, MapPin} from 'lucide-react';
import {apiRequest} from '../../lib/api';
import type {LocationItem, WorkspaceExtras} from '../../types/plumbvoice';

interface ExtrasResponse {
  organizationId: string;
  extras: WorkspaceExtras;
  webhookConfigured: boolean;
  googleConfigured: boolean;
  toolTokenAvailable: boolean;
  ringTokenAvailable?: boolean;
  /** Owner only: true while the workspace still uses the old non-rotatable URL secret. */
  ringTokenLegacy?: boolean;
  team?: {id: string; name: string; role: string}[];
  features?: Record<string, {allowed: boolean; minPlan: string}>;
}

interface Preview {
  url: string;
  pagesRead: string[];
  title: string;
  phones: string[];
  emails: string[];
  hours: string[];
  serviceAreas: string[];
  services: string[];
  blockedByRobots: boolean;
}

const EVENTS: {id: string; label: string}[] = [
  {id: 'lead_created', label: 'New lead'},
  {id: 'call_completed', label: 'Call completed'},
  {id: 'emergency_detected', label: 'Emergency detected'},
  {id: 'appointment_booked', label: 'Appointment booked'},
];

function Section({icon, title, hint, children, lockedPlan}: {icon: React.ReactNode; title: string; hint: string; children: React.ReactNode; lockedPlan?: string}) {
  return (
    <div className="card-tier-1 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="text-[#C8672B] mt-0.5">{icon}</div>
        <div>
          <h3 className="headline-sm text-[#1C1F22]">{title}</h3>
          <p className="text-[12.5px] text-[#7A746B]">{hint}</p>
          {lockedPlan && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#B47010]">
              <Lock className="w-3.5 h-3.5" /> Needs the {lockedPlan} plan or above. Upgrade under Billing.
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

const Field = ({label, children}: {label: string; children: React.ReactNode}) => (
  <label className="block space-y-1.5">
    <span className="label-caps text-[#7A746B]">{label}</span>
    {children}
  </label>
);

export function AutomationPanels() {
  const [data, setData] = useState<ExtrasResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<ExtrasResponse>('/api/extras'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load settings.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: string, body: Record<string, unknown>, okMsg: string) => {
      setBusy(key);
      setError('');
      setNotice('');
      try {
        const r = await apiRequest<{extras: WorkspaceExtras; webhookSecret?: string}>('/api/extras', {method: 'PATCH', body: JSON.stringify(body)});
        setData((d) => (d ? {...d, extras: r.extras, webhookConfigured: d.webhookConfigured || Boolean(r.webhookSecret)} : d));
        setNotice(r.webhookSecret ? `${okMsg} Signing secret (shown once, copy it now): ${r.webhookSecret}` : okMsg);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
      } finally {
        setBusy('');
      }
    },
    []
  );

  if (!data) return error ? <p className="text-[13px] text-[#B42318]">{error}</p> : null;
  const x = data.extras;
  const origin = window.location.origin;
  const lock = (f: string) => (data.features && data.features[f] && !data.features[f].allowed ? data.features[f].minPlan : undefined);

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-5">
        <h2 className="headline-sm text-[#1C1F22]">Automation &amp; Channels</h2>
        <p className="text-[13px] text-[#7A746B]">Website chat, webhooks, website import and calendar. Only the account owner can save changes.</p>
        <button
          type="button"
          className="btn-secondary mt-3 px-3 py-1.5 text-[12.5px]"
          onClick={async () => {
            setError('');
            try {
              const text = await apiRequest<string>('/api/export/json');
              const blob = new Blob([typeof text === 'string' ? text : JSON.stringify(text, null, 2)], {type: 'application/json'});
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'plumbvoice-export.json';
              a.click();
              URL.revokeObjectURL(a.href);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Export failed.');
            }
          }}
        >
          Download all my data (JSON)
        </button>
        {notice && <p className="mt-3 text-[13px] text-[#2E8B57] break-all">{notice}</p>}
        {error && <p className="mt-3 text-[13px] text-[#B42318]">{error}</p>}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChatCard x={x} orgId={data.organizationId} origin={origin} busy={busy === 'chat'} onSave={(b) => save('chat', b, 'Website chat settings saved.')} />
        <WebhookCard lockedPlan={lock('webhooks')} x={x} configured={data.webhookConfigured} busy={busy === 'webhook'} onSave={(b) => save('webhook', b, 'Webhook settings saved.')} />
        <KnowledgeCard lockedPlan={lock('knowledgeImport')} onDone={setNotice} onError={setError} />
        <CalendarCard lockedPlan={lock('calendar')} x={x} ready={data.googleConfigured} onChanged={load} onError={setError} />
        <RingFirstCard lockedPlan={lock('ringFirst')} x={x} orgId={data.organizationId} available={Boolean(data.ringTokenAvailable)} legacy={data.ringTokenLegacy === true} onError={setError} onChanged={load} origin={origin} busy={busy === 'ring'} onSave={(b) => save('ring', b, 'Ring-first settings saved.')} />
        <RecordingCard x={x} busy={busy === 'rec'} onSave={(b) => save('rec', b, 'Recording settings saved.')} />
        <LocationsCard x={x} team={data.team ?? []} lockedPlan={lock('multiLocation')} busy={busy === 'loc'} onSave={(b) => save('loc', b, 'Locations saved.')} />
        <ReviewCard x={x} busy={busy === 'review'} onSave={(b) => save('review', b, 'Review request settings saved.')} />
        <BookingPageCard x={x} orgId={data.organizationId} origin={origin} busy={busy === 'booking'} onSave={(b) => save('booking', b, 'Booking page settings saved.')} />
        <MessagingCard lockedPlan={lock('smsActions')} x={x} orgId={data.organizationId} origin={origin} tokenOk={data.toolTokenAvailable} busy={busy === 'msg'} onSave={(b) => save('msg', b, 'Messaging settings saved.')} />
      </div>
    </div>
  );
}

function SaveButton({busy, onClick, label = 'Save'}: {busy: boolean; onClick: () => void; label?: string}) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="btn-primary px-4 py-2 text-[13px] disabled:opacity-60">
      {busy ? 'Saving…' : label}
    </button>
  );
}

function ChatCard({x, orgId, origin, busy, onSave}: {x: WorkspaceExtras; orgId: string; origin: string; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const cw = x.chatWidget;
  const [enabled, setEnabled] = useState(cw?.enabled ?? false);
  const [domains, setDomains] = useState((cw?.allowedDomains ?? []).join('\n'));
  const [welcome, setWelcome] = useState(cw?.welcome ?? 'Hi! How can we help today?');
  const snippet = `<script src="${origin}/plumbvoice-widget.js" data-org="${orgId}" async></script>`;
  return (
    <Section icon={<MessageSquare className="w-5 h-5" />} title="Website Chat Widget" hint="An AI chat bubble for your own website. It captures leads like a phone call.">
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable chat widget
      </label>
      <Field label="Allowed website domains (one per line)">
        <textarea rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yourcompany.com" className="input-crafted w-full px-3 py-2 font-mono text-[12.5px]" />
      </Field>
      <Field label="Welcome message">
        <input value={welcome} maxLength={200} onChange={(e) => setWelcome(e.target.value)} className="input-crafted w-full px-3" />
      </Field>
      <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-2">
        <p className="label-caps text-[#7A746B]">Paste before &lt;/body&gt; on your site</p>
        <code className="block text-[11px] text-[#C8672B] break-all">{snippet}</code>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(snippet)} className="btn-secondary px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5">
          <Copy className="w-3.5 h-3.5" /> Copy
        </button>
      </div>
      <SaveButton busy={busy} onClick={() => onSave({chatWidget: {enabled, allowedDomains: domains.split('\n').map((d) => d.trim()).filter(Boolean), welcome}})} />
    </Section>
  );
}

function WebhookCard({x, configured, busy, onSave, lockedPlan}: {lockedPlan?: string; x: WorkspaceExtras; configured: boolean; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const w = x.webhook;
  const [url, setUrl] = useState(w?.url ?? '');
  const [enabled, setEnabled] = useState(w?.enabled ?? false);
  const [events, setEvents] = useState<string[]>(w?.events ?? EVENTS.map((e) => e.id));
  const [log, setLog] = useState<{id: string; type: string; ok: boolean; status: number; at: string; error?: string}[]>([]);
  const [msg, setMsg] = useState('');
  const refresh = async () => setLog((await apiRequest<{log: typeof log}>('/api/extras/webhook/log')).log);
  return (
    <Section lockedPlan={lockedPlan} icon={<Webhook className="w-5 h-5" />} title="Webhooks (Zapier, Make, CRM)" hint="Send events to any URL. In Zapier use a “Catch Hook” trigger and paste its URL here.">
      <Field label="Webhook URL (https)">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" className="input-crafted w-full px-3 font-mono text-[12.5px]" />
      </Field>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send events
      </label>
      <div className="grid grid-cols-2 gap-2">
        {EVENTS.map((ev) => (
          <label key={ev.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="checkbox-crafted" checked={events.includes(ev.id)} onChange={(e) => setEvents((c) => (e.target.checked ? [...c, ev.id] : c.filter((v) => v !== ev.id)))} /> {ev.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <SaveButton busy={busy} onClick={() => onSave({webhook: {url, enabled, events}})} />
        <button type="button" disabled={!configured} className="btn-secondary px-4 py-2 text-[13px] disabled:opacity-50" onClick={async () => {
          try {
            const r = await apiRequest<{result: {ok: boolean; status: number; error?: string}}>('/api/extras/webhook/test', {method: 'POST', body: '{}'});
            setMsg(r.result.ok ? 'Test delivered.' : `Test failed: ${r.result.error ?? r.result.status}`);
            await refresh();
          } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Test failed.');
          }
        }}>Send test</button>
        <button type="button" className="btn-secondary px-4 py-2 text-[13px]" onClick={() => void refresh().catch(() => {})}>Recent deliveries</button>
      </div>
      {msg && <p className="text-[12.5px] text-[#23282D]">{msg}</p>}
      {log.length > 0 && (
        <ul className="text-[12px] space-y-1">
          {log.slice(0, 8).map((l) => (
            <li key={l.id} className="flex justify-between gap-2 border-b border-[#ECE6DC] pb-1">
              <span>{l.type}</span>
              <span className={l.ok ? 'text-[#2E8B57]' : 'text-[#B42318]'}>{l.ok ? 'delivered' : l.error ?? l.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function KnowledgeCard({onDone, onError, lockedPlan}: {lockedPlan?: string; onDone: (m: string) => void; onError: (m: string) => void}) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const groups: {title: string; items: string[]}[] = preview
    ? [
        {title: 'Hours', items: preview.hours},
        {title: 'Service areas', items: preview.serviceAreas},
        {title: 'Services', items: preview.services},
        {title: 'Phones', items: preview.phones},
        {title: 'Emails', items: preview.emails},
      ].filter((g) => g.items.length)
    : [];
  return (
    <Section lockedPlan={lockedPlan} icon={<Globe className="w-5 h-5" />} title="Import From Your Website" hint="We read your public pages and show what we found. Nothing reaches the AI until you approve it.">
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourcompany.com" className="input-crafted flex-1 px-3" />
        <button type="button" disabled={working || !url} className="btn-primary px-4 py-2 text-[13px] disabled:opacity-60" onClick={async () => {
          setWorking(true);
          onError('');
          try {
            const r = await apiRequest<{preview: Preview}>('/api/knowledge/preview', {method: 'POST', body: JSON.stringify({url})});
            setPreview(r.preview);
            setPicked(new Set());
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Import failed.');
          } finally {
            setWorking(false);
          }
        }}>{working ? 'Reading…' : 'Preview'}</button>
      </div>
      {preview?.blockedByRobots && <p className="text-[12.5px] text-[#B47010]">This site’s robots.txt asks bots not to read it, so nothing was imported.</p>}
      {groups.map((g) => (
        <div key={g.title} className="space-y-1">
          <p className="label-caps text-[#7A746B]">{g.title}</p>
          {g.items.map((it) => (
            <label key={it} className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" className="checkbox-crafted mt-0.5" checked={picked.has(it)} onChange={(e) => setPicked((s) => {
                const n = new Set(s);
                if (e.target.checked) n.add(it);
                else n.delete(it);
                return n;
              })} />
              <span>{it}</span>
            </label>
          ))}
        </div>
      ))}
      {preview && !preview.blockedByRobots && groups.length === 0 && <p className="text-[12.5px] text-[#7A746B]">No hours, areas or services were found on those pages.</p>}
      {picked.size > 0 && (
        <button type="button" className="btn-primary px-4 py-2 text-[13px]" onClick={async () => {
          try {
            await apiRequest('/api/knowledge/approve', {method: 'POST', body: JSON.stringify({url: preview?.url, lines: [...picked]})});
            onDone(`Added ${picked.size} approved line(s) to your AI knowledge notes.`);
            setPicked(new Set());
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not save.');
          }
        }}>Add {picked.size} selected to AI knowledge</button>
      )}
    </Section>
  );
}

function CalendarCard({x, ready, onChanged, onError, lockedPlan}: {lockedPlan?: string; x: WorkspaceExtras; ready: boolean; onChanged: () => void; onError: (m: string) => void}) {
  const connected = x.googleCalendar?.connected === true;
  return (
    <Section lockedPlan={lockedPlan} icon={<CalendarCheck className="w-5 h-5" />} title="Google Calendar" hint="New appointments are checked against your calendar and added as events.">
      <p className="text-[13px] flex items-center gap-1.5">
        {connected ? (<><CheckCircle2 className="w-4 h-4 text-[#2E8B57]" /> Connected (primary calendar)</>) : ready ? 'Not connected.' : 'The server is missing Google credentials (see Env vars above).'}
      </p>
      {connected ? (
        <button type="button" className="btn-secondary px-4 py-2 text-[13px]" onClick={async () => {
          try {
            await apiRequest('/api/integrations/google/disconnect', {method: 'POST', body: '{}'});
            onChanged();
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not disconnect.');
          }
        }}>Disconnect</button>
      ) : (
        <button type="button" disabled={!ready} className="btn-primary px-4 py-2 text-[13px] disabled:opacity-50" onClick={async () => {
          try {
            window.location.href = (await apiRequest<{url: string}>('/api/integrations/google/start')).url;
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not start Google sign-in.');
          }
        }}>Connect Google Calendar</button>
      )}
    </Section>
  );
}

function MessagingCard({x, orgId, origin, tokenOk, busy, onSave, lockedPlan}: {lockedPlan?: string; x: WorkspaceExtras; orgId: string; origin: string; tokenOk: boolean; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const [token, setToken] = useState('');
  const [link, setLink] = useState(x.bookingLink ?? '');
  const [langs, setLangs] = useState<('en' | 'es')[]>(x.languages ?? ['en']);
  const toggle = (l: 'en' | 'es', on: boolean) => setLangs((c) => (on ? [...new Set([...c, l])] : c.filter((v) => v !== l)));
  return (
    <Section lockedPlan={lockedPlan} icon={<MessageSquare className="w-5 h-5" />} title="Text Links & Languages" hint="The approved booking link the AI may text a caller (with their consent), and the languages you serve.">
      <Field label="Booking link (https)">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://yourcompany.com/book" className="input-crafted w-full px-3" />
      </Field>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="checkbox-crafted" checked={langs.includes('en')} onChange={(e) => toggle('en', e.target.checked)} /> English</label>
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="checkbox-crafted" checked={langs.includes('es')} onChange={(e) => toggle('es', e.target.checked)} /> Español</label>
      </div>
      <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-1.5">
        <p className="label-caps text-[#7A746B]">Telnyx assistant tools (text link, missed call)</p>
        <code className="block text-[11px] text-[#C8672B] break-all">{`${origin}/api/tools/${orgId}/send-link`}</code>
        {token ? <code className="block text-[11px] break-all">x-plumbvoice-tool-token: {token}</code> : (
          <button type="button" disabled={!tokenOk} onClick={async () => setToken((await apiRequest<{token: string}>('/api/tools/token')).token)} className="btn-secondary px-3 py-1.5 text-[12px] disabled:opacity-50">
            {tokenOk ? 'Show tool token' : 'Server needs SECRETS_KEY'}
          </button>
        )}
      </div>
      <SaveButton busy={busy} onClick={() => onSave({bookingLink: link, languages: langs})} />
    </Section>
  );
}

function ReviewCard({x, busy, onSave}: {x: WorkspaceExtras; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const rr = x.reviewRequest;
  const [link, setLink] = useState(rr?.link ?? '');
  const [enabled, setEnabled] = useState(rr?.enabled ?? false);
  const [auto, setAuto] = useState(rr?.auto ?? false);
  return (
    <Section icon={<Star className="w-5 h-5" />} title="Google Review Requests" hint="Text a customer your Google review link after a job. One text per lead, never to numbers that replied STOP, only 8am–9pm your time.">
      <Field label="Google review link (https)">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://g.page/r/your-business/review" className="input-crafted w-full px-3" />
      </Field>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Allow review requests
      </label>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Send automatically when a lead is marked Converted
      </label>
      <p className="text-[12px] text-[#7A746B]">Needs text messaging set up on the server (TELNYX_SMS_FROM). You can also send one by hand from any lead.</p>
      <SaveButton busy={busy} onClick={() => onSave({reviewRequest: {link, enabled, auto}})} />
    </Section>
  );
}

function BookingPageCard({x, orgId, origin, busy, onSave}: {x: WorkspaceExtras; orgId: string; origin: string; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const bp = x.bookingPage;
  const [enabled, setEnabled] = useState(bp?.enabled ?? false);
  const [intro, setIntro] = useState(bp?.intro ?? 'Tell us what you need and we will confirm a time with you.');
  const url = `${origin}/book/${orgId}`;
  const [copied, setCopied] = useState(false);
  return (
    <Section icon={<CalendarPlus className="w-5 h-5" />} title="Customer Booking Page" hint="A public page where customers request a visit. Each request becomes a lead (source: Booking Page) and alerts you. You confirm the time yourself.">
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Booking page is on
      </label>
      <Field label="Short intro shown to customers">
        <input value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={300} className="input-crafted w-full px-3" />
      </Field>
      <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-1.5">
        <p className="label-caps text-[#7A746B]">Your booking link</p>
        <code className="block text-[12px] text-[#C8672B] break-all">{url}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {});
          }}
          className="btn-secondary px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5"
        >
          <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <SaveButton busy={busy} onClick={() => onSave({bookingPage: {enabled, intro}})} />
    </Section>
  );
}

function RingFirstCard({x, orgId, available, legacy, onError, onChanged, origin, busy, onSave, lockedPlan}: {lockedPlan?: string; x: WorkspaceExtras; orgId: string; available: boolean; legacy: boolean; onError: (m: string) => void; onChanged: () => void; origin: string; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const rf = x.ringFirst;
  const [enabled, setEnabled] = useState(rf?.enabled ?? false);
  const [phone, setPhone] = useState(rf?.ownerPhone ?? '');
  const [seconds, setSeconds] = useState(String(rf?.seconds ?? 20));
  const [assistantId, setAssistantId] = useState(rf?.assistantId ?? '');
  const [copied, setCopied] = useState(false);
  // The URL secret is never loaded with the page: the Owner asks for it (emailed-code check on new devices) and it only lives in this component.
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const url = `${origin}/api/telnyx/texml/${orgId}/${token}`;
  const reveal = async () => {
    setWorking(true);
    try {
      setToken((await apiRequest<{token: string}>('/api/extras/ring-token')).token);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not show the URL.');
    } finally {
      setWorking(false);
    }
  };
  const rotate = async () => {
    if (!window.confirm('Create a new secret URL? The current one stops working immediately, so you must paste the new URL into your Telnyx TeXML application or calls will fail.')) return;
    setWorking(true);
    try {
      setToken((await apiRequest<{token: string}>('/api/extras/ring-token/rotate', {method: 'POST', body: '{}'})).token);
      setCopied(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not rotate the URL.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <Section lockedPlan={lockedPlan} icon={<PhoneCall className="w-5 h-5" />} title="Ring My Phone First" hint="Customers call your business number. Your own phone rings first; if you do not answer in time, the AI picks up. If you answer, the AI never joins.">
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="checkbox-crafted" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Ring my phone first
      </label>
      <Field label="My mobile number (to ring)">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" className="input-crafted w-full px-3" inputMode="tel" />
      </Field>
      <Field label="Ring for">
        <select value={seconds} onChange={(e) => setSeconds(e.target.value)} className="input-crafted w-full px-3">
          {[10, 15, 20, 25, 30].map((n) => (
            <option key={n} value={n}>
              {n} seconds
            </option>
          ))}
        </select>
      </Field>
      <Field label="Telnyx AI assistant ID">
        <input value={assistantId} onChange={(e) => setAssistantId(e.target.value)} placeholder="assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="input-crafted w-full px-3 font-mono text-[12px]" />
      </Field>
      <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-1.5">
        <p className="label-caps text-[#7A746B]">Voice URL for your Telnyx TeXML application (method POST)</p>
        {!available ? (
          <code className="block text-[12px] text-[#C8672B] break-all">Set SECRETS_KEY on the server first.</code>
        ) : token ? (
          <>
            <code className="block text-[12px] text-[#C8672B] break-all">{url}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {});
              }}
              className="btn-secondary px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy URL'}
            </button>
          </>
        ) : (
          <code className="block text-[12px] text-[#7A746B]">Hidden. Only the account owner can show it.</code>
        )}
        {available && (
          <div className="flex flex-wrap gap-2">
            {!token && (
              <button type="button" disabled={working} onClick={() => void reveal()} className="btn-secondary px-3 py-1.5 text-[12px] disabled:opacity-50">
                Show URL
              </button>
            )}
            <button type="button" disabled={working} onClick={() => void rotate()} className="btn-secondary px-3 py-1.5 text-[12px] disabled:opacity-50">
              Rotate URL
            </button>
          </div>
        )}
        {legacy && <p className="text-[12px] text-[#B42318]">This URL uses the older fixed secret. Rotate it once, then update Telnyx with the new URL.</p>}
      </div>
      <p className="text-[12px] text-[#7A746B]">In Telnyx, create a TeXML application with this Voice URL and assign your business number to it (instead of to the AI assistant). Keep this URL private. Test with a real call before telling customers.</p>
      <SaveButton busy={busy} onClick={() => onSave({ringFirst: {enabled, ownerPhone: phone, seconds: Number(seconds), assistantId}})} />
    </Section>
  );
}

const DEFAULT_NOTICE = 'This call may be recorded for quality and training purposes.';

function RecordingCard({x, busy, onSave}: {x: WorkspaceExtras; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const r = x.recording;
  const [notice, setNotice] = useState(r?.consentNotice ?? '');
  const [days, setDays] = useState(String(r?.retentionDays ?? 0));
  return (
    <Section
      icon={<Mic className="w-5 h-5" />}
      title="Recording & Privacy"
      hint="The notice callers hear, and how long recordings are kept. Recording laws differ by state: many require telling every caller."
    >
      <Field label="Recording notice (said at the start of the call)">
        <textarea rows={2} maxLength={300} value={notice} onChange={(e) => setNotice(e.target.value)} placeholder={DEFAULT_NOTICE} className="input-crafted w-full px-3 py-2 text-[13px]" />
      </Field>
      <button type="button" className="btn-secondary px-3 py-1.5 text-[12px]" onClick={() => setNotice(DEFAULT_NOTICE)}>
        Use the standard notice
      </button>
      <Field label="Keep recordings for">
        <select value={days} onChange={(e) => setDays(e.target.value)} className="input-crafted w-full px-3">
          <option value="0">Until I delete them</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
          <option value="365">1 year</option>
        </select>
      </Field>
      <p className="text-[12px] text-[#7A746B]">
        After this time only the audio is removed. The transcript, summary and lead stay. The Test Agent says this notice. For real phone calls, paste the same sentence into the greeting of your Telnyx AI assistant,
        because the phone call is answered there.
      </p>
      <SaveButton busy={busy} onClick={() => onSave({recording: {consentNotice: notice.trim(), retentionDays: Number(days)}})} />
    </Section>
  );
}

const emptyLoc = (): LocationItem => ({id: '', name: '', address: '', zips: [], phone: '', hours: '', teamMemberIds: []});

function LocationsCard({x, team, lockedPlan, busy, onSave}: {x: WorkspaceExtras; team: {id: string; name: string; role: string}[]; lockedPlan?: string; busy: boolean; onSave: (b: Record<string, unknown>) => void}) {
  const [locs, setLocs] = useState<(LocationItem & {zipText: string})[]>((x.locations ?? []).map((l) => ({...l, zipText: l.zips.join(', ')})));
  const set = (i: number, patch: Partial<LocationItem & {zipText: string}>) => setLocs((cur) => cur.map((l, k) => (k === i ? {...l, ...patch} : l)));
  return (
    <Section lockedPlan={lockedPlan}
      icon={<MapPin className="w-5 h-5" />}
      title="Locations (Business plan)"
      hint="Several offices or branches. A call or lead is routed to the location whose ZIP list matches the caller's ZIP. Emergency texts go to that location's number."
    >
      {locs.length === 0 && <p className="text-[13px] text-[#7A746B]">No locations yet. Without locations everything goes to your main number, as before.</p>}
      {locs.map((l, i) => (
        <div key={l.id || i} className="p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-2.5">
          <Field label="Location name">
            <input value={l.name} maxLength={80} onChange={(e) => set(i, {name: e.target.value})} placeholder="North Branch" className="input-crafted w-full px-3" />
          </Field>
          <Field label="Address">
            <input value={l.address} maxLength={200} onChange={(e) => set(i, {address: e.target.value})} className="input-crafted w-full px-3" />
          </Field>
          <Field label="ZIP codes served (comma separated)">
            <input value={l.zipText} onChange={(e) => set(i, {zipText: e.target.value})} placeholder="75001, 75002" className="input-crafted w-full px-3 font-mono text-[12.5px]" />
          </Field>
          <Field label="Number for alerts and emergencies">
            <input value={l.phone} onChange={(e) => set(i, {phone: e.target.value})} placeholder="+1 555 123 4567" inputMode="tel" className="input-crafted w-full px-3" />
          </Field>
          <Field label="Opening hours">
            <input value={l.hours} maxLength={200} onChange={(e) => set(i, {hours: e.target.value})} placeholder="Mon-Fri 8am-6pm" className="input-crafted w-full px-3" />
          </Field>
          {team.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="label-caps text-[#7A746B]">Team at this location</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {team.map((m) => (
                  <label key={m.id} className="inline-flex items-center gap-2 text-[13px] text-[#1C1F22] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={l.teamMemberIds.includes(m.id)}
                      onChange={(e) => set(i, {teamMemberIds: e.target.checked ? [...l.teamMemberIds, m.id] : l.teamMemberIds.filter((t) => t !== m.id)})}
                    />
                    {m.name} <span className="text-[11.5px] text-[#7A746B]">({m.role})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button type="button" className="text-[12.5px] font-semibold text-[#B42318] hover:underline cursor-pointer" onClick={() => setLocs((cur) => cur.filter((_, k) => k !== i))}>
            Remove this location
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={locs.length >= 20} className="btn-secondary px-3 py-2 text-[13px]" onClick={() => setLocs((cur) => [...cur, {...emptyLoc(), zipText: ''}])}>
          Add a location
        </button>
        <SaveButton
          busy={busy}
          onClick={() => onSave({locations: locs.map(({zipText, ...l}) => ({...l, zips: zipText.split(/[\s,]+/).filter(Boolean)}))})}
        />
      </div>
    </Section>
  );
}
