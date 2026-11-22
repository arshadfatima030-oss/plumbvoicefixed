import {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  PhoneCall,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  formatCurrency,
  formatDuration,
  LeadStatusBadge,
  TradeLabel,
  UrgencyBadge,
} from '../../components/StatusBadges';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';
import type {
  CallItem,
  QuoteItem,
  ReminderItem,
  LeadItem,
  LeadStatus,
  LeadUrgency,
  TeamMember,
  TradeCategory,
} from '../../types/plumbvoice';

const ALL_STATUSES: LeadStatus[] = [
  'New',
  'Contacted',
  'Qualified',
  'Appointment Scheduled',
  'In Progress',
  'Converted',
  'Lost',
];

export function LeadsListPage({
  leads,
  team,
  onNavigate,
  onCreateLead,
  onUpdateLead,
}: {
  leads: LeadItem[];
  team: TeamMember[];
  onNavigate: (path: string) => void;
  onCreateLead: (payload: Partial<LeadItem>) => Promise<void>;
  onUpdateLead: (id: string, patch: Partial<LeadItem>) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | LeadStatus>('All');
  const [urgencyFilter, setUrgencyFilter] = useState<'All' | LeadUrgency>('All');
  const [sortBy, setSortBy] = useState<'newest' | 'value' | 'urgency'>('newest');
  const [showAddModal, setShowAddModal] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTrade, setNewTrade] = useState<TradeCategory>('Plumbing');
  const [newService, setNewService] = useState('');
  const [newZip, setNewZip] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newUrgency, setNewUrgency] = useState<LeadUrgency>('Normal');

  usePageSeo({
    title: 'Leads CRM — PlumbVoice AI',
    description: 'Manage captured plumbing and electrical leads, urgency, and CSV export.',
    path: '/app/leads',
    noindex: true,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const urgencyRank: Record<LeadUrgency, number> = {Emergency: 3, Urgent: 2, Normal: 1};

    return leads
      .filter((l) => {
        const mStatus = statusFilter === 'All' || l.status === statusFilter;
        const mUrgency = urgencyFilter === 'All' || l.urgency === urgencyFilter;
        const mQ =
          !q ||
          l.name.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          l.serviceType.toLowerCase().includes(q) ||
          l.zip.toLowerCase().includes(q) ||
          l.fullAddress.toLowerCase().includes(q);
        return mStatus && mUrgency && mQ;
      })
      .sort((a, b) => {
        if (sortBy === 'value') return b.estimatedValue - a.estimatedValue;
        if (sortBy === 'urgency') return urgencyRank[b.urgency] - urgencyRank[a.urgency];
        return a.dayOffset - b.dayOffset;
      });
  }, [leads, search, statusFilter, urgencyFilter, sortBy]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateLead({
      name: newName,
      phone: newPhone,
      trade: newTrade,
      serviceType: newService,
      zip: newZip,
      fullAddress: newAddress,
      urgency: newUrgency,
      leadSource: 'Manual Entry',
    });
    setShowAddModal(false);
    setNewName('');
    setNewPhone('');
    setNewService('');
    setNewZip('');
    setNewAddress('');
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="card-tier-1 p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="relative w-full lg:w-64 sm:col-span-2">
            <Search className="w-4 h-4 text-[#7A746B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ZIP, service..."
              aria-label="Search leads"
              className="input-crafted w-full pl-9 pr-3"
            />
          </div>

          <select
            aria-label="Filter by lead status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | LeadStatus)}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="All">All Statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by urgency"
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value as 'All' | LeadUrgency)}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="All">All Urgencies</option>
            <option value="Emergency">Emergency</option>
            <option value="Urgent">Urgent</option>
            <option value="Normal">Normal</option>
          </select>

          <select
            aria-label="Sort leads"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'value' | 'urgency')}
            className="input-crafted w-full lg:w-auto px-3 text-[13px]"
          >
            <option value="newest">Sort: Newest</option>
            <option value="urgency">Sort: Highest Urgency</option>
            <option value="value">Sort: Highest Value</option>
          </select>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={async () => {
              // Fetched (not a plain link) so the emailed-code prompt can appear on an unsaved device.
              try {
                const csv = await apiRequest<string>('/api/leads/export/csv');
                const blob = new Blob(['\uFEFF', csv], {type: 'text/csv;charset=utf-8'}); // BOM so Excel reads accents correctly
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'plumbvoice-leads.csv';
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Export failed.');
              }
            }}
            className="btn-secondary inline-flex items-center justify-center gap-1.5 text-[13px] py-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#C8672B]" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="btn-primary inline-flex items-center justify-center gap-1.5 text-[13px] py-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Lead</span>
          </button>
        </div>
      </div>

      {/* Leads List */}
      {filtered.length === 0 ? (
        <div className="card-tier-1 p-10 sm:p-12 text-center space-y-3">
          <p className="headline-sm text-[#1C1F22]">No leads found</p>
          <p className="text-[14px] text-[#7A746B]">
            Try clearing your search or testing your AI Voice Agent to capture a new lead.
          </p>
        </div>
      ) : (
        <div className="card-tier-1 overflow-hidden">
          {/* Mobile Lead Cards */}
          <div className="md:hidden divide-y divide-[#ECE6DC]">
            {filtered.map((lead) => {
              const member = team.find((m) => m.id === lead.assignedMemberId);
              return (
                <div
                  key={lead.id}
                  onClick={() => onNavigate(`/app/leads/${lead.id}`)}
                  className="p-4 hover:bg-[#FBEBDD]/55 space-y-2.5 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display font-semibold text-[15px] text-[#1C1F22]">
                        {lead.name}
                      </p>
                      <a
                        href={`tel:${lead.phone.replace(/\D/g, '')}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-[12px] text-[#C8672B] hover:underline"
                      >
                        {lead.phone}
                      </a>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="font-display font-bold text-[15px] text-[#1C1F22] tabular-nums">
                        {formatCurrency(lead.estimatedValue)}
                      </p>
                      <UrgencyBadge urgency={lead.urgency} />
                    </div>
                  </div>
                  <p className="text-[13.5px] font-medium text-[#23282D]">{lead.serviceType}</p>
                  <p className="text-[12px] text-[#7A746B]">
                    {lead.fullAddress} {lead.zip ? `(${lead.zip})` : ''}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <select
                      aria-label={`Status for ${lead.name}`}
                      value={lead.status}
                      onChange={(e) =>
                        onUpdateLead(lead.id, {status: e.target.value as LeadStatus})
                      }
                      className="h-9 px-2.5 rounded-lg bg-white border border-[#ECE6DC] text-[12px] font-semibold text-[#1C1F22]"
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <span className="text-[12px] text-[#7A746B]">
                      {member ? member.name : 'Unassigned'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#ECE6DC]">
                  <th className="py-3.5 px-5 label-caps text-[#7A746B]">Lead &amp; Location</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Service Needed</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Urgency</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Status</th>
                  <th className="py-3.5 px-4 label-caps text-[#7A746B]">Assigned</th>
                  <th className="py-3.5 px-5 label-caps text-[#7A746B] text-right">Est. Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE6DC]">
                {filtered.map((lead) => {
                  const member = team.find((m) => m.id === lead.assignedMemberId);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onNavigate(`/app/leads/${lead.id}`)}
                      className="hover:bg-[#FBEBDD]/55 cursor-pointer transition-colors"
                    >
                      <td className="py-4 px-5">
                        <p className="font-display font-semibold text-[15px] text-[#1C1F22]">
                          {lead.name}
                        </p>
                        <p className="font-mono text-[12px] text-[#7A746B]">{lead.phone}</p>
                        <p className="text-[12px] text-[#7A746B] mt-0.5">
                          {lead.fullAddress} {lead.zip ? `(${lead.zip})` : ''}
                        </p>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-[14px] font-medium text-[#23282D]">{lead.serviceType}</p>
                        <TradeLabel trade={lead.trade} />
                      </td>
                      <td className="py-4 px-4">
                        <UrgencyBadge urgency={lead.urgency} />
                      </td>
                      <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                        <select
                          aria-label={`Status for ${lead.name}`}
                          value={lead.status}
                          onChange={(e) =>
                            onUpdateLead(lead.id, {status: e.target.value as LeadStatus})
                          }
                          className="h-8 px-2 rounded-lg bg-white border border-[#ECE6DC] text-[12px] font-semibold text-[#1C1F22]"
                        >
                          {ALL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-4 px-4 text-[13px] text-[#23282D]">
                        {member ? member.name : 'Unassigned'}
                      </td>
                      <td className="py-4 px-5 text-right font-display font-bold text-[15px] text-[#1C1F22] tabular-nums">
                        {formatCurrency(lead.estimatedValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1F22]/55"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-tier-3 w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4">
            <h2 className="headline-md text-[#1C1F22]">Add New Contractor Lead</h2>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1.5">Customer Name</label>
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="input-crafted w-full px-3"
                  />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1.5">Phone</label>
                  <input
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="input-crafted w-full px-3 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1.5">Trade</label>
                  <select
                    value={newTrade}
                    onChange={(e) => setNewTrade(e.target.value as TradeCategory)}
                    className="input-crafted w-full px-3"
                  >
                    <option value="Plumbing">Plumbing</option>
                    <option value="Electrical">Electrical</option>
                  </select>
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1.5">Urgency</label>
                  <select
                    value={newUrgency}
                    onChange={(e) => setNewUrgency(e.target.value as LeadUrgency)}
                    className="input-crafted w-full px-3"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label-caps text-[#7A746B] block mb-1.5">Service Needed</label>
                <input
                  required
                  value={newService}
                  onChange={(e) => setNewService(e.target.value)}
                  className="input-crafted w-full px-3"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="label-caps text-[#7A746B] block mb-1.5">Full Address</label>
                  <input
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    className="input-crafted w-full px-3"
                  />
                </div>
                <div>
                  <label className="label-caps text-[#7A746B] block mb-1.5">ZIP</label>
                  <input
                    value={newZip}
                    onChange={(e) => setNewZip(e.target.value)}
                    className="input-crafted w-full px-3 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary cursor-pointer">
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function LeadDetailPage({
  lead,
  linkedCall,
  team,
  onNavigate,
  onUpdateLead,
  onDeleteLead,
  onSendReviewRequest,
  allLeads,
  quotes,
  reminders,
  onCreateReminder,
  onCancelReminder,
  onCreateQuote,
  onQuoteAction,
  onMergeLead,
}: {
  allLeads: LeadItem[];
  reminders: ReminderItem[];
  onCreateReminder: (leadId: string, body: {months?: number; dueDateISO?: string; message: string}) => Promise<boolean>;
  onCancelReminder: (id: string) => Promise<void>;
  quotes: QuoteItem[];
  onCreateQuote: (leadId: string, body: {title: string; items: {description: string; amount: number}[]; notes: string}) => Promise<boolean>;
  onQuoteAction: (id: string, action: 'send' | 'void') => Promise<void>;
  onMergeLead: (keepId: string, mergeId: string) => Promise<void>;
  lead?: LeadItem;
  linkedCall?: CallItem;
  team: TeamMember[];
  onNavigate: (path: string) => void;
  onUpdateLead: (id: string, patch: Partial<LeadItem>) => Promise<void>;
  onDeleteLead: (id: string) => Promise<void>;
  onSendReviewRequest: (id: string) => Promise<void>;
}) {
  const [reviewBusy, setReviewBusy] = useState(false);
  const [form, setForm] = useState<LeadItem | null>(lead ? {...lead} : null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  usePageSeo({
    title: lead ? `Lead: ${lead.name} — PlumbVoice AI` : 'Lead Detail — PlumbVoice AI',
    description: 'Edit contractor lead details, notes, team assignment, and transcript.',
    path: lead ? `/app/leads/${lead.id}` : '/app/leads',
    noindex: true,
  });

  if (!lead || !form) {
    return (
      <div className="card-tier-1 p-10 text-center space-y-3">
        <p className="headline-md text-[#1C1F22]">Lead record not found</p>
        <button type="button" onClick={() => onNavigate('/app/leads')} className="btn-secondary cursor-pointer">
          Back to Leads
        </button>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onUpdateLead(lead.id, form);
    setSaving(false);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2400);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/app/leads')}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7A746B] hover:text-[#1C1F22] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Leads</span>
        </button>

        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-[#D64545] bg-[#FDF0F0] border border-[#D64545]/25 hover:bg-[#D64545] hover:text-white transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete Lead</span>
        </button>
      </div>

      {savedNotice && (
        <div className="rounded-xl bg-[#EBF6F0] border border-[#2E8B57]/30 px-4 py-3 text-[13px] font-semibold text-[#2E8B57] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Lead record updated and saved.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 card-tier-1 p-6 space-y-5">
          <div className="pb-4 border-b border-[#ECE6DC] flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="label-caps text-[#C8672B]">
                {lead.leadSource} · {lead.createdAt}
              </span>
              <h2 className="headline-md text-[#1C1F22] mt-1">{form.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              <UrgencyBadge urgency={form.urgency} />
              <LeadStatusBadge status={form.status} />
            </div>
          </div>

          {lead.status === 'Converted' && (
            <div className="rounded-xl bg-[#FAF7F2] border border-[#ECE6DC] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
              {lead.reviewRequestedAtISO ? (
                <span className="text-[#2E8B57] font-semibold">
                  Review request sent on {new Date(lead.reviewRequestedAtISO).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}.
                </span>
              ) : (
                <>
                  <span className="text-[#23282D]">Job finished? Text this customer your Google review link.</span>
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={async () => {
                      setReviewBusy(true);
                      try {
                        await onSendReviewRequest(lead.id);
                      } finally {
                        setReviewBusy(false);
                      }
                    }}
                    className="btn-secondary px-3 py-1.5 text-[12.5px] disabled:opacity-60"
                  >
                    {reviewBusy ? 'Sending…' : 'Send review request'}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Customer Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({...form, phone: e.target.value})}
                className="input-crafted w-full px-3 font-mono"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Service Type</label>
              <input
                value={form.serviceType}
                onChange={(e) => setForm({...form, serviceType: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Full Address</label>
              <input
                value={form.fullAddress}
                onChange={(e) => setForm({...form, fullAddress: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>
            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">ZIP Code</label>
              <input
                value={form.zip}
                onChange={(e) => setForm({...form, zip: e.target.value})}
                className="input-crafted w-full px-3 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="label-caps text-[#7A746B] block mb-1.5">Problem Description</label>
            <textarea
              rows={3}
              value={form.problemDescription}
              onChange={(e) => setForm({...form, problemDescription: e.target.value})}
              className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px]"
            />
          </div>

          <div>
            <label className="label-caps text-[#7A746B] block mb-1.5">Internal Dispatch Notes</label>
            <textarea
              rows={3}
              value={form.internalNotes}
              onChange={(e) => setForm({...form, internalNotes: e.target.value})}
              className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[14px]"
            />
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary cursor-pointer">
              {saving ? 'Saving…' : 'Save Lead Changes'}
            </button>
          </div>
        </div>

        {/* Right Side Panel */}
        <div className="lg:col-span-4 space-y-6">

          <QuotesPanel lead={lead} quotes={quotes} onCreate={onCreateQuote} onAction={onQuoteAction} />
          <SmsConsentPanel lead={lead} />
          <RemindersPanel lead={lead} reminders={reminders} onCreate={onCreateReminder} onCancel={onCancelReminder} />
          <DuplicatesPanel lead={lead} allLeads={allLeads} onMerge={onMergeLead} />

          <div className="card-tier-1 p-6 space-y-4">
            <span className="label-caps text-[#7A746B]">Pipeline Assignment</span>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Lead Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({...form, status: e.target.value as LeadStatus})}
                className="input-crafted w-full px-3"
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Urgency Level</label>
              <select
                value={form.urgency}
                onChange={(e) => setForm({...form, urgency: e.target.value as LeadUrgency})}
                className="input-crafted w-full px-3"
              >
                <option value="Emergency">Emergency</option>
                <option value="Urgent">Urgent</option>
                <option value="Normal">Normal</option>
              </select>
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Assign Team Member</label>
              <select
                value={form.assignedMemberId || ''}
                onChange={(e) =>
                  setForm({...form, assignedMemberId: e.target.value || undefined})
                }
                className="input-crafted w-full px-3"
              >
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role} · {m.tradeSpecialty})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Preferred Appointment</label>
              <input
                value={form.preferredAppointment}
                onChange={(e) => setForm({...form, preferredAppointment: e.target.value})}
                className="input-crafted w-full px-3"
              />
            </div>

            <div>
              <label className="label-caps text-[#7A746B] block mb-1.5">Est. Value ($)</label>
              <input
                type="number"
                value={form.estimatedValue}
                onChange={(e) => setForm({...form, estimatedValue: Number(e.target.value)})}
                className="input-crafted w-full px-3 font-mono tabular-nums"
              />
            </div>
          </div>

          {linkedCall && (
            <div className="card-tier-1 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="label-caps text-[#C8672B]">Source Phone Call</span>
                <span className="font-mono text-[12px] text-[#7A746B]">
                  {formatDuration(linkedCall.durationSec)}
                </span>
              </div>
              <p className="text-[13px] text-[#23282D]">{linkedCall.aiSummary}</p>
              <button
                type="button"
                onClick={() => onNavigate(`/app/calls/${linkedCall.id}`)}
                className="btn-secondary w-full text-[13px] inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <PhoneCall className="w-3.5 h-3.5 text-[#C8672B]" />
                <span>View Recording &amp; Transcript</span>
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1F22]/55" role="dialog" aria-modal="true">
          <div className="modal-tier-3 w-full max-w-md p-6 space-y-4">
            <h3 className="headline-md text-[#1C1F22]">Delete lead for {lead.name}?</h3>
            <p className="text-[14px] text-[#7A746B]">
              This permanently removes the lead record from your workspace pipeline.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-secondary cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteLead(lead.id);
                  onNavigate('/app/leads');
                }}
                className="px-4 py-2.5 rounded-lg bg-[#D64545] text-white text-[13px] font-semibold cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const usd = (n: number) => n.toLocaleString('en-US', {style: 'currency', currency: 'USD'});

function QuotesPanel({
  lead,
  quotes,
  onCreate,
  onAction,
}: {
  lead: LeadItem;
  quotes: QuoteItem[];
  onCreate: (leadId: string, body: {title: string; items: {description: string; amount: number}[]; notes: string}) => Promise<boolean>;
  onAction: (id: string, action: 'send' | 'void') => Promise<void>;
}) {
  const mine = quotes.filter((q) => q.leadId === lead.id);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{description: '', amount: ''}]);
  const [busy, setBusy] = useState('');
  const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const link = (q: QuoteItem) => `${window.location.origin}/quote/${q.organizationId}/${q.id}`;
  const tone = (q: QuoteItem) =>
    q.status === 'Accepted' ? 'text-[#2E8B57]' : q.status === 'Declined' || q.status === 'Voided' ? 'text-[#7A746B]' : 'text-[#C8672B]';

  return (
    <div className="card-tier-1 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="label-caps text-[#7A746B]">Quotes</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-semibold text-[#C8672B] cursor-pointer">
            + New quote
          </button>
        )}
      </div>

      {mine.length === 0 && !open && <p className="text-[13px] text-[#7A746B]">No quote yet. Create one and send the customer a private approve/decline link.</p>}

      {mine.map((q) => (
        <div key={q.id} className="rounded-lg border border-[#ECE6DC] p-3 space-y-2 text-[13px]">
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-[#1C1F22]">{q.title}</span>
            <span className="font-mono">{usd(q.total)}</span>
          </div>
          <p className={`font-semibold ${tone(q)}`}>
            {q.status === 'Open' && q.expired ? 'Expired' : q.status}
            {q.status === 'Accepted' && q.respondedByName ? ` by ${q.respondedByName}` : ''}
            {q.status === 'Open' && q.sentAtISO ? ' · link sent' : ''}
          </p>
          {q.status === 'Open' && !q.expired && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary px-2.5 py-1 text-[12px]"
                onClick={() => void navigator.clipboard?.writeText(link(q))}
              >
                Copy link
              </button>
              <button
                type="button"
                disabled={busy === q.id}
                className="btn-secondary px-2.5 py-1 text-[12px] disabled:opacity-60"
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    await onAction(q.id, 'send');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Text link
              </button>
              <button
                type="button"
                disabled={busy === q.id}
                className="px-2.5 py-1 text-[12px] text-[#B42318] cursor-pointer disabled:opacity-60"
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    await onAction(q.id, 'void');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Void
              </button>
            </div>
          )}
        </div>
      ))}

      {open && (
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Water heater replacement" className="input-crafted w-full px-3" />
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={r.description}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? {...x, description: e.target.value} : x)))}
                maxLength={160}
                placeholder="Description"
                className="input-crafted flex-1 px-3 min-w-0"
              />
              <input
                value={r.amount}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? {...x, amount: e.target.value.replace(/[^\d.]/g, '')} : x)))}
                inputMode="decimal"
                placeholder="$"
                className="input-crafted w-24 px-3 font-mono"
              />
            </div>
          ))}
          {rows.length < 20 && (
            <button type="button" onClick={() => setRows([...rows, {description: '', amount: ''}])} className="text-[12.5px] text-[#C8672B] cursor-pointer">
              + Add line
            </button>
          )}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="Notes for the customer (optional)" className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[13px]" />
          <p className="text-[13px] font-semibold">Total {usd(total)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy === 'new'}
              className="btn-primary px-3 py-2 text-[13px] disabled:opacity-60"
              onClick={async () => {
                setBusy('new');
                try {
                  const ok = await onCreate(lead.id, {
                    title,
                    notes,
                    items: rows.filter((r) => r.description.trim() && Number(r.amount) >= 0 && r.amount !== '').map((r) => ({description: r.description.trim(), amount: Number(r.amount)})),
                  });
                  if (ok) {
                    setOpen(false);
                    setTitle('');
                    setNotes('');
                    setRows([{description: '', amount: ''}]);
                  }
                } finally {
                  setBusy('');
                }
              }}
            >
              Create quote
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-3 py-2 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const last10 = (v: string) => v.replace(/\D/g, '').slice(-10);

function DuplicatesPanel({lead, allLeads, onMerge}: {lead: LeadItem; allLeads: LeadItem[]; onMerge: (keepId: string, mergeId: string) => Promise<void>}) {
  const [busy, setBusy] = useState('');
  const key = last10(lead.phone);
  const dupes = key.length === 10 ? allLeads.filter((l) => l.id !== lead.id && last10(l.phone) === key) : [];
  if (dupes.length === 0) return null;
  return (
    <div className="card-tier-1 p-6 space-y-3">
      <span className="label-caps text-[#7A746B]">Possible duplicates (same phone)</span>
      {dupes.map((d) => (
        <div key={d.id} className="rounded-lg border border-[#ECE6DC] p-3 text-[13px] space-y-2">
          <p className="font-semibold text-[#1C1F22]">{d.name} · {d.serviceType}</p>
          <p className="text-[#7A746B]">{d.createdAt} · {d.leadSource} · {d.status}</p>
          <button
            type="button"
            disabled={busy === d.id}
            className="btn-secondary px-2.5 py-1 text-[12px] disabled:opacity-60"
            onClick={async () => {
              setBusy(d.id);
              try {
                await onMerge(lead.id, d.id);
              } finally {
                setBusy('');
              }
            }}
          >
            Merge into this lead
          </button>
        </div>
      ))}
    </div>
  );
}

type ConsentView = {
  phone: string;
  optedOut: boolean;
  record: {source: string; purposes: string[]; capturedAtISO: string; evidence: string; revokedAtISO: string} | null;
  allowed: Record<string, boolean>;
};
const CONSENT_SOURCE_LABEL: Record<string, string> = {
  booking_page: 'Booking page checkbox', website_chat: 'Website chat', phone_call: 'Agreed on a call', inbound_call: 'Customer called us',
  verbal_staff: 'Verbal (recorded by staff)', written_form: 'Written / signed form', sms_reply: 'Text reply',
};
const CONSENT_PURPOSE_LABEL: Record<string, string> = {service: 'Quotes, links & replies', review_request: 'Review requests', maintenance_reminder: 'Maintenance reminders'};

/** Shows whether this customer agreed to texts, and lets staff record or withdraw consent BEFORE anything is sent. */
function SmsConsentPanel({lead}: {lead: LeadItem}) {
  const [view, setView] = useState<ConsentView | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [purposes, setPurposes] = useState<string[]>(['service']);
  const [source, setSource] = useState('verbal_staff');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `/api/leads/${lead.id}/sms-consent`;
  useEffect(() => {
    let live = true;
    apiRequest<{consent: ConsentView}>(url)
      .then((r) => live && setView(r.consent))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load consent.'));
    return () => {
      live = false;
    };
  }, [url, lead.phone]);
  const run = async (fn: () => Promise<{consent: ConsentView}>) => {
    setBusy(true);
    setError('');
    try {
      setView((await fn()).consent);
      setOpen(false);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const rec = view?.record;
  const active = Boolean(rec && !rec.revokedAtISO && !view?.optedOut);
  return (
    <div className="card-tier-1 p-6 space-y-3">
      <div className="flex items-center justify-between">
        <span className="label-caps text-[#7A746B]">Text-Message Consent</span>
        {!open && !view?.optedOut && (
          <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-semibold text-[#C8672B] cursor-pointer">
            {rec ? 'Update' : '+ Record'}
          </button>
        )}
      </div>
      {error && <p className="text-[12.5px] text-[#B42318]">{error}</p>}
      {view?.optedOut && <p className="text-[13px] font-semibold text-[#B42318]">Opted out (replied STOP). No texts can be sent.</p>}
      {!view?.optedOut && !rec && <p className="text-[13px] text-[#7A746B]">No consent on file. Quotes, review requests and reminders by text stay blocked until it is recorded.</p>}
      {rec && !view?.optedOut && (
        <div className="text-[13px] space-y-1">
          <p className={`font-semibold ${active ? 'text-[#2E8B57]' : 'text-[#B42318]'}`}>{active ? 'Consent on file' : 'Consent withdrawn'}</p>
          <p className="text-[#23282D]">{rec.purposes.map((k) => CONSENT_PURPOSE_LABEL[k] ?? k).join(' · ')}</p>
          <p className="text-[#7A746B]">
            {CONSENT_SOURCE_LABEL[rec.source] ?? rec.source} · {new Date(rec.capturedAtISO).toLocaleString()}
            {rec.evidence ? ` · ${rec.evidence}` : ''}
          </p>
          {active && (
            <button type="button" disabled={busy} onClick={() => run(() => apiRequest<{consent: ConsentView}>(url, {method: 'DELETE'}))} className="text-[12px] text-[#B42318] cursor-pointer disabled:opacity-60">
              Customer withdrew consent
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="space-y-3">
          {Object.entries(CONSENT_PURPOSE_LABEL).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="checkbox-crafted" checked={purposes.includes(k)} onChange={(e) => setPurposes((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} />
              {label}
            </label>
          ))}
          <select value={source} onChange={(e) => setSource(e.target.value)} className="input-crafted w-full px-3">
            <option value="verbal_staff">Customer agreed verbally</option>
            <option value="written_form">Customer signed a form</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Who, when, how (e.g. “Ana, by phone, Nov 22”)" className="input-crafted w-full px-3" />
          <p className="text-[12px] text-[#7A746B]">Only record this if the customer actually agreed. This is your proof if consent is ever questioned.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !purposes.length || note.trim().length < 3}
              className="btn-primary px-3 py-2 text-[13px] disabled:opacity-60"
              onClick={() => run(() => apiRequest<{consent: ConsentView}>(url, {method: 'POST', body: JSON.stringify({purposes, source, note: note.trim()})}))}
            >
              Save consent
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-[#7A746B] cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RemindersPanel({
  lead,
  reminders,
  onCreate,
  onCancel,
}: {
  lead: LeadItem;
  reminders: ReminderItem[];
  onCreate: (leadId: string, body: {months?: number; dueDateISO?: string; message: string}) => Promise<boolean>;
  onCancel: (id: string) => Promise<void>;
}) {
  const mine = reminders.filter((r) => r.leadId === lead.id && r.status !== 'Cancelled');
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState('12');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const tone = (r: ReminderItem) => (r.status === 'Sent' ? 'text-[#2E8B57]' : r.status === 'Scheduled' ? 'text-[#C8672B]' : 'text-[#7A746B]');
  return (
    <div className="card-tier-1 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="label-caps text-[#7A746B]">Maintenance Reminders</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-semibold text-[#C8672B] cursor-pointer">
            + Add
          </button>
        )}
      </div>
      {mine.length === 0 && !open && <p className="text-[13px] text-[#7A746B]">Text this customer later (e.g. a yearly check-up) to win repeat work.</p>}
      {mine.map((r) => (
        <div key={r.id} className="rounded-lg border border-[#ECE6DC] p-3 text-[13px] space-y-1.5">
          <p className={`font-semibold ${tone(r)}`}>
            {r.status} · {r.dueDateISO}
            {r.note ? ` (${r.note})` : ''}
          </p>
          <p className="text-[#23282D]">{r.message}</p>
          {r.status === 'Scheduled' && (
            <button
              type="button"
              disabled={busy === r.id}
              className="text-[12px] text-[#B42318] cursor-pointer disabled:opacity-60"
              onClick={async () => {
                setBusy(r.id);
                try {
                  await onCancel(r.id);
                } finally {
                  setBusy('');
                }
              }}
            >
              Cancel reminder
            </button>
          )}
        </div>
      ))}
      {open && (
        <div className="space-y-3">
          <select value={months} onChange={(e) => setMonths(e.target.value)} className="input-crafted w-full px-3">
            {[['3', 'In 3 months'], ['6', 'In 6 months'], ['12', 'In 1 year'], ['24', 'In 2 years']].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={320}
            placeholder="Leave blank for the standard message. “Reply STOP to opt out.” is added automatically."
            className="w-full p-3 bg-white border border-[#ECE6DC] rounded-lg text-[13px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy === 'new'}
              className="btn-primary px-3 py-2 text-[13px] disabled:opacity-60"
              onClick={async () => {
                setBusy('new');
                try {
                  if (await onCreate(lead.id, {months: Number(months), message})) {
                    setOpen(false);
                    setMessage('');
                  }
                } finally {
                  setBusy('');
                }
              }}
            >
              Schedule
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-3 py-2 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
