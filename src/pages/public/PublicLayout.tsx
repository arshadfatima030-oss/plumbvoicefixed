import {useState} from 'react';
import {Menu, ShieldCheck, X} from 'lucide-react';

interface PublicLayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isLoggedIn: boolean;
  children: React.ReactNode;
}

const NAV_LINKS = [
  {label: 'Home', path: '/'},
  {label: 'How It Works', path: '/how-it-works'},
  {label: 'Features', path: '/features'},
  {label: 'Plumbing', path: '/plumbing-answering-service'},
  {label: 'Electrical', path: '/electrician-answering-service'},
  {label: 'Pricing', path: '/pricing'},
];

export function PublicLayout({
  currentPath,
  onNavigate,
  isLoggedIn,
  children,
}: PublicLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const go = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#23282D] overflow-x-hidden">
      {/* Sticky Clean 3-Zone Header */}
      <header className="sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-sm border-b border-[#ECE6DC]">
        <div className="max-w-[1280px] mx-auto px-3.5 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 sm:gap-6">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              go('/');
            }}
            className="flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <span className="w-8 h-8 rounded-lg bg-[#C8672B] text-white font-display font-extrabold text-sm flex items-center justify-center">
              PV
            </span>
            <span className="font-display font-bold text-[17px] sm:text-[18px] tracking-tight text-[#1C1F22]">
              PlumbVoice AI
            </span>
          </a>

          {/* Zone 2: Single-line Nav Links */}
          <nav className="hidden lg:flex items-center gap-6" aria-label="Primary website navigation">
            {NAV_LINKS.map((item) => {
              const active = currentPath === item.path;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.path);
                  }}
                  className={`text-[14px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'text-[#C8672B] underline underline-offset-8 decoration-2'
                      : 'text-[#23282D] hover:text-[#C8672B]'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: Auth & Primary CTA */}
          <div className="hidden lg:flex items-center gap-3 shrink-0">
            {isLoggedIn ? (
              <button
                type="button"
                onClick={() => go('/app/overview')}
                className="btn-primary text-[13px] whitespace-nowrap cursor-pointer"
              >
                Open App Dashboard
              </button>
            ) : (
              <>
                <a
                  href="/login"
                  onClick={(e) => {
                    e.preventDefault();
                    go('/login');
                  }}
                  className="px-3.5 py-2 text-[13px] font-semibold text-[#1C1F22] hover:text-[#C8672B] whitespace-nowrap"
                >
                  Log In
                </a>
                <button
                  type="button"
                  onClick={() => go('/signup')}
                  className="btn-primary text-[13px] whitespace-nowrap cursor-pointer"
                >
                  Start Free Trial
                </button>
              </>
            )}
          </div>

          <div className="flex lg:hidden items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => go(isLoggedIn ? '/app/overview' : '/signup')}
              className="btn-primary text-[12px] px-3 py-1.5 whitespace-nowrap cursor-pointer"
            >
              {isLoggedIn ? 'Dashboard' : 'Free Trial'}
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle mobile menu"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-[#1C1F22] hover:bg-[#ECE6DC]/60"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-[#ECE6DC] bg-white px-4 py-4 space-y-1 shadow-lg">
            {NAV_LINKS.map((item) => (
              <a
                key={item.path}
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  go(item.path);
                }}
                className="block py-2.5 px-2 rounded-lg text-[15px] font-medium text-[#1C1F22] hover:bg-[#FAF7F2] hover:text-[#C8672B]"
              >
                {item.label}
              </a>
            ))}
            <a
              href="/blog"
              onClick={(e) => {
                e.preventDefault();
                go('/blog');
              }}
              className="block py-2.5 px-2 rounded-lg text-[15px] font-medium text-[#1C1F22] hover:bg-[#FAF7F2] hover:text-[#C8672B]"
            >
              Contractor Blog
            </a>
            <a
              href="/contact"
              onClick={(e) => {
                e.preventDefault();
                go('/contact');
              }}
              className="block py-2.5 px-2 rounded-lg text-[15px] font-medium text-[#1C1F22] hover:bg-[#FAF7F2] hover:text-[#C8672B]"
            >
              Contact &amp; Demo
            </a>
            <div className="pt-3 mt-2 border-t border-[#ECE6DC] grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => go(isLoggedIn ? '/app/overview' : '/login')}
                className="btn-secondary w-full text-[13.5px]"
              >
                {isLoggedIn ? 'Dashboard' : 'Log In'}
              </button>
              <button
                type="button"
                onClick={() => go('/signup')}
                className="btn-primary w-full text-[13.5px]"
              >
                Start Trial
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* SEO & Local Contractor Footer */}
      <footer className="bg-[#1C1F22] text-[#FAF7F2] border-t border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-[#C8672B] text-white font-display font-extrabold text-sm flex items-center justify-center">
                PV
              </span>
              <span className="font-display font-bold text-[18px] text-white">
                PlumbVoice AI
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-[#A8A298]">
              24/7 AI phone receptionist and lead capture platform built exclusively for American plumbing and electrical contractors.
            </p>
            <div className="space-y-1 text-[13px] text-[#FAF7F2]">
              <p className="font-semibold">PlumbVoice AI Inc.</p>
              <p className="text-[#A8A298]">2418 S Congress Ave, Austin, TX 78704</p>
            </div>
          </div>

          <div>
            <p className="label-caps text-[#F2A93B] mb-4">Solutions</p>
            <ul className="space-y-2.5 text-[14px] text-[#C8C3BA]">
              <li>
                <a href="/plumbing-answering-service" onClick={(e) => { e.preventDefault(); go('/plumbing-answering-service'); }} className="hover:text-white">
                  Plumbing Answering Service
                </a>
              </li>
              <li>
                <a href="/electrician-answering-service" onClick={(e) => { e.preventDefault(); go('/electrician-answering-service'); }} className="hover:text-white">
                  Electrical Answering Service
                </a>
              </li>
              <li>
                <a href="/how-it-works" onClick={(e) => { e.preventDefault(); go('/how-it-works'); }} className="hover:text-white">
                  How Call Forwarding Works
                </a>
              </li>
              <li>
                <a href="/features" onClick={(e) => { e.preventDefault(); go('/features'); }} className="hover:text-white">
                  Platform Features
                </a>
              </li>
              <li>
                <a href="/pricing" onClick={(e) => { e.preventDefault(); go('/pricing'); }} className="hover:text-white">
                  Pricing &amp; Plans
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="label-caps text-[#F2A93B] mb-4">US Service Markets</p>
            <ul className="space-y-2.5 text-[14px] text-[#C8C3BA]">
              <li>
                <a href="/cities/houston-tx" onClick={(e) => { e.preventDefault(); go('/cities/houston-tx'); }} className="hover:text-white">
                  Houston, TX Contractors
                </a>
              </li>
              <li>
                <a href="/cities/austin-tx" onClick={(e) => { e.preventDefault(); go('/cities/austin-tx'); }} className="hover:text-white">
                  Austin, TX Contractors
                </a>
              </li>
              <li>
                <a href="/cities/phoenix-az" onClick={(e) => { e.preventDefault(); go('/cities/phoenix-az'); }} className="hover:text-white">
                  Phoenix, AZ Contractors
                </a>
              </li>
              <li>
                <a href="/cities/denver-co" onClick={(e) => { e.preventDefault(); go('/cities/denver-co'); }} className="hover:text-white">
                  Denver, CO Contractors
                </a>
              </li>
              <li>
                <a href="/blog" onClick={(e) => { e.preventDefault(); go('/blog'); }} className="hover:text-white">
                  Contractor Guides &amp; Blog
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="label-caps text-[#F2A93B] mb-4">Company &amp; Trust</p>
            <ul className="space-y-2.5 text-[14px] text-[#C8C3BA]">
              <li>
                <a href="/about" onClick={(e) => { e.preventDefault(); go('/about'); }} className="hover:text-white">
                  About PlumbVoice AI
                </a>
              </li>
              <li>
                <a href="/contact" onClick={(e) => { e.preventDefault(); go('/contact'); }} className="hover:text-white">
                  Contact &amp; Book Demo
                </a>
              </li>
              <li>
                <a href="/login" onClick={(e) => { e.preventDefault(); go('/login'); }} className="hover:text-white">
                  Contractor Sign In
                </a>
              </li>
              <li>
                <a href="/signup" onClick={(e) => { e.preventDefault(); go('/signup'); }} className="hover:text-white">
                  Start 14-Day Trial
                </a>
              </li>
            </ul>
            <div className="mt-5 p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2 text-[12px] text-[#FAF7F2]">
              <ShieldCheck className="w-4 h-4 text-[#2E8B57] shrink-0" />
              <span>US-Based Support · TCPA Compliant</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-[#8E887E]">
            <p>© {new Date().getFullYear()} PlumbVoice AI Inc. Built for American Plumbing &amp; Electrical Contractors.</p>
            <p>Never Miss Another Customer Call.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
