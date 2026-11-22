import {useMemo, useState} from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Mic,
  PhoneCall,
  PhoneForwarded,
  TrendingUp,
  Truck,
} from 'lucide-react';
import {
  CallStatusBadge,
  formatCurrency,
  formatDuration,
  LeadStatusBadge,
  TradeLabel,
  UrgencyBadge,
  SimulatedNumberBadge,
} from '../../components/StatusBadges';
import {usePageSeo} from '../../lib/seo';
import type {TenantWorkspace} from '../../types/plumbvoice';

interface OverviewDashboardPageProps {
  workspace: TenantWorkspace;
  onNavigate: (path: string) => void;
}

type DateRange = 'today' | '7d' | '30d' | 'custom';

function MiniSparkline({points, color}: {points: number[]; color: string}) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const coords = points
    .map((val, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * 68;
      const y = 20 - ((val - min) / span) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="68" height="22" viewBox="0 0 68 22" className="shrink-0" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
}

export function OverviewDashboardPage({
  workspace,
  onNavigate,
}: OverviewDashboardPageProps) {
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [customDays, setCustomDays] = useState(14);

  usePageSeo({
    title: 'Overview Dashboard — PlumbVoice AI',
    description: 'Real-time AI phone receptionist performance and contractor leads.',
    path: '/app/overview',
    noindex: true,
  });

  const maxOffset =
    dateRange === 'today' ? 0 : dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : customDays;

  const filteredCalls = useMemo(
    () => workspace.calls.filter((c) => c.dayOffset <= maxOffset),
    [workspace.calls, maxOffset]
  );

  const filteredLeads = useMemo(
    () => workspace.leads.filter((l) => l.dayOffset <= maxOffset),
    [workspace.leads, maxOffset]
  );

  const stats = useMemo(() => {
    const totalCalls = filteredCalls.length;
    const aiAnswered = filteredCalls.filter(
      (c) => c.answeredBy === 'AI' && c.status !== 'Missed'
    ).length;
    const missedCalls = filteredCalls.filter((c) => c.status === 'Missed').length;
    const totalLeads = filteredLeads.length;
    const qualifiedLeads = filteredLeads.filter((l) =>
      ['Qualified', 'Appointment Scheduled', 'In Progress', 'Converted'].includes(l.status)
    ).length;
    const conversionRate =
      totalCalls > 0 ? Math.round((totalLeads / totalCalls) * 100) : 0;
    const pipelineValue = filteredLeads
      .filter((l) => l.status !== 'Lost')
      .reduce((sum, l) => sum + l.estimatedValue, 0);

    return {
      totalCalls,
      aiAnswered,
      missedCalls,
      totalLeads,
      qualifiedLeads,
      conversionRate,
      pipelineValue,
    };
  }, [filteredCalls, filteredLeads]);

  const featuredCall =
    filteredCalls.find((c) => c.status === 'Active') || filteredCalls[0] || workspace.calls[0];

  const plumbingCount = filteredLeads.filter((l) => l.trade === 'Plumbing').length;
  const electricalCount = filteredLeads.filter((l) => l.trade === 'Electrical').length;
  const totalTrade = plumbingCount + electricalCount || 1;
  const plumbingPct = Math.round((plumbingCount / totalTrade) * 100);
  const electricalPct = 100 - plumbingPct;

  const hourlyBuckets = useMemo(() => {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    return hours.map((h) => ({
      label: h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`,
      total: filteredCalls.filter((c) => c.hourOfDay === h).length,
      urgent: filteredCalls.filter((c) => c.hourOfDay === h && c.urgency !== 'Normal').length,
    }));
  }, [filteredCalls]);

  const maxHourVal = Math.max(...hourlyBuckets.map((b) => b.total), 2);
  const onCallTech = workspace.team.find((m) => m.onCall) || workspace.team[1];
  const urgentLeads = filteredLeads.filter((l) => l.urgency !== 'Normal');

  return (
    <div className="space-y-8">
      {/* Date Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1 p-1 bg-white border border-[#ECE6DC] rounded-lg w-full sm:w-auto">
          {(
            [
              {id: 'today', label: 'Today'},
              {id: '7d', label: 'Last 7 Days'},
              {id: '30d', label: 'Last 30 Days'},
              {id: 'custom', label: 'Custom Range'},
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDateRange(item.id)}
              className={`px-3 py-2 sm:py-1.5 rounded-md text-[12px] font-semibold transition-colors cursor-pointer ${
                dateRange === item.id
                  ? 'bg-[#1C1F22] text-white'
                  : 'text-[#7A746B] hover:text-[#1C1F22]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {dateRange === 'custom' && (
          <div className="flex items-center gap-2 text-[13px]">
            <label htmlFor="custom-days" className="label-caps text-[#7A746B]">
              Lookback Days:
            </label>
            <input
              id="custom-days"
              type="number"
              min={1}
              max={90}
              value={customDays}
              onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 h-9 px-2.5 rounded-lg bg-white border border-[#ECE6DC] font-mono text-[13px] tabular-nums"
            />
          </div>
        )}
      </div>

      {/* 6 Top Stats Row (Matching Stitch Dashboard Screenshot) */}
      <section aria-label="Primary performance metrics" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {[
          {
            label: 'Total Calls',
            value: stats.totalCalls,
            sub: 'All inbound rings',
            trend: '+12%',
            spark: [2, 3, 2, 4, 5, 4, stats.totalCalls],
            color: '#C8672B',
          },
          {
            label: 'AI Answered Calls',
            value: stats.aiAnswered,
            sub: `Timeout ${workspace.phoneSetup.ringTimeoutSec}s`,
            trend: '100% intake',
            spark: [1, 2, 2, 3, 4, 3, stats.aiAnswered],
            color: '#2E8B57',
          },
          {
            label: 'Missed Calls',
            value: stats.missedCalls,
            sub: stats.missedCalls === 0 ? 'Zero uncaptured' : 'Text-back queued',
            trend: stats.missedCalls === 0 ? 'Nominal' : 'Follow up',
            spark: [1, 0, 1, 0, 0, 0, stats.missedCalls],
            color: stats.missedCalls > 0 ? '#D64545' : '#2E8B57',
          },
          {
            label: 'Total Leads',
            value: stats.totalLeads,
            sub: 'Saved to CRM',
            trend: '+18%',
            spark: [1, 2, 3, 3, 4, 5, stats.totalLeads],
            color: '#C8672B',
          },
          {
            label: 'Qualified Leads',
            value: stats.qualifiedLeads,
            sub: 'Verified address & scope',
            trend: 'Ready to book',
            spark: [1, 1, 2, 2, 3, 3, stats.qualifiedLeads],
            color: '#F2A93B',
          },
          {
            label: 'Conversion Rate',
            value: `${stats.conversionRate}%`,
            sub: 'Call → Lead capture',
            trend: 'Live calc',
            spark: [65, 72, 78, 82, 85, 90, stats.conversionRate],
            color: '#2E8B57',
          },
        ].map((card) => (
          <div key={card.label} className="card-tier-1 p-3.5 sm:p-4 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-1">
              <span className="label-caps text-[#7A746B] truncate">{card.label}</span>
              <TrendingUp className="w-3.5 h-3.5 text-[#2E8B57] shrink-0" />
            </div>
            <div className="flex items-end justify-between gap-1.5 pt-1">
              <p className="font-display font-extrabold text-[22px] sm:text-[28px] leading-none text-[#1C1F22] tabular-nums">
                {card.value}
              </p>
              <div className="hidden sm:block">
                <MiniSparkline points={card.spark} color={card.color} />
              </div>
            </div>
            <p className="text-[11px] text-[#7A746B] truncate">
              {card.trend} · {card.sub}
            </p>
          </div>
        ))}
      </section>

      {/* Main 12-Column Grid (8 cols left + 4 cols right, matching Stitch) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT 8 COLUMNS */}
        <div className="xl:col-span-8 space-y-6">
          {/* AI Agent Status & Live Incoming Voice Monitor */}
          <section className="card-tier-1 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#ECE6DC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EBF6F0] text-[#2E8B57] border border-[#2E8B57]/25 label-caps shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#2E8B57] animate-pulse" aria-hidden="true" />
                  <span>Live</span>
                </span>
                <div className="min-w-0">
                  <h2 className="headline-sm text-[#1C1F22] truncate">
                    AI Agent Status · {workspace.voiceAgent.agentName}
                  </h2>
                  <p className="text-[12px] text-[#7A746B] break-words">
                    Demo number <span className="font-mono text-[#1C1F22]">{workspace.phoneSetup.systemNumber}</span> <SimulatedNumberBadge className="mx-1" /> · Timeout <span className="font-mono">{workspace.phoneSetup.ringTimeoutSec}s</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate('/app/test-agent')}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#1C1F22] text-[#F2A93B] hover:bg-[#2B3035] cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Test Live Voice</span>
                </button>
                {featuredCall && (
                  <button
                    type="button"
                    onClick={() => onNavigate(`/app/calls/${featuredCall.id}`)}
                    className="btn-primary text-[12px] py-2 px-3.5 cursor-pointer"
                  >
                    Inspect Call
                  </button>
                )}
              </div>
            </div>

            {featuredCall ? (
              <div className="p-4 sm:p-5 space-y-4">
                <div className="rounded-xl bg-[#1C1F22] text-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="label-caps text-[#F2A93B]">{featuredCall.trade}</span>
                      <span className="text-[#7A746B]">·</span>
                      <span className="font-mono text-[12px] text-[#C8C3BA]">
                        {featuredCall.callerPhone}
                      </span>
                    </div>
                    <p className="font-display font-bold text-[15px] sm:text-[16px] mt-1">
                      {featuredCall.callerName} — {featuredCall.serviceRequested}
                    </p>
                  </div>

                  {/* Mini Waveform */}
                  <div className="flex items-end gap-[3px] h-7 sm:h-8 shrink-0" aria-hidden="true">
                    {featuredCall.waveform.slice(0, 20).map((bar, idx) => (
                      <span
                        key={idx}
                        style={{height: `${Math.max(20, bar)}%`}}
                        className={`w-[3px] rounded-full ${
                          idx < 11 ? 'bg-[#C8672B]' : 'bg-[#F2A93B]/60'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Latest Transcript Bubbles */}
                <div className="space-y-2.5">
                  {featuredCall.transcript.slice(0, 3).map((turn) => (
                    <div
                      key={turn.id}
                      className={`rounded-xl px-3.5 sm:px-4 py-2.5 text-[13.5px] sm:text-[14px] ${
                        turn.speaker === 'agent'
                          ? 'bg-[#FAF7F2] border border-[#ECE6DC] mr-3 sm:mr-8'
                          : 'bg-white border border-[#ECE6DC] ml-3 sm:ml-8 shadow-[0_1px_2px_rgba(28,31,34,0.04)]'
                      }`}
                    >
                      <span className="label-caps text-[#C8672B] block mb-0.5">
                        {turn.speaker === 'agent'
                          ? `${workspace.voiceAgent.agentName} · AI Receptionist`
                          : featuredCall.callerName}
                      </span>
                      <p className="text-[#23282D]">{turn.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-[14px] text-[#7A746B]">
                No calls recorded in the selected date window.
              </div>
            )}
          </section>

          {/* Calls Overview & Hourly Volume Bar Chart */}
          <section className="card-tier-1 p-4 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="label-caps text-[#7A746B]">Call Answering Performance</span>
                <h2 className="headline-sm text-[#1C1F22] mt-0.5">
                  Hourly Call Volume &amp; Urgent Dispatches
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/app/analytics')}
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                <span>Full Analytics</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            <div className="h-40 sm:h-44 flex items-end gap-1.5 sm:gap-3 pt-4 border-b border-[#ECE6DC] pb-2">
              {hourlyBuckets.map((bucket) => {
                const totalPct = Math.round((bucket.total / maxHourVal) * 100);
                const urgentPct = Math.round((bucket.urgent / maxHourVal) * 100);
                return (
                  <div key={bucket.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end min-w-0">
                    <div className="w-full max-w-[28px] flex items-end justify-center gap-0.5 sm:gap-1 h-full">
                      <div
                        style={{height: `${Math.max(8, totalPct)}%`}}
                        title={`${bucket.total} calls at ${bucket.label}`}
                        className="w-2.5 sm:w-3 rounded-t bg-[#1C1F22] transition-all"
                      />
                      {bucket.urgent > 0 && (
                        <div
                          style={{height: `${Math.max(8, urgentPct)}%`}}
                          title={`${bucket.urgent} urgent at ${bucket.label}`}
                          className="w-2.5 sm:w-3 rounded-t bg-[#C8672B] transition-all"
                        />
                      )}
                    </div>
                    <span className="font-mono text-[10px] sm:text-[11px] text-[#7A746B] tabular-nums">
                      {bucket.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-[12px] text-[#7A746B]">
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#1C1F22]" /> Total Calls
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#C8672B]" /> Urgent / Emergency Dispatches
              </span>
            </div>
          </section>

          {/* Recent Calls (Mobile Card View + Desktop Table) */}
          <section className="card-tier-1 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#ECE6DC] flex items-center justify-between gap-3">
              <div>
                <h2 className="headline-sm text-[#1C1F22]">Recent Calls</h2>
                <p className="text-[12px] text-[#7A746B]">
                  Live transcripts, answer source, and urgency triage
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/app/calls')}
                className="text-[13px] font-semibold text-[#C8672B] hover:underline whitespace-nowrap cursor-pointer"
              >
                View All →
              </button>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-[#ECE6DC]">
              {filteredCalls.slice(0, 5).map((call) => (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => onNavigate(`/app/calls/${call.id}`)}
                  className="w-full text-left p-4 hover:bg-[#FBEBDD]/50 space-y-2 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[14.5px] text-[#1C1F22]">{call.callerName}</p>
                      <p className="font-mono text-[12px] text-[#7A746B]">{call.callerPhone}</p>
                    </div>
                    <CallStatusBadge status={call.status} />
                  </div>
                  <p className="text-[13px] text-[#23282D]">{call.serviceRequested}</p>
                  <div className="flex items-center justify-between text-[12px] text-[#7A746B]">
                    <TradeLabel trade={call.trade} />
                    <span className="font-mono tabular-nums">
                      {call.answeredBy} · {formatDuration(call.durationSec)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF7F2] border-b border-[#ECE6DC]">
                    <th className="py-3 px-5 label-caps text-[#7A746B]">Caller</th>
                    <th className="py-3 px-4 label-caps text-[#7A746B]">Service &amp; Trade</th>
                    <th className="py-3 px-4 label-caps text-[#7A746B]">Answered By</th>
                    <th className="py-3 px-4 label-caps text-[#7A746B]">Duration</th>
                    <th className="py-3 px-5 label-caps text-[#7A746B]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE6DC]">
                  {filteredCalls.slice(0, 5).map((call) => (
                    <tr
                      key={call.id}
                      onClick={() => onNavigate(`/app/calls/${call.id}`)}
                      className="hover:bg-[#FBEBDD]/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-[14px] text-[#1C1F22]">{call.callerName}</p>
                        <p className="font-mono text-[12px] text-[#7A746B]">{call.callerPhone}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-[13px] font-medium text-[#23282D]">{call.serviceRequested}</p>
                        <TradeLabel trade={call.trade} />
                      </td>
                      <td className="py-3.5 px-4 text-[13px] text-[#23282D]">{call.answeredBy}</td>
                      <td className="py-3.5 px-4 font-mono text-[13px] text-[#7A746B] tabular-nums">
                        {formatDuration(call.durationSec)}
                      </td>
                      <td className="py-3.5 px-5">
                        <CallStatusBadge status={call.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent Leads Table */}
          <section className="card-tier-1 overflow-hidden">
            <div className="p-5 border-b border-[#ECE6DC] flex items-center justify-between">
              <h2 className="headline-sm text-[#1C1F22]">Recent Leads</h2>
              <button
                type="button"
                onClick={() => onNavigate('/app/leads')}
                className="text-[13px] font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                Manage All Leads →
              </button>
            </div>
            <div className="divide-y divide-[#ECE6DC]">
              {filteredLeads.slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onNavigate(`/app/leads/${lead.id}`)}
                  className="w-full text-left px-5 py-3.5 hover:bg-[#FBEBDD]/50 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                >
                  <div>
                    <p className="font-semibold text-[14px] text-[#1C1F22]">
                      {lead.name} · <span className="font-normal text-[#7A746B]">{lead.serviceType}</span>
                    </p>
                    <p className="text-[12px] text-[#7A746B] mt-0.5">
                      {lead.trade} · {lead.fullAddress}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <UrgencyBadge urgency={lead.urgency} />
                    <LeadStatusBadge status={lead.status} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* RIGHT 4 COLUMNS */}
        <div className="xl:col-span-4 space-y-6">
          {/* Dark Revenue Protection Card (Matching Stitch Right Rail) */}
          <section className="rounded-xl bg-[#1C1F22] text-white p-6 space-y-3">
            <span className="label-caps text-[#F2A93B]">Revenue Protection</span>
            <p className="font-display font-extrabold text-[34px] leading-none tabular-nums">
              {formatCurrency(stats.pipelineValue)}
            </p>
            <p className="text-[13px] leading-relaxed text-[#C8C3BA]">
              Estimated pipeline captured across {stats.totalLeads} qualified inquiries answered while technicians were in the field.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/app/leads')}
              className="btn-primary w-full text-[13px] mt-2 cursor-pointer"
            >
              Review Captured Pipeline
            </button>
          </section>

          {/* Field Readiness / On-Call Roster */}
          <section className="card-tier-1 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="label-caps text-[#7A746B]">Field Readiness</span>
              <Truck className="w-4 h-4 text-[#C8672B]" />
            </div>
            {onCallTech && (
              <div>
                <p className="font-display font-bold text-[16px] text-[#1C1F22]">
                  {onCallTech.name}
                </p>
                <p className="text-[12px] text-[#7A746B] mt-0.5">
                  On-Call {onCallTech.tradeSpecialty} · {onCallTech.truckCode} · {onCallTech.phone}
                </p>
              </div>
            )}
            <div className="pt-2 border-t border-[#ECE6DC] flex items-center justify-between text-[12px]">
              <span className="text-[#2E8B57] font-semibold">Emergency SMS Routing: Active</span>
              <button
                type="button"
                onClick={() => onNavigate('/app/settings/emergency')}
                className="font-semibold text-[#C8672B] hover:underline cursor-pointer"
              >
                Configure
              </button>
            </div>
          </section>

          {/* Plumbing vs Electrical Donut & Service Classification */}
          <section className="card-tier-1 p-5 space-y-4">
            <span className="label-caps text-[#7A746B]">Plumbing vs Electrical Split</span>
            <div className="flex items-center gap-5">
              <svg width="88" height="88" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#F2A93B"
                  strokeWidth="5"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#C8672B"
                  strokeWidth="5"
                  strokeDasharray={`${plumbingPct} ${100 - plumbingPct}`}
                />
              </svg>
              <div className="space-y-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-[#C8672B]" />
                  <span className="font-semibold text-[#1C1F22]">Plumbing: {plumbingPct}%</span>
                  <span className="text-[#7A746B]">({plumbingCount})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-[#F2A93B]" />
                  <span className="font-semibold text-[#1C1F22]">Electrical: {electricalPct}%</span>
                  <span className="text-[#7A746B]">({electricalCount})</span>
                </div>
              </div>
            </div>
          </section>

          {/* Urgent Requests */}
          <section className="card-tier-1 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="label-caps text-[#D64545]">Urgent Requests</span>
              <span className="font-mono text-[12px] font-bold text-[#1C1F22]">
                {urgentLeads.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {urgentLeads.slice(0, 3).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onNavigate(`/app/leads/${lead.id}`)}
                  className="w-full text-left p-3 rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] hover:border-[#C8672B] transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px] text-[#1C1F22] truncate">
                      {lead.name}
                    </span>
                    <UrgencyBadge urgency={lead.urgency} />
                  </div>
                  <p className="text-[12px] text-[#7A746B] mt-1 truncate">{lead.serviceType}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Active Forwarding Sync */}
          <section className="card-tier-1 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="label-caps text-[#7A746B]">Forwarding Status</span>
              <PhoneForwarded className="w-4 h-4 text-[#C8672B]" />
            </div>
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-[#23282D]">{workspace.phoneSetup.carrier} Forwarding</span>
                <span className="inline-flex items-center gap-1 text-[#2E8B57] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#23282D]">After-Hours AI Routing</span>
                <span className="font-semibold text-[#1C1F22]">
                  {workspace.phoneSetup.afterHoursForwarding ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/app/phone-setup')}
              className="btn-secondary w-full text-[12px] py-2 cursor-pointer"
            >
              <PhoneCall className="w-3.5 h-3.5 inline mr-1.5" />
              Manage Phone Setup
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
