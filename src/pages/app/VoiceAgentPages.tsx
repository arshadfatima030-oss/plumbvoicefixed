import {useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Mic,
  MicOff,
  Play,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';
import {TradeSceneArtwork} from '../../components/TradeVisuals';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';
import type {
  ExtractedCallerFields,
  VoiceAgentConfig,
} from '../../types/plumbvoice';

const VOICE_OPTIONS: {
  id: VoiceAgentConfig['voiceId'];
  label: string;
  desc: string;
  pitch: number;
}[] = [
  {id: 'us-warm-female', label: 'Nora · Warm American Female', desc: 'Calm, reassuring homeowner tone', pitch: 1.05},
  {id: 'us-calm-male', label: 'Grant · Steady American Male', desc: 'Grounded, reassuring dispatch voice', pitch: 0.9},
  {id: 'us-crisp-female', label: 'Claire · Crisp American Female', desc: 'Clear, brisk scheduling tone', pitch: 1.12},
  {id: 'us-authoritative-male', label: 'Cole · Direct Master Desk', desc: 'Confident emergency triage voice', pitch: 0.85},
];

function speakText(text: string, speed: number, pitch: number) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = speed;
  utter.pitch = pitch;
  const voices = window.speechSynthesis.getVoices();
  const usVoice = voices.find((v) => v.lang.startsWith('en-US'));
  if (usVoice) utter.voice = usVoice;
  window.speechSynthesis.speak(utter);
}

export function VoiceAgentConfigPage({
  config,
  onSave,
  onNavigate,
}: {
  config: VoiceAgentConfig;
  onSave: (patch: Partial<VoiceAgentConfig>) => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const [draft, setDraft] = useState<VoiceAgentConfig>(config);
  const [zipInput, setZipInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  usePageSeo({
    title: 'Voice Agent Configuration — PlumbVoice AI',
    description: 'Configure AI voice receptionist greeting, timeout, voice, and emergency instructions.',
    path: '/app/voice-agent',
    noindex: true,
  });

  const handlePreviewVoice = (voiceId: VoiceAgentConfig['voiceId']) => {
    const v = VOICE_OPTIONS.find((o) => o.id === voiceId) || VOICE_OPTIONS[0];
    speakText(draft.greetingMessage, draft.speakingSpeed, v.pitch);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2600);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Contextual Visual Header */}
      <div className="card-tier-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <TradeSceneArtwork
            variant="contractor-phone"
            alt="Contractor receiving AI call alert in the field"
            className="h-48 lg:h-full w-full"
          />
        </div>
        <div className="lg:col-span-8 p-6 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <span className="label-caps text-[#C8672B]">AI Phone Receptionist</span>
            <h2 className="headline-md text-[#1C1F22]">
              Configure {draft.agentName} for {draft.businessName}
            </h2>
            <p className="text-[14px] text-[#7A746B]">
              Define how your automated receptionist greets callers, handles after-hours requests, and enforces life-safety emergency triage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/app/test-agent')}
              className="btn-secondary text-[13px] inline-flex items-center gap-2 cursor-pointer"
            >
              <Mic className="w-4 h-4 text-[#C8672B]" />
              <span>Open Test Your AI Agent</span>
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-[13px] cursor-pointer">
              {saving ? 'Saving…' : 'Save Agent Configuration'}
            </button>
          </div>
        </div>
      </div>

      {savedNotice && (
        <div className="rounded-xl bg-[#EBF6F0] border border-[#2E8B57]/30 px-4 py-3 text-[13px] font-semibold text-[#2E8B57] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Voice agent configuration saved and active.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns */}
        <div className="lg:col-span-7 space-y-6">
          <section className="card-tier-1 p-6 space-y-4">
            <h3 className="headline-sm text-[#1C1F22] pb-3 border-b border-[#ECE6DC]">
              Identity &amp; Answering Behavior
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">AI Agent Name</label>
                <input
                  value={draft.agentName}
                  onChange={(e) => setDraft({...draft, agentName: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Business Name</label>
                <input
                  value={draft.businessName}
                  onChange={(e) => setDraft({...draft, businessName: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Business Type</label>
                <select
                  value={draft.businessType}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      businessType: e.target.value as VoiceAgentConfig['businessType'],
                    })
                  }
                  className="input-crafted w-full px-3"
                >
                  <option value="Plumbing">Plumbing</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Plumbing & Electrical">Plumbing &amp; Electrical</option>
                </select>
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Business Phone</label>
                <input
                  value={draft.businessPhone}
                  onChange={(e) => setDraft({...draft, businessPhone: e.target.value})}
                  className="input-crafted w-full px-3 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Shop Street Address</label>
              <input
                value={draft.address}
                onChange={(e) => setDraft({...draft, address: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">
                  Ring Timeout Before AI Pickup (Seconds)
                </label>
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
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Business Hours Summary</label>
                <input
                  value={draft.workingHoursSummary}
                  onChange={(e) => setDraft({...draft, workingHoursSummary: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.afterHoursAnswering}
                onChange={(e) => setDraft({...draft, afterHoursAnswering: e.target.checked})}
                className="checkbox-crafted"
              />
              <span className="text-[14px] font-medium text-[#23282D]">
                Enable 24/7 after-hours &amp; weekend AI call answering
              </span>
            </label>
          </section>

          <section className="card-tier-1 p-6 space-y-4">
            <h3 className="headline-sm text-[#1C1F22] pb-3 border-b border-[#ECE6DC]">
              Greeting &amp; Emergency Safety Instructions
            </h3>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Greeting Message</label>
              <textarea
                rows={3}
                value={draft.greetingMessage}
                onChange={(e) => setDraft({...draft, greetingMessage: e.target.value})}
                className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px]"
              />
            </div>

            <div>
              <label className="label-caps text-[#D64545] block mb-1.5">
                Emergency Handling &amp; Safe Guidance Rules
              </label>
              <textarea
                rows={3}
                value={draft.emergencyInstructions}
                onChange={(e) => setDraft({...draft, emergencyInstructions: e.target.value})}
                className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px]"
              />
            </div>
          </section>
        </div>

        {/* Right 5 Columns: Voice Selection & Service ZIPs */}
        <div className="lg:col-span-5 space-y-6">
          <section className="card-tier-1 p-6 space-y-4">
            <h3 className="headline-sm text-[#1C1F22] pb-3 border-b border-[#ECE6DC]">
              Voice, Accent &amp; Speed
            </h3>

            <div className="space-y-2.5">
              {VOICE_OPTIONS.map((v) => {
                const selected = draft.voiceId === v.id;
                return (
                  <div
                    key={v.id}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                      selected ? 'bg-[#FBEBDD]/50 border-[#C8672B]' : 'bg-white border-[#ECE6DC]'
                    }`}
                  >
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="voiceId"
                        checked={selected}
                        onChange={() => setDraft({...draft, voiceId: v.id})}
                        className="radio-crafted mt-0.5"
                      />
                      <div>
                        <p className="text-[13.5px] font-semibold text-[#1C1F22]">{v.label}</p>
                        <p className="text-[12px] text-[#7A746B]">{v.desc}</p>
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => handlePreviewVoice(v.id)}
                      className="p-2 rounded-lg bg-[#1C1F22] text-[#F2A93B] hover:bg-[#2B3035] shrink-0 cursor-pointer"
                      aria-label={`Preview ${v.label}`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label-caps text-[#7A746B]">Speaking Speed</label>
                <span className="font-mono text-[13px] font-semibold text-[#1C1F22]">
                  {draft.speakingSpeed.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.85}
                max={1.2}
                step={0.05}
                value={draft.speakingSpeed}
                onChange={(e) => setDraft({...draft, speakingSpeed: Number(e.target.value)})}
                className="w-full accent-[#C8672B]"
              />
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Language &amp; Accent</label>
              <select
                value={draft.accent}
                onChange={(e) =>
                  setDraft({...draft, accent: e.target.value as VoiceAgentConfig['accent']})
                }
                className="input-crafted w-full px-3"
              >
                <option>American English (Neutral)</option>
                <option>American English (Southern)</option>
                <option>American English (Midwest)</option>
              </select>
            </div>
          </section>

          <section className="card-tier-1 p-6 space-y-4">
            <h3 className="headline-sm text-[#1C1F22]">Service Area ZIP Codes</h3>
            <div className="flex flex-wrap gap-2">
              {draft.serviceAreas.map((zip) => (
                <span
                  key={zip}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] font-mono text-[12px]"
                >
                  <span>{zip}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        serviceAreas: draft.serviceAreas.filter((z) => z !== zip),
                      })
                    }
                    aria-label={`Remove ZIP ${zip}`}
                    className="text-[#7A746B] hover:text-[#1C1F22] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={zipInput}
                onChange={(e) => setZipInput(e.target.value)}
                placeholder="Add ZIP (e.g. 78703)"
                maxLength={5}
                className="input-crafted flex-1 px-3 font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  const z = zipInput.trim();
                  if (/^\d{5}$/.test(z) && !draft.serviceAreas.includes(z)) {
                    setDraft({...draft, serviceAreas: [...draft.serviceAreas, z]});
                    setZipInput('');
                  }
                }}
                className="btn-secondary px-3 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}

const TEST_SCENARIOS = [
  {
    id: 'burst-pipe',
    label: 'Burst Pipe',
    starterPrompt:
      "Hi, water is pouring out from a burst pipe behind my washing machine and getting everywhere!",
  },
  {
    id: 'power-outage',
    label: 'Power Outage',
    starterPrompt:
      'Half of the outlets and lights in our downstairs living room suddenly went dead.',
  },
  {
    id: 'drain-cleaning',
    label: 'Drain Cleaning',
    starterPrompt:
      'Our kitchen sink is completely backed up and draining super slowly into the dishwasher.',
  },
  {
    id: 'sparking-outlet',
    label: 'Sparking Outlet',
    starterPrompt:
      'My bathroom outlet just sparked and smelled slightly like burnt plastic when I plugged in a hair dryer.',
  },
];

export function TestAgentPage({
  config,
  onCallSaved,
  onNavigate,
}: {
  config: VoiceAgentConfig;
  onCallSaved: () => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const [scenario, setScenario] = useState(TEST_SCENARIOS[0]);
  const [messages, setMessages] = useState<{speaker: 'agent' | 'caller'; text: string}[]>([
    {speaker: 'agent', text: config.greetingMessage},
  ]);
  const [extracted, setExtracted] = useState<ExtractedCallerFields>({
    name: null,
    phone: null,
    zip: null,
    address: null,
    serviceType: null,
    trade: null,
    urgency: null,
    preferredTime: null,
    isEmergency: false,
    escalationReason: null,
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [engine, setEngine] = useState<'gemini' | 'fallback' | ''>('');
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  usePageSeo({
    title: 'Test Your AI Agent — PlumbVoice AI',
    description:
      'Test browser microphone, hear selected voice, run live Gemini AI contractor scenarios, and inspect extracted lead checklist.',
    path: '/app/test-agent',
    noindex: true,
  });

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const selectedVoiceMeta =
    VOICE_OPTIONS.find((v) => v.id === config.voiceId) || VOICE_OPTIONS[0];

  const startMicTest = async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streamRef.current = stream;
      setMicActive(true);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // If browser Web Speech Recognition is available, capture spoken words into input
      const SpeechRec =
        (window as unknown as {SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown})
          .SpeechRecognition ||
        (window as unknown as {webkitSpeechRecognition?: new () => unknown}).webkitSpeechRecognition;
      if (SpeechRec) {
        const rec = new SpeechRec() as {
          lang: string;
          interimResults: boolean;
          onresult: (ev: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void;
          start: () => void;
        };
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.onresult = (ev) => {
          const spoken = ev.results?.[0]?.[0]?.transcript;
          if (spoken) {
            setInput(spoken);
          }
        };
        rec.start();
      }
    } catch (err) {
      setMicError(
        err instanceof Error
          ? `Microphone unavailable: ${err.message}`
          : 'Microphone access denied by browser.'
      );
      setMicActive(false);
    }
  };

  const stopMicTest = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMicActive(false);
    setMicLevel(0);
  };

  const sendCallerUtterance = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || loading) return;
    setErrorMsg('');
    const nextHistory = [...messages, {speaker: 'caller' as const, text: clean}];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const data = await apiRequest<{
        replyText: string;
        extracted: ExtractedCallerFields;
        engine?: 'gemini' | 'fallback';
      }>('/api/agent/converse', {
        method: 'POST',
        body: JSON.stringify({
          messages: nextHistory,
          scenario: scenario.label,
        }),
      });
      setMessages((prev) => [...prev, {speaker: 'agent', text: data.replyText}]);
      setExtracted(data.extracted);
      setEngine(data.engine ?? '');
      speakText(data.replyText, config.speakingSpeed, selectedVoiceMeta.pitch);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'The voice agent request failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToWorkspace = async () => {
    setSavingCall(true);
    setErrorMsg('');
    try {
      const res = await apiRequest<{call: {id: string}; lead: {id: string}}>(
        '/api/agent/save-test-call',
        {
          method: 'POST',
          body: JSON.stringify({
            transcript: messages,
            extracted,
            durationSec: messages.length * 14,
          }),
        }
      );
      await onCallSaved();
      setSavedPath(`/app/leads/${res.lead.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save call');
    } finally {
      setSavingCall(false);
    }
  };

  const checklist = [
    {label: 'Caller Name', val: extracted.name},
    {label: 'Callback Phone', val: extracted.phone},
    {label: 'Service ZIP', val: extracted.zip},
    {label: 'Street Address', val: extracted.address},
    {label: 'Service Type', val: extracted.serviceType},
    {label: 'Urgency Level', val: extracted.urgency},
    {label: 'Preferred Time', val: extracted.preferredTime},
  ];

  return (
    <div className="space-y-6">
      {/* Top Bar: Scenario Selector + Mic + Voice Preview */}
      <div className="card-tier-1 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-2 lg:space-y-0 lg:flex lg:flex-wrap lg:items-center lg:gap-2">
          <span className="label-caps text-[#7A746B] block lg:inline lg:mr-1">Scenario:</span>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {TEST_SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  setScenario(sc);
                  setMessages([{speaker: 'agent', text: config.greetingMessage}]);
                  setSavedPath(null);
                  setErrorMsg('');
                }}
                className={`px-3 py-2 sm:py-1.5 rounded-lg text-[12px] font-semibold transition-colors cursor-pointer ${
                  scenario.id === sc.id
                    ? 'bg-[#1C1F22] text-white'
                    : 'bg-[#FAF7F2] border border-[#ECE6DC] text-[#23282D] hover:border-[#C8672B]'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              speakText(config.greetingMessage, config.speakingSpeed, selectedVoiceMeta.pitch)
            }
            className="btn-secondary text-[12px] py-2 px-3 inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Volume2 className="w-4 h-4 text-[#C8672B]" />
            <span>Hear Selected Voice</span>
          </button>

          <button
            type="button"
            onClick={micActive ? stopMicTest : startMicTest}
            className={`px-3.5 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              micActive
                ? 'bg-[#D64545] text-white'
                : 'bg-[#1C1F22] text-[#F2A93B] hover:bg-[#2B3035]'
            }`}
          >
            {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            <span>{micActive ? 'Stop Mic Test' : 'Test Browser Microphone'}</span>
          </button>
        </div>
      </div>

      {micError && (
        <div className="rounded-xl bg-[#FEF6E8] border border-[#E9A23B]/35 px-4 py-3 text-[13px] font-medium text-[#9A5D0A]">
          {micError} — You can still speak/type caller messages below using the live Gemini AI backend.
        </div>
      )}

      {engine === 'fallback' && (
        <div role="status" className="rounded-xl bg-[#FFF6E5] border border-[#F2A93B]/40 px-4 py-3 text-[13px] text-[#7A4B00]">
          The AI model is unavailable right now, so this test is running on the built-in rule-based intake flow. Replies are simpler, but extraction and emergency detection still work.
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl bg-[#FDF0F0] border border-[#D64545]/30 px-4 py-3 text-[13px] font-medium text-[#D64545] flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedPath && (
        <div className="rounded-xl bg-[#EBF6F0] border border-[#2E8B57]/30 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-[#2E8B57]">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Live test call and lead saved to workspace records.</span>
          </span>
          <button
            type="button"
            onClick={() => onNavigate(savedPath)}
            className="underline cursor-pointer"
          >
            View Saved Lead →
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Live Waveform & Live Conversation */}
        <div className="lg:col-span-7 card-tier-1 overflow-hidden">
          <div className="bg-[#1C1F22] text-white px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="label-caps text-[#F2A93B] block truncate">
                Live Gemini Voice Test · {selectedVoiceMeta.label}
              </span>
              <p className="text-[13px] text-[#C8C3BA] mt-0.5 truncate">
                Scenario: {scenario.label}
              </p>
            </div>

            {/* Live Audio Waveform Meter */}
            <div className="flex items-end gap-[3px] h-7 sm:h-8 shrink-0" aria-label="Audio level waveform">
              {[24, 48, 72, 40, 86, 56, 36, 78, 62, 44, 68, 30].map((base, idx) => {
                const h = micActive
                  ? Math.max(18, Math.min(100, Math.round((micLevel * (base / 60)) + 15)))
                  : loading
                    ? Math.max(20, ((base + idx * 17) % 85) + 15)
                    : 20;
                return (
                  <span
                    key={idx}
                    style={{height: `${h}%`}}
                    className={`w-[3px] rounded-full transition-all duration-150 ${
                      micActive || loading ? 'bg-[#F2A93B]' : 'bg-white/25'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-3 max-h-[340px] sm:max-h-[420px] overflow-y-auto bg-white">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.speaker === 'agent' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[92%] sm:max-w-[86%] rounded-xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-[13.5px] sm:text-[14px] leading-relaxed ${
                    m.speaker === 'agent'
                      ? 'bg-[#FAF7F2] border border-[#ECE6DC]'
                      : 'bg-white border border-[#ECE6DC] shadow-sm'
                  }`}
                >
                  <span className="label-caps text-[#C8672B] block mb-1">
                    {m.speaker === 'agent' ? `${config.agentName} · AI Receptionist` : 'You (Caller)'}
                  </span>
                  <p className="text-[#23282D]">{m.text}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="text-[13px] text-[#7A746B] italic px-2">
                {config.agentName} is responding…
              </div>
            )}
          </div>

          {/* Caller Input & Quick Scenario Starter */}
          <div className="p-4 bg-[#FAF7F2] border-t border-[#ECE6DC] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => sendCallerUtterance(scenario.starterPrompt)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Send &ldquo;{scenario.label}&rdquo; Caller Opener</span>
              </button>
              <span className="text-[11px] text-[#7A746B]">
                Powered by server-side Gemini API
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendCallerUtterance(input);
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Speak via mic or type what the caller says..."
                aria-label="Caller response"
                className="input-crafted flex-1 px-3"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="btn-primary px-4 h-[42px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right 5 cols: Live Lead Intake Checklist */}
        <aside className="lg:col-span-5 card-tier-2 p-5 sm:p-6 space-y-5">
          <div className="pb-4 border-b border-[#ECE6DC] flex items-center justify-between gap-2">
            <div>
              <span className="label-caps text-[#C8672B]">Real-Time Intake Checklist</span>
              <h2 className="headline-sm text-[#1C1F22] mt-0.5">
                Extracted Caller Data
              </h2>
            </div>
            {extracted.isEmergency && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FDF0F0] text-[#D64545] border border-[#D64545]/25 label-caps shrink-0">
                <AlertTriangle className="w-3 h-3" />
                Emergency
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {checklist.map((item) => {
              const collected = Boolean(item.val);
              return (
                <div
                  key={item.label}
                  className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 ${
                    collected
                      ? 'bg-[#EBF6F0]/60 border-[#2E8B57]/30'
                      : 'bg-[#FAF7F2] border-[#ECE6DC]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        collected ? 'text-[#2E8B57]' : 'text-[#7A746B]/40'
                      }`}
                    />
                    <span className="text-[13px] font-medium text-[#1C1F22]">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-[12.5px] font-mono text-[#23282D] break-words sm:text-right pl-6 sm:pl-0">
                    {item.val || 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>

          {extracted.escalationReason && (
            <div className="p-3.5 rounded-lg bg-[#FDF0F0] border border-[#D64545]/25 text-[12.5px] text-[#D64545]">
              <strong>Escalation Triggered:</strong> {extracted.escalationReason}
            </div>
          )}

          <button
            type="button"
            disabled={savingCall || messages.length < 2}
            onClick={handleSaveToWorkspace}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 text-[13px] cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{savingCall ? 'Saving…' : 'Save Test Call & Lead to Workspace'}</span>
          </button>
        </aside>
      </div>
    </div>
  );
}
