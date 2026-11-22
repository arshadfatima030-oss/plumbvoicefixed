import {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Search,
  UserPlus,
} from 'lucide-react';
import {
  CallStatusBadge,
  formatCurrency,
  formatDuration,
  TradeLabel,
  UrgencyBadge,
} from '../../components/StatusBadges';
import {usePageSeo} from '../../lib/seo';
import {apiRequest} from '../../lib/api';
import type {CallAnsweredBy, CallItem, CallOutcomeStatus, LeadItem, TradeCategory} from '../../types/plumbvoice';

function TagChips({tags}: {tags?: string[]}) {
  if (!tags?.length) return null;
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FAF7F2] border border-[#ECE6DC] text-[#7A746B] capitalize">
          {t}
        </span>
      ))}
    </>
  );
}

export function CallsListPage({
  calls,
  onNavigate,
}: {
  calls: CallItem[];
  onNavigate: (path: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CallOutcomeStatus>('All');
  const [answeredByFilter, setAnsweredByFilter] = useState<'All' | CallAnsweredBy>('All');
  const [tradeFilter, setTradeFilter] = useState<'All' | TradeCategory>('All');

  usePageSeo({
    title: 'Inbound Calls — PlumbVoice AI',
    description: 'Searchable inbound contractor calls with recordings and AI transcripts.',
    path: '/app/calls',
    noindex: true,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      const mStatus = statusFilter === 'All' || c.status === statusFilter;
      const mAns = answeredByFilter === 'All' || c.answeredBy === answeredByFilter;
      const mTrade = tradeFilter === 'All' || c.trade === tradeFilter;
      const mQ =
        !q ||
        c.callerName.toLowerCase().includes(q) ||
        c.callerPhone.toLowerCase().includes(q) ||
        c.serviceRequested.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q);
      return mStatus && mAns && mTrade && mQ;
    });
  }, [calls, search, statusFilter, answeredByFilter, tradeFilter]);

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-[#7A746B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search caller, phone, service, address..."
            aria-label="Search calls"
            className="input-crafted w-full pl-9 pr-3"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-wrap items-center gap-2.5 sm:gap-3">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | CallOutcomeStatus)}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="All">All Statuses</option>
            <option value="Answered">Answered</option>
            <option value="Active">Active</option>
            <option value="Missed">Missed</option>
          </select>

          <select
            aria-label="Filter by answered by"
            value={answeredByFilter}
            onChange={(e) => setAnsweredByFilter(e.target.value as 'All' | CallAnsweredBy)}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="All">Answered By: Any</option>
            <option value="AI">AI Receptionist</option>
            <option value="Business">Business Crew</option>
          </select>

          <select
            aria-label="Filter by trade"
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value as 'All' | TradeCategory)}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="All">All Trades</option>
            <option value="Plumbing">Plumbing</option>
            <option value="Electrical">Electrical</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-tier-1 p-10 sm:p-12 text-center space-y-3">
          <p className="headline-sm text-[#1C1F22]">No calls match these filters</p>
          <p className="text-[14px] text-[#7A746B]">
            Reset your filters or test your AI voice agent to generate a real call log.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatusFilter('All');
              setAnsweredByFilter('All');
              setTradeFilter('All');
            }}
            className="btn-secondary text-[13px] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="card-tier-1 overflow-hidden">
          {/* Mobile Call Cards */}
          <div className="md:hidden divide-y divide-[#ECE6DC]">
            {filtered.map((call) => (
              <button
                key={call.id}
                type="button"
                onClick={() => onNavigate(`/app/calls/${call.id}`)}
                className="w-full text-left p-4 hover:bg-[#FBEBDD]/55 space-y-2.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display font-semibold text-[15px] text-[#1C1F22]">
                      {call.callerName}
                    </p>
                    <p className="font-mono text-[12px] text-[#7A746B] tabular-nums">
                      {call.callerPhone}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <CallStatusBadge status={call.status} />
                    <UrgencyBadge urgency={call.urgency} />
                        <TagChips tags={call.tags} />
                  </div>
                </div>
                <p className="text-[13.5px] font-medium text-[#23282D]">{call.serviceRequested}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px] text-[#7A746B]">
                  <TradeLabel trade={call.trade} />
                  <span className="font-mono tabular-nums">
                    {call.answeredBy} · {formatDuration(call.durationSec)} · {call.createdAt}
                  </span>
                </div>
                <p className="text-[12.5px] font-semibold text-[#C8672B]">Open Transcript &amp; Audio →</p>
              </button>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#ECE6DC]">
                  <th className="py-3.5 px-5 label-caps text-[#7A746B]">Customer &amp; Phone</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Service Requested</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Date &amp; Duration</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Answered By</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Status &amp; Urgency</th>
                  <th className="py-3.5 px-5 label-caps text-[#7A746B] text-right">Transcript</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE6DC]">
                {filtered.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => onNavigate(`/app/calls/${call.id}`)}
                    className="hover:bg-[#FBEBDD]/55 cursor-pointer transition-colors"
                  >
                    <td className="py-4 px-5">
                      <p className="font-display font-semibold text-[15px] text-[#1C1F22]">
                        {call.callerName}
                      </p>
                      <p className="font-mono text-[12px] text-[#7A746B] tabular-nums">
                        {call.callerPhone}
                      </p>
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-[14px] font-medium text-[#23282D]">
                        {call.serviceRequested}
                      </p>
                      <TradeLabel trade={call.trade} />
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-[13px] text-[#23282D]">{call.createdAt}</p>
                      <p className="font-mono text-[12px] text-[#7A746B] tabular-nums">
                        {formatDuration(call.durationSec)} · {call.recordingAvailable ? 'Audio Ready' : 'No Audio'}
                      </p>
                    </td>
                    <td className="py-4 px-4 text-[13px] font-semibold text-[#1C1F22]">
                      {call.answeredBy}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CallStatusBadge status={call.status} />
                        <UrgencyBadge urgency={call.urgency} />
                        <TagChips tags={call.tags} />
                      </div>
                    </td>
                    <td className="py-4 px-5 text-right">
                      <span className="text-[13px] font-semibold text-[#C8672B]">
                        Open Detail →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function CallDetailPage({
  call,
  linkedLead,
  onNavigate,
  onCreateLeadFromCall,
}: {
  call?: CallItem;
  linkedLead?: LeadItem;
  onNavigate: (path: string) => void;
  onCreateLeadFromCall: (call: CallItem) => Promise<void>;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [sec, setSec] = useState(0);
  const [speed, setSpeed] = useState<1 | 1.25 | 1.5>(1);
  const [creatingLead, setCreatingLead] = useState(false);

  usePageSeo({
    title: call ? `Call: ${call.callerName} — PlumbVoice AI` : 'Call Detail — PlumbVoice AI',
    description: 'Call audio recording, AI summary, and transcript.',
    path: call ? `/app/calls/${call.id}` : '/app/calls',
    noindex: true,
  });

  useEffect(() => {
    setIsPlaying(false);
    setSec(0);
  }, [call?.id]);

  // Real provider recording (only present on real calls). Test calls keep the original simulated timer.
  // The provider URL never reaches the browser; playback always goes through our authenticated /api/calls/:id/recording.
  const realAudio = Boolean(call?.recordingAvailable);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioError, setAudioError] = useState(false);

  useEffect(() => {
    setAudioError(false);
  }, [call?.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !realAudio) return;
    a.playbackRate = speed;
    if (isPlaying) void a.play().catch(() => setIsPlaying(false));
    else a.pause();
  }, [isPlaying, speed, realAudio]);

  useEffect(() => {
    const a = audioRef.current;
    if (a && realAudio && Math.abs(a.currentTime - sec) > 1.2) a.currentTime = sec;
  }, [sec, realAudio]);

  useEffect(() => {
    if (!isPlaying || !call || realAudio) return;
    const t = window.setInterval(() => {
      setSec((prev) => {
        if (prev + 0.5 >= call.durationSec) {
          setIsPlaying(false);
          return call.durationSec;
        }
        return prev + 0.5;
      });
    }, Math.round(500 / speed));
    return () => window.clearInterval(t);
  }, [isPlaying, speed, call, realAudio]);

  if (!call) {
    return (
      <div className="card-tier-1 p-10 text-center space-y-3">
        <p className="headline-md text-[#1C1F22]">Call record not found</p>
        <button type="button" onClick={() => onNavigate('/app/calls')} className="btn-secondary cursor-pointer">
          Back to Calls
        </button>
      </div>
    );
  }

  const ratio = call.durationSec > 0 ? sec / call.durationSec : 0;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => onNavigate('/app/calls')}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7A746B] hover:text-[#1C1F22] cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Calls List</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {realAudio && call && (
            <audio
              hidden
              ref={audioRef}
              src={`/api/calls/${call.id}/recording`}
              preload="none"
              onTimeUpdate={() => audioRef.current && setSec(audioRef.current.currentTime)}
              onEnded={() => setIsPlaying(false)}
              onError={() => {
                setIsPlaying(false);
                setAudioError(true);
              }}
            />
          )}
          {audioError && (
            <p role="alert" className="text-[12.5px] text-[#B42318]">
              This recording could not be loaded. It may have expired at the provider or been removed.
            </p>
          )}
          {/* Audio Player */}
          <div className="rounded-xl bg-[#1C1F22] text-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (sec >= call.durationSec) setSec(0);
                    setIsPlaying((p) => !p);
                  }}
                  aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                  className="w-10 h-10 rounded-lg bg-[#C8672B] hover:bg-[#B55A22] flex items-center justify-center cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <div>
                  <p className="font-semibold text-[14px]">
                    Call Audio · {call.callerName}
                  </p>
                  <p className="font-mono text-[12px] text-[#A8A298] tabular-nums">
                    {formatDuration(sec)} / {formatDuration(call.durationSec)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setSec(0);
                  }}
                  className="p-2 rounded-lg text-[#A8A298] hover:text-white cursor-pointer"
                  aria-label="Restart"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSpeed((s) => (s === 1 ? 1.25 : s === 1.25 ? 1.5 : 1))}
                  className="px-2.5 py-1 rounded bg-white/10 font-mono text-[12px] cursor-pointer"
                >
                  {speed}x
                </button>
              </div>
            </div>

            <div className="h-14 flex items-end gap-[3px]">
              {call.waveform.map((amp, idx) => {
                const barRatio = (idx + 1) / call.waveform.length;
                const passed = barRatio <= ratio;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSec(((idx + 0.5) / call.waveform.length) * call.durationSec)}
                    className="flex-1 h-full flex items-end cursor-pointer"
                    aria-label={`Seek to ${Math.round(barRatio * 100)}%`}
                  >
                    <span
                      style={{height: `${Math.max(18, amp)}%`}}
                      className={`w-full rounded-[2px] ${
                        passed ? 'bg-[#C8672B]' : 'bg-white/20 hover:bg-white/40'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {realAudio && (
            <p className="text-[12px] text-[#7A746B]">
              Recording kept under your retention settings.{' '}
              <button
                type="button"
                className="font-semibold text-[#B42318] hover:underline cursor-pointer"
                onClick={async () => {
                  if (!window.confirm('Delete this recording permanently? The transcript and lead stay.')) return;
                  try {
                    await apiRequest(`/api/calls/${call.id}/recording`, {method: 'DELETE'});
                    window.location.reload();
                  } catch (e) {
                    window.alert(e instanceof Error ? e.message : 'Could not delete the recording.');
                  }
                }}
              >
                Delete recording
              </button>
            </p>
          )}
          {!realAudio && call.recordingDeletedAtISO && (
            <p className="text-[12px] text-[#7A746B]">Recording removed on {new Date(call.recordingDeletedAtISO).toLocaleDateString()}. The transcript is kept.</p>
          )}
          {/* Conversation Transcript */}
          <div className="card-tier-1 p-6 space-y-4">
            <h2 className="headline-sm text-[#1C1F22]">Conversation Transcript</h2>
            <div className="space-y-3">
              {call.transcript.map((turn) => (
                <div
                  key={turn.id}
                  className={`flex ${turn.speaker === 'agent' ? 'justify-start' : 'justify-end'}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSec(turn.timestampSec);
                      setIsPlaying(true);
                    }}
                    className={`max-w-[88%] text-left rounded-xl px-4 py-3 cursor-pointer ${
                      turn.speaker === 'agent'
                        ? 'bg-[#FAF7F2] border border-[#ECE6DC]'
                        : 'bg-white border border-[#ECE6DC] shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="label-caps text-[#C8672B]">
                        {turn.speaker === 'agent' ? 'AI Voice Receptionist' : call.callerName}
                      </span>
                      <span className="font-mono text-[11px] text-[#7A746B] tabular-nums">
                        {formatDuration(turn.timestampSec)}
                      </span>
                    </div>
                    <p className="text-[14px] leading-relaxed text-[#23282D]">{turn.text}</p>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Summary & Lead Status */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="card-tier-2 p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <CallStatusBadge status={call.status} />
              <UrgencyBadge urgency={call.urgency} />
                        <TagChips tags={call.tags} />
            </div>

            <div>
              <h2 className="headline-md text-[#1C1F22]">{call.callerName}</h2>
              <a
                href={`tel:${call.callerPhone.replace(/\D/g, '')}`}
                className="font-mono text-[13px] text-[#C8672B] hover:underline mt-0.5 inline-block"
              >
                {call.callerPhone}
              </a>
              <p className="text-[13px] text-[#23282D] mt-2 flex items-start gap-1.5">
                <MapPin className="w-4 h-4 text-[#C8672B] shrink-0 mt-0.5" />
                <span>{call.address}</span>
              </p>
            </div>

            <div className="p-4 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] space-y-1.5">
              <span className="label-caps text-[#C8672B]">AI Summary</span>
              <p className="text-[13.5px] leading-relaxed text-[#23282D]">{call.aiSummary}</p>
            </div>

            {call.nextSteps && (
              <div className="p-4 rounded-lg bg-[#FEF6E8] border border-[#E9A23B]/35 space-y-1.5">
                <span className="label-caps text-[#B47010]">Suggested Next Step</span>
                <p className="text-[13.5px] leading-relaxed text-[#23282D]">{call.nextSteps}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-[#ECE6DC]">
              <span className="label-caps text-[#7A746B]">Estimated Value</span>
              <span className="font-display font-extrabold text-[20px] text-[#1C1F22] tabular-nums">
                {formatCurrency(call.estimatedValue)}
              </span>
            </div>

            {linkedLead ? (
              <div className="p-4 rounded-lg bg-[#EBF6F0] border border-[#2E8B57]/25 space-y-2">
                <p className="text-[13px] font-semibold text-[#2E8B57] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Lead Created ({linkedLead.status})</span>
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(`/app/leads/${linkedLead.id}`)}
                  className="btn-secondary w-full text-[13px] py-2 cursor-pointer"
                >
                  Open Lead Record →
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={creatingLead}
                onClick={async () => {
                  setCreatingLead(true);
                  await onCreateLeadFromCall(call);
                  setCreatingLead(false);
                }}
                className="btn-primary w-full inline-flex items-center justify-center gap-2 text-[13px] cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{creatingLead ? 'Creating Lead…' : 'Create Lead From Call'}</span>
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
