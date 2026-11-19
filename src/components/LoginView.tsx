/**
 * ============================================================================
 * MODULE: components/LoginView.tsx — Authentication Gateway
 * ----------------------------------------------------------------------------
 * The sign-in screen shown when no user session is active. Responsibilities:
 *   - Collect username/password and validate them against stored users.
 *   - Enforce active-account status and surface clear error messages.
 *   - Offer quick demo role logins (Admin, Cashier, General, Audit) so the
 *     different permission levels can be explored easily.
 *   - Summarize what each security role can do.
 * On success it hands the authenticated user up to App.tsx, which then starts
 * the session and routes the user to an appropriate starting screen.
 * ============================================================================
 */
import React, { useState } from 'react';
import { User } from '../types';
import { Lock, User as UserIcon, AlertCircle, Eye, EyeOff, Loader2, Shield, Sparkles, Terminal, Key } from 'lucide-react';

interface LoginViewProps {
  users: User[];
  onLoginSuccess: (user: User) => void;
  /**
   * Verifies credentials. Supplied by App so that the remote SQL server can be
   * the authority when one is configured, and the browser hash store otherwise.
   */
  onAuthenticate: (username: string, password: string) => Promise<{ user?: User; error?: string }>;
}

export default function LoginView({ onLoginSuccess, onAuthenticate }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please provide both username and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onAuthenticate(username, password);
      if (!result.user) {
        setError(result.error ?? 'Invalid username or password.');
        return;
      }
      setPassword('');
      onLoginSuccess(result.user);
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Decorative background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-teal-500/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-slate-800 rounded-3xl shadow-2xl border border-slate-700/50 overflow-hidden relative z-10">
        
        {/* LEFT COLUMN: BRAND PROMOTION & ROLE SUMMARY */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-950 to-teal-950 p-8 flex flex-col justify-between text-white border-b lg:border-b-0 lg:border-r border-slate-700/30">
          
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 px-3.5 py-1.5 rounded-full text-teal-400 text-xs font-black uppercase tracking-wider">
              <Sparkles size={13} /> Secure Sandbox Auth
            </div>
            
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold tracking-wide uppercase">Afritecx Badboy</h2>
              <p className="text-xs text-slate-400">Adaptable operations, POS, inventory, payroll, CRM, and accounting platform</p>
            </div>
          </div>

          {/* Quick Info Grid detailing role privileges */}
          <div className="my-8 space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-teal-400">Security Roles & Permissions</h4>
            
            <div className="space-y-3.5">
              <div className="flex gap-3">
                <div className="p-2 bg-slate-800/80 border border-slate-700 rounded-xl text-teal-400 shrink-0">
                  <Shield size={15} />
                </div>
                <div>
                  <h5 className="text-xs font-bold">Administrator (ADMIN)</h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">Full root access: modify products, view financial balance sheets, configure users, and adjust business settings.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-slate-800/80 border border-slate-700 rounded-xl text-sky-400 shrink-0">
                  <Terminal size={15} />
                </div>
                <div>
                  <h5 className="text-xs font-bold">POS Operator (CASHIER)</h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">Checkout optimized: restricted to the POS grid checkout terminal and CRM customer profiles. Financial registers are locked.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-slate-800/80 border border-slate-700 rounded-xl text-indigo-400 shrink-0">
                  <Key size={15} />
                </div>
                <div>
                  <h5 className="text-xs font-bold">Accountant (ACCOUNTANT)</h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">Financial audits: access to Ledger accounts, Profit & Loss reports, Trial Balances, and manual Journal adjusting forms.</p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-slate-500 font-medium">
            Protected by Node.js compatible local schema databases. Plain-text sandbox emulation.
          </p>
        </div>

        {/* RIGHT COLUMN: LOGIN FORM CONTAINER */}
        <div className="lg:col-span-7 p-8 sm:p-12 flex flex-col justify-center bg-slate-800/40">
          
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white">Authorized Login</h3>
            <p className="text-xs text-slate-400 mt-1">Provide your credentials below to enter the business console</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            
            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <UserIcon size={14} className="text-slate-400" /> Username
              </label>
              <input
                type="text"
                required
                placeholder="e.g. admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-semibold"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Lock size={14} className="text-slate-400" /> Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-4 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error Container */}
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <p className="font-semibold leading-relaxed">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-teal-600 disabled:opacity-60 disabled:cursor-not-allowed hover:bg-teal-500 active:scale-[0.99] text-white text-xs font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-teal-600/10 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Verifying…</span>
              ) : (
                'Sign In to System'
              )}
            </button>
          </form>

        </div>

      </div>

    </div>
  );
}
