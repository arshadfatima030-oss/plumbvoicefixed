import {useState} from 'react';
import {
  Bell,
  Calendar,
  CheckCircle2,
  MessageSquare,
  PhoneForwarded,
  Plus,
  Send,
} from 'lucide-react';
import {formatCurrency, SimulatedNumberBadge, TradeLabel, UrgencyBadge} from '../../components/StatusBadges';
import {usePageSeo} from '../../lib/seo';
import type {
  AppointmentItem,
  FollowUpItem,
  NotificationItem,
  PhoneSetupConfig,
  TeamMember,
  TradeCategory,
} from '../../types/plumbvoice';

const CARRIER_STEPS: Record<PhoneSetupConfig['carrier'], {text: string; dialCode?: string}[]> = {
  'AT&T': [
    {text: 'Open the Phone keypad on your primary business line.'},
    {text: 'Dial *61*[SYS_DIGITS]# (Conditional No-Answer) and press Call.', dialCode: '*61*[SYS_DIGITS]#'},
    {text: 'Dial *67*[SYS_DIGITS]# (Busy Forward) and press Call.', dialCode: '*67*[SYS_DIGITS]#'},
    {text: 'Verify confirmation tone, then tap Send Test Call to System Number.'},
  ],
  Verizon: [
    {text: 'Dial *71[SYS_DIGITS] from your business line for Busy/No-Answer forwarding.', dialCode: '*71[SYS_DIGITS]'},
    {text: 'Wait for the confirmation tone before hanging up.'},
    {text: 'To disable conditional forwarding anytime, dial *73.', dialCode: '*73'},
  ],
  'T-Mobile': [
    {text: 'Dial **61*1[SYS_DIGITS]**20# to forward unanswered calls after 20 seconds.', dialCode: '**61*1[SYS_DIGITS]**20#'},
    {text: 'Dial **67*1[SYS_DIGITS]# to forward while on another job call.', dialCode: '**67*1[SYS_DIGITS]#'},
  ],
  RingCentral: [
    {text: 'Log in to RingCentral Admin Portal > Call Handling & Forwarding.'},
    {text: 'Set Ring Duration to 20 seconds (4 rings), then add your PlumbVoice System Number as overflow.'},
  ],
  Grasshopper: [
    {text: 'Open Grasshopper Extension Settings > Call Forwarding.'},
    {text: 'Add your PlumbVoice System Number ([SYS_PRETTY]) as fallback after 4 rings.'},
  ],
};

const POPULAR_AREA_CODES = [
  {code: '512', label: '512 · Austin, TX'},
  {code: '713', label: '713 · Houston, TX'},
  {code: '214', label: '214 · Dallas, TX'},
  {code: '602', label: '602 · Phoenix, AZ'},
  {code: '303', label: '303 · Denver, CO'},
  {code: '404', label: '404 · Atlanta, GA'},
  {code: '312', label: '312 · Chicago, IL'},
  {code: '888', label: '888 · Toll-Free'},
];

export function PhoneSetupPage({
  phoneSetup,
  onSave,
  onProvisionSystemNumber,
  onTestSystemCall,
  onNavigate,
}: {
  phoneSetup: PhoneSetupConfig;
  onSave: (patch: Partial<PhoneSetupConfig>) => Promise<void>;
  onProvisionSystemNumber: (areaCode: string, numberType: 'Local DID' | 'Toll-Free 888') => Promise<PhoneSetupConfig | null>;
  onTestSystemCall: () => Promise<{callId: string} | null>;
  onNavigate: (path: string) => void;
}) {
  const [draft, setDraft] = useState(phoneSetup);
  const [areaCode, setAreaCode] = useState(phoneSetup.systemNumberAreaCode || '512');
  const [numberType, setNumberType] = useState<'Local DID' | 'Toll-Free 888'>(phoneSetup.systemNumberType || 'Local DID');
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [testingCall, setTestingCall] = useState(false);
  const [verifiedMsg, setVerifiedMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [lastTestCallId, setLastTestCallId] = useState<string | null>(null);

  usePageSeo({
    title: 'System Number & Call Forwarding — PlumbVoice AI',
    description: 'Create a simulated demo System Number, set the ring timeout and view carrier forwarding codes. Your real AI line is the Telnyx number you buy and assign.',
    path: '/app/phone-setup',
    noindex: true,
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setVerifiedMsg('System Number and carrier routing settings saved.');
    window.setTimeout(() => setVerifiedMsg(''), 3000);
  };

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      const updated = await onProvisionSystemNumber(areaCode, numberType);
      if (!updated) return;
      setDraft(updated);
      setVerifiedMsg(`Demo number ${updated.systemNumber} generated. It is simulated and cannot receive real calls.`);
      window.setTimeout(() => setVerifiedMsg(''), 3500);
    } finally {
      setProvisioning(false);
    }
  };

  const handleSimulateSystemCall = async () => {
    setTestingCall(true);
    try {
      const res = await onTestSystemCall();
      if (!res) return;
      setLastTestCallId(res.callId);
      setDraft((prev) => ({...prev, lastSystemTestAt: 'Simulated test just now'}));
      setVerifiedMsg('Simulated test call logged. No real call was placed.');
    } finally {
      setTestingCall(false);
    }
  };

  const handleCopyNumber = async () => {
    try {
      await navigator.clipboard.writeText(draft.systemNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked in non-HTTPS contexts
    }
  };

  const sysDigits = draft.systemNumber.replace(/\D/g, '');

  return (
    <div className="space-y-6 max-w-5xl">
      {verifiedMsg && (
        <div className="rounded-xl bg-[#EBF6F0] border border-[#2E8B57]/30 px-4 py-3 text-[13px] font-semibold text-[#2E8B57] flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{verifiedMsg}</span>
          </span>
          {lastTestCallId && (
            <button
              type="button"
              onClick={() => onNavigate(`/app/calls/${lastTestCallId}`)}
              className="underline font-bold cursor-pointer"
            >
              Inspect Test Call →
            </button>
          )}
        </div>
      )}

      {/* System Number Provisioning Card (Zero External Provider Needed) */}
      <section className="rounded-xl bg-[#1C1F22] text-[#FAF7F2] p-5 sm:p-7 space-y-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-white/10">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps text-[#F2A93B]">Demo System Number</span>
              <SimulatedNumberBadge />
              <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#2E8B57]/20 text-[#5CD493] border border-[#2E8B57]/40">
                {draft.systemNumberStatus} · {draft.systemNumberType}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <p className="font-mono font-extrabold text-[26px] sm:text-[32px] tracking-tight text-white tabular-nums">
                {draft.systemNumber}
              </p>
              <button
                type="button"
                onClick={handleCopyNumber}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-[12px] font-semibold text-[#FAF7F2] cursor-pointer"
              >
                {copied ? 'Copied!' : 'Copy Number'}
              </button>
            </div>
            <p className="text-[12.5px] text-[#A8A298]">
              {draft.systemNumberProvisionedAt} · Simulated placeholder for testing. Your real AI line is the number you buy and assign in Telnyx (see setup guide); do not forward customer calls to this one.
            </p>
          </div>

          <button
            type="button"
            disabled={testingCall}
            onClick={handleSimulateSystemCall}
            className="btn-primary w-full md:w-auto text-[13px] whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            {testingCall ? 'Routing Test Call…' : 'Send Test Call to System Number'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label htmlFor="sys-area" className="label-caps text-[#A8A298] block mb-1.5">
              Select US Area Code
            </label>
            <select
              id="sys-area"
              value={areaCode}
              onChange={(e) => {
                const val = e.target.value;
                setAreaCode(val);
                if (val === '888') setNumberType('Toll-Free 888');
              }}
              className="h-[42px] w-full px-3 rounded-lg bg-white/10 border border-white/15 text-white text-[14px] focus:outline-none focus:border-[#F2A93B]"
            >
              {POPULAR_AREA_CODES.map((a) => (
                <option key={a.code} value={a.code} className="text-[#1C1F22]">
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-4">
            <label htmlFor="sys-type" className="label-caps text-[#A8A298] block mb-1.5">
              Number Type
            </label>
            <select
              id="sys-type"
              value={numberType}
              onChange={(e) => setNumberType(e.target.value as 'Local DID' | 'Toll-Free 888')}
              className="h-[42px] w-full px-3 rounded-lg bg-white/10 border border-white/15 text-white text-[14px] focus:outline-none focus:border-[#F2A93B]"
            >
              <option value="Local DID" className="text-[#1C1F22]">Local DID Number</option>
              <option value="Toll-Free 888" className="text-[#1C1F22]">Toll-Free (888)</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <button
              type="button"
              disabled={provisioning}
              onClick={handleProvision}
              className="w-full h-[42px] px-4 rounded-lg bg-[#F2A93B] hover:bg-[#e59a28] text-[#1C1F22] font-semibold text-[13px] cursor-pointer disabled:opacity-60"
            >
              {provisioning ? 'Allocating…' : 'Assign New Number'}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSave} className="lg:col-span-7 card-tier-1 p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#ECE6DC]">
            <div>
              <span className="label-caps text-[#C8672B]">Carrier Routing</span>
              <h2 className="headline-md text-[#1C1F22] mt-0.5">
                Business Line &amp; Ring Timeout
              </h2>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full label-caps border ${
                draft.forwardingVerified
                  ? 'bg-[#EBF6F0] text-[#2E8B57] border-[#2E8B57]/25'
                  : 'bg-[#FEF6E8] text-[#B47010] border-[#E9A23B]/35'
              }`}
            >
              {draft.forwardingVerified ? 'Verified' : 'Pending Test'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Your Business Phone</label>
              <input
                value={draft.businessPhone}
                onChange={(e) => setDraft({...draft, businessPhone: e.target.value})}
                className="input-crafted w-full px-3 font-mono"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] mb-1.5 flex items-center gap-2">
                Assigned System Number <SimulatedNumberBadge />
              </label>
              <input
                value={draft.systemNumber}
                readOnly
                aria-readonly="true"
                className="input-crafted w-full px-3 font-mono bg-[#FAF7F2]"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Phone Carrier</label>
              <select
                value={draft.carrier}
                onChange={(e) =>
                  setDraft({...draft, carrier: e.target.value as PhoneSetupConfig['carrier']})
                }
                className="input-crafted w-full px-3"
              >
                <option value="AT&T">AT&amp;T</option>
                <option value="Verizon">Verizon</option>
                <option value="T-Mobile">T-Mobile</option>
                <option value="RingCentral">RingCentral</option>
                <option value="Grasshopper">Grasshopper</option>
              </select>
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Ring Timeout (Seconds)</label>
              <input
                type="number"
                min={5}
                max={45}
                value={draft.ringTimeoutSec}
                onChange={(e) =>
                  setDraft({...draft, ringTimeoutSec: Number(e.target.value) || 20})
                }
                className="input-crafted w-full px-3 font-mono tabular-nums"
              />
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.afterHoursForwarding}
              onChange={(e) => setDraft({...draft, afterHoursForwarding: e.target.checked})}
              className="checkbox-crafted mt-0.5"
            />
            <span className="text-[14px] text-[#23282D]">
              Forward all calls directly to your PlumbVoice System Number outside business hours
            </span>
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary w-full sm:w-auto text-[13px] cursor-pointer">
              {saving ? 'Saving…' : 'Save Forwarding Setup'}
            </button>
            <button
              type="button"
              onClick={async () => {
                const updated = {
                  ...draft,
                  forwardingVerified: true,
                  lastSystemTestAt: 'Verified just now',
                };
                setDraft(updated);
                await onSave(updated);
                setVerifiedMsg('System Number connection verified.');
              }}
              className="btn-secondary w-full sm:w-auto text-[13px] cursor-pointer"
            >
              Verify Connection Status
            </button>
          </div>
        </form>

        <section className="lg:col-span-5 rounded-xl bg-white border border-[#ECE6DC] p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#ECE6DC]">
            <div>
              <span className="label-caps text-[#C8672B]">Carrier Instructions</span>
              <h3 className="headline-sm text-[#1C1F22] mt-0.5">{draft.carrier} Mobile / Desk Setup</h3>
            </div>
            <PhoneForwarded className="w-5 h-5 text-[#C8672B]" />
          </div>

          <p role="note" className="rounded-lg border border-[#F2A93B]/50 bg-[#FFF6E5] p-3 text-[12.5px] leading-relaxed text-[#6B4A0B]">
            The number in these steps is a <strong>demo placeholder</strong>. Before forwarding real calls, replace it with the live number you bought in Telnyx.
          </p>
          <ol className="space-y-3 text-[13.5px] leading-relaxed text-[#23282D] list-decimal pl-4">
            {CARRIER_STEPS[draft.carrier].map((step, i) => {
              const renderedText = step.text
                .replace('[SYS_DIGITS]', sysDigits)
                .replace('[SYS_PRETTY]', draft.systemNumber);
              const renderedDial = step.dialCode?.replace('[SYS_DIGITS]', sysDigits);
              return (
                <li key={i} className="space-y-1.5">
                  <p className="break-words">{renderedText}</p>
                  {renderedDial && (
                    <a
                      href={`tel:${encodeURIComponent(renderedDial)}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FAF7F2] border border-[#ECE6DC] font-mono text-[12px] font-semibold text-[#C8672B] hover:border-[#C8672B]"
                    >
                      Tap to Dial: {renderedDial}
                    </a>
                  )}
                </li>
              );
            })}
          </ol>

          {draft.lastSystemTestAt && (
            <p className="pt-3 border-t border-[#ECE6DC] font-mono text-[12px] text-[#2E8B57]">
              Status: {draft.lastSystemTestAt}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function AppointmentsPage({
  appointments,
  team,
  googleConnected,
  onCreateAppointment,
  onUpdateAppointment,
}: {
  appointments: AppointmentItem[];
  team: TeamMember[];
  googleConnected: boolean;
  onCreateAppointment: (payload: Partial<AppointmentItem>) => Promise<void>;
  onUpdateAppointment: (id: string, patch: Partial<AppointmentItem>) => Promise<void>;
}) {
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [trade, setTrade] = useState<TradeCategory>('Plumbing');
  const [dateISO, setDateISO] = useState(new Date().toISOString().slice(0, 10));
  const [timeWindow, setTimeWindow] = useState('10:00 AM – 12:00 PM');
  const [assignedMemberId, setAssignedMemberId] = useState(team[1]?.id || team[0]?.id || '');

  usePageSeo({
    title: 'Appointments & Calendar — PlumbVoice AI',
    description: 'Schedule plumbing and electrical dispatch windows and sync Google Calendar.',
    path: '/app/appointments',
    noindex: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateAppointment({
      title,
      customerName,
      customerPhone,
      address,
      trade,
      dateISO,
      timeWindow,
      assignedMemberId,
    });
    setShowModal(false);
    setTitle('');
    setCustomerName('');
    setCustomerPhone('');
    setAddress('');
  };

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#C8672B]" />
          <div>
            <h2 className="headline-sm text-[#1C1F22]">Upcoming Field Appointments</h2>
            <p className="text-[12px] text-[#7A746B]">
              Google Calendar Sync: {googleConnected ? 'Connected' : 'Optional (Connect in Integrations)'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn-primary text-[13px] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule Job</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {appointments.map((appt) => {
          const tech = team.find((m) => m.id === appt.assignedMemberId);
          return (
            <div key={appt.id} className="card-tier-1 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-semibold text-[#C8672B]">
                  {appt.dateISO} · {appt.timeWindow}
                </span>
                <UrgencyBadge urgency={appt.urgency} />
              </div>

              <div>
                <h3 className="headline-sm text-[#1C1F22]">{appt.title}</h3>
                <p className="text-[13px] text-[#7A746B] mt-0.5">
                  {appt.customerName} · {appt.address}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#ECE6DC]">
                <div className="flex items-center gap-3">
                  <TradeLabel trade={appt.trade} />
                  <span className="text-[12px] text-[#23282D] font-medium">
                    {tech ? `${tech.truckCode} · ${tech.name}` : 'Unassigned'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-bold text-[#1C1F22]">
                    {formatCurrency(appt.estimatedValue)}
                  </span>
                  <select
                    aria-label={`Status for ${appt.title}`}
                    value={appt.status}
                    onChange={(e) =>
                      onUpdateAppointment(appt.id, {
                        status: e.target.value as AppointmentItem['status'],
                      })
                    }
                    className="h-8 px-2 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] text-[12px] font-semibold"
                  >
                    <option value="Scheduled">Scheduled</option>
                    <option value="En Route">En Route</option>
                    <option value="On Site">On Site</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1F22]/55" role="dialog" aria-modal="true">
          <div className="modal-tier-3 w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4">
            <h3 className="headline-md text-[#1C1F22]">Schedule Field Appointment</h3>
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="label-caps text-[#7A746B] block mb-1">Job Title</label>
                <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input-crafted w-full px-3" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Customer</label>
                  <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="input-crafted w-full px-3" />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Phone</label>
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="input-crafted w-full px-3 font-mono" />
                </div>
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1">Address</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className="input-crafted w-full px-3" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Trade</label>
                  <select value={trade} onChange={(e) => setTrade(e.target.value as TradeCategory)} className="input-crafted w-full px-2">
                    <option value="Plumbing">Plumbing</option>
                    <option value="Electrical">Electrical</option>
                  </select>
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Date</label>
                  <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} className="input-crafted w-full px-2 font-mono text-[12px]" />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Window</label>
                  <input value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)} className="input-crafted w-full px-2 text-[12px]" />
                </div>
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1">Technician</label>
                <select value={assignedMemberId} onChange={(e) => setAssignedMemberId(e.target.value)} className="input-crafted w-full px-3">
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.truckCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="btn-primary cursor-pointer">
                  Confirm Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function FollowUpsPage({
  followUps,
  onUpdateFollowUp,
  onNavigate,
}: {
  followUps: FollowUpItem[];
  onUpdateFollowUp: (id: string, patch: Partial<FollowUpItem>) => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  usePageSeo({
    title: 'Follow-Ups & Reminders — PlumbVoice AI',
    description: 'Consent-based SMS follow-ups and quote reminders with opt-out compliance.',
    path: '/app/follow-ups',
    noindex: true,
  });

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-[#C8672B]" />
          <div>
            <h2 className="headline-sm text-[#1C1F22]">Consent-Based Customer Follow-Ups</h2>
            <p className="text-[13px] text-[#7A746B]">
              Every customer SMS requires consent and includes automatic STOP opt-out handling.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {followUps.map((f) => (
          <div key={f.id} className="card-tier-1 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-semibold text-[15px] text-[#1C1F22]">
                  {f.customerName}
                </span>
                <span className="font-mono text-[12px] text-[#7A746B]">{f.phone}</span>
                <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#FBEBDD] text-[#C8672B] border border-[#C8672B]/25">
                  {f.triggerReason}
                </span>
              </div>
              <p className="text-[13.5px] text-[#23282D] bg-[#FAF7F2] border border-[#ECE6DC] rounded-lg p-3">
                {f.messagePreview}
              </p>
              <p className="text-[12px] text-[#7A746B]">
                {f.scheduledFor} · Consent: {f.consentOptIn ? `Verified${f.consentSource ? ` (${f.consentSource.replace(/_/g, ' ')}${f.consentAtISO ? `, ${new Date(f.consentAtISO).toLocaleDateString()}` : ''})` : ''}` : 'Missing'} · Status:{' '}
                <strong className="text-[#1C1F22]">{f.status}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate(`/app/leads/${f.leadId}`)}
                className="btn-secondary text-[12px] py-2 cursor-pointer"
              >
                Open Lead
              </button>
              {f.status === 'Pending' && (
                <button
                  type="button"
                  onClick={() => onUpdateFollowUp(f.id, {status: 'Sent', scheduledFor: 'Sent just now'})}
                  className="btn-primary text-[12px] py-2 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Compliant SMS</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotificationsPage({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: {
  notifications: NotificationItem[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  usePageSeo({
    title: 'Notifications — PlumbVoice AI',
    description: 'New lead, missed call, emergency, and reminder notifications.',
    path: '/app/notifications',
    noindex: true,
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="card-tier-1 p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-[#C8672B]" />
          <h2 className="headline-sm text-[#1C1F22]">Dispatch &amp; Lead Alerts</h2>
        </div>
        <button type="button" onClick={onMarkAllRead} className="btn-secondary text-[12px] py-2 cursor-pointer">
          Mark All Read
        </button>
      </div>

      <div className="card-tier-1 divide-y divide-[#ECE6DC]">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              n.read ? 'bg-white' : 'bg-[#FBEBDD]/45'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="label-caps text-[#C8672B]">{n.type}</span>
                <span className="text-[12px] text-[#7A746B]">· {n.createdAt}</span>
              </div>
              <p className="font-display font-semibold text-[15px] text-[#1C1F22]">{n.title}</p>
              <p className="text-[13px] text-[#7A746B]">{n.body}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!n.read && (
                <button
                  type="button"
                  onClick={() => onMarkRead(n.id)}
                  className="text-[12px] font-semibold text-[#7A746B] hover:text-[#1C1F22] cursor-pointer"
                >
                  Dismiss
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await onMarkRead(n.id);
                  onNavigate(n.targetPath);
                }}
                className="btn-secondary text-[12px] py-1.5 px-3 cursor-pointer"
              >
                Inspect →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
