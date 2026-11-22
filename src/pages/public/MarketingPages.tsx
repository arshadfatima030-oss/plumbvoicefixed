import {useState} from 'react';
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react';
import {TradeSceneArtwork} from '../../components/TradeVisuals';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';

interface MarketingPageProps {
  onNavigate: (path: string) => void;
  onGetStarted: () => void;
}

export function HowItWorksPage({onNavigate, onGetStarted}: MarketingPageProps) {
  usePageSeo({
    title: 'How PlumbVoice AI Works — 24/7 Call Forwarding & Triage',
    description:
      'See how PlumbVoice AI answers unanswered contractor calls in under 20 seconds, captures lead details, and escalates emergencies.',
    path: '/how-it-works',
  });

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-14">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-5">
          <span className="label-caps text-[#C8672B]">How It Works</span>
          <h1 className="font-display font-extrabold text-[36px] sm:text-[42px] leading-tight text-[#1C1F22]">
            Keep Your Existing Business Number. Capture Every Ring You Cannot Answer.
          </h1>
          <p className="text-[16px] leading-relaxed text-[#7A746B]">
            PlumbVoice AI connects behind your current AT&T, Verizon, T-Mobile, or RingCentral line using conditional call forwarding—answering only when you are busy, on a ladder, or off the clock.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => onNavigate('/signup')} className="btn-primary text-[14px] cursor-pointer">
              Start Free Trial
            </button>
            <button type="button" onClick={onGetStarted} className="btn-secondary text-[14px] cursor-pointer">
              Test Live AI Agent
            </button>
          </div>
        </div>
        <div className="lg:col-span-5 rounded-xl overflow-hidden border border-[#ECE6DC]">
          <TradeSceneArtwork
            variant="service-van"
            alt="Contractor service van parked outside an American home"
            className="h-72 w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {step: '01', title: 'Customer Dials Your Shop', body: 'Your office or cell phone rings normally for 20 seconds (4 rings). If your team picks up, PlumbVoice stays silent.'},
          {step: '02', title: 'Conditional Forward to Nora', body: 'If unanswered or after hours, your carrier forwards the call to your PlumbVoice AI line (a Telnyx number you connect to your account).'},
          {step: '03', title: 'Structured Trade Triage', body: 'Nora collects name, phone, street address, ZIP, service scope, urgency, and preferred arrival window.'},
          {step: '04', title: 'Lead Saved & Tech Notified', body: 'Transcript, recording, and urgency summary land in your dashboard while SMS alerts reach your on-call tech.'},
        ].map((item) => (
          <div key={item.step} className="card-tier-1 p-6 space-y-2.5">
            <span className="font-mono font-bold text-[13px] text-[#C8672B]">{item.step}.</span>
            <h2 className="headline-sm text-[#1C1F22]">{item.title}</h2>
            <p className="text-[14px] text-[#7A746B] leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeaturesPage({onNavigate}: MarketingPageProps) {
  usePageSeo({
    title: 'PlumbVoice AI Features — Voice Receptionist & Lead CRM',
    description:
      'Explore 24/7 AI call answering, emergency keyword routing, consent-based SMS text-back, technician calendar, and analytics.',
    path: '/features',
  });

  const features = [
    {title: '24/7 Natural Voice Answering', desc: 'Answers every inbound call in clear American English within 1–2 rings—nights, weekends, and holidays.'},
    {title: 'Emergency Hazard Guardrails', desc: 'Recognizes burst pipes, gas leaks, sparking outlets, and warm breaker panels, providing safe shutoff guidance without dangerous advice.'},
    {title: 'Complete Lead Extraction', desc: 'Automatically verifies caller name, callback phone, ZIP code, street address, service type, and preferred window.'},
    {title: 'Call Recordings & Transcripts', desc: 'Every AI-answered call includes synchronized audio playback, searchable transcript, and AI summary.'},
    {title: 'Consent-Based Missed-Call SMS', desc: 'Automatically follows up with callers who hang up early, with built-in TCPA opt-out compliance.'},
    {title: 'Appointments & Team Routing', desc: 'Assign leads to plumbers or electricians by trade specialty, schedule windows, and sync with Google Calendar.'},
  ];

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="max-w-3xl space-y-3">
        <span className="label-caps text-[#C8672B]">Platform Features</span>
        <h1 className="font-display font-extrabold text-[36px] sm:text-[42px] text-[#1C1F22]">
          Every Tool Required to Capture and Convert Inbound Trade Calls
        </h1>
        <p className="text-[16px] text-[#7A746B]">
          Purpose-built for home service contractors—no bloated CRM complexity, no generic chatbots.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f) => (
          <div key={f.title} className="card-tier-1 p-6 space-y-2.5">
            <h2 className="headline-sm text-[#1C1F22]">{f.title}</h2>
            <p className="text-[14px] text-[#7A746B] leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="card-tier-1 p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="headline-md text-[#1C1F22]">Ready to test your own greeting and emergency rules?</h2>
          <p className="text-[14px] text-[#7A746B] mt-1">Start a 14-day free trial or dial our live demo line.</p>
        </div>
        <button type="button" onClick={() => onNavigate('/signup')} className="btn-primary whitespace-nowrap cursor-pointer">
          Start Free Trial
        </button>
      </div>
    </div>
  );
}

export function PlumbingSolutionsPage({onNavigate}: MarketingPageProps) {
  usePageSeo({
    title: 'AI Answering Service for Plumbers — PlumbVoice AI',
    description:
      'Capture burst pipe emergencies, water heater replacements, slab leaks, and drain cleaning calls 24/7 with PlumbVoice AI.',
    path: '/plumbing-answering-service',
  });

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-5">
          <div className="inline-flex items-center gap-2 text-[#C8672B] label-caps">
            <Wrench className="w-4 h-4" />
            <span>Plumbing Answering Service</span>
          </div>
          <h1 className="font-display font-extrabold text-[36px] sm:text-[42px] leading-tight text-[#1C1F22]">
            AI Answering Service for Plumbers Who Cannot Answer Under a Sink
          </h1>
          <p className="text-[16px] text-[#7A746B] leading-relaxed">
            When water is flooding a kitchen or a tankless heater throws an error code, homeowners do not leave voicemails. PlumbVoice AI answers immediately, guides emergency shutoff safety, and books your next available truck.
          </p>
          <button type="button" onClick={() => onNavigate('/signup')} className="btn-primary cursor-pointer">
            Start Free Plumbing Trial
          </button>
        </div>
        <div className="lg:col-span-5 rounded-xl overflow-hidden border border-[#ECE6DC]">
          <TradeSceneArtwork
            variant="copper-pipes"
            alt="Copper plumbing pipes and brass shutoff valves close-up"
            className="h-72 w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {title: 'Burst Pipes & Slab Leaks', desc: 'Collects shutoff status, standing water details, and street address for immediate emergency escalation.'},
          {title: 'Water Heater & Tankless Calls', desc: 'Captures fuel type (gas/electric), error codes, unit location, and age before your tech rolls out.'},
          {title: 'Sewer & Hydro-Jetting Leads', desc: 'Qualifies main line backups vs single-fixture clogs and captures ZIP codes inside your service radius.'},
        ].map((c) => (
          <div key={c.title} className="card-tier-1 p-6 space-y-2">
            <h2 className="headline-sm text-[#1C1F22]">{c.title}</h2>
            <p className="text-[14px] text-[#7A746B] leading-relaxed">{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ElectricalSolutionsPage({onNavigate}: MarketingPageProps) {
  usePageSeo({
    title: 'AI Receptionist for Electricians — PlumbVoice AI',
    description:
      '24/7 AI answering service for electrical contractors. Triage sparking outlets, 200A panel faults, outages, and EV charger leads.',
    path: '/electrician-answering-service',
  });

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-5">
          <div className="inline-flex items-center gap-2 text-[#B47010] label-caps">
            <Zap className="w-4 h-4 text-[#F2A93B]" />
            <span>Electrical Answering Service</span>
          </div>
          <h1 className="font-display font-extrabold text-[36px] sm:text-[42px] leading-tight text-[#1C1F22]">
            AI Receptionist for Electricians Built Around Life-Safety Triage
          </h1>
          <p className="text-[16px] text-[#7A746B] leading-relaxed">
            Never tell a homeowner to open a live breaker box. PlumbVoice AI enforces strict electrical safety scripts for sparking outlets, burning odors, and partial outages while capturing high-margin EV charger and panel upgrade leads.
          </p>
          <button type="button" onClick={() => onNavigate('/signup')} className="btn-primary cursor-pointer">
            Start Free Electrical Trial
          </button>
        </div>
        <div className="lg:col-span-5 rounded-xl overflow-hidden border border-[#ECE6DC]">
          <TradeSceneArtwork
            variant="outlet-install"
            alt="Electrician testing GFCI outlet and breaker circuit"
            className="h-72 w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {title: 'Sparking Outlets & Burning Smells', desc: 'Immediately warns callers not to touch outlets or panels and escalates to your on-call master electrician.'},
          {title: '200A / 400A Panel Upgrades', desc: 'Captures panel brand, current amperage, and home square footage for qualified estimator callbacks.'},
          {title: 'EV Charger Installations', desc: 'Books Level 2 garage charger consultations and captures charger model and breaker availability.'},
        ].map((c) => (
          <div key={c.title} className="card-tier-1 p-6 space-y-2">
            <h2 className="headline-sm text-[#1C1F22]">{c.title}</h2>
            <p className="text-[14px] text-[#7A746B] leading-relaxed">{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PricingPage({onNavigate}: MarketingPageProps) {
  const [annual, setAnnual] = useState(false);

  usePageSeo({
    title: 'PlumbVoice AI Pricing — Plans for Plumbing & Electrical Shops',
    description:
      'Transparent monthly and annual pricing for Starter, Professional, and Business AI phone receptionist plans.',
    path: '/pricing',
  });

  const plans = [
    {
      name: 'Starter',
      monthly: 69,
      annual: 58,
      target: 'Solo & 1–2 truck shops',
      minutes: '250 AI voice minutes / mo',
      features: ['24/7 AI answering & intake', 'Emergency SMS & owner alerts', 'Custom emergency rules', 'Call recordings & transcripts', 'Lead capture CRM', 'Team members & roles', 'Call quality analytics', 'Works with your existing business number via carrier forwarding'],
      highlighted: false,
    },
    {
      name: 'Professional',
      monthly: 169,
      annual: 141,
      target: 'Growing 3–10 truck teams',
      minutes: '1,000 AI voice minutes / mo',
      features: ['Everything in Starter', 'Missed-call text-back (TCPA)', 'Google Calendar booking', 'Ring my phone first (20 sec)', 'Webhooks (Zapier, CRM)', 'Website knowledge import', 'Text booking links during calls'],
      highlighted: true,
    },
    {
      name: 'Business',
      monthly: 299,
      annual: 249,
      target: 'Multi-branch contractors',
      minutes: '2,000 AI voice minutes / mo',
      features: ['Everything in Professional', 'Multi-location routing by ZIP code', 'Alert number & hours per location', 'Leads reported by location'],
      highlighted: false,
    },
  ];

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="text-center max-w-2xl mx-auto space-y-4">
        <span className="label-caps text-[#C8672B]">Simple Contractor Pricing</span>
        <h1 className="font-display font-extrabold text-[36px] sm:text-[42px] text-[#1C1F22]">
          One Booked Emergency Pays for the Entire Year
        </h1>
        <div className="inline-flex items-center gap-1 p-1 bg-white border border-[#ECE6DC] rounded-lg">
          <button
            type="button"
            onClick={() => setAnnual(false)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-semibold cursor-pointer ${
              !annual ? 'bg-[#1C1F22] text-white' : 'text-[#7A746B]'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-semibold cursor-pointer ${
              annual ? 'bg-[#1C1F22] text-white' : 'text-[#7A746B]'
            }`}
          >
            Annual (Save ~16%)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((p) => (
          <div
            key={p.name}
            className={`rounded-xl p-7 flex flex-col justify-between space-y-6 ${
              p.highlighted
                ? 'bg-white border-2 border-[#C8672B] shadow-xl'
                : 'card-tier-1'
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="headline-md text-[#1C1F22]">{p.name}</h2>
                {p.highlighted && (
                  <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#FBEBDD] text-[#C8672B] border border-[#C8672B]/25">
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#7A746B]">{p.target}</p>
              <p className="font-display font-extrabold text-[38px] text-[#1C1F22] tabular-nums">
                ${annual ? p.annual : p.monthly}
                <span className="text-[14px] font-medium text-[#7A746B]"> / month</span>
              </p>
              <p className="font-mono text-[12px] font-semibold text-[#C8672B]">{p.minutes}</p>
              <ul className="space-y-2.5 pt-2 border-t border-[#ECE6DC] text-[14px] text-[#23282D]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2E8B57] shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className={`w-full py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer ${
                p.highlighted ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              Start 14-Day Free Trial
            </button>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[13px] leading-relaxed text-[#7A746B] max-w-3xl">
        Phone numbers: you keep your existing business number and forward unanswered calls to your AI line. The AI line is a Telnyx number you buy and connect yourself; Telnyx and carrier charges (numbers, minutes, texting registration) are billed separately and are not included in these plans. The demo System Number inside the app is a simulated placeholder.
      </p>
    </div>
  );
}

export function AboutContactPage({isContact}: {isContact?: boolean; onNavigate: (p: string) => void}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [trade, setTrade] = useState('Plumbing & Electrical');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  usePageSeo({
    title: isContact
      ? 'Contact PlumbVoice AI — Book a Contractor Demo'
      : 'About PlumbVoice AI — Built for American Contractors',
    description:
      'Austin-based team building reliable 24/7 AI phone receptionists for US plumbing and electrical service contractors.',
    path: isContact ? '/contact' : '/about',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');
    try {
      await apiRequest('/api/public/contact', {
        method: 'POST',
        body: JSON.stringify({name, email, company, trade, message}),
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit message.');
    }
  };

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div className="lg:col-span-6 space-y-6">
        <span className="label-caps text-[#C8672B]">
          {isContact ? 'Contact & Demo' : 'About PlumbVoice AI'}
        </span>
        <h1 className="font-display font-extrabold text-[36px] leading-tight text-[#1C1F22]">
          Built in Austin, TX for Hardworking US Trade Businesses
        </h1>
        <p className="text-[15px] leading-relaxed text-[#7A746B]">
          We started PlumbVoice AI after watching local plumbing and electrical contractors spend thousands on Local Services Ads only to lose emergency calls to generic voicemail while out on jobs.
        </p>

        <div className="rounded-xl overflow-hidden border border-[#ECE6DC]">
          <TradeSceneArtwork
            variant="owner-desk"
            alt="Plumbing contractor reviewing customer leads at desk"
            className="h-56 w-full"
          />
        </div>

        <div className="card-tier-1 p-5 space-y-2 text-[14px]">
          <p className="font-display font-bold text-[#1C1F22]">PlumbVoice AI Inc.</p>
          <p className="text-[#7A746B] flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#C8672B]" />
            <span>2418 South Congress Ave, Suite B, Austin, TX 78704</span>
          </p>
        </div>
      </div>

      <div className="lg:col-span-6 card-tier-1 p-6 sm:p-8">
        <h2 className="headline-md text-[#1C1F22]">Request a Live Demo or Contact Sales</h2>
        <p className="text-[14px] text-[#7A746B] mt-1 mb-6">
          Tell us about your truck count and current phone carrier—we will reply within 1 business hour.
        </p>

        {status === 'sent' && (
          <div className="mb-5 rounded-lg bg-[#EBF6F0] border border-[#2E8B57]/30 p-4 text-[14px] font-medium text-[#2E8B57] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Message received. Our Austin onboarding specialist will reach out shortly.</span>
          </div>
        )}
        {status === 'error' && (
          <div className="mb-5 rounded-lg bg-[#FDF0F0] border border-[#D64545]/30 p-4 text-[14px] font-medium text-[#D64545] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-name" className="label-caps text-[#7A746B] block mb-1.5">
                Your Name
              </label>
              <input
                id="contact-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-crafted w-full px-3"
                placeholder="Ray Callahan"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className="label-caps text-[#7A746B] block mb-1.5">
                Work Email
              </label>
              <input
                id="contact-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-crafted w-full px-3"
                placeholder="ray@austincopper.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-company" className="label-caps text-[#7A746B] block mb-1.5">
                Business Name
              </label>
              <input
                id="contact-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="input-crafted w-full px-3"
                placeholder="Austin Copper Plumbing"
              />
            </div>
            <div>
              <label htmlFor="contact-trade" className="label-caps text-[#7A746B] block mb-1.5">
                Primary Trade
              </label>
              <select
                id="contact-trade"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                className="input-crafted w-full px-3"
              >
                <option>Plumbing</option>
                <option>Electrical</option>
                <option>Plumbing &amp; Electrical</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="contact-msg" className="label-caps text-[#7A746B] block mb-1.5">
              How Can We Help?
            </label>
            <textarea
              id="contact-msg"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px] text-[#23282D] focus:outline-none focus:border-[#C8672B]"
              placeholder="Tell us about your truck count, carrier, and call volume..."
            />
          </div>

          <button
            type="submit"
            disabled={status === 'sending'}
            className="btn-primary w-full text-[14px] cursor-pointer"
          >
            {status === 'sending' ? 'Sending…' : 'Request Contractor Demo'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function BlogPage({onNavigate}: MarketingPageProps) {
  usePageSeo({
    title: 'Contractor Lead Generation Blog — PlumbVoice AI',
    description:
      'Practical guides on missed calls, emergency electrical dispatch, and AI receptionists vs traditional answering services.',
    path: '/blog',
  });

  const articles = [
    {
      title: 'How Many Calls Do Plumbers Miss Each Week (And What It Costs)',
      read: '5 min read · Plumbing Operations',
      excerpt:
        'Every unanswered call is a customer who may call the next shop. Here is how to count your own missed calls, price them with your average job ticket, and decide what answering them is worth.',
    },
    {
      title: 'How to Never Miss an Emergency Electrical Call After 6 PM',
      read: '4 min read · Electrical Safety',
      excerpt:
        'A simple conditional forwarding setup paired with strict life-safety triage rules ensures sparking outlets and warm main panels reach your on-call master electrician in seconds.',
    },
    {
      title: 'AI Receptionist vs Traditional Answering Service for Contractors',
      read: '6 min read · Industry Comparison',
      excerpt:
        'Compare 7-minute call-center hold times and misspelled notes against instant 1.3-ring intake with verified ZIP codes and structured dispatch transcripts.',
    },
  ];

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-10">
      <div className="max-w-2xl">
        <span className="label-caps text-[#C8672B]">Contractor Resources</span>
        <h1 className="font-display font-extrabold text-[36px] text-[#1C1F22] mt-1">
          Playbooks for Plumbing &amp; Electrical Growth
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {articles.map((art) => (
          <article key={art.title} className="card-tier-1 p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <p className="text-[12px] text-[#7A746B]">{art.read}</p>
              <h2 className="headline-sm text-[#1C1F22]">{art.title}</h2>
              <p className="text-[14px] text-[#7A746B] leading-relaxed">{art.excerpt}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
            >
              <span>Try PlumbVoice AI Free</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

const CITY_INFO: Record<string, {city: string; state: string; detail: string}> = {
  'houston-tx': {
    city: 'Houston',
    state: 'TX',
    detail: 'Serving Greater Houston plumbers & electricians from Katy to The Woodlands—handling freeze pipe bursts, slab leaks, and storm outage triage.',
  },
  'austin-tx': {
    city: 'Austin',
    state: 'TX',
    detail: 'Built in Austin for Travis and Williamson County contractors handling tankless water heaters, limestone slab leaks, and 200A EV upgrades.',
  },
  'phoenix-az': {
    city: 'Phoenix',
    state: 'AZ',
    detail: 'Supporting Valley of the Sun electrical & plumbing fleets through peak summer grid strain, breaker trips, and main water line repairs.',
  },
  'denver-co': {
    city: 'Denver',
    state: 'CO',
    detail: 'Helping Front Range contractors capture overnight frozen pipe calls, boiler emergencies, and panel service upgrades.',
  },
};

export function CityLandingPage({
  citySlug,
  onNavigate,
}: {
  citySlug: string;
  onNavigate: (p: string) => void;
}) {
  const info = CITY_INFO[citySlug] || {
    city: 'Houston',
    state: 'TX',
    detail: '24/7 AI answering service for local plumbing and electrical contractors.',
  };

  usePageSeo({
    title: `AI Answering Service for Plumbers in ${info.city}, ${info.state}`,
    description: `Never miss an emergency plumbing or electrical call in ${info.city}, ${info.state}. 24/7 AI phone receptionist for local contractors.`,
    path: `/cities/${citySlug}`,
  });

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-10">
      <div className="card-tier-1 p-8 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-4">
          <span className="label-caps text-[#C8672B]">
            Local Market · {info.city}, {info.state}
          </span>
          <h1 className="font-display font-extrabold text-[34px] sm:text-[40px] leading-tight text-[#1C1F22]">
            AI Answering Service for Plumbers &amp; Electricians in {info.city}, {info.state}
          </h1>
          <p className="text-[16px] text-[#7A746B] leading-relaxed">{info.detail}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button type="button" onClick={() => onNavigate('/signup')} className="btn-primary cursor-pointer">
              Start Free Trial in {info.city}
            </button>
            <button type="button" onClick={() => onNavigate('/contact')} className="btn-secondary cursor-pointer">
              Book Local Demo
            </button>
          </div>
        </div>
        <div className="lg:col-span-5 rounded-xl overflow-hidden border border-[#ECE6DC]">
          <TradeSceneArtwork
            variant="contractor-phone"
            alt={`Contractor answering dispatch in ${info.city}, ${info.state}`}
            className="h-64 w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 text-[13px] text-[#7A746B]">
        <ShieldCheck className="w-4 h-4 text-[#2E8B57]" />
        <span>Also available in Austin TX, Houston TX, Phoenix AZ, Denver CO, and all 50 US states.</span>
      </div>
    </div>
  );
}
