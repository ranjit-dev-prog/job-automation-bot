import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';

export interface AiRelevanceResult {
  score: number;
  reasoning: string;
}

export interface AiAnswerResult {
  value: string;
}

export interface AiEmailDraft {
  subject: string;
  body: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

// Shared instruction: the model must ground every answer in the supplied profile data and
// never invent experience/qualifications/salary/etc. — the same "never guess" rule the
// keyword-based screening-answer.util enforces, just applied to free-form questions an AI
// can parse better than a handful of regexes.
const ANSWER_SYSTEM_PROMPT = `You help fill in a job application form on behalf of a candidate.
You will be given the candidate's profile as JSON — including structured fields and, when
available, "resumeText" (raw text extracted from their uploaded resume) — plus one screening
question.
Answer ONLY using facts explicitly present in the profile JSON or resumeText. Never guess,
estimate, or invent a value that isn't there — this includes experience, salary, notice period,
work authorization, and skills. resumeText is supporting evidence, not license to infer beyond
what it actually states (e.g. a resume listing "SQL" supports a SQL experience question; it does
not support guessing years of experience or salary unless a number is explicitly stated).
Respond with a single-line JSON object and nothing else:
- If the profile/resume confirms an answer: {"answerable": true, "value": "<short plain-text answer, e.g. a number, or exactly Yes/No>"}
- If nothing confirms an answer: {"answerable": false}`;

const RELEVANCE_SYSTEM_PROMPT = `You score how relevant a job posting is to a candidate, for an auto-apply bot that should
skip jobs the candidate is a poor fit for. You will be given the candidate's profile as JSON —
skills, target roles, experience, and when available "resumeText" (raw resume text, useful for a
fuller picture of their background than the structured fields alone) — and a job title +
description, both as JSON.
Respond with a single-line JSON object and nothing else:
{"score": <integer 0-100>, "reasoning": "<one short sentence>"}
Score based on overlap between the candidate's actual skills/experience (profile fields and
resumeText together) and what the job actually asks for. Do not be swayed by company prestige or
salary — only role fit.`;

const EMAIL_DRAFT_SYSTEM_PROMPT = `You draft a short, professional outreach email a job candidate can send directly to a company
about a role they applied for. You will be given the candidate's profile as JSON and the job
title + company.
Ground every claim in the profile JSON (and resumeText if present) — never invent experience,
titles, or achievements that aren't there. Keep it concise (under 150 words), warm but
professional, and end with the candidate's name. Do not include a subject line inside the body.
Respond with a single-line JSON object and nothing else:
{"subject": "<short subject line>", "body": "<email body, \\n for line breaks>"}`;

const CONNECTION_MESSAGE_SYSTEM_PROMPT = `You draft a short, casual LinkedIn message a job candidate can send to a 1st-degree connection
who works at a company the candidate just applied to, asking for a referral or a pointer to the
right person. You will be given the candidate's profile as JSON, the job title, the company, and
the connection's name.
Keep it under 60 words, friendly, and low-pressure — it should read like a real person messaging
an acquaintance, not a form letter. Ground any claim about the candidate in the profile JSON.
Respond with a single-line JSON object and nothing else:
{"message": "<message text, \\n for line breaks>"}`;

const MAX_RESUME_CHARS = 8000;

/** Caps resumeText length before it goes into a prompt — full resumes can run long/multi-page. */
function forPrompt(profile: ApplicantProfile): ApplicantProfile {
  if (!profile.resumeText || profile.resumeText.length <= MAX_RESUME_CHARS) return profile;
  return { ...profile, resumeText: profile.resumeText.slice(0, MAX_RESUME_CHARS) };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Models sometimes wrap the JSON in prose or a markdown fence despite instructions —
    // fall back to the outermost { ... } span rather than a backtracking regex over the whole
    // reply.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Thin wrapper around Claude/Gemini used to answer application screening questions and score
 * job relevance more flexibly than the deterministic keyword rules in job-matching.util and
 * screening-answer.util. Every method degrades to `null` on any error, missing config, or a
 * response the model itself flags as unconfirmed — callers must treat that exactly like the
 * keyword rules returning null: stop and ask, never fall back to a guess.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider = (this.config.get<string>('AI_PROVIDER', 'none') || 'none').toLowerCase();
  }

  isEnabled(): boolean {
    if (this.provider === 'claude') return !!this.config.get<string>('ANTHROPIC_API_KEY');
    if (this.provider === 'gemini') return !!this.config.get<string>('GEMINI_API_KEY');
    return false;
  }

  async scoreRelevance(
    profile: ApplicantProfile,
    jobTitle: string,
    jobDescription: string,
  ): Promise<AiRelevanceResult | null> {
    if (!this.isEnabled()) return null;
    const userPrompt = JSON.stringify({
      candidateProfile: forPrompt(profile),
      job: { title: jobTitle, description: jobDescription.slice(0, 6000) },
    });

    const raw = await this.complete(RELEVANCE_SYSTEM_PROMPT, userPrompt);
    if (!raw) return null;

    const parsed = extractJson(raw) as { score?: unknown; reasoning?: unknown } | null;
    if (!parsed || typeof parsed.score !== 'number') return null;
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    return { score, reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '' };
  }

  async answerQuestion(profile: ApplicantProfile, question: string): Promise<AiAnswerResult | null> {
    if (!this.isEnabled()) return null;
    const userPrompt = JSON.stringify({ candidateProfile: forPrompt(profile), question });

    const raw = await this.complete(ANSWER_SYSTEM_PROMPT, userPrompt);
    if (!raw) return null;

    const parsed = extractJson(raw) as { answerable?: unknown; value?: unknown } | null;
    if (!parsed || parsed.answerable !== true || typeof parsed.value !== 'string' || !parsed.value.trim()) {
      return null;
    }
    return { value: parsed.value.trim() };
  }

  async draftOutreachEmail(
    profile: ApplicantProfile,
    jobTitle: string,
    company: string,
  ): Promise<AiEmailDraft | null> {
    if (!this.isEnabled()) return null;
    const userPrompt = JSON.stringify({ candidateProfile: forPrompt(profile), jobTitle, company });

    const raw = await this.complete(EMAIL_DRAFT_SYSTEM_PROMPT, userPrompt);
    if (!raw) return null;

    const parsed = extractJson(raw) as { subject?: unknown; body?: unknown } | null;
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') return null;
    if (!parsed.subject.trim() || !parsed.body.trim()) return null;
    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  }

  async draftConnectionMessage(
    profile: ApplicantProfile,
    jobTitle: string,
    company: string,
    connectionName: string,
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;
    const userPrompt = JSON.stringify({
      candidateProfile: forPrompt(profile),
      jobTitle,
      company,
      connectionName,
    });

    const raw = await this.complete(CONNECTION_MESSAGE_SYSTEM_PROMPT, userPrompt);
    if (!raw) return null;

    const parsed = extractJson(raw) as { message?: unknown } | null;
    if (!parsed || typeof parsed.message !== 'string' || !parsed.message.trim()) return null;
    return parsed.message.trim();
  }

  /** Dispatches to the configured provider; returns the raw text reply, or null on any failure. */
  private async complete(systemPrompt: string, userPrompt: string): Promise<string | null> {
    try {
      if (this.provider === 'claude') return await this.completeClaude(systemPrompt, userPrompt);
      if (this.provider === 'gemini') return await this.completeGemini(systemPrompt, userPrompt);
      return null;
    } catch (err) {
      this.logger.warn(`AI request failed (${this.provider}): ${(err as Error).message}`);
      return null;
    }
  }

  private async completeClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) return null;
    const model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`Claude API returned ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const textBlock = body.content?.find((block) => block.type === 'text');
    return textBlock?.text ?? null;
  }

  private async completeGemini(systemPrompt: string, userPrompt: string): Promise<string | null> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) return null;
    const model = this.config.get<string>('GEMINI_MODEL', 'gemini-3.6-flash');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      this.logger.warn(`Gemini API returned ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return body.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  }
}
