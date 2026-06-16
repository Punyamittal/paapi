import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Zap,
  User,
  Database,
  FileText,
  MessageSquare,
  Search,
  Settings,
} from 'lucide-react';
import { LOCAL_VAULT_KEY } from '@/lib/crypto/auto-unlock';
import { setPopupEncryptionPassword } from '@/lib/crypto/popup-session';
import { sendExtensionMessage, sendExtensionMessageSafe, connectPopupKeepalive, wakeServiceWorker } from '@/lib/messaging/extension-messages';
import { getAllProfiles } from '@/lib/storage/indexed-db';
import { initializeDefaultProfile } from '@/lib/vault/vault-service';
import type { Profile, SessionState } from '@/types';
import { QuickFill } from './components/QuickFill';
import { ProfilesView } from './components/ProfilesView';
import { VaultView } from './components/VaultView';
import { DocumentsView } from './components/DocumentsView';
import { SavedAnswersView } from './components/SavedAnswersView';
import { SearchView } from './components/SearchView';
import { SettingsView } from './components/SettingsView';

type Tab = 'fill' | 'profiles' | 'vault' | 'documents' | 'answers' | 'search' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: typeof Shield }> = [
  { id: 'fill', label: 'Fill', icon: Zap },
  { id: 'profiles', label: 'Profiles', icon: User },
  { id: 'vault', label: 'Vault', icon: Database },
  { id: 'documents', label: 'Docs', icon: FileText },
  { id: 'answers', label: 'Answers', icon: MessageSquare },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('fill');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const result = await sendExtensionMessageSafe<SessionState>({ type: 'GET_SESSION' });
    setSession(result ?? { isUnlocked: true, activeProfileId: null, lastActivity: Date.now() });
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      const result = await getAllProfiles();
      setProfiles(Array.isArray(result) ? result : []);
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    const disconnectKeepalive = connectPopupKeepalive();

    void (async () => {
      try {
        await wakeServiceWorker();
        await sendExtensionMessage({ type: 'AUTO_INIT_VAULT' });
        setPopupEncryptionPassword(LOCAL_VAULT_KEY);
        await initializeDefaultProfile();
        await refreshSession();
        await refreshProfiles();
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      disconnectKeepalive?.();
    };
  }, [refreshSession, refreshProfiles]);

  const handleSwitchProfile = async (profileId: string) => {
    await sendExtensionMessageSafe({
      type: 'SWITCH_PROFILE',
      payload: { profileId },
    });
    await refreshSession();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[520px] bg-slate-50">
        <div className="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const profileList = Array.isArray(profiles) ? profiles : [];

  const activeProfile = profileList.find((p) => p.id === session?.activeProfileId)
    ?? profileList.find((p) => p.isDefault)
    ?? profileList[0];

  return (
    <div className="flex flex-col h-[520px] bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-brand-500">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-white" />
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">FormVault AI</h1>
            {activeProfile && (
              <p className="text-[10px] text-brand-100 leading-tight">
                {activeProfile.name}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {!activeProfile && activeTab !== 'settings' && activeTab !== 'fill' && activeTab !== 'profiles' ? (
          <div className="p-6 text-center text-slate-400">
            <p className="text-xs">No profile loaded yet.</p>
            <p className="text-[10px] mt-1">Open the Profiles tab to get started.</p>
          </div>
        ) : (
        <>
        {activeTab === 'fill' && (
          <QuickFill
            activeProfileId={activeProfile?.id}
            onSwitchProfile={handleSwitchProfile}
            profiles={profileList}
          />
        )}
        {activeTab === 'profiles' && (
          <ProfilesView
            profiles={profileList}
            activeProfileId={activeProfile?.id}
            onRefresh={refreshProfiles}
            onSwitch={handleSwitchProfile}
          />
        )}
        {activeTab === 'vault' && activeProfile && (
          <VaultView profileId={activeProfile.id} />
        )}
        {activeTab === 'documents' && activeProfile && (
          <DocumentsView profileId={activeProfile.id} />
        )}
        {activeTab === 'answers' && activeProfile && (
          <SavedAnswersView profileId={activeProfile.id} />
        )}
        {activeTab === 'search' && activeProfile && (
          <SearchView profileId={activeProfile.id} />
        )}
        {activeTab === 'settings' && <SettingsView />}
        </>
        )}
      </main>

      <nav className="flex border-t border-slate-100 bg-slate-50">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
              activeTab === id
                ? 'text-brand-600 bg-white'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
