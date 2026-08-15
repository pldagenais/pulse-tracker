import { useAuthActions } from '@convex-dev/auth/react';
import { LogIn } from 'lucide-react';
import { useT } from '../../lib/i18n';

/** Cloud-mode gate. Convex refuses every query until sign-in succeeds. */
export function SignIn() {
  const { signIn } = useAuthActions();
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="glass max-w-sm rounded-xl p-8 text-center">
        <div className="font-display text-3xl font-semibold tracking-tight text-ink">
          Pulse<span className="text-claude">▌</span>
        </div>
        <div className="microlabel mt-1">{t('signin.subtitle')}</div>
        <p className="mt-4 text-[14px] leading-5 text-mid">
          {t('signin.tagline')}
        </p>
        <button
          onClick={() => void signIn('github')}
          className="mt-5 inline-flex items-center gap-2 rounded-md border border-claude/50 bg-claude/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-wider text-claude hover:bg-claude/20"
        >
          <LogIn size={14} /> {t('signin.github')}
        </button>
      </div>
    </div>
  );
}
