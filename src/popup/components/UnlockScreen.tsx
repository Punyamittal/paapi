import { useState } from 'react';
import { Shield, Eye, EyeOff } from 'lucide-react';

interface UnlockScreenProps {
  onUnlock: (password: string) => Promise<boolean>;
}

export function UnlockScreen({ onUnlock }: UnlockScreenProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    setLoading(true);
    setError('');
    const success = await onUnlock(password);
    if (!success) {
      setError('Incorrect password');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-[520px] bg-gradient-to-b from-brand-50 to-white px-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-4 shadow-lg shadow-brand-200">
        <Shield className="w-8 h-8 text-white" />
      </div>

      <h1 className="text-lg font-bold text-slate-800 mb-1">FormVault AI</h1>
      <p className="text-xs text-slate-500 mb-6 text-center">
        Your data stays on this device. Always encrypted. Never shared.
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-[280px]">
        <div className="relative mb-3">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            className="w-full px-3 py-2.5 pr-10 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-500 mb-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-60"
        >
          {loading ? 'Unlocking...' : 'Unlock Vault'}
        </button>
      </form>

      <p className="text-[10px] text-slate-400 mt-4 text-center">
        First time? Your password creates an encrypted vault on this device.
        Re-open the popup? Enter your password again to view saved data.
      </p>
    </div>
  );
}
