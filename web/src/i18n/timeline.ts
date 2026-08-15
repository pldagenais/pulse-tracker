/* Strings for the timeline domain: TimelinePage, SessionPage, Gantt,
 * SessionDetailView, SessionDrawer. */
import type { MsgEntry } from './index';

export const timeline = {
  // TimelinePage — view switcher & navigation
  'timeline.day': { en: 'Day', fr: 'Jour' },
  'timeline.week': { en: 'Week', fr: 'Semaine' },
  'timeline.month': { en: 'Month', fr: 'Mois' },
  'timeline.prevDay': { en: 'Previous day', fr: 'Jour précédent' },
  'timeline.nextDay': { en: 'Next day', fr: 'Jour suivant' },
  'timeline.prevWeek': { en: 'Previous week', fr: 'Semaine précédente' },
  'timeline.nextWeek': { en: 'Next week', fr: 'Semaine suivante' },
  'timeline.prevMonth': { en: 'Previous month', fr: 'Mois précédent' },
  'timeline.nextMonth': { en: 'Next month', fr: 'Mois suivant' },
  'timeline.today': { en: 'today', fr: 'aujourd’hui' },

  // Day view
  'timeline.claudeWorking': { en: 'claude working', fr: 'claude au travail' },
  'timeline.youActive': { en: 'you active', fr: 'vous actif' },
  'timeline.prompts': { en: 'prompts', fr: 'prompts' },
  'timeline.sessions': { en: 'sessions', fr: 'sessions' },
  'timeline.estCost': { en: 'est. cost', fr: 'coût est.' },
  'timeline.sessionTimeline': { en: 'session timeline', fr: 'chronologie des sessions' },
  'timeline.byProject': { en: 'By project', fr: 'Par projet' },
  'timeline.bySession': { en: 'By session', fr: 'Par session' },
  'timeline.fitActivity': { en: 'fit activity', fr: 'ajuster à l’activité' },
  'timeline.full24h': { en: 'full 24h', fr: '24 h complètes' },
  'timeline.noActivityOn': { en: 'No activity on {date}', fr: 'Aucune activité le {date}' },
  'timeline.legacyDayHint': {
    en: 'Legacy day — {count} messages recorded before transcript history begins (Jun 25, 2026); no timeline detail is available.',
    fr: 'Journée héritée — {count} messages enregistrés avant le début de l’historique des transcriptions (25 juin 2026); aucun détail de chronologie disponible.',
  },

  // Week view
  'timeline.claudeTimeByProject': { en: 'claude time by project', fr: 'temps claude par projet' },
  'timeline.digestLink': { en: 'digest →', fr: 'résumé →' },
  'timeline.weekTotal': { en: 'week total', fr: 'total semaine' },
  'timeline.you': { en: 'you', fr: 'vous' },

  // Month view
  'timeline.monthTitle': { en: 'month', fr: 'mois' },
  'timeline.wdMon': { en: 'Mon', fr: 'lun' },
  'timeline.wdTue': { en: 'Tue', fr: 'mar' },
  'timeline.wdWed': { en: 'Wed', fr: 'mer' },
  'timeline.wdThu': { en: 'Thu', fr: 'jeu' },
  'timeline.wdFri': { en: 'Fri', fr: 'ven' },
  'timeline.wdSat': { en: 'Sat', fr: 'sam' },
  'timeline.wdSun': { en: 'Sun', fr: 'dim' },
  'timeline.legacy': { en: 'legacy', fr: 'hérité' },
  'timeline.noDurationsBefore': { en: '(no durations before Jun 25, 2026)', fr: '(aucune durée avant le 25 juin 2026)' },
  'timeline.less': { en: 'less', fr: 'moins' },
  'timeline.more': { en: 'more', fr: 'plus' },
  'timeline.preTranscriptEra': { en: 'pre-transcript era (counts only)', fr: 'période pré-transcriptions (décomptes seulement)' },

  // SessionPage
  'timeline.backToTimeline': { en: 'timeline', fr: 'chronologie' },

  // Gantt
  'timeline.untitledSession': { en: 'Untitled session', fr: 'Session sans titre' },
  'timeline.cloudWorktreeTitle': {
    en: '{label} · {worktree} · cloud worktree session',
    fr: '{label} · {worktree} · session cloud (worktree)',
  },
  'timeline.resetZoom': { en: 'reset zoom', fr: 'réinitialiser le zoom' },
  'timeline.cloudWorktreeSession': { en: 'cloud (worktree) session', fr: 'session cloud (worktree)' },

  // Session detail — header
  'timeline.compare': { en: 'compare', fr: 'comparer' },
  'timeline.compareTitle': { en: 'Compare this session with another', fr: 'Comparer cette session avec une autre' },
  'timeline.starNeedsPc': { en: 'Starring needs your PC', fr: 'Marquer d’une étoile requiert votre PC' },
  'timeline.starSession': { en: 'Star session', fr: 'Marquer la session d’une étoile' },
  'timeline.unstarSession': { en: 'Unstar session', fr: 'Retirer l’étoile de la session' },
  'timeline.commitsDuring': { en: 'commits during this session · {n}', fr: 'commits durant cette session · {n}' },

  // Session detail — time card
  'timeline.timeCard': { en: 'time', fr: 'temps' },
  'timeline.claudeWorkingCap': { en: 'Claude working', fr: 'Claude au travail' },
  'timeline.youActiveCap': { en: 'You active', fr: 'Vous actif' },
  'timeline.subagentCompute': { en: 'Subagent compute', fr: 'Calcul des sous-agents' },

  // Session detail — context curve
  'timeline.contextWindow': { en: 'context window', fr: 'fenêtre de contexte' },
  'timeline.peak': { en: 'peak', fr: 'pic' },
  'timeline.at': { en: 'at', fr: 'à' },
  'timeline.final': { en: 'final', fr: 'final' },
  'timeline.compactionLegend': { en: 'compaction (context dropped >40%)', fr: 'compaction (contexte réduit de >40 %)' },

  // Session detail — tokens & cost
  'timeline.tokensCostCard': { en: 'tokens · est. cost', fr: 'tokens · coût est.' },
  'timeline.input': { en: 'input', fr: 'entrée' },
  'timeline.output': { en: 'output', fr: 'sortie' },
  'timeline.cacheRead': { en: 'cache read', fr: 'lecture cache' },
  'timeline.cacheWrite': { en: 'cache write', fr: 'écriture cache' },
  'timeline.estApiCost': { en: 'est. API-equivalent cost', fr: 'coût équivalent API (est.)' },
  'timeline.partial': { en: ' (partial)', fr: ' (partiel)' },

  // Session detail — prompts / replay
  'timeline.promptsCard': { en: 'prompts · {n}', fr: 'prompts · {n}' },
  'timeline.showConversation': { en: 'show conversation', fr: 'afficher la conversation' },
  'timeline.hideConversation': { en: 'hide conversation', fr: 'masquer la conversation' },
  'timeline.transcriptTruncated': { en: 'transcript truncated', fr: 'transcription tronquée' },
  'timeline.noPrompts': { en: 'No prompts recorded.', fr: 'Aucun prompt enregistré.' },

  // Session detail — activity
  'timeline.activityCard': { en: 'activity', fr: 'activité' },
  'timeline.tools': { en: 'tools', fr: 'outils' },
  'timeline.skills': { en: 'skills', fr: 'skills' },
  'timeline.subagentRuns': { en: 'subagent runs · {n}', fr: 'exécutions de sous-agents · {n}' },
  'timeline.tokensOut': { en: '{n} out', fr: '{n} en sortie' },

  // Session detail — tags & note
  'timeline.tagsNote': { en: 'tags & note', fr: 'tags et note' },
  'timeline.removeTag': { en: 'Remove tag {tag}', fr: 'Retirer le tag {tag}' },
  'timeline.suggestedApply': { en: 'Suggested — click to apply', fr: 'Suggestion — cliquer pour appliquer' },
  'timeline.addTag': { en: 'Add tag', fr: 'Ajouter un tag' },
  'timeline.aiSuggest': { en: 'ai suggest', fr: 'suggestion IA' },
  'timeline.thinking': { en: 'thinking…', fr: 'réflexion…' },
  'timeline.noNewSuggestions': { en: 'no new suggestions', fr: 'aucune nouvelle suggestion' },
  'timeline.aiNeedsPc': { en: 'AI suggestions need your PC', fr: 'Les suggestions IA requièrent votre PC' },
  'timeline.notePlaceholder': {
    en: 'Notes about this session — saved automatically',
    fr: 'Notes sur cette session — enregistrées automatiquement',
  },

  // Session detail — prompt rows
  'timeline.turnTimeTitle': { en: 'Claude working time for this turn', fr: 'Temps de travail de Claude pour ce tour' },
  'timeline.clickCollapse': { en: 'Click to collapse', fr: 'Cliquer pour replier' },
  'timeline.clickExpand': { en: 'Click to expand', fr: 'Cliquer pour déplier' },

  // Session drawer
  'timeline.sessionDetail': { en: 'session detail', fr: 'détail de la session' },
  'timeline.sessionDetailAria': { en: 'Session detail', fr: 'Détail de la session' },
  'timeline.openFullPage': { en: 'Open full page', fr: 'Ouvrir en pleine page' },
  'timeline.openFullPageAria': { en: 'Open session as full page', fr: 'Ouvrir la session en pleine page' },
  'timeline.closeEsc': { en: 'Close (Esc)', fr: 'Fermer (Esc)' },
  'timeline.closeAria': { en: 'Close session detail', fr: 'Fermer le détail de la session' },
} as const satisfies Record<string, MsgEntry>;
