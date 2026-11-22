import {useState} from 'react';
import {
  BarChart3,
  Bell,
  Bot,
  Calendar,
  CreditCard,
  ExternalLink,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Wrench,
  MessageSquare,
  Mic,
  PhoneCall,
  PhoneForwarded,
  Plug,
  Rocket,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type {TenantWorkspace, UserSession} from '../../types/plumbvoice';

interface AppLayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  user: UserSession;
  workspace: TenantWorkspace;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      {label: 'Overview', path: '/app/overview', icon: LayoutDashboard},
      {label: 'Calls', path: '/app/calls', icon: PhoneCall},
      {label: 'Leads', path: '/app/leads', icon: Users},
      {label: 'Appointments', path: '/app/appointments', icon: Calendar},
      {label: 'Follow-Ups', path: '/app/follow-ups', icon: MessageSquare},
      {label: 'Notifications', path: '/app/notifications', icon: Bell},
    ],
  },
  {
    label: 'Voice AI & Phone',
    items: [
      {label: 'Voice Agent', path: '/app/voice-agent', icon: Bot},
      {label: 'Test AI Agent', path: '/app/test-agent', icon: Mic},
      {label: 'Phone Setup', path: '/app/phone-setup', icon: PhoneForwarded},
    ],
  },
  {
    label: 'System & Account',
    items: [
      {label: 'Analytics', path: '/app/analytics', icon: BarChart3},
      {label: 'Team', path: '/app/team', icon: Users},
      {label: 'Settings', path: '/app/settings/profile', matchPrefix: '/app/settings', icon: Settings},
      {label: 'Billing & Plans', path: '/app/billing', icon: CreditCard},
      {label: 'Integrations', path: '/app/integrations', icon: Plug},
      {label: 'Profile & Security', path: '/app/profile', icon: Shield},
      {label: 'Setup Wizard', path: '/app/onboarding', icon: Rocket},
    ],
  },
];

type NavGroup = {label: string; items: {label: string; path: string; matchPrefix?: string; icon: typeof Home}[]};

const TECH_NAV_GROUPS: NavGroup[] = [
  {
    label: 'My Work',
    items: [
      {label: 'My Jobs', path: '/app/jobs', icon: Wrench},
      {label: 'Profile & Security', path: '/app/profile', icon: Shield},
    ],
  },
];

function getBreadcrumb(path: string): {section: string; page: string} {
  if (path.startsWith('/app/calls/')) return {section: 'Operations / Calls', page: 'Call Detail'};
  if (path === '/app/jobs') return {section: 'My Work', page: 'My Jobs'};
  if (path === '/app/calls') return {section: 'Operations', page: 'Inbound Calls'};
  if (path.startsWith('/app/leads/')) return {section: 'Operations / Leads', page: 'Lead Detail'};
  if (path === '/app/leads') return {section: 'Operations', page: 'Leads CRM'};
  if (path === '/app/appointments') return {section: 'Operations', page: 'Appointments & Calendar'};
  if (path === '/app/follow-ups') return {section: 'Operations', page: 'Follow-Ups & Reminders'};
  if (path === '/app/notifications') return {section: 'Operations', page: 'Notifications'};
  if (path === '/app/voice-agent') return {section: 'Voice AI', page: 'Voice Agent Configuration'};
  if (path === '/app/test-agent') return {section: 'Voice AI', page: 'Test Your AI Agent'};
  if (path === '/app/phone-setup') return {section: 'Phone', page: 'Phone Setup & Call Forwarding'};
  if (path === '/app/analytics') return {section: 'Reports', page: 'Analytics & Performance'};
  if (path === '/app/team') return {section: 'Account', page: 'Team Management'};
  if (path === '/app/settings/hours') return {section: 'Settings', page: 'Working Hours'};
  if (path === '/app/settings/knowledge') return {section: 'Settings', page: 'AI Knowledge'};
  if (path === '/app/settings/emergency') return {section: 'Settings', page: 'Emergency Rules'};
  if (path.startsWith('/app/settings')) return {section: 'Settings', page: 'Business Profile'};
  if (path === '/app/billing') return {section: 'Account', page: 'Billing & Plans'};
  if (path === '/app/integrations') return {section: 'Account', page: 'Integrations'};
  if (path === '/app/profile') return {section: 'Account', page: 'Profile & Security'};
  if (path === '/app/onboarding') return {section: 'Onboarding', page: '5-Step Setup Wizard'};
  return {section: 'Operations', page: 'Overview Dashboard'};
}

export function AppLayout({
  currentPath,
  onNavigate,
  user,
  workspace,
  onLogout,
  children,
}: AppLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unreadCount = workspace.notifications.filter((n) => !n.read).length;
  const crumb = getBreadcrumb(currentPath);

  const go = (path: string) => {
    setDrawerOpen(false);
    onNavigate(path);
  };

  const sidebarBody = (
    <div className="flex flex-col h-full bg-[#1C1F22] text-[#FAF7F2] w-[82vw] max-w-[260px] lg:w-[260px] select-none">
      {/* Brand Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(user.role === 'Technician' ? '/app/jobs' : '/app/overview')}
          className="text-left min-w-0 cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#C8672B] text-white font-display font-extrabold text-sm flex items-center justify-center shrink-0">
              PV
            </span>
            <span className="font-display font-bold text-[17px] text-white whitespace-nowrap">
              PlumbVoice AI
            </span>
          </div>
          <p className="text-[12px] text-[#A8A298] mt-1.5 truncate">
            {workspace.settings.businessName}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-lg text-[#A8A298] hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto" aria-label="App sidebar navigation">
        {((user.role === 'Technician' ? TECH_NAV_GROUPS : NAV_GROUPS) as NavGroup[]).map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="px-3 pb-1 label-caps text-[#7A746B]">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.matchPrefix
                ? currentPath.startsWith(item.matchPrefix)
                : currentPath === item.path ||
                  (item.path === '/app/calls' && currentPath.startsWith('/app/calls/')) ||
                  (item.path === '/app/leads' && currentPath.startsWith('/app/leads/'));

              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => go(item.path)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#C8672B] text-white'
                      : 'text-[#C8C3BA] hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#8E887E]'}`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>

                  {item.path === '/app/notifications' && unreadCount > 0 && (
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#F2A93B] text-[#1C1F22] font-bold">
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Operator & Public Website Link */}
      <div className="p-4 border-t border-white/10 space-y-3">
        <button
          type="button"
          onClick={() => go('/')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[12px] font-medium text-[#C8C3BA] cursor-pointer"
        >
          <span>View Public Website</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go('/app/profile')}
            className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-[#2B3035] text-[#F2A93B] font-display font-bold text-xs flex items-center justify-center shrink-0">
              {user.name
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{user.name}</p>
              <p className="text-[11px] text-[#8E887E] truncate">{user.role}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="p-2 rounded-lg text-[#8E887E] hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#FAF7F2] text-[#23282D] pb-24 lg:pb-0 overflow-x-hidden">
      {/* Desktop 260px Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0">
        <div className="fixed top-0 left-0 bottom-0 w-[260px] z-30">{sidebarBody}</div>
      </aside>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#1C1F22]/60 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full shadow-2xl">{sidebarBody}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-[#FAF7F2]/95 backdrop-blur-sm border-b border-[#ECE6DC]">
          <div className="max-w-[1280px] mx-auto px-3.5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2.5 sm:gap-4">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center -ml-1.5 rounded-lg text-[#1C1F22] hover:bg-[#ECE6DC]/60"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="text-[#7A746B] hidden sm:inline whitespace-nowrap">
                  {crumb.section}
                </span>
                <span className="text-[#7A746B] hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <h1 className="font-display font-bold text-[#1C1F22] text-[15px] sm:text-[16px] truncate">
                  {crumb.page}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => go('/')}
                aria-label="Go to home page"
                className="min-w-[40px] min-h-[40px] px-0 sm:px-3 flex items-center justify-center gap-1.5 rounded-lg bg-white border border-[#ECE6DC] text-[#1C1F22] hover:bg-[#FAF7F2] text-[13px] font-medium cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
              </button>

              <button
                type="button"
                onClick={() => go('/app/notifications')}
                aria-label="Notifications"
                className="relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white border border-[#ECE6DC] text-[#1C1F22] hover:bg-[#FAF7F2] cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#C8672B] text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => go('/app/test-agent')}
                className="btn-primary text-[12.5px] sm:text-[13px] px-3 sm:px-5 py-2 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Test Your AI Agent</span>
                <span className="sm:hidden">Test AI</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1280px] mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#1C1F22] border-t border-white/10 grid grid-cols-5 min-h-[64px] pb-[env(safe-area-inset-bottom)]"
      >
        {[
          {label: 'Overview', path: '/app/overview', icon: LayoutDashboard},
          {label: 'Calls', path: '/app/calls', icon: PhoneCall},
          {label: 'Leads', path: '/app/leads', icon: Users},
          {label: 'Phone', path: '/app/phone-setup', icon: PhoneForwarded},
        ].map((tab) => {
          const Icon = tab.icon;
          const active =
            currentPath === tab.path ||
            (tab.path === '/app/calls' && currentPath.startsWith('/app/calls/')) ||
            (tab.path === '/app/leads' && currentPath.startsWith('/app/leads/')) ||
            (tab.path === '/app/overview' && currentPath === '/app');
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => go(tab.path)}
              className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium ${
                active ? 'text-[#F2A93B]' : 'text-[#A8A298]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-[#A8A298]"
        >
          <Menu className="w-4 h-4" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
