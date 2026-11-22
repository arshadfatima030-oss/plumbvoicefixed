import {useEffect, useRef, useState} from 'react';
import {CheckCircle2, Eye, EyeOff, ShieldAlert} from 'lucide-react';
import {apiRequest} from '../../lib/api';
import {usePageSeo} from '../../lib/seo';
import type {UserSession} from '../../types/plumbvoice';

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify';

interface AuthPageProps {
  mode: AuthMode;
  onNavigate: (path: string) => void;
  onAuthSuccess: (user: UserSession, redirectPath: string) => void;
  onVerified?: () => void;
}

const TITLES: Record<AuthMode, string> = {
  login: 'Log In — PlumbVoice AI',
  signup: 'Start Free Trial — PlumbVoice AI',
  forgot: 'Reset Password — PlumbVoice AI',
  reset: 'Choose a New Password — PlumbVoice AI',
  verify: 'Verify Your Email — PlumbVoice AI',
};
const PATHS: Record<AuthMode, string> = {
  login: '/login',
  signup: '/signup',
  forgot: '/forgot-password',
  reset: '/reset-password',
  verify: '/verify-email',
};

function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  label,
  extra,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  label: string;
  extra?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="label-caps text-[#7A746B]">
          {label}
        </label>
        {extra}
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          maxLength={128}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-crafted w-full px-3 pr-10"
          placeholder="At least 8 characters"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#7A746B] hover:text-[#1C1F22] cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export function AuthPage({mode, onNavigate, onAuthSuccess, onVerified}: AuthPageProps) {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState(false);
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<{id: string; hint: string} | null>(null);
  const [code, setCode] = useState('');
  const verifyStarted = useRef(false);

  const token = new URLSearchParams(window.location.search).get('token') || '';

  usePageSeo({
    title: TITLES[mode],
    description: 'Access your PlumbVoice AI contractor receptionist dashboard.',
    path: PATHS[mode],
    noindex: true,
  });

  // Email-verification links land here; POST the token (GET links get consumed by mail scanners).
  useEffect(() => {
    if (mode !== 'verify' || verifyStarted.current) return;
    verifyStarted.current = true;
    if (!token) {
      setError('This verification link is incomplete.');
      return;
    }
    setLoading(true);
    apiRequest('/api/auth/verify-email', {method: 'POST', body: JSON.stringify({token})})
      .then(() => {
        setDone(true);
        window.setTimeout(() => onVerified?.(), 1200);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Verification failed'))
      .finally(() => setLoading(false));
  }, [mode, token, onVerified]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const data = await apiRequest<{
        user?: UserSession;
        codeRequired?: boolean;
        challengeId?: string;
        emailHint?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({email, password, rememberDevice: remember}),
      });
      if (data.codeRequired && data.challengeId) {
        setChallenge({id: data.challengeId, hint: data.emailHint || 'your email'});
        setPassword('');
        return;
      }
      if (data.user) onAuthSuccess(data.user, '/app/overview');
    }, 'Unable to sign in');
  };

  const handleCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    void run(async () => {
      const data = await apiRequest<{user: UserSession}>('/api/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({challengeId: challenge.id, code, rememberDevice: remember}),
      });
      onAuthSuccess(data.user, '/app/overview');
    }, 'Unable to verify the code');
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const data = await apiRequest<{user: UserSession}>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({name, email, password, businessName, businessPhone}),
      });
      onAuthSuccess(data.user, '/app/onboarding');
    }, 'Unable to create account');
  };

  const handleForgot = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiRequest('/api/auth/forgot-password', {method: 'POST', body: JSON.stringify({email})});
      setDone(true);
    }, 'Unable to send reset email');
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('This reset link is incomplete. Request a new one.');
      return;
    }
    void run(async () => {
      await apiRequest('/api/auth/reset-password', {method: 'POST', body: JSON.stringify({token, password})});
      setNotice('Password updated. Sign in with your new password.');
      setDone(true);
    }, 'Unable to reset password');
  };

  const heading: Record<AuthMode, [string, string, string]> = {
    login: challenge
      ? ['Check Your Email', 'Enter your sign-in code', `We sent a 6-digit code to ${challenge.hint}. It expires in 10 minutes.`]
      : ['Contractor Console', 'Sign in to PlumbVoice AI', 'Manage your AI phone receptionist, inbound calls, and leads.'],
    signup: ['14-Day Free Trial', 'Create your contractor account', 'Configure your AI receptionist and forwarding in 5 quick steps.'],
    forgot: ['Account Recovery', 'Reset your password', 'Enter your work email and we will send reset instructions if an account exists.'],
    reset: ['Account Recovery', 'Choose a new password', 'Pick a password you have not used before.'],
    verify: ['Email Verification', 'Verifying your email…', 'One moment while we confirm your address.'],
  };
  const [eyebrow, title, subtitle] = heading[mode];

  const emailField = (id: string) => (
    <div>
      <label htmlFor={id} className="label-caps text-[#7A746B] block mb-1.5">
        Work Email
      </label>
      <input
        id={id}
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input-crafted w-full px-3"
        placeholder="you@yourcompany.com"
      />
    </div>
  );

  const link = (href: string, text: string, className = 'font-semibold text-[#C8672B] hover:underline') => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(href);
      }}
      className={className}
    >
      {text}
    </a>
  );

  return (
    <div className="max-w-md mx-auto px-4 py-14">
      <div className="card-tier-1 p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <span className="label-caps text-[#C8672B]">{eyebrow}</span>
          <h1 className="font-display font-bold text-[24px] text-[#1C1F22]">
            {mode === 'verify' && done ? 'Email verified' : title}
          </h1>
          <p className="text-[13px] text-[#7A746B]">{subtitle}</p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-[#FDF0F0] border border-[#D64545]/30 p-3 text-[13px] font-medium text-[#D64545] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {mode === 'verify' ? (
          <div className="space-y-4">
            {loading && <p className="text-[13px] text-[#7A746B]">Confirming…</p>}
            {done && (
              <div className="rounded-lg bg-[#EBF6F0] border border-[#2E8B57]/30 p-4 text-[13px] text-[#2E8B57] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Thanks — your email is confirmed. Redirecting…</span>
              </div>
            )}
            {error && (
              <button type="button" onClick={() => onNavigate('/login')} className="btn-primary w-full text-[14px] cursor-pointer">
                Go to Sign In
              </button>
            )}
          </div>
        ) : mode === 'forgot' ? (
          done ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-[#EBF6F0] border border-[#2E8B57]/30 p-4 text-[13px] text-[#2E8B57] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</span>
              </div>
              <button type="button" onClick={() => onNavigate('/login')} className="btn-primary w-full text-[14px] cursor-pointer">
                Return to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4">
              {emailField('forgot-email')}
              <button type="submit" disabled={loading} className="btn-primary w-full text-[14px] cursor-pointer">
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )
        ) : mode === 'reset' ? (
          done ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-[#EBF6F0] border border-[#2E8B57]/30 p-4 text-[13px] text-[#2E8B57] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{notice}</span>
              </div>
              <button type="button" onClick={() => onNavigate('/login')} className="btn-primary w-full text-[14px] cursor-pointer">
                Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <PasswordField id="reset-password" label="New Password" value={password} onChange={setPassword} autoComplete="new-password" />
              <button type="submit" disabled={loading} className="btn-primary w-full text-[14px] cursor-pointer">
                {loading ? 'Saving…' : 'Update Password'}
              </button>
            </form>
          )
        ) : mode === 'login' && challenge ? (
          <form onSubmit={handleCode} className="space-y-4">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input-crafted w-full px-3 text-center font-mono text-[22px] tracking-[0.4em]"
              placeholder="••••••"
              aria-label="6-digit sign-in code"
            />
            <label className="flex items-center gap-2 text-[13px] text-[#7A746B] cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="checkbox-crafted" />
              Remember this device for 30 days
            </label>
            <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full text-[14px] cursor-pointer">
              {loading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setError('');
              }}
              className="w-full text-[13px] font-medium text-[#C8672B] hover:underline cursor-pointer"
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="signup-name" className="label-caps text-[#7A746B] block mb-1.5">Your Full Name</label>
                  <input id="signup-name" required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="input-crafted w-full px-3" placeholder="Ray Callahan" />
                </div>
                <div>
                  <label htmlFor="signup-biz" className="label-caps text-[#7A746B] block mb-1.5">Company Name</label>
                  <input id="signup-biz" required maxLength={120} autoComplete="organization" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input-crafted w-full px-3" placeholder="Lone Star Plumbing & Electric" />
                </div>
                <div>
                  <label htmlFor="signup-phone" className="label-caps text-[#7A746B] block mb-1.5">Business Phone</label>
                  <input id="signup-phone" type="tel" maxLength={30} autoComplete="tel" value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} className="input-crafted w-full px-3 font-mono" placeholder="(512) 555-0190" />
                </div>
              </>
            )}
            {emailField('auth-email')}
            <PasswordField
              id="auth-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              extra={mode === 'login' ? link('/forgot-password', 'Forgot password?', 'text-[12px] font-medium text-[#C8672B] hover:underline') : undefined}
            />
            {mode === 'login' && (
              <label className="flex items-center gap-2 text-[13px] text-[#7A746B] cursor-pointer">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="checkbox-crafted" />
                Remember this device for 30 days (skips email codes)
              </label>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full text-[14px] cursor-pointer">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account & Start Onboarding'}
            </button>
            {mode === 'signup' && (
              <p className="text-[12px] text-[#7A746B]">We will email you a link to verify your address.</p>
            )}
          </form>
        )}

        {(mode === 'login' || mode === 'signup') && (
          <p className="pt-4 border-t border-[#ECE6DC] text-center text-[13px] text-[#7A746B]">
            {mode === 'login' ? (
              <>New to PlumbVoice AI? {link('/signup', 'Start Free Trial')}</>
            ) : (
              <>Already have an account? {link('/login', 'Sign In')}</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
