import {useEffect, useRef, useState} from 'react';
import {ShieldCheck, X} from 'lucide-react';
import {apiRequest} from '../lib/api';

/** Asks for the 6-digit code emailed to the user before a sensitive change on an unsaved device. */
export function StepUpModal({onDone}: {onDone: (confirmed: boolean) => void}) {
  const [challengeId, setChallengeId] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  const sendCode = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await apiRequest<{challengeId?: string; emailHint?: string; notRequired?: boolean}>(
        '/api/auth/step-up/start',
        {method: 'POST', body: JSON.stringify({})}
      );
      if (res.notRequired) {
        onDone(true);
        return;
      }
      setChallengeId(res.challengeId || '');
      setEmailHint(res.emailHint || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiRequest('/api/auth/step-up/verify', {
        method: 'POST',
        body: JSON.stringify({challengeId, code, rememberDevice: remember}),
      });
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
      <form onSubmit={submit} className="card-tier-1 w-full max-w-sm p-6 space-y-4 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#C8672B]" />
            <h2 id="stepup-title" className="font-display font-bold text-[18px] text-[#1C1F22]">Confirm this change</h2>
          </div>
          <button type="button" onClick={() => onDone(false)} aria-label="Cancel" className="p-1 text-[#7A746B] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[13px] text-[#7A746B]">
          This device isn’t saved, so we emailed a 6-digit code{emailHint ? ` to ${emailHint}` : ''}.
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-[#FDF0F0] border border-[#D64545]/30 p-3 text-[13px] font-medium text-[#D64545]">
            {error}
          </p>
        )}
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
          aria-label="6-digit code"
        />
        <label className="flex items-center gap-2 text-[13px] text-[#7A746B] cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="checkbox-crafted" />
          Remember this device for 30 days
        </label>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={sendCode} disabled={busy} className="text-[13px] font-medium text-[#C8672B] hover:underline cursor-pointer">
            Send a new code
          </button>
          <button type="submit" disabled={busy || code.length !== 6 || !challengeId} className="btn-primary cursor-pointer">
            {busy ? 'Please wait…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
