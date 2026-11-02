// Optional LLM, used ONLY to reword shopper-facing text. Decisions never depend on it.
// Any OpenAI-compatible /chat/completions endpoint works (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY).
// Output is validated; on timeout, error or a failed check we keep the templated text.
import { config, llmEnabled } from '../config.js';

const BANNED = [
  'flaw', 'problem', 'fix', 'unflattering', 'dull', 'sallow', 'ashy', 'pale', 'too dark', 'too light',
  'imperfection', 'correct your', 'ugly', 'bad skin', 'wrong with', 'guarantee', '%',
];

export function validateRewrite(text, { mustInclude = [], maxLen = 360 } = {}) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 20 || t.length > maxLen) return false;
  const lower = t.toLowerCase();
  if (BANNED.some((w) => lower.includes(w))) return false;
  if (mustInclude.some((w) => !lower.includes(String(w).toLowerCase()))) return false;
  if (/https?:|<|>|\{|\}/.test(t)) return false;
  return true;
}

/**
 * Reword `fallback` in a warm, plain voice. Returns { text, source: 'llm'|'template', ms, why? }.
 */
export async function reword({ purpose, facts, fallback, mustInclude = [] }) {
  if (!llmEnabled()) return { text: fallback, source: 'template', ms: 0, why: 'llm_disabled' };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content:
              'You write short, warm, plain-English microcopy for a beauty and fashion returns assistant. ' +
              'Rewrite the draft so it sounds friendly and human. Rules: keep every fact exactly as given, ' +
              'never add facts, numbers, promises or product names that are not in the draft, no judgemental ' +
              'words about skin, max 2 sentences, no emojis, no markdown. Reply with the rewritten text only.',
          },
          { role: 'user', content: `Purpose: ${purpose}\nFacts: ${JSON.stringify(facts)}\nDraft: ${fallback}` },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim().replace(/^"|"$/g, '');
    if (!validateRewrite(text, { mustInclude })) {
      return { text: fallback, source: 'template', ms: Date.now() - t0, why: 'validation_failed' };
    }
    return { text, source: 'llm', ms: Date.now() - t0 };
  } catch (e) {
    return { text: fallback, source: 'template', ms: Date.now() - t0, why: e.name === 'AbortError' ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}
