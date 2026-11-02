// Return sessions. Selfies and renders live only in memory, inside the session, and are
// wiped when the session ends (exchange, refund, escalation, explicit delete, or TTL).
// YouCam tasks created for the session are deleted with POST /s2s/v2.0/task/delete,
// which removes their input and output files on YouCam's side too.
import { randomUUID } from 'node:crypto';

export class SessionStore {
  constructor({ ttlMin = 20, onExpire = () => {} } = {}) {
    this.sessions = new Map();
    this.ttlMs = ttlMin * 60000;
    this.onExpire = onExpire;
    this.timer = setInterval(() => this.sweep(), 30000);
    this.timer.unref?.();
  }

  create(fields) {
    const id = randomUUID();
    const s = {
      id,
      createdAt: Date.now(),
      touchedAt: Date.now(),
      status: 'active',
      step: 'reason',
      reason: null,
      consent: false,
      photo: null, // { buffer, sha, mime, width, height }
      youcamFileId: null,
      youcamFileSha: null,
      taskIds: [],
      profile: null,
      matches: null,
      picks: [],
      renders: [], // { id, productId, role, status, buffer?, contentType?, units, ms, cached, error? }
      rendersUsed: 0,
      unitsUsed: 0,
      attempts: { photo: 0, analysis: 0 },
      trace: [],
      outcome: null,
      escalation: null,
      exchange: null,
      llmUsed: false,
      ...fields,
    };
    this.sessions.set(id, s);
    return s;
  }

  get(id) {
    const s = this.sessions.get(id);
    if (s) s.touchedAt = Date.now();
    return s ?? null;
  }

  /** Remove personal data (photo + renders) but keep the PII-free summary for the trace. */
  wipePersonalData(s) {
    s.photo = null;
    for (const r of s.renders) {
      r.buffer = null;
    }
    s.photoDeletedAt = new Date().toISOString();
  }

  sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.status === 'active' && now - s.touchedAt > this.ttlMs) {
        s.status = 'expired';
        this.wipePersonalData(s);
        this.onExpire(s);
      }
      // Keep ended sessions' summaries (no personal data) for the trace panel for 6 hours.
      if (s.status !== 'active' && now - s.touchedAt > 6 * 3600000) this.sessions.delete(s.id);
    }
  }

  recent(limit = 20) {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
