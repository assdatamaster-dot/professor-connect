import type { UpdateReleaseNotes } from './contracts.js';

export class ReleaseNotesService {
  public parse(value: unknown): UpdateReleaseNotes {
    const raw = normalizeNotes(value);
    const sections: Record<'news' | 'fixes' | 'improvements', string[]> = {
      news: [],
      fixes: [],
      improvements: [],
    };
    let current: keyof typeof sections = 'news';
    for (const sourceLine of raw.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (line.length === 0) continue;
      const heading = line
        .replace(/^#+\s*/, '')
        .replace(/:$/, '')
        .toLowerCase();
      if (/^(novidades?|news|features?)$/.test(heading)) {
        current = 'news';
        continue;
      }
      if (/^(corre[cç][oõ]es?|fixes?|bug fixes?)$/.test(heading)) {
        current = 'fixes';
        continue;
      }
      if (/^(melhorias?|improvements?|enhancements?)$/.test(heading)) {
        current = 'improvements';
        continue;
      }
      sections[current].push(line.replace(/^[-*•]\s*/, ''));
    }
    return { ...sections, raw };
  }
}

function normalizeNotes(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === 'object' && entry !== null && 'note' in entry
          ? String((entry as { note: unknown }).note)
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
