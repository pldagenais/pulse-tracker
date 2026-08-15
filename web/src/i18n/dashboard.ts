/* Dashboard domain: DashboardPage + DigestPage. */
import type { MsgEntry } from './index';

export const dashboard = {
  // hero stats / mirror state
  'dashboard.notMirroredTitle': { en: 'No data mirrored for today yet', fr: 'Aucune donnée synchronisée pour aujourd’hui' },
  'dashboard.notMirroredHint': { en: 'Your PC mirrors each day as it happens — this appears when today has not synced yet.', fr: 'Votre PC synchronise chaque journée en continu — ceci s’affiche quand la journée d’aujourd’hui n’a pas encore été synchronisée.' },
  'dashboard.notMirroredShort': { en: 'Not mirrored yet', fr: 'Pas encore synchronisé' },
  'dashboard.claudeWorkingToday': { en: 'claude working · today', fr: 'claude au travail · aujourd’hui' },
  'dashboard.claudeWorkingTitle': { en: 'Total Claude compute across sessions — parallel sessions add up, so this can exceed wall-clock time.', fr: 'Temps de calcul total de Claude, toutes sessions confondues — les sessions parallèles s’additionnent, le total peut donc dépasser le temps réel.' },
  'dashboard.subagents': { en: '+ {duration} subagents', fr: '+ {duration} sous-agents' },
  'dashboard.youActiveToday': { en: 'you active · today', fr: 'temps actif · aujourd’hui' },
  'dashboard.youActiveSub': { en: 'review & prompt time, deduped', fr: 'temps de révision et de prompt, dédupliqué' },
  'dashboard.youActiveTitle': { en: 'Time you spent reviewing and prompting between turns; overlapping sessions counted once.', fr: 'Temps passé à réviser et à rédiger des prompts entre les tours; les sessions qui se chevauchent comptent une seule fois.' },
  'dashboard.prompts': { en: 'prompts', fr: 'prompts' },
  'dashboard.sessionsToday': { en: '{n} sessions today', fr: '{n} sessions aujourd’hui' },
  'dashboard.estCost': { en: 'est. cost', fr: 'coût est.' },
  'dashboard.costWhy': { en: 'Why? Click for the cost breakdown', fr: 'Pourquoi ? Cliquez pour le détail des coûts' },
  'dashboard.costPartial': { en: 'partial — unpriced model in use', fr: 'partiel — modèle sans tarif utilisé' },
  'dashboard.costPartialTitle': { en: 'A model without a price-table entry ran today — this figure is a floor, not a total.', fr: 'Un modèle absent de la table des prix a été utilisé aujourd’hui — ce montant est un plancher, pas un total.' },
  'dashboard.costApiEquiv': { en: 'API-equivalent · click to explain', fr: 'équivalent API · cliquez pour l’explication' },
  'dashboard.streak': { en: 'streak', fr: 'série' },
  'dashboard.streakDays': { en: '{n}d', fr: '{n} j' },
  'dashboard.streakLongest': { en: 'longest {n}d', fr: 'record {n} j' },

  // delta line
  'dashboard.sameAsYesterday': { en: '— same as yesterday', fr: '— comme hier' },
  'dashboard.vsYesterday': { en: 'vs yesterday', fr: 'vs hier' },

  // cards
  'dashboard.recentSessions': { en: 'recent sessions', fr: 'sessions récentes' },
  'dashboard.timelineLink': { en: 'timeline →', fr: 'chronologie →' },
  'dashboard.noSessionsYet': { en: 'No sessions recorded yet', fr: 'Aucune session enregistrée pour l’instant' },
  'dashboard.last7Days': { en: 'last 7 days · claude time', fr: '7 derniers jours · temps claude' },
  'dashboard.todayByProject': { en: 'today by project', fr: 'aujourd’hui par projet' },
  'dashboard.nothingTrackedTitle': { en: 'Nothing tracked yet today', fr: 'Rien de suivi encore aujourd’hui' },
  'dashboard.nothingTrackedHint': { en: 'Start a Claude Code session anywhere — it shows up here within seconds.', fr: 'Démarrez une session Claude Code n’importe où — elle apparaît ici en quelques secondes.' },
  'dashboard.journal': { en: 'journal', fr: 'journal' },
  'dashboard.allLink': { en: 'all →', fr: 'tout →' },
  'dashboard.journalEmpty': { en: 'No entries yet — Claude logs a one-liner here after finishing substantive work.', fr: 'Aucune entrée pour l’instant — Claude consigne une ligne ici après un travail substantiel.' },

  // budget
  'dashboard.monthlyBudget': { en: 'monthly budget', fr: 'budget mensuel' },
  'dashboard.budgetSpent': { en: 'spent', fr: 'dépensé' },
  'dashboard.budgetOf': { en: 'of', fr: 'sur' },
  'dashboard.budgetPartialTitle': { en: 'A model without a price-table entry ran this month — spend is a floor, not a total.', fr: 'Un modèle absent de la table des prix a été utilisé ce mois-ci — la dépense est un plancher, pas un total.' },
  'dashboard.onPaceFor': { en: 'on pace for {amount}', fr: 'en route vers {amount}' },

  // activity + now
  'dashboard.activity': { en: 'activity', fr: 'activité' },
  'dashboard.noHookEvents': { en: 'No hook events yet.', fr: 'Aucun événement de hook pour l’instant.' },
  'dashboard.now': { en: 'now', fr: 'en ce moment' },
  'dashboard.allQuiet': { en: 'All quiet — no Claude Code sessions running.', fr: 'Tout est calme — aucune session Claude Code en cours.' },
  'dashboard.workingElapsed': { en: 'working {elapsed}', fr: 'au travail {elapsed}' },
  'dashboard.waitingForYou': { en: 'waiting for you', fr: 'vous attend' },
  'dashboard.open': { en: 'open', fr: 'ouverte' },
  'dashboard.parallelSessions': { en: '{n} sessions computing in parallel', fr: '{n} sessions calculent en parallèle' },

  // digest page
  'dashboard.weekView': { en: '← week view', fr: '← vue semaine' },
  'dashboard.weekOf': { en: 'Week of {from} – {to}', fr: 'Semaine du {from} au {to}' },
  'dashboard.prevWeek': { en: 'Previous week', fr: 'Semaine précédente' },
  'dashboard.nextWeek': { en: 'Next week', fr: 'Semaine suivante' },
  'dashboard.print': { en: 'print', fr: 'imprimer' },
  'dashboard.claudeWorking': { en: 'claude working', fr: 'claude au travail' },
  'dashboard.youActive': { en: 'you active', fr: 'temps actif' },
  'dashboard.sessions': { en: 'sessions', fr: 'sessions' },
  'dashboard.claudeTimeByDay': { en: 'claude time by day', fr: 'temps claude par jour' },
  'dashboard.focusSwitchesMid': { en: 'project switches across', fr: 'changements de projet parmi' },
  'dashboard.focusSwitchesEnd': { en: 'projects this week', fr: 'projets cette semaine' },
  'dashboard.focusLongest': { en: 'longest focus run', fr: 'plus long bloc de concentration' },
  'dashboard.focusOn': { en: 'on', fr: 'sur' },
  'dashboard.byProject': { en: 'by project', fr: 'par projet' },
  'dashboard.noProjectActivity': { en: 'No project activity this week', fr: 'Aucune activité de projet cette semaine' },
  'dashboard.topSessions': { en: 'top sessions', fr: 'sessions principales' },
  'dashboard.noSessionsWeek': { en: 'No sessions this week', fr: 'Aucune session cette semaine' },
  'dashboard.noJournalWeek': { en: 'No journal entries this week', fr: 'Aucune entrée de journal cette semaine' },
  'dashboard.journalWeekHint': { en: 'Claude logs a one-liner here after finishing substantive work.', fr: 'Claude consigne une ligne ici après un travail substantiel.' },
} as const satisfies Record<string, MsgEntry>;
