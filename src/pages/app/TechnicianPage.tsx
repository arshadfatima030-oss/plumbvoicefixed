import {useState} from 'react';
import {CheckCircle2, MapPin, Navigation, Phone, Truck, Wrench} from 'lucide-react';
import type {AppointmentItem, LeadItem} from '../../types/plumbvoice';

interface Props {
  appointments: AppointmentItem[];
  leads: LeadItem[];
  technicianName: string;
  onUpdateAppointment: (id: string, patch: Partial<AppointmentItem>) => Promise<unknown> | void;
  onUpdateLead: (id: string, patch: Partial<LeadItem>) => Promise<unknown> | void;
}

const NEXT: Record<AppointmentItem['status'], {to: AppointmentItem['status']; label: string; icon: typeof Truck} | null> = {
  Scheduled: {to: 'En Route', label: 'On my way', icon: Truck},
  'En Route': {to: 'On Site', label: "I've arrived", icon: MapPin},
  'On Site': {to: 'Completed', label: 'Job done', icon: CheckCircle2},
  Completed: null,
};

const STATUS_STYLE: Record<AppointmentItem['status'], string> = {
  Scheduled: 'bg-[#EFEDE8] text-[#4A453D]',
  'En Route': 'bg-[#FFF1D6] text-[#8A5A00]',
  'On Site': 'bg-[#DCEBFA] text-[#1F4E86]',
  Completed: 'bg-[#DDF1E3] text-[#1E6B3A]',
};

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const diff = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime()) / 86_400_000);
  const base = d.toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'});
  return diff === 0 ? `Today · ${base}` : diff === 1 ? `Tomorrow · ${base}` : base;
}

function JobCard({
  appt,
  lead,
  technicianName,
  onUpdateAppointment,
  onUpdateLead,
}: {
  appt: AppointmentItem;
  lead?: LeadItem;
  technicianName: string;
  onUpdateAppointment: Props['onUpdateAppointment'];
  onUpdateLead: Props['onUpdateLead'];
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const next = NEXT[appt.status];

  const advance = async () => {
    if (!next || busy) return;
    if (next.to === 'Completed' && !window.confirm('Mark this job as done?')) return;
    setBusy(true);
    try {
      await onUpdateAppointment(appt.id, {status: next.to});
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    const text = note.trim();
    if (!lead || !text || busy) return;
    setBusy(true);
    try {
      const stamp = new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
      const line = `[${stamp} ${technicianName}] ${text}`;
      await onUpdateLead(lead.id, {internalNotes: lead.internalNotes ? `${lead.internalNotes}\n${line}` : line});
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-[#E4E0D8] bg-white p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-bold text-[16px] text-[#1C1F22] truncate">{appt.title}</h3>
          <p className="text-[13px] text-[#6B665D]">
            {appt.timeWindow} · {appt.customerName}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[appt.status]}`}>{appt.status}</span>
      </div>

      {lead?.problemDescription && (
        <p className="text-[13.5px] text-[#2B2F33] bg-[#F7F5F0] rounded-lg p-3 whitespace-pre-wrap">{lead.problemDescription}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {appt.customerPhone && (
          <a
            href={telHref(appt.customerPhone)}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#D9D4C9] py-2.5 text-[13.5px] font-semibold text-[#1C1F22]"
          >
            <Phone className="w-4 h-4" /> Call
          </a>
        )}
        {appt.address && (
          <a
            href={mapsUrl(appt.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-[#D9D4C9] py-2.5 text-[13.5px] font-semibold text-[#1C1F22]"
          >
            <Navigation className="w-4 h-4" /> Directions
          </a>
        )}
      </div>
      {appt.address && <p className="text-[12.5px] text-[#6B665D]">{appt.address}</p>}

      {next && (
        <button
          type="button"
          disabled={busy}
          onClick={advance}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#C8672B] text-white py-3 text-[15px] font-bold disabled:opacity-60 cursor-pointer"
        >
          <next.icon className="w-5 h-5" /> {next.label}
        </button>
      )}

      {lead && (
        <div className="space-y-2 pt-1">
          {lead.internalNotes && <pre className="text-[12.5px] text-[#4A453D] whitespace-pre-wrap font-sans bg-[#FBFAF7] rounded-lg p-2.5">{lead.internalNotes}</pre>}
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (parts used, issue found…)"
              maxLength={500}
              className="flex-1 min-w-0 rounded-lg border border-[#D9D4C9] px-3 py-2 text-[13.5px]"
            />
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={addNote}
              className="rounded-lg bg-[#1C1F22] text-white px-3 text-[13px] font-semibold disabled:opacity-50 cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function TechnicianPage({appointments, leads, technicianName, onUpdateAppointment, onUpdateLead}: Props) {
  const sorted = [...appointments].sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.timeWindow.localeCompare(b.timeWindow));
  const todayISO = new Date().toISOString().slice(0, 10);
  const open = sorted.filter((a) => a.status !== 'Completed' || a.dateISO.slice(0, 10) >= todayISO);
  const groups = new Map<string, AppointmentItem[]>();
  for (const a of open) {
    const k = a.dateISO.slice(0, 10);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-2xl text-[#1C1F22] flex items-center gap-2">
          <Wrench className="w-6 h-6 text-[#C8672B]" /> My Jobs
        </h1>
        <p className="text-[13.5px] text-[#6B665D]">Only jobs assigned to you are shown here.</p>
      </div>

      {groups.size === 0 && (
        <div className="rounded-xl border border-dashed border-[#D9D4C9] p-8 text-center text-[14px] text-[#6B665D]">
          No jobs assigned to you right now.
        </div>
      )}

      {[...groups.entries()].map(([day, list]) => (
        <section key={day} className="space-y-3">
          <h2 className="label-caps text-[#7A746B]">{dayLabel(day)}</h2>
          {list.map((a) => (
            <JobCard
              key={a.id}
              appt={a}
              lead={leads.find((l) => l.id === a.linkedLeadId)}
              technicianName={technicianName}
              onUpdateAppointment={onUpdateAppointment}
              onUpdateLead={onUpdateLead}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
