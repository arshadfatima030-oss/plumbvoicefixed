import type {AppointmentItem, LeadItem, TeamMember, TenantWorkspace} from '../src/types/plumbvoice.ts';

/**
 * Technician-safe copies. These are ALLOWLISTS: a field added to LeadItem / AppointmentItem later stays hidden from
 * technicians until it is listed here on purpose. Money (estimated value), call links, lead source, customer e-mail
 * and integration ids are never needed to do a job, so they are not sent. Placeholders keep the shared types valid.
 */
export const techLeadView = (l: LeadItem): LeadItem => ({
  id: l.id,
  organizationId: l.organizationId,
  name: l.name,
  phone: l.phone,
  email: '',
  trade: l.trade,
  serviceType: l.serviceType,
  problemDescription: l.problemDescription,
  zip: l.zip,
  fullAddress: l.fullAddress,
  urgency: l.urgency,
  preferredAppointment: l.preferredAppointment,
  leadSource: 'Manual Entry',
  callDurationSec: 0,
  createdAt: l.createdAt,
  createdAtISO: l.createdAtISO,
  dayOffset: l.dayOffset,
  status: l.status,
  estimatedValue: 0,
  assignedMemberId: l.assignedMemberId,
  internalNotes: l.internalNotes,
});

export const techAppointmentView = (a: AppointmentItem): AppointmentItem => ({
  id: a.id,
  organizationId: a.organizationId,
  title: a.title,
  customerName: a.customerName,
  customerPhone: a.customerPhone,
  address: a.address,
  trade: a.trade,
  urgency: a.urgency,
  dateISO: a.dateISO,
  timeWindow: a.timeWindow,
  assignedMemberId: a.assignedMemberId,
  status: a.status,
  estimatedValue: 0,
  googleSynced: false,
  linkedLeadId: a.linkedLeadId,
});

/**
 * The whole workspace as a technician may see it. Built from scratch instead of deleting fields from the full view,
 * so nothing new leaks by default (agent prompts, phone setup, webhook URLs, owner phone, opt-out lists, plan and invoice data).
 */
export function technicianView(
  full: TenantWorkspace,
  me: TeamMember | undefined,
  ownsLead: (l: LeadItem) => boolean,
  ownsAppointment: (a: AppointmentItem) => boolean
): TenantWorkspace {
  return {
    organizationId: full.organizationId,
    leads: full.leads.filter(ownsLead).map(techLeadView),
    appointments: full.appointments.filter(ownsAppointment).map(techAppointmentView),
    calls: [],
    followUps: [],
    notifications: [],
    quotes: [],
    reminders: [],
    team: me ? [{...me}] : [],
    // The app shell only reads the business name; everything else in these objects is owner-only configuration.
    voiceAgent: {} as TenantWorkspace['voiceAgent'],
    phoneSetup: {} as TenantWorkspace['phoneSetup'],
    settings: {businessName: full.settings.businessName, timezone: full.settings.timezone} as TenantWorkspace['settings'],
    // Without this the app shell would push a technician into the owner's onboarding flow.
    onboardingCompleted: true,
    billing: {} as TenantWorkspace['billing'],
  };
}
