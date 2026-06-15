import { useState } from 'react';
import { Zap, ChevronDown, ExternalLink } from 'lucide-react';
import type { Profile } from '@/types';

interface QuickFillProps {
  activeProfileId?: string;
  profiles: Profile[];
  onSwitchProfile: (id: string) => void;
}

export function QuickFill({ activeProfileId, profiles, onSwitchProfile }: QuickFillProps) {
  const [filling, setFilling] = useState(false);
  const [report, setReport] = useState<{
    totalFields: number;
    filledCount: number;
    reviewCount: number;
    unknownCount: number;
  } | null>(null);
  const [showProfiles, setShowProfiles] = useState(false);

  const profileList = Array.isArray(profiles) ? profiles : [];
  const activeProfile = profileList.find((p) => p.id === activeProfileId);

  const handleFillForm = async () => {
    setFilling(true);
    setReport(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM' });
      if (result) {
        setReport({
          totalFields: result.totalFields,
          filledCount: result.filledCount,
          reviewCount: result.reviewCount,
          unknownCount: result.unknownCount,
        });
      }
    } catch {
      setReport(null);
    }

    setFilling(false);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Profile Selector */}
      <div className="relative">
        <button
          onClick={() => setShowProfiles(!showProfiles)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeProfile?.color ?? '#6366f1' }}
            />
            <span className="font-medium">{activeProfile?.name ?? 'Select Profile'}</span>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </button>

        {showProfiles && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
            {profileList.map((profile) => (
              <button
                key={profile.id}
                onClick={() => {
                  onSwitchProfile(profile.id);
                  setShowProfiles(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg"
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: profile.color }}
                />
                {profile.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fill Button */}
      <button
        onClick={handleFillForm}
        disabled={filling}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-gradient-to-r from-brand-600 to-brand-500 rounded-xl hover:from-brand-700 hover:to-brand-600 transition-all shadow-md shadow-brand-200 disabled:opacity-60"
      >
        <Zap className="w-5 h-5" />
        {filling ? 'Filling Form...' : 'Fill Form on This Page'}
      </button>

      {/* Report */}
      {report && (
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Fill Report
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Detected" value={report.totalFields} />
            <Stat label="Filled" value={report.filledCount} color="text-emerald-600" />
            <Stat label="Need Review" value={report.reviewCount} color="text-amber-600" />
            <Stat label="Unknown" value={report.unknownCount} color="text-red-500" />
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Quick Tips
        </h3>
        <div className="space-y-1.5">
          <Tip text="Type @phone, @email, @github in any field for instant expansion" />
          <Tip text="Use the floating button on any webpage to fill forms" />
          <Tip text="Upload documents to auto-extract personal information" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center py-2 bg-white rounded-lg">
      <div className={`text-lg font-bold ${color ?? 'text-slate-700'}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px] text-slate-500">
      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-brand-400" />
      {text}
    </div>
  );
}
