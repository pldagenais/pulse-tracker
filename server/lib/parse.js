// Pure classification of Claude Code transcript JSONL lines.
// The rules here were derived from inspecting real transcripts (CC v2.1.181-2.1.222);
// see CLAUDE.md "Critical parser rules". Unknown types/blocks must never throw.

const COMMAND_RE = /^<command-name>/;
const LOCAL_OUT_RE = /^<(local-command-stdout|local-command-caveat)/;
// Content injected by the harness (task notifications etc.) starts with this tag;
// genuine typed prompts never do (reminders are appended, not prepended).
const SYSTEM_REMINDER_RE = /^\s*<system-reminder>/;
// Compaction/resume writes a synthetic user message carrying the conversation
// summary — injected by Claude Code, not typed by the user.
const CONTINUATION_RE = /^This session is being continued from a previous conversation/;

/** Parse the line's ISO timestamp to epoch ms; null if absent/invalid. */
export function tsMs(obj) {
  if (!obj || typeof obj.timestamp !== 'string') return null;
  const t = Date.parse(obj.timestamp);
  return Number.isFinite(t) ? t : null;
}

/**
 * Classify a parsed transcript line.
 * kind ∈ prompt | command | tool_result | assistant | system | attachment |
 *        queue_op | title | last_prompt | pr_link | summary | skip
 * "prompt"/"command" are the only kinds that represent human input.
 */
export function classifyLine(obj) {
  if (!obj || typeof obj !== 'object') return { kind: 'skip' };
  switch (obj.type) {
    case 'user': {
      const c = obj.message ? obj.message.content : undefined;
      if (typeof c === 'string') {
        if (LOCAL_OUT_RE.test(c)) return { kind: 'system' };
        if (SYSTEM_REMINDER_RE.test(c)) return { kind: 'system' };
        if (CONTINUATION_RE.test(c)) return { kind: 'system' };
        if (obj.isMeta) return { kind: 'system' };
        if (obj.toolUseResult !== undefined) return { kind: 'tool_result' };
        if (COMMAND_RE.test(c)) return { kind: 'command' };
        const origin = obj.origin;
        // Real human prompts carry origin.kind === 'human'; very old CC versions
        // have no origin field at all — treat those as human once all other
        // exclusions passed. origin present but not human (task-notification
        // etc.) is injected content, not the user typing.
        if (!origin || origin.kind === 'human') return { kind: 'prompt' };
        return { kind: 'system' };
      }
      if (Array.isArray(c)) {
        // tool_result blocks / injected text blocks / images — never human input
        const isToolResult =
          obj.toolUseResult !== undefined || c.some((b) => b && b.type === 'tool_result');
        return { kind: isToolResult ? 'tool_result' : 'system' };
      }
      return { kind: 'skip' };
    }
    case 'assistant':
      return { kind: 'assistant' };
    case 'system':
      return { kind: 'system' };
    case 'attachment':
      return { kind: 'attachment' };
    case 'queue-operation':
      return { kind: 'queue_op' };
    case 'custom-title':
      return { kind: 'title' };
    case 'last-prompt':
      return { kind: 'last_prompt' };
    case 'pr-link':
      return { kind: 'pr_link' };
    case 'summary': // legacy CC versions only
      return { kind: 'summary' };
    default:
      return { kind: 'skip' };
  }
}

/** Common envelope fields, normalized. */
export function envelope(obj) {
  return {
    uuid: typeof obj.uuid === 'string' ? obj.uuid : null,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : null,
    cwd: typeof obj.cwd === 'string' && obj.cwd ? obj.cwd : null,
    gitBranch: typeof obj.gitBranch === 'string' ? obj.gitBranch : null,
    version: typeof obj.version === 'string' ? obj.version : null,
    entrypoint: typeof obj.entrypoint === 'string' ? obj.entrypoint : null,
    isSidechain: obj.isSidechain === true,
    agentId: typeof obj.agentId === 'string' ? obj.agentId : null,
    ts: tsMs(obj),
  };
}

function matchTag(s, tag) {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/**
 * Extract display text for a human prompt line (kind prompt|command).
 * @returns {{text:string, commandName:string|null}}
 */
export function extractPrompt(obj, kind) {
  const c = obj.message.content;
  if (kind === 'prompt') return { text: c, commandName: null };
  const name = matchTag(c, 'command-name');
  const args = matchTag(c, 'command-args');
  const msg = matchTag(c, 'command-message');
  const text = [name || msg || '(command)', args].filter(Boolean).join(' ').trim();
  return { text, commandName: name || null };
}

/**
 * Normalize token usage from an assistant message (or Agent toolUseResult.usage).
 * Returns null when there is no usage or the model is synthetic (error lines).
 * Caller is responsible for crediting usage only once per message.id.
 */
export function extractUsage(message) {
  if (!message || !message.usage || message.model === '<synthetic>') return null;
  const u = message.usage;
  const cc = u.cache_creation;
  let cache5m = 0;
  let cache1h = 0;
  if (cc && typeof cc === 'object') {
    cache5m = cc.ephemeral_5m_input_tokens || 0;
    cache1h = cc.ephemeral_1h_input_tokens || 0;
  } else {
    // Older format without the TTL split: the API default TTL is 5m.
    cache5m = u.cache_creation_input_tokens || 0;
  }
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cache5m,
    cache1h,
  };
}

/**
 * Metadata from an assistant line: message id/model/effort, tool_use info,
 * visible-text size, and skill/plugin attributions. Thinking payloads and
 * unknown block types are ignored (signatures must never be persisted).
 */
export function assistantMeta(obj) {
  const msg = obj.message || {};
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  let toolName = null;
  let toolUseCount = 0;
  let charCount = 0;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'tool_use') {
      toolUseCount += 1;
      if (!toolName && typeof b.name === 'string') toolName = b.name;
    } else if (b.type === 'text' && typeof b.text === 'string') {
      charCount += b.text.length;
    }
  }
  return {
    messageId: typeof msg.id === 'string' ? msg.id : null,
    model: typeof msg.model === 'string' ? msg.model : null,
    effort: typeof obj.effort === 'string' ? obj.effort : null,
    toolName,
    toolUseCount,
    charCount,
    attrSkill: typeof obj.attributionSkill === 'string' ? obj.attributionSkill : null,
    attrPlugin: typeof obj.attributionPlugin === 'string' ? obj.attributionPlugin : null,
    attrMcpServer: typeof obj.attributionMcpServer === 'string' ? obj.attributionMcpServer : null,
    attrMcpTool: typeof obj.attributionMcpTool === 'string' ? obj.attributionMcpTool : null,
  };
}

/**
 * If a tool_result line carries an Agent (subagent) run result, extract it —
 * this is the richest per-subagent record (authoritative duration, tool stats).
 */
export function extractAgentRun(obj) {
  const r = obj.toolUseResult;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.agentId !== 'string' || !r.agentId) return null;
  const usage =
    r.usage && typeof r.usage === 'object'
      ? extractUsage({ usage: r.usage, model: r.resolvedModel })
      : null;
  return {
    agentId: r.agentId,
    agentType: typeof r.agentType === 'string' ? r.agentType : null,
    resolvedModel: typeof r.resolvedModel === 'string' ? r.resolvedModel : null,
    status: typeof r.status === 'string' ? r.status : null,
    totalDurationMs: Number.isFinite(r.totalDurationMs) ? r.totalDurationMs : null,
    totalToolUseCount: Number.isFinite(r.totalToolUseCount) ? r.totalToolUseCount : null,
    toolStats: r.toolStats && typeof r.toolStats === 'object' ? r.toolStats : null,
    usage,
  };
}

/**
 * Error signals for the failure feed. Returns {kind:'tool'|'api', snippet}
 * or null. Defensive: transcript error shapes are not a stable schema.
 */
export function errorInfo(obj, kind) {
  try {
    if (kind === 'tool_result') {
      const c = obj.message?.content;
      if (Array.isArray(c)) {
        const block = c.find((b) => b && b.type === 'tool_result' && b.is_error === true);
        if (block) {
          let text = '';
          if (typeof block.content === 'string') text = block.content;
          else if (Array.isArray(block.content)) text = block.content.map((x) => (typeof x?.text === 'string' ? x.text : '')).join(' ');
          return { kind: 'tool', snippet: text.replace(/\s+/g, ' ').slice(0, 160) || 'tool error' };
        }
      }
      if (typeof obj.toolUseResult === 'string' && /^(Error|InputValidationError|Blocked)/i.test(obj.toolUseResult)) {
        return { kind: 'tool', snippet: obj.toolUseResult.replace(/\s+/g, ' ').slice(0, 160) };
      }
    } else if (kind === 'assistant' && obj.isApiErrorMessage === true) {
      const c = obj.message?.content;
      const text = Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join(' ') : String(c ?? '');
      return { kind: 'api', snippet: text.replace(/\s+/g, ' ').slice(0, 160) || 'API error' };
    }
  } catch { /* never break classification */ }
  return null;
}
