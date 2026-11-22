import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertCircle, CheckCircle2, RefreshCw} from 'lucide-react';
import {apiRequest, setStepUpHandler} from './lib/api';
import {StepUpModal} from './components/StepUpModal';
import {usePageSeo} from './lib/seo';
import type {
  AppointmentItem,
  BusinessSettingsData,
  CallItem,
  FollowUpItem,
  IntegrationStatusItem,
  LeadItem,
  QuoteItem,
  ReminderItem,
  PhoneSetupConfig,
  PlanTier,
  TeamMember,
  TenantWorkspace,
  UserSession,
  VoiceAgentConfig,
} from './types/plumbvoice';
import {PublicLayout} from './pages/public/PublicLayout';
import {HomePage} from './pages/public/HomePage';
import {
  AboutContactPage,
  BlogPage,
  CityLandingPage,
  ElectricalSolutionsPage,
  FeaturesPage,
  HowItWorksPage,
  PlumbingSolutionsPage,
  PricingPage,
} from './pages/public/MarketingPages';
import {AuthPage} from './pages/public/AuthPages';
import {BookingPage} from './pages/public/BookingPage';
import {QuotePage} from './pages/public/QuotePage';
import {AppLayout} from './pages/app/AppLayout';
import {TechnicianPage} from './pages/app/TechnicianPage';
import {OverviewDashboardPage} from './pages/app/OverviewDashboardPage';
import {CallDetailPage, CallsListPage} from './pages/app/CallsPages';
import {LeadDetailPage, LeadsListPage} from './pages/app/LeadsPages';
import {TestAgentPage, VoiceAgentConfigPage} from './pages/app/VoiceAgentPages';
import {
  AppointmentsPage,
  FollowUpsPage,
  NotificationsPage,
  PhoneSetupPage,
} from './pages/app/PhoneAndSchedulePages';
import {
  AnalyticsPage,
  AuditLogCard,
  SettingsSubPages,
  TeamManagementPage,
} from './pages/app/AnalyticsAndTeamPages';
import {
  BillingPage,
  IntegrationsPage,
  OnboardingWizardPage,
  ProfileSecurityPage,
} from './pages/app/AdminAndOnboardingPages';

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function NotFoundPage({onNavigate}: {onNavigate: (path: string) => void}) {
  usePageSeo({
    title: 'Page Not Found — PlumbVoice AI',
    description: 'The requested PlumbVoice AI page could not be found.',
    path: '/404',
    noindex: true,
  });

  return (
    <div className="max-w-[760px] mx-auto px-4 py-20 text-center space-y-5">
      <div className="card-tier-1 p-10 space-y-4">
        <span className="label-caps text-[#C8672B]">404 · Route Not Found</span>
        <h1 className="font-display font-extrabold text-[34px] text-[#1C1F22]">
          We couldn&apos;t find that page
        </h1>
        <p className="text-[15px] text-[#7A746B] max-w-md mx-auto">
          The link may have moved or the record no longer exists. Jump back to the homepage, pricing, or your contractor dashboard.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <button type="button" onClick={() => onNavigate('/')} className="btn-primary cursor-pointer">
            Return Home
          </button>
          <button type="button" onClick={() => onNavigate('/pricing')} className="btn-secondary cursor-pointer">
            View Pricing
          </button>
          <button type="button" onClick={() => onNavigate('/contact')} className="btn-secondary cursor-pointer">
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [path, setPath] = useState<string>(() => normalizePath(window.location.pathname));
  const [authLoading, setAuthLoading] = useState(true);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false); // "Not now" on the setup wizard; asks again next login
  const [user, setUser] = useState<UserSession | null>(null);
  const [workspace, setWorkspace] = useState<TenantWorkspace | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatusItem[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Sensitive changes on an unsaved device pause here until the user enters the emailed code.
  const [stepUpResolve, setStepUpResolve] = useState<((ok: boolean) => void) | null>(null);
  const stepUpPending = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    setStepUpHandler(() => {
      if (!stepUpPending.current) {
        stepUpPending.current = new Promise<boolean>((resolve) => {
          setStepUpResolve(() => (ok: boolean) => {
            stepUpPending.current = null;
            setStepUpResolve(null);
            resolve(ok);
          });
        });
      }
      return stepUpPending.current;
    });
    return () => setStepUpHandler(null);
  }, []);

  /** Wraps an async handler so a failed request shows a toast instead of an unhandled rejection. */
  const guard =
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
    async (...args: A): Promise<void> => {
      try {
        await fn(...args);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Something went wrong');
      }
    };

  const navigate = useCallback((nextPath: string) => {
    const clean = normalizePath(nextPath);
    if (normalizePath(window.location.pathname) !== clean) {
      window.history.pushState({}, '', clean);
    }
    setPath(clean);
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const data = await apiRequest<{
        user: UserSession;
        workspace: TenantWorkspace;
        integrations: IntegrationStatusItem[];
      }>('/api/workspace');
      setUser(data.user);
      setWorkspace(data.workspace);
      setIntegrations(data.integrations);
      return data.workspace;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load workspace';
      setWorkspaceError(msg);
      return null;
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiRequest<{user: UserSession | null}>('/api/auth/me');
        if (!active) return;
        setUser(res.user);
        if (res.user) {
          await fetchWorkspace();
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchWorkspace]);

  // Guard /app/* routes when unauthenticated, and prompt onboarding for brand-new signups
  useEffect(() => {
    if (authLoading) return;
    if (path.startsWith('/app') && !user) {
      navigate('/login');
      return;
    }
    if (
      user &&
      workspace &&
      !workspace.onboardingCompleted &&
      !onboardingSkipped &&
      path.startsWith('/app') &&
      path !== '/app/onboarding'
    ) {
      navigate('/app/onboarding');
    }
  }, [authLoading, path, user, workspace, onboardingSkipped, navigate]);

  const handleAuthSuccess = async (loggedUser: UserSession, redirectPath: string) => {
    setOnboardingSkipped(false);
    setUser(loggedUser);
    const ws = await fetchWorkspace();
    if (ws && !ws.onboardingCompleted) {
      navigate('/app/onboarding');
    } else {
      navigate(loggedUser.role === 'Technician' ? '/app/jobs' : redirectPath || '/app/overview');
    }
  };

  const handleGetStarted = () => navigate('/signup');

  const handleVerified = async () => {
    try {
      const me = await apiRequest<{user: UserSession | null}>('/api/auth/me');
      if (me.user) {
        await fetchWorkspace();
        navigate('/app/overview');
        return;
      }
    } catch {
      /* fall through to login */
    }
    navigate('/login');
  };

  const handleResendVerification = async () => {
    try {
      await apiRequest('/api/auth/resend-verification', {method: 'POST'});
      showToast('Verification email sent. Check your inbox.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send verification email');
    }
  };

  const handleUpdateProfile = async (name: string) => {
    const res = await apiRequest<{user: UserSession}>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({name}),
    });
    setUser(res.user);
    await fetchWorkspace();
  };

  const handleForgetDevices = async () => {
    await apiRequest('/api/auth/forget-devices', {method: 'POST'});
    await fetchWorkspace();
    showToast('All saved devices were forgotten and other sessions signed out.');
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    await apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({currentPassword, newPassword}),
    });
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', {method: 'POST'});
    } finally {
      setUser(null);
      setWorkspace(null);
      setIntegrations([]);
      navigate('/');
    }
  };

  // Workspace Mutations
  const handleCreateLead = guard(async (payload: Partial<LeadItem>) => {
    const data = await apiRequest<{lead: LeadItem}>('/api/leads', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await fetchWorkspace();
    showToast(`Lead saved for ${data.lead.name}`);
  });

  const handleUpdateLead = guard(async (id: string, patch: Partial<LeadItem>) => {
    const res = await apiRequest<{lead: LeadItem}>(`/api/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            leads: prev.leads.map((l) => (l.id === id ? res.lead : l)),
          }
        : prev
    );
    showToast('Lead record updated');
  });

  const handleDeleteLead = guard(async (id: string) => {
    await apiRequest(`/api/leads/${id}`, {method: 'DELETE'});
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            leads: prev.leads.filter((l) => l.id !== id),
          }
        : prev
    );
    showToast('Lead removed');
  });

  const handleCreateLeadFromCall = guard(async (call: CallItem) => {
    const res = await apiRequest<{lead: LeadItem}>('/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        name: call.callerName,
        phone: call.callerPhone,
        trade: call.trade,
        serviceType: call.serviceRequested,
        problemDescription: call.aiSummary,
        zip: call.zip,
        fullAddress: call.address,
        urgency: call.urgency,
        leadSource: 'AI Phone Receptionist',
        callDurationSec: call.durationSec,
        linkedCallId: call.id,
        estimatedValue: call.estimatedValue,
        status: call.urgency === 'Emergency' ? 'Qualified' : 'New',
      }),
    });
    await fetchWorkspace();
    showToast(`Created lead from ${call.callerName}'s call`);
    navigate(`/app/leads/${res.lead.id}`);
  });

  const handleSaveVoiceAgent = guard(async (patch: Partial<VoiceAgentConfig>) => {
    const res = await apiRequest<{voiceAgent: VoiceAgentConfig}>('/api/agent-config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) => (prev ? {...prev, voiceAgent: res.voiceAgent} : prev));
    showToast('Voice agent configuration saved');
  });

  const handleSavePhoneSetup = guard(async (patch: Partial<PhoneSetupConfig>) => {
    const res = await apiRequest<{phoneSetup: PhoneSetupConfig}>('/api/phone-setup', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) => (prev ? {...prev, phoneSetup: res.phoneSetup} : prev));
    showToast('System Number & forwarding setup saved');
  });

  const handleProvisionSystemNumber = async (
    areaCode: string,
    numberType: 'Local DID' | 'Toll-Free 888'
  ): Promise<PhoneSetupConfig | null> => {
    try {
      const res = await apiRequest<{phoneSetup: PhoneSetupConfig}>('/api/phone-setup/provision', {
        method: 'POST',
        body: JSON.stringify({areaCode, numberType}),
      });
      await fetchWorkspace();
      showToast(`Demo number ${res.phoneSetup.systemNumber} generated (simulated, not a real line)`);
      return res.phoneSetup;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not provision number');
      return null;
    }
  };

  const handleTestSystemCall = async (): Promise<{callId: string} | null> => {
    try {
      const res = await apiRequest<{call: CallItem; phoneSetup: PhoneSetupConfig}>(
        '/api/system-voice/inbound',
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      await fetchWorkspace();
      showToast('Simulated test call logged');
      return {callId: res.call.id};
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Test call failed');
      return null;
    }
  };

  const handleSaveSettings = guard(async (patch: Partial<BusinessSettingsData>) => {
    const res = await apiRequest<{settings: BusinessSettingsData}>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) => (prev ? {...prev, settings: res.settings} : prev));
    showToast('Workspace settings saved');
  });

  const handleCreateAppointment = guard(async (payload: Partial<AppointmentItem>) => {
    const res = await apiRequest<{appointment: AppointmentItem}>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setWorkspace((prev) =>
      prev ? {...prev, appointments: [res.appointment, ...prev.appointments]} : prev
    );
    showToast(`Scheduled ${res.appointment.title}`);
  });

  const handleUpdateAppointment = guard(async (id: string, patch: Partial<AppointmentItem>) => {
    const res = await apiRequest<{appointment: AppointmentItem}>(`/api/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            appointments: prev.appointments.map((a) => (a.id === id ? res.appointment : a)),
          }
        : prev
    );
    showToast('Appointment status updated');
  });

  const handleUpdateFollowUp = guard(async (id: string, patch: Partial<FollowUpItem>) => {
    const res = await apiRequest<{followUp: FollowUpItem}>(`/api/followups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            followUps: prev.followUps.map((f) => (f.id === id ? res.followUp : f)),
          }
        : prev
    );
    showToast('Follow-up reminder updated');
  });

  const handleMarkNotificationRead = guard(async (id: string) => {
    await apiRequest(`/api/notifications/${id}/read`, {method: 'PATCH'});
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            notifications: prev.notifications.map((n) => (n.id === id ? {...n, read: true} : n)),
          }
        : prev
    );
  });

  const handleMarkAllNotificationsRead = guard(async () => {
    await apiRequest('/api/notifications/read-all', {method: 'POST'});
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            notifications: prev.notifications.map((n) => ({...n, read: true})),
          }
        : prev
    );
    showToast('All notifications marked read');
  });

  const handleInviteMember = guard(async (payload: Partial<TeamMember>) => {
    const res = await apiRequest<{member: TeamMember}>('/api/team', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setWorkspace((prev) => (prev ? {...prev, team: [...prev.team, res.member]} : prev));
    showToast(`Invitation sent to ${res.member.name}`);
  });

  const handleToggleOnCall = guard(async (id: string, onCall: boolean) => {
    const res = await apiRequest<{member: TeamMember}>(`/api/team/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({onCall}),
    });
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            team: prev.team.map((m) => (m.id === id ? res.member : m)),
          }
        : prev
    );
    showToast(`${res.member.name} is now ${onCall ? 'On-Call Active' : 'Off Duty'}`);
  });

  const handleRemoveMember = guard(async (id: string) => {
    await apiRequest(`/api/team/${id}`, {method: 'DELETE'});
    setWorkspace((prev) =>
      prev ? {...prev, team: prev.team.filter((m) => m.id !== id)} : prev
    );
    showToast('Team member removed');
  });

  const handleChangePlan = guard(async (plan: PlanTier, billingCycle: 'monthly' | 'annual' = 'monthly') => {
    const b = workspace?.billing;
    if (b?.paymentsEnabled) {
      // Real payments: go to Stripe Checkout (new subscription) or the Stripe portal (change an existing one).
      const live = ['trialing', 'active', 'past_due'].includes(b.subscriptionStatus ?? '');
      const {url} = await apiRequest<{url: string}>(live ? '/api/billing/portal' : '/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({plan, billingCycle}),
      });
      window.location.href = url;
      return;
    }
    const res = await apiRequest<{billing: TenantWorkspace['billing']}>('/api/billing', {
      method: 'PATCH',
      body: JSON.stringify({plan}),
    });
    setWorkspace((prev) => (prev ? {...prev, billing: res.billing} : prev));
    showToast(`Subscription switched to ${plan} plan`);
  });

  const handleSendReviewRequest = guard(async (id: string) => {
    const res = await apiRequest<{lead: LeadItem}>(`/api/leads/${id}/review-request`, {method: 'POST', body: '{}'});
    setWorkspace((prev) => (prev ? {...prev, leads: prev.leads.map((l) => (l.id === id ? res.lead : l))} : prev));
    showToast('Review request sent');
  });

  const handleCreateQuote = async (leadId: string, body: {title: string; items: {description: string; amount: number}[]; notes: string}): Promise<boolean> => {
    try {
      const res = await apiRequest<{quote: QuoteItem}>(`/api/leads/${leadId}/quotes`, {method: 'POST', body: JSON.stringify(body)});
      setWorkspace((prev) => (prev ? {...prev, quotes: [res.quote, ...(prev.quotes ?? [])]} : prev));
      showToast('Quote created. Copy or text the link to the customer.');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the quote');
      return false;
    }
  };

  const handleCreateReminder = async (leadId: string, body: {months?: number; dueDateISO?: string; message: string}): Promise<boolean> => {
    try {
      const res = await apiRequest<{reminder: ReminderItem}>(`/api/leads/${leadId}/reminders`, {method: 'POST', body: JSON.stringify(body)});
      setWorkspace((prev) => (prev ? {...prev, reminders: [res.reminder, ...(prev.reminders ?? [])]} : prev));
      showToast('Reminder scheduled');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not schedule the reminder');
      return false;
    }
  };

  const handleCancelReminder = guard(async (id: string) => {
    const res = await apiRequest<{reminder: ReminderItem}>(`/api/reminders/${id}/cancel`, {method: 'POST', body: '{}'});
    setWorkspace((prev) => (prev ? {...prev, reminders: (prev.reminders ?? []).map((r) => (r.id === id ? res.reminder : r))} : prev));
    showToast('Reminder cancelled');
  });

  const handleQuoteAction = guard(async (id: string, action: 'send' | 'void') => {
    const res = await apiRequest<{quote: QuoteItem}>(`/api/quotes/${id}/${action}`, {method: 'POST', body: '{}'});
    setWorkspace((prev) => (prev ? {...prev, quotes: (prev.quotes ?? []).map((q) => (q.id === id ? res.quote : q))} : prev));
    showToast(action === 'send' ? 'Quote link texted to the customer' : 'Quote voided');
  });

  const handleMergeLead = guard(async (keepId: string, mergeId: string) => {
    const res = await apiRequest<{lead: LeadItem; removedId: string}>('/api/leads/merge', {method: 'POST', body: JSON.stringify({keepId, mergeId})});
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            leads: prev.leads.filter((l) => l.id !== res.removedId).map((l) => (l.id === keepId ? res.lead : l)),
            quotes: (prev.quotes ?? []).map((q) => (q.leadId === res.removedId ? {...q, leadId: keepId} : q)),
          }
        : prev
    );
    showToast('Leads merged');
  });

  const handleOpenPortal = guard(async () => {
    const {url} = await apiRequest<{url: string}>('/api/billing/portal', {method: 'POST', body: '{}'});
    window.location.href = url;
  });

  const handleCompleteOnboarding = guard(async () => {
    await apiRequest('/api/onboarding/complete', {method: 'POST'});
    setWorkspace((prev) => (prev ? {...prev, onboardingCompleted: true} : prev));
    showToast('PlumbVoice AI is active 24/7');
  });

  // Customer-facing booking page of one business (no PlumbVoice marketing chrome).
  if (path.startsWith('/book/')) {
    return <BookingPage orgId={decodeURIComponent(path.slice('/book/'.length).split('/')[0] ?? '')} />;
  }

  if (path.startsWith('/quote/')) {
    const [orgId = '', quoteId = ''] = path.slice('/quote/'.length).split('/').map(decodeURIComponent);
    return <QuotePage orgId={orgId} quoteId={quoteId} />;
  }

  // Business App Routes
  if (path.startsWith('/app')) {
    if (authLoading || workspaceLoading || (!workspace && !workspaceError)) {
      return (
        <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
          <div className="card-tier-1 p-8 w-full max-w-md text-center space-y-4">
            <div className="w-10 h-10 rounded-lg bg-[#C8672B] text-white font-display font-extrabold flex items-center justify-center mx-auto">
              PV
            </div>
            <p className="headline-sm text-[#1C1F22]">Loading PlumbVoice AI Workspace…</p>
            <div className="h-2 rounded-full bg-[#ECE6DC] overflow-hidden">
              <div className="h-full w-1/2 bg-[#C8672B] animate-pulse" />
            </div>
          </div>
        </div>
      );
    }

    if (workspaceError || !workspace || !user) {
      return (
        <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
          <div className="card-tier-1 p-8 w-full max-w-md text-center space-y-4">
            <AlertCircle className="w-8 h-8 text-[#D64545] mx-auto" />
            <h1 className="headline-md text-[#1C1F22]">Unable to load workspace</h1>
            <p className="text-[14px] text-[#7A746B]">
              {workspaceError || 'Your session expired. Sign back in to continue.'}
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => fetchWorkspace()}
                className="btn-secondary inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry</span>
              </button>
              <button type="button" onClick={() => navigate('/login')} className="btn-primary cursor-pointer">
                Sign In
              </button>
            </div>
          </div>
        </div>
      );
    }

    const googleConnected = integrations.some((i) => i.id === 'google-calendar' && i.connected);

    const isTech = user.role === 'Technician';
    const renderAppPage = () => {
      if (isTech) {
        // Technicians only get their own job list and their account page.
        if (path === '/app/profile') {
          return <ProfileSecurityPage user={user} onUpdateName={handleUpdateProfile} onChangePassword={handleChangePassword} onForgetDevices={handleForgetDevices} />;
        }
        return (
          <TechnicianPage
            appointments={workspace.appointments}
            leads={workspace.leads}
            technicianName={user.name}
            onUpdateAppointment={handleUpdateAppointment}
            onUpdateLead={handleUpdateLead}
          />
        );
      }
      if (path === '/app' || path === '/app/overview') {
        return <OverviewDashboardPage workspace={workspace} onNavigate={navigate} />;
      }
      if (path === '/app/calls') {
        return <CallsListPage calls={workspace.calls} onNavigate={navigate} />;
      }
      if (path.startsWith('/app/calls/')) {
        const callId = decodeURIComponent(path.slice('/app/calls/'.length));
        const call = workspace.calls.find((c) => c.id === callId);
        const linkedLead = call?.linkedLeadId
          ? workspace.leads.find((l) => l.id === call.linkedLeadId)
          : undefined;
        return (
          <CallDetailPage
            call={call}
            linkedLead={linkedLead}
            onNavigate={navigate}
            onCreateLeadFromCall={handleCreateLeadFromCall}
          />
        );
      }
      if (path === '/app/leads') {
        return (
          <LeadsListPage
            leads={workspace.leads}
            team={workspace.team}
            onNavigate={navigate}
            onCreateLead={handleCreateLead}
            onUpdateLead={handleUpdateLead}
          />
        );
      }
      if (path.startsWith('/app/leads/')) {
        const leadId = decodeURIComponent(path.slice('/app/leads/'.length));
        const lead = workspace.leads.find((l) => l.id === leadId);
        const linkedCall = lead?.linkedCallId
          ? workspace.calls.find((c) => c.id === lead.linkedCallId)
          : undefined;
        return (
          <LeadDetailPage
            key={lead?.id || leadId}
            lead={lead}
            linkedCall={linkedCall}
            team={workspace.team}
            onNavigate={navigate}
            onUpdateLead={handleUpdateLead}
            onDeleteLead={handleDeleteLead}
            onSendReviewRequest={handleSendReviewRequest}
            allLeads={workspace.leads}
            quotes={workspace.quotes ?? []}
            reminders={workspace.reminders ?? []}
            onCreateReminder={handleCreateReminder}
            onCancelReminder={handleCancelReminder}
            onCreateQuote={handleCreateQuote}
            onQuoteAction={handleQuoteAction}
            onMergeLead={handleMergeLead}
          />
        );
      }
      if (path === '/app/voice-agent') {
        return (
          <VoiceAgentConfigPage
            config={workspace.voiceAgent}
            onSave={handleSaveVoiceAgent}
            onNavigate={navigate}
          />
        );
      }
      if (path === '/app/test-agent') {
        return (
          <TestAgentPage
            config={workspace.voiceAgent}
            onCallSaved={async () => {
              await fetchWorkspace();
              showToast('Real AI voice call saved to Calls & Leads');
            }}
            onNavigate={navigate}
          />
        );
      }
      if (path === '/app/phone-setup') {
        return (
          <PhoneSetupPage
            phoneSetup={workspace.phoneSetup}
            onSave={handleSavePhoneSetup}
            onProvisionSystemNumber={handleProvisionSystemNumber}
            onTestSystemCall={handleTestSystemCall}
            onNavigate={navigate}
          />
        );
      }
      if (path === '/app/appointments') {
        return (
          <AppointmentsPage
            appointments={workspace.appointments}
            team={workspace.team}
            googleConnected={googleConnected}
            onCreateAppointment={handleCreateAppointment}
            onUpdateAppointment={handleUpdateAppointment}
          />
        );
      }
      if (path === '/app/follow-ups') {
        return (
          <FollowUpsPage
            followUps={workspace.followUps}
            onUpdateFollowUp={handleUpdateFollowUp}
            onNavigate={navigate}
          />
        );
      }
      if (path === '/app/notifications') {
        return (
          <NotificationsPage
            notifications={workspace.notifications}
            onMarkRead={handleMarkNotificationRead}
            onMarkAllRead={handleMarkAllNotificationsRead}
            onNavigate={navigate}
          />
        );
      }
      if (path === '/app/analytics') {
        return <AnalyticsPage workspace={workspace} />;
      }
      if (path === '/app/team') {
        return (
          <>
            <TeamManagementPage
              team={workspace.team}
              onInvite={handleInviteMember}
              onToggleOnCall={handleToggleOnCall}
              onRemove={handleRemoveMember}
            />
            <div className="mt-6">
              <AuditLogCard />
            </div>
          </>
        );
      }
      if (path === '/app/settings' || path.startsWith('/app/settings/')) {
        const subRaw = path.replace('/app/settings', '').replace('/', '');
        const subPage =
          subRaw === 'hours' || subRaw === 'knowledge' || subRaw === 'emergency'
            ? subRaw
            : 'profile';
        return (
          <SettingsSubPages
            subPage={subPage}
            settings={workspace.settings}
            voiceAgent={workspace.voiceAgent}
            onNavigate={navigate}
            onSaveSettings={handleSaveSettings}
            onSaveAgent={handleSaveVoiceAgent}
          />
        );
      }
      if (path === '/app/billing') {
        return <BillingPage billing={workspace.billing} onChangePlan={handleChangePlan} onOpenPortal={handleOpenPortal} />;
      }
      if (path === '/app/integrations') {
        return <IntegrationsPage integrations={integrations} />;
      }
      if (path === '/app/profile') {
        return <ProfileSecurityPage user={user} onUpdateName={handleUpdateProfile} onChangePassword={handleChangePassword} onForgetDevices={handleForgetDevices} />;
      }
      if (path === '/app/onboarding') {
        return (
          <OnboardingWizardPage
            workspace={workspace}
            integrations={integrations}
            onSaveAgent={handleSaveVoiceAgent}
            onSavePhone={handleSavePhoneSetup}
            onCompleteOnboarding={handleCompleteOnboarding}
            onSkip={() => {
              setOnboardingSkipped(true);
              navigate(user?.role === 'Technician' ? '/app/jobs' : '/app/overview');
            }}
            onNavigate={navigate}
          />
        );
      }
      return <OverviewDashboardPage workspace={workspace} onNavigate={navigate} />;
    };

    return (
      <AppLayout
        currentPath={path}
        onNavigate={navigate}
        user={user}
        workspace={workspace}
        onLogout={handleLogout}
      >
        {stepUpResolve && <StepUpModal onDone={stepUpResolve} />}
        {!user.emailVerified && (
          <div
            role="alert"
            className="mb-6 rounded-xl bg-[#FFF6E5] border border-[#F2A93B]/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#7A4B00]"
          >
            <span>Please verify your email ({user.email}) to unlock number provisioning and team invites.</span>
            <button type="button" onClick={handleResendVerification} className="font-semibold underline cursor-pointer">
              Resend email
            </button>
          </div>
        )}
        {toastMessage && (
          <div
            role="status"
            className="mb-6 rounded-xl bg-[#1C1F22] text-[#FAF7F2] px-4 py-3 flex items-center gap-2.5 text-[13px] font-medium shadow-md"
          >
            <CheckCircle2 className="w-4 h-4 text-[#F2A93B] shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
        {(() => {
          const a = workspace.billing.access;
          if (!a || a.state === 'free' || a.state === 'active') return null;
          if (a.state === 'trial' && (a.trialDaysLeft ?? 99) > 7) return null;
          const when = a.endsAtISO ? new Date(a.endsAtISO).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : '';
          const text =
            a.state === 'trial'
              ? `Free trial: ${a.trialDaysLeft} day${a.trialDaysLeft === 1 ? '' : 's'} left. Subscribe under Billing to keep AI chat and tools running.`
              : a.state === 'grace'
                ? `Your last payment failed. Update your card${when ? ` by ${when}` : ''} or AI features will pause.`
                : a.state === 'canceling'
                  ? `Your subscription ends${when ? ` on ${when}` : ' at the end of this period'}.`
                  : 'Your subscription is inactive, so AI chat and tools are paused. Reactivate under Billing.';
          const bad = a.state === 'blocked' || a.state === 'grace';
          return (
            <div
              role="alert"
              className={`mb-6 rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px] ${bad ? 'bg-[#FDECEA] border-[#D64545]/40 text-[#8A1F1F]' : 'bg-[#FFF6E5] border-[#F2A93B]/40 text-[#7A4B00]'}`}
            >
              <span>{text}</span>
              {path !== '/app/billing' && (
                <button type="button" onClick={() => navigate('/app/billing')} className="font-semibold underline cursor-pointer">
                  Open Billing
                </button>
              )}
            </div>
          );
        })()}
        {renderAppPage()}
      </AppLayout>
    );
  }

  // Public Website + Auth Routes
  const renderPublicPage = () => {
    if (path === '/') {
      return <HomePage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/how-it-works') {
      return <HowItWorksPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/features') {
      return <FeaturesPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/plumbing-answering-service') {
      return <PlumbingSolutionsPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/electrician-answering-service') {
      return <ElectricalSolutionsPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/pricing') {
      return <PricingPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path === '/about') {
      return <AboutContactPage isContact={false} onNavigate={navigate} />;
    }
    if (path === '/contact') {
      return <AboutContactPage isContact={true} onNavigate={navigate} />;
    }
    if (path === '/blog') {
      return <BlogPage onNavigate={navigate} onGetStarted={handleGetStarted} />;
    }
    if (path.startsWith('/cities/')) {
      const slug = path.slice('/cities/'.length);
      return <CityLandingPage citySlug={slug} onNavigate={navigate} />;
    }
    if (path === '/login') {
      return <AuthPage mode="login" onNavigate={navigate} onAuthSuccess={handleAuthSuccess} />;
    }
    if (path === '/signup') {
      return <AuthPage mode="signup" onNavigate={navigate} onAuthSuccess={handleAuthSuccess} />;
    }
    if (path === '/forgot-password') {
      return <AuthPage mode="forgot" onNavigate={navigate} onAuthSuccess={handleAuthSuccess} />;
    }
    if (path === '/reset-password') {
      return <AuthPage mode="reset" onNavigate={navigate} onAuthSuccess={handleAuthSuccess} />;
    }
    if (path === '/verify-email') {
      return (
        <AuthPage mode="verify" onNavigate={navigate} onAuthSuccess={handleAuthSuccess} onVerified={handleVerified} />
      );
    }
    return <NotFoundPage onNavigate={navigate} />;
  };

  return (
    <PublicLayout currentPath={path} onNavigate={navigate} isLoggedIn={Boolean(user)}>
      {renderPublicPage()}
    </PublicLayout>
  );
}
