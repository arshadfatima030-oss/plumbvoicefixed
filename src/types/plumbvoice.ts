export type TradeCategory = 'Plumbing' | 'Electrical';

export type CallAnsweredBy = 'AI' | 'Business';
export type CallOutcomeStatus = 'Answered' | 'Missed' | 'Active';

export type LeadStatus =
  | 'New'
  | 'Contacted'
  | 'Qualified'
  | 'Appointment Scheduled'
  | 'In Progress'
  | 'Converted'
  | 'Lost';

export type LeadUrgency = 'Emergency' | 'Urgent' | 'Normal';

export type PlanTier = 'Starter' | 'Professional' | 'Business';

export interface TranscriptTurn {
  id: string;
  speaker: 'agent' | 'caller';
  timestampSec: number;
  text: string;
}

export interface CallItem {
  id: string;
  organizationId: string;
  callerName: string;
  callerPhone: string;
  address: string;
  zip: string;
  trade: TradeCategory;
  serviceRequested: string;
  answeredBy: CallAnsweredBy;
  status: CallOutcomeStatus;
  urgency: LeadUrgency;
  durationSec: number;
  pickupRings: number;
  estimatedValue: number;
  createdAt: string; // display label, recomputed by the server from createdAtISO
  createdAtISO?: string;
  dayOffset: number; // recomputed by the server from createdAtISO
  hourOfDay: number; // 0-23 for real hourly volume charts
  aiSummary: string;
  recordingAvailable: boolean;
  /** Optional: set only for real provider calls. Existing records simply lack these fields. */
  recordingUrl?: string;
  /** Set when a stored recording was removed (retention rule or the owner). */
  recordingDeletedAtISO?: string;
  locationId?: string;
  externalId?: string;
  /** Optional AI call tags / follow-up, language and channel (absent on older records). */
  tags?: string[];
  nextSteps?: string;
  language?: 'en' | 'es';
  channel?: 'phone' | 'chat';
  /** Created by the Test Agent or a simulated test call; excluded from stats and evicted first. */
  isTest?: boolean;
  linkedLeadId?: string;
  waveform: number[];
  transcript: TranscriptTurn[];
}

export interface LeadItem {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  email: string;
  trade: TradeCategory;
  serviceType: string;
  problemDescription: string;
  zip: string;
  fullAddress: string;
  urgency: LeadUrgency;
  preferredAppointment: string;
  leadSource: 'AI Phone Receptionist' | 'Web Demo' | 'After-Hours Forward' | 'Manual Entry' | 'Website Chat' | 'Booking Page';
  callDurationSec: number;
  linkedCallId?: string;
  createdAt: string;
  createdAtISO?: string;
  dayOffset: number;
  status: LeadStatus;
  estimatedValue: number;
  assignedMemberId?: string;
  internalNotes: string;
  /** Set when a Google review request text was sent for this lead (once per lead). */
  reviewRequestedAtISO?: string;
  /** Created from a Test Agent session; excluded from stats and evicted first. */
  isTest?: boolean;
  /** Routed location (only when the business has set up locations). */
  locationId?: string;
}

export interface AppointmentItem {
  id: string;
  organizationId: string;
  title: string;
  customerName: string;
  customerPhone: string;
  address: string;
  trade: TradeCategory;
  urgency: LeadUrgency;
  dateISO: string;
  timeWindow: string;
  assignedMemberId: string;
  status: 'Scheduled' | 'En Route' | 'On Site' | 'Completed';
  estimatedValue: number;
  googleSynced: boolean;
  googleEventId?: string;
  linkedLeadId?: string;
}

/** A written estimate the customer can approve or decline from a private link. */
export interface QuoteItem {
  /** Unguessable token, also used in the public link /quote/<organizationId>/<id>. */
  id: string;
  organizationId: string;
  leadId: string;
  customerName: string;
  customerPhone: string;
  title: string;
  items: {description: string; amount: number}[];
  total: number;
  notes: string;
  status: 'Open' | 'Accepted' | 'Declined' | 'Voided';
  createdAtISO: string;
  validUntilISO: string;
  sentAtISO?: string;
  respondedAtISO?: string;
  respondedByName?: string;
  /** Computed by the server: an Open quote past its valid-until date. */
  expired?: boolean;
}

/** A text to send a past customer on a future date (e.g. yearly water-heater check). */
export interface ReminderItem {
  id: string;
  organizationId: string;
  leadId: string;
  customerName: string;
  phone: string;
  /** Without the opt-out footer; the server appends it when sending. */
  message: string;
  /** YYYY-MM-DD */
  dueDateISO: string;
  status: 'Scheduled' | 'Sent' | 'Cancelled' | 'Skipped' | 'Failed';
  attempts: number;
  createdAtISO: string;
  sentAtISO?: string;
  note?: string;
}

export type SmsConsentPurpose = 'service' | 'review_request' | 'maintenance_reminder';
export type SmsConsentSource = 'booking_page' | 'website_chat' | 'phone_call' | 'inbound_call' | 'verbal_staff' | 'written_form' | 'sms_reply';

/** Proof that a customer agreed to receive texts. Captured before sending, never after. */
export interface SmsConsentRecord {
  phone: string;
  purposes: SmsConsentPurpose[];
  source: SmsConsentSource;
  capturedAtISO: string;
  /** Short proof (form version, staff note, call id). */
  evidence?: string;
  capturedBy?: string;
  revokedAtISO?: string;
  history?: {atISO: string; source: SmsConsentSource; purposes: SmsConsentPurpose[]; evidence?: string; by?: string}[];
}

export type OutboxKind = 'sms' | 'webhook' | 'gcal';
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

/**
 * An external action (text, webhook, calendar write) saved in the SAME atomic workspace save as the change that caused it.
 * If that save loses a race and the request is retried, the entry was never stored, so nothing is sent twice.
 * Sent after commit by server/outbox.ts. Server-only: stripped from the browser view.
 */
export interface OutboxEntry {
  id: string;
  /** Same dedupeKey = same effect. Enqueueing it again is a no-op. */
  dedupeKey: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  nextAttemptISO: string;
  leaseUntilISO?: string;
  createdAtISO: string;
  updatedAtISO: string;
  lastError?: string;
  /** Record to update once the effect finishes (quote shows "link sent", follow-up becomes Sent, appointment becomes synced). */
  after?: {kind: 'quote' | 'followup' | 'appointment' | 'review'; id: string};
}

export interface FollowUpItem {
  id: string;
  organizationId: string;
  leadId: string;
  customerName: string;
  phone: string;
  trade: TradeCategory;
  triggerReason: 'Missed Call Text-Back' | 'Unbooked Quote' | 'Appointment Confirmation' | 'Post-Job Review' | 'Maintenance Reminder' | 'Booking link sent during call' | 'Directions sent during call';
  messagePreview: string;
  consentOptIn: boolean;
  /** Where and when the customer's consent was captured (copied from the consent record at send time). */
  consentSource?: SmsConsentSource;
  consentAtISO?: string;
  status: 'Pending' | 'Sent' | 'Replied' | 'Opted Out';
  scheduledFor: string;
}

export interface NotificationItem {
  id: string;
  organizationId: string;
  type: 'New Lead' | 'Missed Call' | 'Urgent Lead' | 'Follow-Up Reminder' | 'System';
  title: string;
  body: string;
  createdAt: string;
  createdAtISO?: string;
  read: boolean;
  targetPath: string;
}

export interface TeamMember {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
  role: 'Owner' | 'Dispatcher' | 'Technician' | 'Viewer';
  tradeSpecialty: TradeCategory | 'Both';
  truckCode: string;
  status: 'Active' | 'Invited';
  onCall: boolean;
}

export interface VoiceAgentConfig {
  agentName: string;
  businessName: string;
  businessType: 'Plumbing' | 'Electrical' | 'Plumbing & Electrical';
  businessPhone: string;
  address: string;
  serviceAreas: string[];
  workingHoursSummary: string;
  afterHoursAnswering: boolean;
  ringTimeoutSec: number;
  greetingMessage: string;
  voiceId: 'us-warm-female' | 'us-calm-male' | 'us-crisp-female' | 'us-authoritative-male';
  speakingSpeed: number;
  accent: 'American English (Neutral)' | 'American English (Southern)' | 'American English (Midwest)';
  emergencyInstructions: string;
  aiKnowledgeNotes: string;
}

export interface PhoneSetupConfig {
  businessPhone: string;
  systemNumber: string;
  systemNumberAreaCode: string;
  systemNumberType: 'Local DID' | 'Toll-Free 888';
  systemNumberStatus: 'Active' | 'Provisioning';
  systemNumberProvisionedAt: string;
  ringTimeoutSec: number;
  afterHoursForwarding: boolean;
  carrier: 'AT&T' | 'Verizon' | 'T-Mobile' | 'RingCentral' | 'Grasshopper';
  forwardingVerified: boolean;
  lastSystemTestAt?: string;
}

export interface WorkingHoursDay {
  day: string;
  enabled: boolean;
  open: string;
  close: string;
}

export interface BusinessSettingsData {
  businessName: string;
  licenseNumber: string;
  dispatchEmail: string;
  timezone: string;
  workingHours: WorkingHoursDay[];
  holidayAutoAfterHours: boolean;
  emergencyRules: {
    keywords: string[];
    escalateToPhone: string;
    requireSafeShutoffGuidance: boolean;
    smsNotifyOwnerImmediately: boolean;
  };
  notificationPreferences: {
    smsOnNewLead: boolean;
    smsOnEmergency: boolean;
    emailDailyDigest: boolean;
    missedCallTextBackEnabled: boolean;
    tcpaFooterText: string;
  };
}

export interface BillingData {
  plan: PlanTier;
  billingCycle: 'monthly' | 'annual';
  minutesUsed: number;
  minutesIncluded: number;
  nextInvoiceDate: string;
  paymentMethodLast4: string;
  /** Mirrors the Stripe subscription once the owner has paid. Absent until then (trial / local plan). */
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
  cancelAtPeriodEnd?: boolean;
  /** Set by the server on every workspace response: true when Stripe is configured and plan changes are paid. */
  paymentsEnabled?: boolean;
  /** Computed on every response (never stored): minutes beyond the plan and the per-minute price for them. */
  overageMinutes?: number;
  overageRate?: number;
  /** Highest usage alert already sent this billing period (server-managed): 80 or 100. */
  usageNotice?: 80 | 100;
  /** Trial / grace bookkeeping (server-managed). */
  trialStartedAtISO?: string;
  pastDueSinceISO?: string;
  currentPeriodEndISO?: string;
  /** Computed by the server on every workspace response (never stored). */
  access?: {
    state: 'free' | 'trial' | 'active' | 'grace' | 'canceling' | 'blocked';
    allowed: boolean;
    trialDaysLeft?: number;
    endsAtISO?: string;
  };
  invoices: {
    id: string;
    date: string;
    plan: PlanTier;
    amount: number;
    status: 'Paid' | 'Pending';
  }[];
}

export interface IntegrationStatusItem {
  id: string;
  name: string;
  category: 'Voice AI' | 'Telephony' | 'Messaging' | 'Calendar' | 'Billing';
  connected: boolean;
  summary: string;
  envRequired: string[];
  setupInstructions: string;
}

export interface UserSession {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  role: 'Owner' | 'Dispatcher' | 'Technician' | 'Viewer';
  onboardingCompleted: boolean;
  twoFactorEnabled: boolean;
  emailVerified?: boolean;
  /** True when this browser was saved with "Remember this device" (no emailed codes needed). */
  deviceTrusted?: boolean;
}

export interface AgentReply {
  replyText: string;
  extracted: ExtractedCallerFields;
  /** 'gemini' when the model answered, 'fallback' when the rule-based flow was used. */
  engine?: 'gemini' | 'fallback';
}

export interface ExtractedCallerFields {
  name: string | null;
  phone: string | null;
  zip: string | null;
  address: string | null;
  serviceType: string | null;
  trade: TradeCategory | null;
  urgency: LeadUrgency | null;
  preferredTime: string | null;
  isEmergency: boolean;
  escalationReason: string | null;
}


/** Optional, additive per-workspace configuration. Older workspaces simply lack it. */
/** A branch / office. Calls and leads are routed to a location by service ZIP. */
export interface LocationItem {
  id: string;
  name: string;
  address: string;
  /** ZIP codes this location serves. */
  zips: string[];
  /** Number alerts and emergencies for this location go to (falls back to the main escalation number). */
  phone: string;
  /** Free-text opening hours shown to the AI, e.g. "Mon-Fri 8am-6pm". */
  hours: string;
  teamMemberIds: string[];
}

export interface WorkspaceExtras {
  /** Recording consent line the AI says at the start of a call, and how long recordings are kept (0 = keep until deleted). */
  recording?: {consentNotice: string; retentionDays: number};
  locations?: LocationItem[];
  webhook?: {url: string; enabled: boolean; events: string[]};
  chatWidget?: {enabled: boolean; allowedDomains: string[]; welcome: string};
  bookingLink?: string;
  smsOptOut?: string[];
  /** Consent ledger: one record per phone number. See server/consent.ts. */
  smsConsents?: SmsConsentRecord[];
  languages?: ('en' | 'es')[];
  googleCalendar?: {connected: boolean; calendarId: string};
  /** Text customers a Google review link after a job. `auto` sends it when a lead is marked Converted. */
  reviewRequest?: {enabled: boolean; auto: boolean; link: string};
  /** Public page /book/<organizationId> where customers request a visit. */
  bookingPage?: {enabled: boolean; intro: string};
  /**
   * Ring the owner's own phone first; if nobody answers within `seconds`, the call goes to the AI assistant.
   * Works only when the Telnyx number points at the TeXML app (see FEATURES_SETUP.md), not straight at the assistant.
   */
  ringFirst?: {enabled: boolean; ownerPhone: string; seconds: number; assistantId: string};
}

/** Server-only secrets. Never sent to the browser (stripped in store.view). */
export interface WorkspaceSecrets {
  webhookSecret?: string;
  /** AES-256-GCM sealed random secret in the ring-first TeXML URL. Rotatable by the Owner. */
  ringToken?: string;
  /** AES-256-GCM sealed refresh token. */
  googleRefreshToken?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface TenantWorkspace {
  organizationId: string;
  calls: CallItem[];
  leads: LeadItem[];
  appointments: AppointmentItem[];
  followUps: FollowUpItem[];
  quotes?: QuoteItem[];
  reminders?: ReminderItem[];
  /** Pending external actions (see OutboxEntry). Server-only. */
  outbox?: OutboxEntry[];
  notifications: NotificationItem[];
  team: TeamMember[];
  voiceAgent: VoiceAgentConfig;
  phoneSetup: PhoneSetupConfig;
  settings: BusinessSettingsData;
  extras?: WorkspaceExtras;
  secrets?: WorkspaceSecrets;
  billing: BillingData;
  onboardingCompleted: boolean;
}
