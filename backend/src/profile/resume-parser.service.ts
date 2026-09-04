import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export interface ResumeSuggestions {
  fullName?: string;
  email?: string;
  phone?: string;
  skills?: string;
  education?: string;
  experienceYears?: number;
}

const SECTION_HEADINGS = [
  'skills',
  'technical skills',
  'core competencies',
  'education',
  'academic background',
  'experience',
  'work experience',
  'projects',
  'certifications',
  'summary',
  'objective',
];

/**
 * Resumes are uploaded as PDF/DOC/DOCX, not scanned images, so this extracts embedded text
 * directly (pdf-parse / mammoth) rather than running real image OCR — same end result
 * ("read the resume, suggest profile fields") without the extra weight of an OCR engine.
 * Heuristic, not a real resume parser: good enough to prefill a form for the user to review,
 * not to trust blindly.
 */
@Injectable()
export class ResumeParserService {
  private readonly logger = new Logger(ResumeParserService.name);

  async extractText(filePath: string): Promise<string | null> {
    const ext = extname(filePath).toLowerCase();
    try {
      if (ext === '.pdf') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PDFParse } = require('pdf-parse');
        const buffer = await readFile(filePath);
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          // pdf-parse inserts "-- N of M --" page-break markers into the text; strip them
          // so they don't leak into the extracted sections below.
          return (result.text as string).replace(/^-- \d+ of \d+ --$/gm, '');
        } finally {
          await parser.destroy();
        }
      }
      if (ext === '.docx') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value as string;
      }
      // Legacy .doc is a binary format that isn't reliably parseable without extra
      // native tooling — skip extraction rather than guess.
      return null;
    } catch (err) {
      this.logger.warn(`Failed to extract text from resume: ${(err as Error).message}`);
      return null;
    }
  }

  parse(text: string): ResumeSuggestions {
    const suggestions: ResumeSuggestions = {};

    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) suggestions.email = emailMatch[0];

    const phoneMatch = text.match(/(\+?\d[\d .()-]{7,}\d)/);
    if (phoneMatch) suggestions.phone = phoneMatch[0].trim();

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const firstLine = lines[0];
    if (firstLine && firstLine.length <= 60 && !/@/.test(firstLine) && !/\d{3,}/.test(firstLine)) {
      suggestions.fullName = firstLine;
    }

    const skillsBlock = this.extractSection(text, ['skills', 'technical skills', 'core competencies']);
    if (skillsBlock) {
      const items = skillsBlock
        .split(/[,•|]|\r?\n/)
        .map((s) => s.replace(/^[-*\s]+/, '').trim())
        .filter((s) => s.length > 1 && s.length < 40);
      if (items.length) {
        suggestions.skills = [...new Set(items)].slice(0, 30).join(', ');
      }
    }

    const educationBlock = this.extractSection(text, ['education', 'academic background']);
    if (educationBlock) {
      suggestions.education = educationBlock.slice(0, 500).trim();
    }

    const yearsMatches = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)\b/gi)];
    if (yearsMatches.length) {
      const years = yearsMatches.map((m) => parseInt(m[1], 10)).filter((n) => n > 0 && n < 50);
      if (years.length) suggestions.experienceYears = Math.max(...years);
    }

    return suggestions;
  }

  private extractSection(text: string, headings: string[]): string | null {
    const lines = text.split(/\r?\n/);
    const headingRegex = new RegExp(`^\\s*(${headings.join('|')})\\s*:?\\s*$`, 'i');
    const anyHeadingRegex = new RegExp(`^\\s*(${SECTION_HEADINGS.join('|')})\\s*:?\\s*$`, 'i');

    const startIdx = lines.findIndex((l) => headingRegex.test(l));
    if (startIdx === -1) return null;

    const collected: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (anyHeadingRegex.test(line)) break;
      if (line.trim()) collected.push(line);
    }
    return collected.join('\n') || null;
  }
}
