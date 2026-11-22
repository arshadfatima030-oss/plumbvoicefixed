import {useEffect, useState} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  PhoneCall,
  ShieldAlert,
  Sparkles,
  Truck,
  Wrench,
  Zap,
} from 'lucide-react';
import {TradeSceneArtwork} from '../../components/TradeVisuals';
import {usePageSeo} from '../../lib/seo';

interface HomePageProps {
  onNavigate: (path: string) => void;
  onGetStarted: () => void;
}

const DEMO_SCRIPTS = {
  Plumbing: [
    {speaker: 'agent', text: 'Austin Copper Plumbing & Electric, this is Nora, your automated dispatch assistant. Are you calling about an active emergency or a scheduled visit?'},
    {speaker: 'caller', text: "Water is spraying out under our kitchen sink and soaking the cabinet floor. Can someone come right now?"},
    {speaker: 'agent', text: "I'm flagging this as an emergency plumbing dispatch now. If safe, please close the shutoff valve under the sink or your main street valve. What's your address and ZIP?"},
    {speaker: 'caller', text: '1408 Barton Hills Drive, 78704. My name is Karen Jenkins, 512-555-0174.'},
    {speaker: 'agent', text: 'Thank you, Karen. I have captured your address and alerted our on-call plumber, Michael O’Connell, who is receiving your details by SMS now.'},
  ],
  Electrical: [
    {speaker: 'agent', text: 'Austin Copper Plumbing & Electric, this is Nora, your automated dispatch assistant. How can I help with your plumbing or electrical system?'},
    {speaker: 'caller', text: 'Our kitchen GFCI outlet just sparked when we plugged in a toaster, and the main panel in the garage feels warm.'},
    {speaker: 'agent', text: 'For your safety, please leave that outlet unplugged and do not open or touch the electrical panel. Are you smelling any smoke or burning?'},
    {speaker: 'caller', text: 'No smoke yet. I am Arthur Pendelton at 3310 Bee Cave Road, 78746, callback 512-555-0117.'},
    {speaker: 'agent', text: 'Understood, Arthur. I have escalated this as an electrical safety priority and paged our on-call master electrician right away.'},
  ],
};

const FAQ_ITEMS = [
  {
    q: 'Does PlumbVoice AI replace my existing business phone number?',
    a: 'No. You keep the exact business phone number on your trucks, yard signs, and Google Business Profile. When your crew cannot answer within your ring timeout (default 20 seconds) or after hours, your carrier forwards seamlessly to PlumbVoice AI.',
  },
  {
    q: 'Does the AI ever pretend to be human or quote wrong repair prices?',
    a: 'Never. PlumbVoice AI identifies clearly as an automated dispatch assistant, follows strict intake guardrails, never guesses technical diagnoses, and never quotes binding prices without verified rules.',
  },
  {
    q: 'What happens during dangerous emergencies like burst pipes or sparking panels?',
    a: 'Emergency keywords immediately trigger safe homeowner instructions (such as turning off the main water valve or keeping clear of an electrical panel without attempting repairs), mark the lead Emergency, and send an instant SMS alert to your on-call technician.',
  },
  {
    q: 'How long does onboarding take for a 1–15 truck contractor?',
    a: 'Most shops finish the 5-step setup wizard—business hours, emergency rules, voice selection, carrier forwarding, and live test call—in under 12 minutes.',
  },
];

export function HomePage({onNavigate, onGetStarted}: HomePageProps) {
  const [weeklyMissed, setWeeklyMissed] = useState(12);
  const [avgTicket, setAvgTicket] = useState(460);
  const [demoTrade, setDemoTrade] = useState<'Plumbing' | 'Electrical'>('Plumbing');
  const [visibleLines, setVisibleLines] = useState(3);
  const [compareSplit, setCompareSplit] = useState(58);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  usePageSeo({
    title: 'PlumbVoice AI — AI Answering Service for Plumbers & Electricians',
    description:
      'Never miss another customer call. PlumbVoice AI answers 24/7, captures every plumbing and electrical lead, dispatches emergencies, and grows your business.',
    path: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {'@type': 'Answer', text: item.a},
      })),
    },
  });

  useEffect(() => {
    setVisibleLines(2);
    const timer = window.setInterval(() => {
      setVisibleLines((prev) => (prev >= 5 ? 5 : prev + 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [demoTrade]);

  const monthlyRecoverable = Math.round(weeklyMissed * 4.33 * avgTicket * 0.85);

  return (
    <div>
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden bg-[#1C1F22] text-[#FAF7F2]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 items-center">
          <div className="lg:col-span-7 space-y-5 sm:space-y-6">
            <p className="label-caps text-[#F2A93B]">
              24/7 AI Receptionist for Plumbing &amp; Electrical Contractors
            </p>
            <h1 className="font-display font-extrabold text-[28px] sm:text-[42px] lg:text-[50px] leading-[1.12] tracking-[-0.03em] text-white text-balance">
              Never Miss Another Customer Call. Let AI Answer, Capture Every Lead, and Help Grow Your Business, 24/7.
            </h1>
            <p className="text-[15.5px] sm:text-[17px] leading-[1.6] sm:leading-[1.65] text-[#C8C3BA] max-w-2xl">
              Stop losing high-ticket slab leaks, water heater emergencies, and 200A panel calls while you are under a sink or on a ladder. PlumbVoice AI answers the calls your crew cannot take (via carrier forwarding to your AI line), captures addresses, and alerts your on-call crew.
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('/signup')}
                className="btn-primary inline-flex items-center justify-center gap-2 text-[15px] cursor-pointer"
              >
                <span>Start Free Trial</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/how-it-works')}
                className="px-5 py-2.5 rounded-lg text-[14px] font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/15 transition-colors text-center cursor-pointer"
              >
                See How It Works
              </button>
            </div>

            <div className="pt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] sm:text-[13px] text-[#A8A298] border-t border-white/10">
              <span>Answers in 1.3 rings</span>
              <span aria-hidden="true">·</span>
              <span>Built-in US System Number</span>
              <span aria-hidden="true">·</span>
              <span>Zero hardware changes</span>
            </div>
          </div>

          {/* Right Hero Scene + Floating Animated Lead Card matching Stitch */}
          <div className="lg:col-span-5 relative">
            <div className="rounded-xl overflow-hidden border border-white/15 shadow-2xl">
              <TradeSceneArtwork
                variant="kitchen-sink"
                alt="Plumber repairing copper supply pipes under a kitchen sink"
                className="h-[250px] sm:h-[380px] w-full"
                kenBurns
              />
            </div>

            {/* Floating Incoming Call & Immediate Lead Value Card */}
            <div className="mt-4 sm:mt-0 sm:absolute sm:-bottom-5 sm:-left-6 sm:right-6 rounded-xl bg-[#1C1F22]/95 backdrop-blur-md border border-[#F2A93B]/35 p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FDF0F0] text-[#D64545] label-caps">
                  <AlertTriangle className="w-3 h-3" />
                  Emergency Captured
                </span>
                <span className="font-mono text-[12px] text-[#F2A93B] tabular-nums">
                  Picked up in 4s
                </span>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-3">
                <div>
                  <p className="label-caps text-[#A8A298]">Immediate Lead Value</p>
                  <p className="font-display font-bold text-[15px] sm:text-[16px] text-white mt-0.5">
                    Tankless &amp; Copper Main Burst
                  </p>
                </div>
                <span className="font-display font-extrabold text-[20px] sm:text-[22px] text-[#F2A93B] tabular-nums shrink-0">
                  $2,850+
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. THE PROBLEM + INTERACTIVE REVENUE CALCULATOR (Stitch Screenshot Match) */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <span className="label-caps text-[#C8672B]">The Missed-Call Revenue Leak</span>
            <h2 className="font-display font-bold text-[28px] sm:text-[36px] leading-tight text-[#1C1F22]">
              Every Missed Call Is a Job Your Competitor Can Win
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#FDF0F0] border border-[#D64545]/25 text-[#D64545] text-[13px] font-semibold self-start">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Callers who reach no one often try the next listing</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card-tier-1 p-6 space-y-3">
            <span className="label-caps text-[#7A746B]">Example Ticket Value</span>
            <p className="font-display font-extrabold text-[32px] text-[#1C1F22] tabular-nums">
              $1,850 – $4,200
            </p>
            <p className="text-[14px] leading-relaxed text-[#7A746B]">
              Illustrative range only. A single missed sewer line inspection, water heater swap, or 200A panel upgrade can be worth a lot to your business; use your own average ticket in the calculator below.
            </p>
          </div>

          <div className="card-tier-1 p-6 space-y-3">
            <span className="label-caps text-[#7A746B]">Answering Services</span>
            <p className="font-display font-extrabold text-[32px] text-[#1C1F22] tabular-nums">
              Hold times
            </p>
            <p className="text-[14px] leading-relaxed text-[#7A746B]">
              Outsourced answering services put panicked callers on hold, misspell street names, and cannot distinguish a tripped breaker from an arcing main lug.
            </p>
          </div>

          <div className="rounded-xl overflow-hidden border border-[#ECE6DC]">
            <TradeSceneArtwork
              variant="homeowner-call"
              alt="Friendly homeowner calling a local plumber from her kitchen"
              className="h-full min-h-[200px] w-full"
            />
          </div>
        </div>

        {/* Recaptured Emergency Call Revenue Calculator (Matching Stitch Left Card) */}
        <div className="card-tier-1 p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div>
              <span className="label-caps text-[#C8672B]">Interactive ROI Calculator</span>
              <h3 className="headline-md text-[#1C1F22] mt-1">
                Calculate Your Recaptured Emergency Call Revenue
              </h3>
              <p className="text-[14px] text-[#7A746B] mt-1">
                Adjust your weekly missed or after-hours calls to see how much revenue stays in your business every month. This is an illustrative estimate based only on the numbers you enter, not a guarantee of results.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="calc-missed" className="label-caps text-[#7A746B]">
                    Weekly Missed / After-Hours Calls
                  </label>
                  <span className="font-mono font-semibold text-[15px] text-[#1C1F22] tabular-nums">
                    {weeklyMissed} calls / week
                  </span>
                </div>
                <input
                  id="calc-missed"
                  type="range"
                  min={2}
                  max={40}
                  value={weeklyMissed}
                  onChange={(e) => setWeeklyMissed(Number(e.target.value))}
                  className="w-full accent-[#C8672B] cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="calc-ticket" className="label-caps text-[#7A746B]">
                    Average Plumbing / Electrical Job Ticket
                  </label>
                  <span className="font-mono font-semibold text-[15px] text-[#1C1F22] tabular-nums">
                    ${avgTicket}
                  </span>
                </div>
                <input
                  id="calc-ticket"
                  type="range"
                  min={200}
                  max={1500}
                  step={20}
                  value={avgTicket}
                  onChange={(e) => setAvgTicket(Number(e.target.value))}
                  className="w-full accent-[#C8672B] cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl bg-[#1C1F22] text-white p-6 sm:p-7 space-y-4">
            <span className="label-caps text-[#F2A93B]">
              Estimated Monthly Recoverable Revenue
            </span>
            <p className="font-display font-extrabold text-[40px] leading-none text-white tabular-nums">
              ${monthlyRecoverable.toLocaleString()}
              <span className="text-[16px] font-medium text-[#A8A298]"> / month</span>
            </p>
            <p className="text-[13px] text-[#C8C3BA]">
              Based on conservative 85% caller-to-lead capture across urgent and standard calls.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className="btn-primary w-full text-[14px] cursor-pointer"
            >
              Recapture This Revenue Tonight
            </button>
          </div>
        </div>
      </section>

      {/* 4. HOW IT WORKS IN 4 STEPS */}
      <section className="bg-white border-y border-[#ECE6DC] py-16 lg:py-20">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="max-w-2xl">
            <span className="label-caps text-[#C8672B]">How PlumbVoice AI Works</span>
            <h2 className="font-display font-bold text-[28px] sm:text-[34px] text-[#1C1F22] mt-1">
              From Missed Ring to Booked Truck in Under 90 Seconds
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01',
                title: 'Forward Unanswered Rings',
                body: 'Keep your existing number. Calls forward to PlumbVoice AI automatically after 20 seconds or after hours.',
              },
              {
                num: '02',
                title: 'Natural Trade Intake',
                body: 'Nora greets callers in clear American English, identifies plumbing vs electrical needs, and asks calm follow-ups.',
              },
              {
                num: '03',
                title: 'Safe Emergency Triage',
                body: 'Detects burst pipes, gas odors, or sparking outlets, gives safe shutoff guidance, and flags immediate dispatch.',
              },
              {
                num: '04',
                title: 'Instant Lead & SMS Alert',
                body: 'Saves full recording, transcript, ZIP, address, and preferred window—and texts your on-call tech immediately.',
              },
            ].map((step) => (
              <div key={step.num} className="rounded-xl bg-[#FAF7F2] border border-[#ECE6DC] p-6 space-y-3">
                <span className="font-mono text-[13px] font-bold text-[#C8672B]">{step.num}.</span>
                <h3 className="headline-sm text-[#1C1F22]">{step.title}</h3>
                <p className="text-[14px] leading-relaxed text-[#7A746B]">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. LIVE CALL DEMO WITH WAVEFORM & TYPING TRANSCRIPT */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-5 space-y-5">
          <span className="label-caps text-[#C8672B]">Live Call Experience</span>
          <h2 className="font-display font-bold text-[28px] sm:text-[34px] text-[#1C1F22]">
            Listen to How Nora Captures Every Detail Without Putting Callers on Hold
          </h2>
          <p className="text-[15px] leading-relaxed text-[#7A746B]">
            Switch between an emergency kitchen sink burst and a sparking GFCI outlet call. Want to speak to the live Gemini AI receptionist using your own microphone?
          </p>

          <div className="flex items-center gap-2 p-1 bg-white border border-[#ECE6DC] rounded-lg w-fit">
            {(['Plumbing', 'Electrical'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDemoTrade(t)}
                className={`px-4 py-2 rounded-md text-[13px] font-semibold transition-colors cursor-pointer ${
                  demoTrade === t
                    ? 'bg-[#1C1F22] text-white'
                    : 'text-[#7A746B] hover:text-[#1C1F22]'
                }`}
              >
                {t} Scenario
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onGetStarted}
            className="btn-primary inline-flex items-center gap-2 text-[14px] cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Try the Voice Agent Free</span>
          </button>
        </div>

        <div className="lg:col-span-7 rounded-xl bg-[#1C1F22] text-[#FAF7F2] p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <span className="label-caps text-[#F2A93B]">
                Live Voice Preview · {demoTrade}
              </span>
              <p className="font-display font-bold text-[17px] text-white mt-0.5">
                {demoTrade === 'Plumbing'
                  ? 'Karen Jenkins · Burst Kitchen Supply'
                  : 'Arthur Pendelton · Sparking GFCI & Warm Panel'}
              </p>
            </div>
            <div className="flex items-end gap-[3px] h-7" aria-hidden="true">
              {[35, 70, 48, 88, 60, 42, 76, 52, 90, 46, 68, 38].map((h, i) => (
                <span
                  key={i}
                  style={{height: `${h}%`}}
                  className="w-[3px] rounded-full bg-[#F2A93B]"
                />
              ))}
            </div>
          </div>

          <div className="space-y-3 min-h-[250px]">
            {DEMO_SCRIPTS[demoTrade].slice(0, visibleLines).map((line, idx) => (
              <div
                key={idx}
                className={`flex ${line.speaker === 'agent' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed ${
                    line.speaker === 'agent'
                      ? 'bg-[#282C30] text-[#FAF7F2] border border-white/10'
                      : 'bg-white text-[#1C1F22]'
                  }`}
                >
                  <p className="label-caps mb-1 text-[#F2A93B]">
                    {line.speaker === 'agent' ? 'Nora · AI Receptionist' : 'Homeowner'}
                  </p>
                  <p>{line.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. BEFORE & AFTER COMPARISON SPLIT */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-16 space-y-6">
        <div className="card-tier-1 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="label-caps text-[#C8672B]">Before &amp; After PlumbVoice AI</span>
              <h2 className="headline-md text-[#1C1F22] mt-1">
                Drag to Compare Voicemail Loss vs. Automated Lead Capture
              </h2>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-[12px] font-semibold text-[#D64545] whitespace-nowrap">Missed</span>
              <input
                type="range"
                min={20}
                max={80}
                value={compareSplit}
                aria-label="Compare before and after PlumbVoice AI"
                onChange={(e) => setCompareSplit(Number(e.target.value))}
                className="flex-1 sm:w-36 accent-[#C8672B] cursor-pointer"
              />
              <span className="text-[12px] font-semibold text-[#2E8B57] whitespace-nowrap">Captured</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div
              className="rounded-xl border border-[#D64545]/25 bg-[#FDF0F0]/50 p-6 space-y-3 transition-opacity"
              style={{opacity: Math.max(0.45, (100 - compareSplit) / 60)}}
            >
              <span className="label-caps text-[#D64545]">Without PlumbVoice AI</span>
              <h3 className="headline-sm text-[#1C1F22]">4 Rings → Generic Voicemail</h3>
              <p className="text-[14px] text-[#23282D]">
                Homeowner hangs up without leaving a message, calls the next plumber on Google Maps, and books a $2,400 water heater job with your competitor.
              </p>
            </div>

            <div
              className="rounded-xl border border-[#2E8B57]/30 bg-[#EBF6F0]/60 p-6 space-y-3 transition-opacity"
              style={{opacity: Math.max(0.45, compareSplit / 60)}}
            >
              <span className="label-caps text-[#2E8B57]">With PlumbVoice AI</span>
              <h3 className="headline-sm text-[#1C1F22]">Answered in 1.3 Rings → Dispatched</h3>
              <p className="text-[14px] text-[#23282D]">
                Nora greets calmly, captures address, ZIP, urgency, and preferred window, texts your on-call tech, and logs the qualified lead into your dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. PLUMBING & ELECTRICAL INDUSTRY CARDS */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-16 space-y-8">
        <div>
          <span className="label-caps text-[#C8672B]">Built For Real US Trades</span>
          <h2 className="font-display font-bold text-[28px] sm:text-[34px] text-[#1C1F22] mt-1">
            Dedicated Workflows for Plumbing &amp; Electrical Contractors
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card-tier-1 overflow-hidden group hover:border-[#C8672B] transition-all">
            <TradeSceneArtwork
              variant="water-heater"
              alt="Plumber working on a water heater and copper piping"
              className="h-56 w-full transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-[#C8672B] label-caps">
                <Wrench className="w-4 h-4" />
                <span>Plumbing Solutions</span>
              </div>
              <h3 className="headline-md text-[#1C1F22]">
                AI Answering Service for Plumbers
              </h3>
              <p className="text-[14px] text-[#7A746B] leading-relaxed">
                Handles burst pipes, slab leaks, sewer backups, hydro-jetting, and tankless water heaters—giving homeowners safe shutoff guidance while booking your trucks.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/plumbing-answering-service')}
                className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                <span>Explore Plumbing Solutions</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="card-tier-1 overflow-hidden group hover:border-[#F2A93B] transition-all">
            <TradeSceneArtwork
              variant="electrical-panel"
              alt="Master electrician inspecting an open 200A electrical panel"
              className="h-56 w-full transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-[#B47010] label-caps">
                <Zap className="w-4 h-4 text-[#F2A93B]" />
                <span>Electrical Solutions</span>
              </div>
              <h3 className="headline-md text-[#1C1F22]">
                AI Receptionist for Electricians
              </h3>
              <p className="text-[14px] text-[#7A746B] leading-relaxed">
                Triages sparking outlets, warm breaker panels, partial outages, and 48A EV charger estimates—enforcing strict safety warnings without ever diagnosing live wiring.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/electrician-answering-service')}
                className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                <span>Explore Electrical Solutions</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 9. PRICING PREVIEW */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="label-caps text-[#C8672B]">Transparent Plans</span>
            <h2 className="font-display font-bold text-[28px] sm:text-[34px] text-[#1C1F22] mt-1">
              Less Than One Recovered Service Call Per Month
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/pricing')}
            className="text-[14px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
          >
            Compare Full Plan Limits →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              name: 'Starter',
              price: '$69',
              sub: 'For 1–2 truck solo operators',
              bullets: [
                '250 AI voice minutes / mo',
                '24/7 AI answering & intake (English + Spanish)',
                'Emergency SMS & owner alerts',
                'Custom emergency rules',
                'Call recordings & transcripts',
                'Lead capture CRM, appointments & follow-ups',
                'Website chat widget',
                'Team members & roles (Owner, Dispatcher, Viewer)',
                'Call quality analytics',
                'Customer text-consent tracking',
                'Recording notice & retention controls',
                'Lead export (CSV)',
                'Works with your existing business number via carrier forwarding',
              ],
              highlighted: false,
            },
            {
              name: 'Professional',
              price: '$169',
              sub: 'For growing 3–10 truck shops',
              bullets: [
                '1,000 AI voice minutes / mo',
                'Everything in Starter',
                'Customer quotes with an approve/decline link',
                'Maintenance reminders & review requests by text',
                'Duplicate lead merge',
                'Online booking page for your customers',
                'Technician accounts with a "My Jobs" mobile view',
                'Missed-call text-back (TCPA)',
                'Google Calendar booking',
                'Ring my phone first (20 sec)',
                'Webhooks (Zapier, CRM)',
                'Website knowledge import',
                'Text booking links during calls',
              ],
              highlighted: true,
            },
            {
              name: 'Business',
              price: '$299',
              sub: 'For multi-branch dispatch teams',
              bullets: [
                '2,000 AI voice minutes / mo',
                'Everything in Professional',
                'Multi-location routing by ZIP code',
                'Alert number & hours per location',
                'Leads reported by location',
                'Activity log (who changed what)',
                'Full data export (JSON)',
              ],
              highlighted: false,
            },
          ].map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl p-6 space-y-5 ${
                plan.highlighted
                  ? 'bg-white border-2 border-[#C8672B] shadow-lg'
                  : 'card-tier-1'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="headline-md text-[#1C1F22]">{plan.name}</h3>
                {plan.highlighted && (
                  <span className="px-2.5 py-0.5 rounded-full label-caps bg-[#FBEBDD] text-[#C8672B] border border-[#C8672B]/25">
                    Most Popular
                  </span>
                )}
              </div>
              <div>
                <p className="font-display font-extrabold text-[36px] text-[#1C1F22] tabular-nums">
                  {plan.price}
                  <span className="text-[14px] font-medium text-[#7A746B]"> / mo</span>
                </p>
                <p className="text-[13px] text-[#7A746B] mt-1">{plan.sub}</p>
              </div>
              <ul className="space-y-2 text-[14px] text-[#23282D]">
                {plan.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2E8B57] shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onNavigate('/signup')}
                className={`w-full py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer ${
                  plan.highlighted ? 'btn-primary' : 'btn-secondary'
                }`}
              >
                Start 14-Day Trial
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 10. FAQ */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="card-tier-1 p-6 sm:p-8 space-y-6">
          <div>
            <span className="label-caps text-[#C8672B]">Frequently Asked Questions</span>
            <h2 className="headline-md text-[#1C1F22] mt-1">
              Common Questions From Plumbing &amp; Electrical Owners
            </h2>
          </div>

          <div className="divide-y divide-[#ECE6DC]">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left cursor-pointer"
                  >
                    <span className="font-display font-semibold text-[16px] text-[#1C1F22]">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#7A746B] transition-transform shrink-0 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="text-[14px] leading-relaxed text-[#7A746B] mt-2.5 pr-6">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 11. FINAL CTA */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="rounded-xl bg-[#1C1F22] text-white p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <span className="label-caps text-[#F2A93B]">Ready Tonight</span>
            <h2 className="font-display font-bold text-[28px] sm:text-[34px]">
              Stop Letting After-Hours Emergencies Ring Into Voicemail
            </h2>
            <p className="text-[15px] text-[#C8C3BA]">
              Set up your AI phone receptionist today, or compare plans first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className="btn-primary text-[14px] cursor-pointer"
            >
              Start Free Trial
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/pricing')}
              className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[14px] font-semibold cursor-pointer"
            >
              See Pricing
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
