import {useEffect, useMemo, useState} from 'react';
import {CheckCircle2, Plus, ShieldAlert, Trash2, Users, X} from 'lucide-react';
import {formatCurrency} from '../../components/StatusBadges';
import {usePageSeo} from '../../lib/seo';
import {apiRequest} from '../../lib/api';
import type {
  BusinessSettingsData,
  TeamMember,
  TenantWorkspace,
  TradeCategory,
  VoiceAgentConfig,
} from '../../types/plumbvoice';

export function AnalyticsPage({workspace}: {workspace: TenantWorkspace}) {
  usePageSeo({
    title: 'Analytics & Reports — PlumbVoice AI',
    description: 'Answer rate, lead conversion, peak call hours, and trade breakdown.',
    path: '/app/analytics',
    noindex: true,
  });

  const stats = useMemo(() => {
    const calls = workspace.calls;
    const leads = workspace.leads;
    const answered = calls.filter((c) => c.status !== 'Missed').length;
    const answerRate = calls.length > 0 ? Math.round((answered / calls.length) * 100) : 0;
    const convRate = calls.length > 0 ? Math.round((leads.length / calls.length) * 100) : 0;
    const emergencyCount = leads.filter((l) => l.urgency === 'Emergency').length;
    const urgentCount = leads.filter((l) => l.urgency === 'Urgent').length;
    const normalCount = leads.filter((l) => l.urgency === 'Normal').length;
    const totalPipeline = leads
      .filter((l) => l.status !== 'Lost')
      .reduce((sum, l) => sum + l.estimatedValue, 0);

    const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const peakBuckets = hours.map((h) => ({
      label: h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`,
      count: calls.filter((c) => c.hourOfDay === h).length,
    }));

    return {
      answerRate,
      convRate,
      emergencyCount,
      urgentCount,
      normalCount,
      totalPipeline,
      peakBuckets,
      plumbingLeads: leads.filter((l) => l.trade === 'Plumbing').length,
      electricalLeads: leads.filter((l) => l.trade === 'Electrical').length,
    };
  }, [workspace]);

  // Call quality: counted only from real calls (test calls excluded). Nothing here is estimated.
  const quality = useMemo(() => {
    const real = workspace.calls.filter((c) => !c.isTest);
    const spam = real.filter((c) => c.tags?.includes('spam'));
    const genuine = real.filter((c) => !c.tags?.includes('spam'));
    const missed = genuine.filter((c) => c.status === 'Missed').length;
    const veryShort = genuine.filter((c) => c.status !== 'Missed' && c.durationSec < 15).length;
    const callbacks = genuine.filter((c) => c.tags?.includes('callback')).length;
    const spanish = genuine.filter((c) => c.language === 'es').length;
    const avg = genuine.length ? Math.round(genuine.reduce((s, c) => s + c.durationSec, 0) / genuine.length) : 0;
    const locs = workspace.extras?.locations ?? [];
    const byLocation = locs.map((l) => ({name: l.name, count: workspace.leads.filter((x) => !x.isTest && x.locationId === l.id).length}));
    return {total: real.length, spam: spam.length, missed, veryShort, callbacks, spanish, avg, byLocation};
  }, [workspace]);

  const maxPeak = Math.max(...stats.peakBuckets.map((b) => b.count), 2);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card-tier-1 p-6">
          <span className="label-caps text-[#7A746B]">Answer Rate</span>
          <p className="metric-stat text-[#1C1F22] mt-2">{stats.answerRate}%</p>
          <p className="text-[13px] text-[#2E8B57] mt-1">Inbound calls answered</p>
        </div>
        <div className="card-tier-1 p-6">
          <span className="label-caps text-[#7A746B]">Lead Conversion</span>
          <p className="metric-stat text-[#1C1F22] mt-2">{stats.convRate}%</p>
          <p className="text-[13px] text-[#7A746B] mt-1">Calls converted to leads</p>
        </div>
        <div className="card-tier-1 p-6">
          <span className="label-caps text-[#D64545]">Urgent + Emergency</span>
          <p className="metric-stat text-[#1C1F22] mt-2">
            {stats.emergencyCount + stats.urgentCount}
          </p>
          <p className="text-[13px] text-[#7A746B] mt-1">
            {stats.emergencyCount} emergency · {stats.urgentCount} urgent
          </p>
        </div>
        <div className="card-tier-1 p-6">
          <span className="label-caps text-[#C8672B]">Pipeline Captured</span>
          <p className="metric-stat text-[#1C1F22] mt-2">
            {formatCurrency(stats.totalPipeline)}
          </p>
          <p className="text-[13px] text-[#7A746B] mt-1">Active job value</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 card-tier-1 p-6 space-y-4">
          <div>
            <span className="label-caps text-[#C8672B]">Call Distribution</span>
            <h2 className="headline-sm text-[#1C1F22] mt-0.5">Peak Call Hours</h2>
          </div>
          <div className="h-52 flex items-end gap-3 border-b border-[#ECE6DC] pb-2 pt-4">
            {stats.peakBuckets.map((b) => (
              <div key={b.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <div
                  style={{height: `${Math.max(8, Math.round((b.count / maxPeak) * 100))}%`}}
                  className="w-full max-w-[26px] rounded-t bg-[#C8672B]"
                  title={`${b.count} calls`}
                />
                <span className="font-mono text-[11px] text-[#7A746B] tabular-nums">
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-4 card-tier-1 p-6 space-y-5">
          <div>
            <span className="label-caps text-[#7A746B]">Service &amp; Urgency Breakdown</span>
            <h2 className="headline-sm text-[#1C1F22] mt-0.5">Trade &amp; Priority Mix</h2>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[13px] mb-1">
                <span className="font-semibold text-[#1C1F22]">Plumbing Leads</span>
                <span className="font-mono">{stats.plumbingLeads}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[#FAF7F2] overflow-hidden">
                <div
                  className="h-full bg-[#C8672B]"
                  style={{
                    width: `${Math.round(
                      (stats.plumbingLeads / Math.max(1, stats.plumbingLeads + stats.electricalLeads)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[13px] mb-1">
                <span className="font-semibold text-[#1C1F22]">Electrical Leads</span>
                <span className="font-mono">{stats.electricalLeads}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[#FAF7F2] overflow-hidden">
                <div
                  className="h-full bg-[#F2A93B]"
                  style={{
                    width: `${Math.round(
                      (stats.electricalLeads / Math.max(1, stats.plumbingLeads + stats.electricalLeads)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#ECE6DC] space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#D64545] font-semibold">Emergency Priority</span>
              <span className="font-mono font-bold">{stats.emergencyCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#B47010] font-semibold">Urgent Same-Day</span>
              <span className="font-mono font-bold">{stats.urgentCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#2E8B57] font-semibold">Normal Scheduled</span>
              <span className="font-mono font-bold">{stats.normalCount}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="card-tier-1 p-6 space-y-4">
        <div>
          <span className="label-caps text-[#7A746B]">Call Quality</span>
          <h2 className="headline-sm text-[#1C1F22] mt-0.5">Quality &amp; Follow-up</h2>
          <p className="text-[12.5px] text-[#7A746B]">
            {quality.total > 0 ? `Counted from ${quality.total} real call${quality.total === 1 ? '' : 's'}. Test calls are left out.` : 'No real calls yet. These numbers fill in after your first live call.'}
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {[
            ['Missed calls', quality.missed],
            ['Hung up under 15s', quality.veryShort],
            ['Needs callback', quality.callbacks],
            ['Spam blocked', quality.spam],
            ['Spanish calls', quality.spanish],
            ['Avg call length', `${Math.floor(quality.avg / 60)}m ${quality.avg % 60}s`],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-[#FAF7F2] border border-[#ECE6DC] p-3">
              <span className="label-caps text-[#7A746B]">{label}</span>
              <p className="font-mono font-bold text-[18px] text-[#1C1F22] mt-1">{value}</p>
            </div>
          ))}
        </div>
        {quality.byLocation.length > 0 && (
          <div className="pt-4 border-t border-[#ECE6DC] space-y-2 text-[13px]">
            <span className="label-caps text-[#7A746B]">Leads by location</span>
            {quality.byLocation.map((l) => (
              <div key={l.name} className="flex justify-between">
                <span className="font-semibold text-[#1C1F22]">{l.name}</span>
                <span className="font-mono font-bold">{l.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function TeamManagementPage({
  team,
  onInvite,
  onToggleOnCall,
  onRemove,
}: {
  team: TeamMember[];
  onInvite: (payload: Partial<TeamMember>) => Promise<void>;
  onToggleOnCall: (id: string, onCall: boolean) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('Technician');
  const [tradeSpecialty, setTradeSpecialty] = useState<TradeCategory | 'Both'>('Plumbing');
  const [truckCode, setTruckCode] = useState('Truck 12');

  usePageSeo({
    title: 'Team Management — PlumbVoice AI',
    description: 'Invite plumbers, electricians, and dispatchers with role-based permissions.',
    path: '/app/team',
    noindex: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onInvite({name, email, phone, role, tradeSpecialty, truckCode});
    setShowInvite(false);
    setName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div className="space-y-6">
      <div className="card-tier-1 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-[#C8672B] shrink-0" />
          <div>
            <h2 className="headline-sm text-[#1C1F22]">Dispatchers &amp; Field Technicians</h2>
            <p className="text-[13px] text-[#7A746B]">
              Manage on-call escalation rotation and role-based dashboard permissions.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="btn-primary w-full sm:w-auto text-[13px] inline-flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Invite Member</span>
        </button>
      </div>

      <div className="card-tier-1 overflow-hidden">
        {/* Mobile Member Cards */}
        <div className="md:hidden divide-y divide-[#ECE6DC]">
          {team.map((m) => (
            <div key={m.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display font-semibold text-[15px] text-[#1C1F22]">{m.name}</p>
                  <p className="text-[12px] text-[#7A746B] break-all">{m.email}</p>
                  <p className="font-mono text-[12px] text-[#C8672B] mt-0.5">{m.phone}</p>
                </div>
                {m.role !== 'Owner' && (
                  <button
                    type="button"
                    onClick={() => onRemove(m.id)}
                    className="p-2 rounded-lg text-[#7A746B] hover:text-[#D64545] cursor-pointer"
                    aria-label={`Remove ${m.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#ECE6DC]/70 text-[12.5px]">
                <span className="font-medium text-[#1C1F22]">
                  {m.role} · {m.tradeSpecialty} · <span className="font-mono">{m.truckCode}</span>
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={m.onCall}
                    onChange={(e) => onToggleOnCall(m.id, e.target.checked)}
                    className="checkbox-crafted"
                  />
                  <span className="font-medium text-[#23282D]">
                    {m.onCall ? 'On-Call Active' : 'Off Duty'}
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#ECE6DC]">
                <th className="py-3.5 px-5 label-caps text-[#7A746B]">Member</th>
                <th className="py-3.5 px-4 label-caps text-[#7A746B]">Role &amp; Trade</th>
                <th className="py-3.5 px-4 label-caps text-[#7A746B]">Truck / Desk</th>
                <th className="py-3.5 px-4 label-caps text-[#7A746B]">On-Call SMS</th>
                <th className="py-3.5 px-5 label-caps text-[#7A746B] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE6DC]">
              {team.map((m) => (
                <tr key={m.id}>
                  <td className="py-4 px-5">
                    <p className="font-display font-semibold text-[15px] text-[#1C1F22]">{m.name}</p>
                    <p className="text-[12px] text-[#7A746B]">
                      {m.email} · <span className="font-mono">{m.phone}</span>
                    </p>
                  </td>
                  <td className="py-4 px-4">
                    <p className="text-[13px] font-semibold text-[#1C1F22]">{m.role}</p>
                    <p className="text-[12px] text-[#7A746B]">{m.tradeSpecialty}</p>
                  </td>
                  <td className="py-4 px-4 font-mono text-[13px] text-[#23282D]">{m.truckCode}</td>
                  <td className="py-4 px-4">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={m.onCall}
                        onChange={(e) => onToggleOnCall(m.id, e.target.checked)}
                        className="checkbox-crafted"
                      />
                      <span className="text-[12.5px] font-medium text-[#23282D]">
                        {m.onCall ? 'On-Call Active' : 'Off Duty'}
                      </span>
                    </label>
                  </td>
                  <td className="py-4 px-5 text-right">
                    {m.role !== 'Owner' && (
                      <button
                        type="button"
                        onClick={() => onRemove(m.id)}
                        className="p-2 rounded-lg text-[#7A746B] hover:text-[#D64545] cursor-pointer"
                        aria-label={`Remove ${m.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1F22]/55" role="dialog" aria-modal="true">
          <div className="modal-tier-3 w-full max-w-md p-6 space-y-4">
            <h3 className="headline-md text-[#1C1F22]">Invite Team Member</h3>
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="label-caps text-[#7A746B] block mb-1">Full Name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="input-crafted w-full px-3" />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1">Work Email</label>
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-crafted w-full px-3" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Phone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-crafted w-full px-3 font-mono" />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Truck / Unit</label>
                  <input value={truckCode} onChange={(e) => setTruckCode(e.target.value)} className="input-crafted w-full px-3 font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as TeamMember['role'])} className="input-crafted w-full px-3">
                    <option value="Dispatcher">Dispatcher</option>
                    <option value="Technician">Technician</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1">Trade</label>
                  <select value={tradeSpecialty} onChange={(e) => setTradeSpecialty(e.target.value as TradeCategory | 'Both')} className="input-crafted w-full px-3">
                    <option value="Plumbing">Plumbing</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Both">Both</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowInvite(false)} className="btn-secondary cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="btn-primary cursor-pointer">
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsSubPages({
  subPage,
  settings,
  voiceAgent,
  onNavigate,
  onSaveSettings,
  onSaveAgent,
}: {
  subPage: 'profile' | 'hours' | 'knowledge' | 'emergency';
  settings: BusinessSettingsData;
  voiceAgent: VoiceAgentConfig;
  onNavigate: (path: string) => void;
  onSaveSettings: (patch: Partial<BusinessSettingsData>) => Promise<void>;
  onSaveAgent: (patch: Partial<VoiceAgentConfig>) => Promise<void>;
}) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [draftKnowledge, setDraftKnowledge] = useState(voiceAgent.aiKnowledgeNotes);
  const [newKw, setNewKw] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  usePageSeo({
    title: `Settings: ${subPage} — PlumbVoice AI`,
    description: 'Configure business profile, working hours, AI knowledge base, and emergency rules.',
    path: `/app/settings/${subPage}`,
    noindex: true,
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subPage === 'knowledge') {
      await onSaveAgent({aiKnowledgeNotes: draftKnowledge});
    } else {
      await onSaveSettings(draftSettings);
    }
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2400);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Sub-page Tabs */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1 p-1 bg-white border border-[#ECE6DC] rounded-lg w-full sm:w-fit">
        {(
          [
            {id: 'profile', label: 'Business Profile', path: '/app/settings/profile'},
            {id: 'hours', label: 'Working Hours', path: '/app/settings/hours'},
            {id: 'knowledge', label: 'AI Knowledge', path: '/app/settings/knowledge'},
            {id: 'emergency', label: 'Emergency Rules', path: '/app/settings/emergency'},
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onNavigate(tab.path)}
            className={`px-3 py-2 rounded-md text-[12.5px] sm:text-[13px] font-semibold cursor-pointer ${
              subPage === tab.id ? 'bg-[#1C1F22] text-white' : 'text-[#7A746B] hover:text-[#1C1F22]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {savedNotice && (
        <div className="rounded-xl bg-[#EBF6F0] border border-[#2E8B57]/30 px-4 py-3 text-[13px] font-semibold text-[#2E8B57] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Settings updated and synced.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="card-tier-1 p-6 space-y-5">
        {subPage === 'profile' && (
          <>
            <h2 className="headline-md text-[#1C1F22]">Business Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Business Name</label>
                <input
                  value={draftSettings.businessName}
                  onChange={(e) => setDraftSettings({...draftSettings, businessName: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">State License Numbers</label>
                <input
                  value={draftSettings.licenseNumber}
                  onChange={(e) => setDraftSettings({...draftSettings, licenseNumber: e.target.value})}
                  className="input-crafted w-full px-3 font-mono"
                />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Dispatch Notification Email</label>
                <input
                  type="email"
                  value={draftSettings.dispatchEmail}
                  onChange={(e) => setDraftSettings({...draftSettings, dispatchEmail: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Timezone</label>
                <input
                  value={draftSettings.timezone}
                  onChange={(e) => setDraftSettings({...draftSettings, timezone: e.target.value})}
                  className="input-crafted w-full px-3"
                />
              </div>
            </div>
          </>
        )}

        {subPage === 'hours' && (
          <>
            <h2 className="headline-md text-[#1C1F22]">Weekly Schedule &amp; Holidays</h2>
            <div className="divide-y divide-[#ECE6DC]">
              {draftSettings.workingHours.map((row, idx) => (
                <div key={row.day} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-3 w-36 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          workingHours: draftSettings.workingHours.map((r, i) =>
                            i === idx ? {...r, enabled: e.target.checked} : r
                          ),
                        })
                      }
                      className="checkbox-crafted"
                    />
                    <span className="font-medium text-[14px]">{row.day}</span>
                  </label>
                  {row.enabled ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={row.open}
                        onChange={(e) =>
                          setDraftSettings({
                            ...draftSettings,
                            workingHours: draftSettings.workingHours.map((r, i) =>
                              i === idx ? {...r, open: e.target.value} : r
                            ),
                          })
                        }
                        className="h-9 px-2.5 rounded-lg border border-[#ECE6DC] font-mono text-[13px]"
                      />
                      <span className="text-[12px] text-[#7A746B]">to</span>
                      <input
                        type="time"
                        value={row.close}
                        onChange={(e) =>
                          setDraftSettings({
                            ...draftSettings,
                            workingHours: draftSettings.workingHours.map((r, i) =>
                              i === idx ? {...r, close: e.target.value} : r
                            ),
                          })
                        }
                        className="h-9 px-2.5 rounded-lg border border-[#ECE6DC] font-mono text-[13px]"
                      />
                    </div>
                  ) : (
                    <span className="text-[13px] text-[#7A746B]">24/7 AI After-Hours Coverage</span>
                  )}
                </div>
              ))}
            </div>
            <label className="flex items-center gap-3 pt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draftSettings.holidayAutoAfterHours}
                onChange={(e) =>
                  setDraftSettings({...draftSettings, holidayAutoAfterHours: e.target.checked})
                }
                className="checkbox-crafted"
              />
              <span className="text-[14px]">Automatically route federal US holidays to after-hours AI coverage</span>
            </label>
          </>
        )}

        {subPage === 'knowledge' && (
          <>
            <h2 className="headline-md text-[#1C1F22]">AI Knowledge &amp; Scope Guardrails</h2>
            <p className="text-[13px] text-[#7A746B]">
              Define services you accept, brands you stock, and pricing disclosure policies. Nora references these facts during live calls.
            </p>
            <textarea
              rows={6}
              value={draftKnowledge}
              onChange={(e) => setDraftKnowledge(e.target.value)}
              className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px] leading-relaxed"
            />
          </>
        )}

        {subPage === 'emergency' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="headline-md text-[#1C1F22]">Emergency Triage Rules</h2>
              <ShieldAlert className="w-5 h-5 text-[#D64545]" />
            </div>

            <div className="flex flex-wrap gap-2">
              {draftSettings.emergencyRules.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FDF0F0] text-[#D64545] border border-[#D64545]/25 text-[12px] font-semibold"
                >
                  <span>{kw}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftSettings({
                        ...draftSettings,
                        emergencyRules: {
                          ...draftSettings.emergencyRules,
                          keywords: draftSettings.emergencyRules.keywords.filter((k) => k !== kw),
                        },
                      })
                    }
                    className="cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={newKw}
                onChange={(e) => setNewKw(e.target.value)}
                placeholder="Add emergency keyword..."
                className="input-crafted flex-1 px-3"
              />
              <button
                type="button"
                onClick={() => {
                  const clean = newKw.trim().toLowerCase();
                  if (clean && !draftSettings.emergencyRules.keywords.includes(clean)) {
                    setDraftSettings({
                      ...draftSettings,
                      emergencyRules: {
                        ...draftSettings.emergencyRules,
                        keywords: [...draftSettings.emergencyRules.keywords, clean],
                      },
                    });
                    setNewKw('');
                  }
                }}
                className="btn-secondary cursor-pointer"
              >
                Add
              </button>
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">On-Call Escalation Phone</label>
              <input
                value={draftSettings.emergencyRules.escalateToPhone}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    emergencyRules: {
                      ...draftSettings.emergencyRules,
                      escalateToPhone: e.target.value,
                    },
                  })
                }
                className="input-crafted w-full sm:w-64 px-3 font-mono"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draftSettings.emergencyRules.requireSafeShutoffGuidance}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    emergencyRules: {
                      ...draftSettings.emergencyRules,
                      requireSafeShutoffGuidance: e.target.checked,
                    },
                  })
                }
                className="checkbox-crafted"
              />
              <span className="text-[14px]">
                Require safe homeowner shutoff/evacuation guidance &amp; block DIY repair advice
              </span>
            </label>
          </>
        )}

        <div className="pt-3 border-t border-[#ECE6DC] flex justify-end">
          <button type="submit" className="btn-primary cursor-pointer">
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}

interface AuditRow {
  id: string;
  at: string;
  userEmail: string;
  role: string;
  action: string;
  target?: string;
}

/** Owner-only activity log. Hidden for other roles (the API answers 403). */
export function AuditLogCard() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    apiRequest<{log: AuditRow[]}>('/api/audit-log')
      .then((r) => alive && setRows(r.log))
      .catch(() => alive && setRows(null));
    return () => {
      alive = false;
    };
  }, []);
  if (!rows) return null;
  return (
    <div className="card-tier-1 p-6 space-y-3">
      <h3 className="headline-sm text-[#1C1F22]">Activity log</h3>
      <p className="text-[13px] text-[#7A746B]">Who changed what (latest 200 changes). Message contents are never stored here.</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[#7A746B]">No activity recorded yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto divide-y divide-[#ECE6DC] text-[13px]">
          {rows.map((r) => (
            <div key={r.id} className="py-2 flex flex-wrap justify-between gap-2">
              <span className="text-[#23282D]">
                <span className="font-semibold">{r.userEmail}</span> ({r.role}) · {r.action}
              </span>
              <span className="text-[#7A746B] font-mono text-[12px]">{new Date(r.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
