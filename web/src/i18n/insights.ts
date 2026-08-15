/* Insights, Prompts and Journal pages. */
import type { MsgEntry } from './index';

export const insights = {
  // Insights — records row
  'insights.activityTitle': { en: 'activity · last 12 months', fr: 'activité · 12 derniers mois' },
  'insights.currentStreak': { en: 'current streak', fr: 'série en cours' },
  'insights.daysShort': { en: '{n}d', fr: '{n} j' },
  'insights.longestShort': { en: 'longest {n}d', fr: 'record {n} j' },
  'insights.busiestDay': { en: 'busiest day', fr: 'journée la plus chargée' },
  'insights.longestSession': { en: 'longest session', fr: 'session la plus longue' },
  'insights.mostPromptsDay': { en: 'most prompts · day', fr: 'record de prompts · jour' },
  'insights.biggestTokenDay': { en: 'biggest token day', fr: 'journée record de tokens' },
  'insights.outputDaySub': { en: '{day} · output', fr: '{day} · sortie' },

  // Insights — range picker
  'insights.breakdowns': { en: 'breakdowns', fr: 'répartitions' },
  'insights.range7d': { en: '7d', fr: '7 j' },
  'insights.range30d': { en: '30d', fr: '30 j' },
  'insights.range90d': { en: '90d', fr: '90 j' },
  'insights.rangeAll': { en: 'all', fr: 'tout' },

  // Insights — models / cost cards
  'insights.modelsTitle': { en: 'models · est. cost', fr: 'modèles · coût est.' },
  'insights.noModelUsage': { en: 'No model usage in range.', fr: 'Aucune utilisation de modèle dans la période.' },
  'insights.thModel': { en: 'model', fr: 'modèle' },
  'insights.thOutput': { en: 'output', fr: 'sortie' },
  'insights.thCacheW': { en: 'cache w', fr: 'cache écr.' },
  'insights.thEstCost': { en: 'est. cost', fr: 'coût est.' },
  'insights.unpricedTitle': {
    en: 'No price-table entry for this model — its tokens are not in this figure',
    fr: 'Aucune entrée de prix pour ce modèle — ses tokens ne sont pas inclus dans ce montant',
  },
  'insights.costWeeksTitle': { en: 'est. cost · last 12 weeks', fr: 'coût est. · 12 dernières semaines' },

  // Insights — tools / hours / skills
  'insights.toolsTitle': { en: 'tools claude uses', fr: 'outils utilisés par claude' },
  'insights.subagentEdits': { en: 'subagent edits:', fr: 'modifications des sous-agents :' },
  'insights.lines': { en: 'lines', fr: 'lignes' },
  'insights.busiestHours': { en: 'busiest hours', fr: 'heures les plus actives' },
  'insights.skillsTitle': { en: 'skills & plugins', fr: 'skills et plugins' },
  'insights.noSkills': { en: 'No skill attributions in range.', fr: 'Aucune attribution de skill dans la période.' },

  // Insights — compaction card
  'insights.compactionTitle': { en: 'compaction tax', fr: 'taxe de compaction' },
  'insights.noCompactions': {
    en: "No compactions detected in range — no session's context collapsed by more than 40%.",
    fr: 'Aucune compaction détectée dans la période — aucun contexte de session ne s’est réduit de plus de 40 %.',
  },
  'insights.compactions': { en: 'compactions', fr: 'compactions' },
  'insights.rebuildTokens': { en: 'rebuild tokens', fr: 'tokens de reconstruction' },
  'insights.compactionFooter': {
    en: '{hit} of {total} sessions compacted · rebuild = cache writes on the first requests after each collapse',
    fr: '{hit} sessions sur {total} compactées · reconstruction = écritures de cache sur les premières requêtes après chaque effondrement',
  },

  // Insights — focus card
  'insights.focusTitle': { en: 'focus & context switching', fr: 'concentration et changements de contexte' },
  'insights.projectSwitches': { en: 'project switches', fr: 'changements de projet' },
  'insights.longestRun': { en: 'longest run · {project}', fr: 'plus longue période · {project}' },
  'insights.switchOne': { en: '{date}: {n} switch', fr: '{date} : {n} changement' },
  'insights.switchMany': { en: '{date}: {n} switches', fr: '{date} : {n} changements' },
  'insights.focusFooter': {
    en: '{n} projects touched · a switch = consecutive turns in different projects',
    fr: '{n} projets touchés · un changement = des tours consécutifs dans des projets différents',
  },

  // Insights — MCP card
  'insights.mcpTitle': { en: 'mcp servers', fr: 'serveurs mcp' },
  'insights.noMcp': { en: 'No MCP tool calls in range.', fr: 'Aucun appel d’outil MCP dans la période.' },
  'insights.mcpFooter': {
    en: 'top tool: {tool} · every configured server costs context whether used or not — see Manage for per-server detail',
    fr: 'outil le plus utilisé : {tool} · chaque serveur configuré consomme du contexte, utilisé ou non — voir Gérer pour le détail par serveur',
  },

  // Insights — token flow card
  'insights.tokenFlowTitle': { en: 'token economics · 30d', fr: 'économie de tokens · 30 j' },
  'insights.cachingSaved': { en: 'caching saved ~{cost} est.', fr: 'la mise en cache a économisé ~{cost} (est.)' },
  'insights.cacheReads': { en: 'cache reads', fr: 'lectures de cache' },
  'insights.cacheWrites': { en: 'cache writes', fr: 'écritures de cache' },
  'insights.freshInput': { en: 'fresh input', fr: 'entrée fraîche' },
  'insights.tokenFlowAria': {
    en: 'Token flow from input sources to models',
    fr: 'Flux de tokens des sources d’entrée vers les modèles',
  },
  'insights.flowModelLine': { en: '{model} · {in} in → {out} out', fr: '{model} · {in} entrée → {out} sortie' },
  'insights.tokenFlowFooter': {
    en: 'input-side composition per model — cache reads are billed at ~10% of fresh input, which is where the savings come from',
    fr: 'composition de l’entrée par modèle — les lectures de cache sont facturées à ~10 % de l’entrée fraîche, d’où viennent les économies',
  },

  // Insights — PR card
  'insights.prTitle': { en: 'pull requests · 30d', fr: 'pull requests · 30 j' },
  'insights.prMerged': { en: '{merged}/{opened} merged', fr: '{merged}/{opened} fusionnées' },
  'insights.prOpenSuffix': { en: ' · {n} open', fr: ' · {n} ouvertes' },

  // Insights — claude.ai card
  'insights.claudeAiTitle': { en: 'claude.ai chats · imported', fr: 'conversations claude.ai · importées' },
  'insights.claudeAiCounts': { en: '{chats} chats · {messages} messages', fr: '{chats} conversations · {messages} messages' },
  'insights.chatDayOne': { en: '{day} — {chats} chat, {messages} messages', fr: '{day} — {chats} conversation, {messages} messages' },
  'insights.chatDayMany': { en: '{day} — {chats} chats, {messages} messages', fr: '{day} — {chats} conversations, {messages} messages' },
  'insights.noChats30d': { en: 'no chats in the last 30 days', fr: 'aucune conversation dans les 30 derniers jours' },
  'insights.claudeAiFooter': {
    en: 'from your claude.ai data export — refresh anytime with scripts/import-claudeai.mjs. Coding cloud sessions are not part of claude.ai exports.',
    fr: 'depuis votre export de données claude.ai — actualisez quand vous voulez avec scripts/import-claudeai.mjs. Les sessions cloud de codage ne font pas partie des exports claude.ai.',
  },

  // Insights — errors card
  'insights.errorsTitle': { en: 'errors & retries · 30d', fr: 'erreurs et reprises · 30 j' },
  'insights.apiErrors': { en: '{n} api', fr: '{n} api' },
  'insights.toolErrors': { en: '{n} tool', fr: '{n} outil' },
  'insights.errorFallback': { en: 'error', fr: 'erreur' },

  // Insights — year heatmap
  'insights.legendLess': { en: 'less', fr: 'moins' },
  'insights.legendMore': { en: 'more', fr: 'plus' },
  'insights.legendLegacy': { en: 'pre-transcript era (counts only)', fr: 'ère pré-transcriptions (décomptes seulement)' },
  'insights.legacyTip': { en: 'legacy: {n} messages', fr: 'données héritées : {n} messages' },

  // Prompts page
  'insights.searchPlaceholder': {
    en: "Search every prompt you've ever sent…  ( / )",
    fr: 'Cherchez parmi tous les prompts que vous avez envoyés…  ( / )',
  },
  'insights.allProjects': { en: 'all projects', fr: 'tous les projets' },
  'insights.allKinds': { en: 'all kinds', fr: 'tous les types' },
  'insights.kindTyped': { en: 'typed', fr: 'tapé' },
  'insights.kindCommand': { en: 'slash command', fr: 'commande slash' },
  'insights.kindLegacy': { en: 'legacy', fr: 'ancien' },
  'insights.fromDate': { en: 'From date', fr: 'Date de début' },
  'insights.toDate': { en: 'To date', fr: 'Date de fin' },
  'insights.clearDates': { en: 'Clear date range', fr: 'Effacer la plage de dates' },
  'insights.exportCsv': { en: 'Export all prompts as CSV', fr: 'Exporter tous les prompts en CSV' },
  'insights.searching': { en: 'searching…', fr: 'recherche…' },
  'insights.promptCount': { en: '{n} prompts', fr: '{n} prompts' },
  'insights.promptCountMatching': { en: '{n} prompts matching “{q}”', fr: '{n} prompts correspondant à « {q} »' },
  'insights.noMatches': { en: 'No matches for “{q}”', fr: 'Aucun résultat pour « {q} »' },
  'insights.noPrompts': { en: 'No prompts yet', fr: 'Aucun prompt pour l’instant' },
  'insights.loading': { en: 'loading…', fr: 'chargement…' },
  'insights.loadMoreLeft': { en: 'load more ({n} left)', fr: 'en voir plus ({n} restants)' },
  'insights.filterByProject': { en: 'Filter by project', fr: 'Filtrer par projet' },
  'insights.badgeCmd': { en: 'cmd', fr: 'cmd' },
  'insights.badgeLegacy': { en: 'legacy', fr: 'ancien' },

  // Journal page
  'insights.journalPlaceholder': {
    en: 'Add a note… (Claude also logs completed work here automatically)',
    fr: 'Ajoutez une note… (Claude consigne aussi automatiquement le travail accompli ici)',
  },
  'insights.noJournal': { en: 'No journal entries yet', fr: 'Aucune entrée de journal pour l’instant' },
  'insights.journalHint': {
    en: 'After Claude finishes a substantive task in any project, it posts a one-line summary here. You can also add notes yourself above.',
    fr: 'Quand Claude termine une tâche substantielle dans un projet, il publie ici un résumé d’une ligne. Vous pouvez aussi ajouter vos propres notes ci-dessus.',
  },
  'insights.saving': { en: 'saving…', fr: 'enregistrement…' },
  'insights.save': { en: 'save', fr: 'enregistrer' },
  'insights.cancel': { en: 'cancel', fr: 'annuler' },
  'insights.editEntry': { en: 'Edit entry', fr: 'Modifier l’entrée' },
  'insights.deleteEntry': { en: 'Delete entry', fr: 'Supprimer l’entrée' },
  'insights.deleteJournalEntry': { en: 'Delete journal entry', fr: 'Supprimer l’entrée de journal' },
  'insights.loadMore': { en: 'load more', fr: 'en voir plus' },
} as const satisfies Record<string, MsgEntry>;
