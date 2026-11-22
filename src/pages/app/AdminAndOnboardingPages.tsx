import {useState} from 'react';
import {SimulatedNumberBadge} from '../../components/StatusBadges';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Lock,
  Plug,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import {TradeSceneArtwork, TradeSceneVariant} from '../../components/TradeVisuals';
import {usePageSeo} from '../../lib/seo';
import {AutomationPanels} from './AutomationPanels';
import type {
  BillingData,
  IntegrationStatusItem,
  PlanTier,
  TenantWorkspace,
  UserSession,
} from '../../types/plumbvoice';

export function BillingPage({
  billing,
  onChangePlan,
  onOpenPortal,
}: {
  billing: BillingData;
  onChangePlan: (plan: PlanTier, cycle?: 'monthly' | 'annual') => Promise<void>;
  onOpenPortal: () => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>(billing.billingCycle);
  const paid = billing.paymentsEnabled === true;
  const live = ['trialing', 'active', 'past_due'].includes(billing.subscriptionStatus ?? '');
  const checkout = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('checkout');

  usePageSeo({
    title: 'Billing & Plans — PlumbVoice AI',
    description: 'Manage your PlumbVoice AI subscription, voice minutes usage, and invoices.',
    path: '/app/billing',
    noindex: true,
  });

  const usagePct = Math.min(100, Math.round((billing.minutesUsed / billing.minutesIncluded) * 100));

  const plans: {tier: PlanTier; price: number; minutes: number; desc: string; highlighted?: boolean}[] = [
    {tier: 'Starter', price: 69, minutes: 250, desc: 'AI answering, emergency SMS, lead capture & call logs'},
    {
      tier: 'Professional',
      price: 169,
      minutes: 1000,
      desc: 'Everything in Starter plus calendar booking, missed-call text-back, ring-first & webhooks',
      highlighted: true,
    },
    {tier: 'Business', price: 299, minutes: 2000, desc: 'Multi-location routing with an alert number and hours for each location'},
  ];

  return (
    <div className="space-y-8">
      {/* Usage Summary */}
      <section className="card-tier-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#C8672B]" />
            <span className="label-caps text-[#C8672B]">Current Plan · {billing.plan}</span>
          </div>
          <h2 className="headline-md text-[#1C1F22]">
            {billing.minutesUsed} / {billing.minutesIncluded} AI Voice Minutes Used
          </h2>
          <div className="h-3 rounded-full bg-[#FAF7F2] border border-[#ECE6DC] overflow-hidden">
            <div className="h-full bg-[#C8672B]" style={{width: `${usagePct}%`}} />
          </div>
          {(billing.overageMinutes ?? 0) > 0 && (
            <p className="text-[13px] font-semibold text-[#B47010]">
              {billing.overageMinutes} extra minute{billing.overageMinutes === 1 ? '' : 's'} this period
              {billing.overageRate ? ` · about $${((billing.overageMinutes ?? 0) * billing.overageRate).toFixed(2)} at $${billing.overageRate.toFixed(2)} per minute` : ''}
            </p>
          )}
          <p className="text-[13px] text-[#7A746B]">
            Next invoice on {billing.nextInvoiceDate} ·{' '}
            {billing.paymentMethodLast4 ? (
              <>
                Card ending in{' '}
                <span className="font-mono font-semibold text-[#1C1F22]">{billing.paymentMethodLast4}</span>
              </>
            ) : (
              'No payment method on file'
            )}
          </p>
        </div>

        <div className="lg:col-span-5 rounded-xl bg-[#1C1F22] text-white p-5 space-y-2">
          <span className="label-caps text-[#F2A93B]">Billing Cycle</span>
          <p className="font-display font-bold text-[24px] capitalize">{billing.billingCycle}</p>
          {paid ? (
            <>
              <p className="text-[12px] text-[#A8A298]">
                {billing.subscriptionStatus === 'past_due'
                  ? 'Your last payment failed. Update your card to avoid interruption.'
                  : billing.cancelAtPeriodEnd
                    ? 'Your subscription will end at the close of this period.'
                    : live
                      ? 'Payments are handled securely by Stripe.'
                      : 'Choose a plan below to start your subscription.'}
              </p>
              {billing.paymentMethodLast4 || live ? (
                <button
                  type="button"
                  disabled={updating}
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      await onOpenPortal();
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-white text-[#1C1F22] text-[12.5px] font-semibold cursor-pointer"
                >
                  Manage billing
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-[12px] text-[#A8A298]">
              Payments are not connected yet, so plan changes are saved without charging a card.
            </p>
          )}
        </div>
      </section>

      {checkout === 'success' && (
        <div className="card-tier-1 p-4 text-[13.5px] text-[#2E8B57]">
          Payment received. Your plan updates in a few seconds; refresh if you do not see it yet.
        </div>
      )}
      {checkout === 'cancelled' && (
        <div className="card-tier-1 p-4 text-[13.5px] text-[#7A746B]">Checkout was cancelled. You were not charged.</div>
      )}

      {paid && !live && (
        <div className="flex items-center gap-2 text-[13px]">
          {(['monthly', 'annual'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={`px-3 py-1.5 rounded-lg border capitalize cursor-pointer ${cycle === c ? 'bg-[#1C1F22] text-white border-[#1C1F22]' : 'bg-white text-[#1C1F22] border-[#ECE6DC]'}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Plan Comparison */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((p) => {
          const isCurrent = billing.plan === p.tier;
          return (
            <div
              key={p.tier}
              className={`rounded-xl p-6 flex flex-col justify-between space-y-5 ${
                p.highlighted ? 'bg-white border-2 border-[#C8672B] shadow-lg' : 'card-tier-1'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="headline-md text-[#1C1F22]">{p.tier}</h3>
                  {p.highlighted && (
                    <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#FBEBDD] text-[#C8672B] border border-[#C8672B]/25">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="font-display font-extrabold text-[32px] text-[#1C1F22] tabular-nums">
                  ${p.price}
                  <span className="text-[13px] font-medium text-[#7A746B]"> / mo</span>
                </p>
                <p className="font-mono text-[12px] font-semibold text-[#C8672B]">
                  {p.minutes.toLocaleString()} minutes included
                </p>
                <p className="text-[13.5px] text-[#7A746B]">{p.desc}</p>
              </div>

              <button
                type="button"
                disabled={(isCurrent && (!paid || live)) || updating}
                onClick={async () => {
                  setUpdating(true);
                  try {
                    await onChangePlan(p.tier, cycle);
                  } finally {
                    setUpdating(false);
                  }
                }}
                className={`w-full py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer ${
                  isCurrent
                    ? 'bg-[#EBF6F0] text-[#2E8B57] border border-[#2E8B57]/25 cursor-default'
                    : p.highlighted
                      ? 'btn-primary'
                      : 'btn-secondary'
                }`}
              >
                {isCurrent && (!paid || live) ? 'Current Active Plan' : paid && !live ? `Subscribe to ${p.tier}` : `Switch to ${p.tier}`}
              </button>
            </div>
          );
        })}
      </section>

      {/* Invoices */}
      <section className="card-tier-1 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#ECE6DC]">
          <h3 className="headline-sm text-[#1C1F22]">Payment History</h3>
        </div>
        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-[#ECE6DC]">
          {billing.invoices.map((inv) => (
            <div key={inv.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[13px] font-semibold text-[#1C1F22]">{inv.id}</p>
                <p className="text-[12px] text-[#7A746B] mt-0.5">
                  {inv.date} · {inv.plan}
                </p>
              </div>
              <div className="text-right space-y-1">
                <p className="font-mono text-[14px] font-bold text-[#1C1F22]">${inv.amount}</p>
                <span className="inline-block px-2 py-0.5 rounded-full label-caps bg-[#EBF6F0] text-[#2E8B57] border border-[#2E8B57]/25">
                  {inv.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#ECE6DC]">
                <th className="py-3 px-5 label-caps text-[#7A746B]">Invoice ID</th>
                <th className="py-3 px-4 label-caps text-[#7A746B]">Date</th>
                <th className="py-3 px-4 label-caps text-[#7A746B]">Plan</th>
                <th className="py-3 px-4 label-caps text-[#7A746B]">Amount</th>
                <th className="py-3 px-5 label-caps text-[#7A746B]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE6DC]">
              {billing.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-3.5 px-5 font-mono text-[13px] font-semibold">{inv.id}</td>
                  <td className="py-3.5 px-4 text-[13px]">{inv.date}</td>
                  <td className="py-3.5 px-4 text-[13px]">{inv.plan}</td>
                  <td className="py-3.5 px-4 font-mono text-[13px] font-bold">${inv.amount}</td>
                  <td className="py-3.5 px-5">
                    <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#EBF6F0] text-[#2E8B57] border border-[#2E8B57]/25">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function IntegrationsPage({
  integrations,
}: {
  integrations: IntegrationStatusItem[];
}) {
  usePageSeo({
    title: 'Integrations — PlumbVoice AI',
    description: 'Connection status for System Number Telephony, Gemini Voice AI, SMS, Email, Google Calendar, and Stripe.',
    path: '/app/integrations',
    noindex: true,
  });

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-5 flex items-center gap-3">
        <Plug className="w-5 h-5 text-[#C8672B]" />
        <div>
          <h2 className="headline-sm text-[#1C1F22]">External Service Connections</h2>
          <p className="text-[13px] text-[#7A746B]">
            Live credential verification from your server environment. No API secrets are exposed in the browser.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {integrations.map((item) => (
          <div key={item.id} className="card-tier-1 p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="label-caps text-[#7A746B]">{item.category}</span>
                <h3 className="headline-sm text-[#1C1F22] mt-0.5">{item.name}</h3>
              </div>
              {item.connected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full label-caps bg-[#EBF6F0] text-[#2E8B57] border border-[#2E8B57]/25">
                  <CheckCircle2 className="w-3 h-3" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full label-caps bg-[#FEF6E8] text-[#B47010] border border-[#E9A23B]/35">
                  <ShieldAlert className="w-3 h-3" />
                  Setup Needed
                </span>
              )}
            </div>

            <p className="text-[13.5px] text-[#23282D]">{item.summary}</p>

            <div className="p-3.5 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-1.5">
              <p className="label-caps text-[#7A746B]">Configuration</p>
              <p className="text-[12.5px] text-[#23282D]">{item.setupInstructions}</p>
              <p className="font-mono text-[11px] text-[#C8672B] pt-1">
                Env vars: {item.envRequired.join(', ')}
              </p>
            </div>
          </div>
        ))}
      </div>

      <AutomationPanels />
    </div>
  );
}

export function ProfileSecurityPage({
  user,
  onUpdateName,
  onChangePassword,
  onForgetDevices,
}: {
  user: UserSession;
  onUpdateName: (name: string) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onForgetDevices: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [profileMsg, setProfileMsg] = useState<{ok: boolean; text: string} | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ok: boolean; text: string} | null>(null);
  const [busy, setBusy] = useState(false);

  usePageSeo({
    title: 'Profile & Account Security — PlumbVoice AI',
    description: 'Manage your contractor account details and password.',
    path: '/app/profile',
    noindex: true,
  });

  const banner = (m: {ok: boolean; text: string} | null) =>
    m && (
      <div
        role={m.ok ? 'status' : 'alert'}
        className={`rounded-xl px-4 py-3 text-[13px] font-semibold flex items-center gap-2 border ${
          m.ok
            ? 'bg-[#EBF6F0] border-[#2E8B57]/30 text-[#2E8B57]'
            : 'bg-[#FDF0F0] border-[#D64545]/30 text-[#D64545]'
        }`}
      >
        {m.ok && <CheckCircle2 className="w-4 h-4" />}
        <span>{m.text}</span>
      </div>
    );

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onUpdateName(name.trim());
      setProfileMsg({ok: true, text: 'Profile updated.'});
    } catch (err) {
      setProfileMsg({ok: false, text: err instanceof Error ? err.message : 'Could not update profile'});
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onChangePassword(current, next);
      setCurrent('');
      setNext('');
      setPwMsg({ok: true, text: 'Password changed. Your other sessions were signed out.'});
    } catch (err) {
      setPwMsg({ok: false, text: err instanceof Error ? err.message : 'Could not change password'});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <form onSubmit={saveProfile} className="card-tier-1 p-6 space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-[#ECE6DC]">
          <Shield className="w-5 h-5 text-[#C8672B]" />
          <h2 className="headline-md text-[#1C1F22]">Account</h2>
        </div>
        {banner(profileMsg)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="profile-name" className="label-caps text-[#7A746B] block mb-1.5">Full Name</label>
            <input id="profile-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="input-crafted w-full px-3" />
          </div>
          <div>
            <label htmlFor="profile-email" className="label-caps text-[#7A746B] block mb-1.5">
              Account Email {user.emailVerified ? '· Verified' : '· Not verified'}
            </label>
            <input id="profile-email" disabled value={user.email} className="input-crafted w-full px-3 bg-[#FAF7F2] text-[#7A746B]" />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary cursor-pointer">Save Profile</button>
        </div>
      </form>

      <form onSubmit={savePassword} className="card-tier-1 p-6 space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-[#ECE6DC]">
          <Lock className="w-5 h-5 text-[#C8672B]" />
          <h2 className="headline-md text-[#1C1F22]">Change Password</h2>
        </div>
        {banner(pwMsg)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="current-password" className="label-caps text-[#7A746B] block mb-1.5">Current Password</label>
            <input id="current-password" type={showPw ? 'text' : 'password'} required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input-crafted w-full px-3" />
          </div>
          <div>
            <label htmlFor="new-password" className="label-caps text-[#7A746B] block mb-1.5">New Password (8+ characters)</label>
            <input id="new-password" type={showPw ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="input-crafted w-full px-3" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-[#7A746B] cursor-pointer">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="checkbox-crafted" />
          Show passwords
        </label>
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary cursor-pointer">Update Password</button>
        </div>
      </form>

      <div className="card-tier-1 p-6 space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-[#ECE6DC]">
          <Shield className="w-5 h-5 text-[#C8672B]" />
          <h2 className="headline-md text-[#1C1F22]">Saved Devices &amp; Email Codes</h2>
        </div>
        <p className="text-[13px] text-[#7A746B]">
          On a device that isn’t saved, we email a 6-digit code when you sign in and before sensitive changes (password, billing, team).
          Saving a device skips the codes for 30 days.
        </p>
        <p className="text-[13px] font-semibold text-[#1C1F22]">
          This device: {user.deviceTrusted ? 'saved' : 'not saved'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onForgetDevices();
            } finally {
              setBusy(false);
            }
          }}
          className="btn-secondary cursor-pointer"
        >
          Forget all saved devices
        </button>
      </div>
    </div>
  );
}

const ONBOARDING_STEPS: {
  title: string;
  subtitle: string;
  scene: TradeSceneVariant;
  alt: string;
}[] = [
  {
    title: '1. Business Details & Trade Scope',
    subtitle: 'Confirm your shop name, primary phone line, and licensed plumbing/electrical service areas.',
    scene: 'owner-desk',
    alt: 'Business owner reviewing shop setup at desk',
  },
  {
    title: '2. Configure AI Voice Receptionist',
    subtitle: 'Set your greeting message, 20-second ring timeout, and emergency life-safety rules.',
    scene: 'water-heater',
    alt: 'Plumber servicing a residential water heater',
  },
  {
    title: '3. Connect Phone & Carrier Forwarding',
    subtitle: 'Forward unanswered calls from AT&T, Verizon, or T-Mobile to your AI line (the Telnyx number you assigned).',
    scene: 'service-van',
    alt: 'Contractor service truck parked outside home',
  },
  {
    title: '4. Test Your AI Agent Live',
    subtitle: 'Verify microphone, voice tone, and real-time emergency intake before turning on live traffic.',
    scene: 'electrical-panel',
    alt: 'Electrician checking 200A service panel',
  },
  {
    title: '5. Activate 24/7 Lead Capture',
    subtitle: 'Confirm integration readiness and go live so zero customer calls hit voicemail tonight.',
    scene: 'tablet-leads',
    alt: 'Technician reviewing captured leads on tablet',
  },
];

export function OnboardingWizardPage({
  workspace,
  integrations,
  onSaveAgent,
  onSavePhone,
  onCompleteOnboarding,
  onSkip,
  onNavigate,
}: {
  workspace: TenantWorkspace;
  integrations: IntegrationStatusItem[];
  onSaveAgent: (patch: Partial<TenantWorkspace['voiceAgent']>) => Promise<void>;
  onSavePhone: (patch: Partial<TenantWorkspace['phoneSetup']>) => Promise<void>;
  onCompleteOnboarding: () => Promise<void>;
  onSkip: () => void;
  onNavigate: (path: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [bizName, setBizName] = useState(workspace.voiceAgent.businessName);
  const [bizPhone, setBizPhone] = useState(workspace.voiceAgent.businessPhone);
  const [greeting, setGreeting] = useState(workspace.voiceAgent.greetingMessage);
  const [carrier, setCarrier] = useState(workspace.phoneSetup.carrier);
  const [finishing, setFinishing] = useState(false);

  usePageSeo({
    title: '5-Step Onboarding Wizard — PlumbVoice AI',
    description: 'Set up your AI contractor receptionist in 5 guided steps.',
    path: '/app/onboarding',
    noindex: true,
  });

  const current = ONBOARDING_STEPS[step];
  const progressPct = Math.round(((step + 1) / ONBOARDING_STEPS.length) * 100);

  const handleNext = async () => {
    if (step === 0) {
      await onSaveAgent({businessName: bizName, businessPhone: bizPhone});
    } else if (step === 1) {
      await onSaveAgent({greetingMessage: greeting});
    } else if (step === 2) {
      await onSavePhone({carrier, businessPhone: bizPhone});
    }

    if (step < ONBOARDING_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      setFinishing(true);
      await onCompleteOnboarding();
      setFinishing(false);
      onNavigate('/app/overview');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Copper Progress Bar */}
      <div className="card-tier-1 p-5 space-y-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className="label-caps text-[#C8672B]">
            Setup Progress · Step {step + 1} of 5
          </span>
          <span className="font-mono font-bold text-[#1C1F22]">{progressPct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-[#FAF7F2] border border-[#ECE6DC] overflow-hidden">
          <div
            className="h-full bg-[#C8672B] transition-all duration-300"
            style={{width: `${progressPct}%`}}
          />
        </div>
      </div>

      {/* Wizard Card */}
      <div className="card-tier-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <TradeSceneArtwork
            variant={current.scene}
            alt={current.alt}
            className="h-56 lg:h-full w-full"
          />
        </div>

        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <h2 className="headline-md text-[#1C1F22]">{current.title}</h2>
            <p className="text-[14px] text-[#7A746B]">{current.subtitle}</p>

            {step === 0 && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Business Name</label>
                  <input value={bizName} onChange={(e) => setBizName(e.target.value)} className="input-crafted w-full px-3" />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Main Business Phone</label>
                  <input value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} className="input-crafted w-full px-3 font-mono" />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-2 pt-2">
                <label className="label-caps text-[#7A746B] block">AI Receptionist Greeting</label>
                <textarea rows={4} value={greeting} onChange={(e) => setGreeting(e.target.value)} className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px]" />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Your Phone Carrier</label>
                  <select value={carrier} onChange={(e) => setCarrier(e.target.value as TenantWorkspace['phoneSetup']['carrier'])} className="input-crafted w-full px-3">
                    <option value="AT&T">AT&amp;T</option>
                    <option value="Verizon">Verizon</option>
                    <option value="T-Mobile">T-Mobile</option>
                    <option value="RingCentral">RingCentral</option>
                    <option value="Grasshopper">Grasshopper</option>
                  </select>
                </div>
                <div className="p-3.5 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] text-[13px] space-y-1">
                  <p>
                    Demo System Number: <strong className="font-mono text-[#1C1F22]">{workspace.phoneSetup.systemNumber}</strong> <SimulatedNumberBadge className="ml-1" />
                  </p>
                  <p className="text-[12px] text-[#7A746B]">
                    This demo number is simulated and cannot take real calls. Connect your live Telnyx number before forwarding customers.
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#ECE6DC] space-y-3">
                <p className="text-[13.5px] text-[#23282D]">
                  Open the live Voice Agent Tester to speak into your mic or run a burst pipe / sparking outlet scenario.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('/app/test-agent')}
                  className="btn-secondary text-[13px] cursor-pointer"
                >
                  Launch Test Your AI Agent →
                </button>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-2.5 pt-1">
                {integrations.slice(0, 4).map((int) => (
                  <div key={int.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] text-[13px]">
                    <span className="font-medium text-[#1C1F22]">{int.name}</span>
                    <span className={int.connected ? 'text-[#2E8B57] font-semibold' : 'text-[#B47010] font-semibold'}>
                      {int.connected ? 'Connected' : 'Optional / Env Needed'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#ECE6DC] flex items-center justify-between">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="btn-secondary text-[13px] disabled:opacity-40 cursor-pointer"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={finishing}
                onClick={onSkip}
                className="px-3 py-2 text-[13px] font-semibold text-[#7A746B] hover:text-[#1C1F22] disabled:opacity-40 cursor-pointer"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={finishing}
                onClick={handleNext}
                className="btn-primary text-[13px] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>
                  {step === ONBOARDING_STEPS.length - 1
                    ? finishing
                      ? 'Activating…'
                      : 'Activate PlumbVoice AI'
                    : 'Save & Continue'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
