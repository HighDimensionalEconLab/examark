/**
 * Markdown parser for quiz questions
 * Supports both original format AND Quarto GFM output
 */

import type { ParsedQuiz, Question, Section, AnswerOption, QuestionType, MatchPair, BlankAnswer, CanvasSettings } from './types.js';
import { slugify } from './types.js';
import { parse as parseYaml } from 'yaml';

/**
 * Type marker aliases - maps various formats to canonical QuestionType
 * All lookups are case-insensitive
 */
const TYPE_MARKER_ALIASES: Record<string, QuestionType> = {
  // True/False
  'tf': 'true_false',
  'truefalse': 'true_false',
  'true/false': 'true_false',
  't/f': 'true_false',

  // Multiple Choice (default, but can be explicit)
  'mc': 'multiple_choice',
  'multichoice': 'multiple_choice',
  'multiple choice': 'multiple_choice',

  // Multiple Answers (select all that apply)
  'ma': 'multiple_answers',
  'multians': 'multiple_answers',
  'multianswer': 'multiple_answers',
  'multiple answers': 'multiple_answers',
  'selectall': 'multiple_answers',
  'select all': 'multiple_answers',

  // Essay
  'essay': 'essay',
  'long answer': 'essay',
  'longanswer': 'essay',

  // Short Answer
  'short': 'short_answer',
  'sa': 'short_answer',
  'shortanswer': 'short_answer',
  'short answer': 'short_answer',
  'fillblank': 'short_answer',
  'fill blank': 'short_answer',
  'fib': 'short_answer',

  // Numeric
  'num': 'numerical',
  'numeric': 'numerical',
  'numerical': 'numerical',
  'number': 'numerical',

  // Matching
  'match': 'matching',
  'matching': 'matching',
  'mat': 'matching',

  // Fill in Multiple Blanks
  'fmb': 'fill_in_multiple_blanks',
  'fillblanks': 'fill_in_multiple_blanks',
  'fill blanks': 'fill_in_multiple_blanks',
  'multiblanks': 'fill_in_multiple_blanks',
  'fitb': 'fill_in_multiple_blanks',
};

// Applied whenever the document has front matter; a canvas: key overrides its default
export const CANVAS_DEFAULTS: CanvasSettings = {
  quiz_type: 'assignment',
  shuffle_answers: false,
  time_limit: 50,
  allowed_attempts: 1,
  hide_results: 'always',
  show_correct_answers: false,
  one_question_at_a_time: true,
  cant_go_back: false,
  require_lockdown_browser: true,
  require_lockdown_browser_for_results: true,
};

const CANVAS_VALUE_TYPES: Record<string, string | string[]> = {
  quiz_type: ['practice_quiz', 'assignment', 'graded_survey', 'survey'],
  scoring_policy: ['keep_highest', 'keep_latest', 'keep_average'],
  hide_results: ['always', 'until_after_last_attempt'],
  time_limit: 'number', allowed_attempts: 'number',
  shuffle_answers: 'boolean', show_correct_answers: 'boolean', one_question_at_a_time: 'boolean',
  cant_go_back: 'boolean', require_lockdown_browser: 'boolean',
  require_lockdown_browser_for_results: 'boolean', require_lockdown_browser_monitor: 'boolean',
  access_code: 'string', description: 'string', unlock_at: 'string', due_at: 'string', lock_at: 'string',
};

const CANVAS_KEYS = new Set([
  'quiz_type', 'time_limit', 'allowed_attempts', 'scoring_policy', 'shuffle_answers', 'hide_results',
  'show_correct_answers', 'one_question_at_a_time', 'cant_go_back', 'access_code', 'description',
  'require_lockdown_browser', 'require_lockdown_browser_for_results', 'require_lockdown_browser_monitor',
  'unlock_at', 'due_at', 'lock_at',
]);

/**
 * Extract inline type markers like [TF], [Essay], [MultiAns], [Match], [FMB] from question title
 * Supports many aliases (case-insensitive): [TF], [TrueFalse], [True/False], [T/F], etc.
 * Returns the detected type and clean title without the marker
 */
function extractTypeMarker(title: string): { type: QuestionType | null; cleanTitle: string } {
  // Build regex pattern from all aliases
  const aliasPattern = Object.keys(TYPE_MARKER_ALIASES).map(a => a.replace(/[\/\s]/g, '[/\\s]?')).join('|');
  // Handle both [type] and \[type\] (Quarto escaping)
  const markerRegex = new RegExp(`\\\\?\\[(${aliasPattern})(?:,?\\s*\\d+\\s*pts?)?\\\\?\\]`, 'i');

  const markerMatch = title.match(markerRegex);
  if (markerMatch) {
    // Normalize: lowercase and remove spaces/slashes for lookup
    const marker = markerMatch[1].toLowerCase().replace(/[\s\/]+/g, match =>
      match.includes('/') ? '/' : ' '
    );
    const cleanTitle = title.replace(markerMatch[0], '').trim();
    const type = TYPE_MARKER_ALIASES[marker];
    if (type) {
      return { type, cleanTitle };
    }
  }
  return { type: null, cleanTitle: title };
}

/**
 * Parse question type from title or section context
 */
function parseQuestionType(text: string, sectionTitle?: string): QuestionType {
  const lower = text.toLowerCase();
  
  // Check for inline type markers first (highest priority)
  const { type: markerType } = extractTypeMarker(text);
  if (markerType) return markerType;
  
  // Check question title for hints
  if (lower.includes('essay')) return 'essay';
  if (lower.includes('short') && lower.includes('answer')) return 'short_answer';
  if (lower.includes('fill') || lower.includes('blank')) return 'fill_in_blank';
  
  // Check section title for hints
  if (sectionTitle) {
    const sectionLower = sectionTitle.toLowerCase();
    if (sectionLower.includes('essay')) return 'essay';
    if (sectionLower.includes('true') || sectionLower.includes('false')) return 'true_false';
    if (sectionLower.includes('short')) return 'short_answer';
    if (sectionLower.includes('multi-part') || sectionLower.includes('multi part')) return 'essay';
  }
  
  return 'multiple_choice';
}

/**
 * Check if text represents True/False question
 */
function isTrueFalseQuestion(options: AnswerOption[]): boolean {
  if (options.length !== 2) return false;
  const texts = options.map(o => o.text.toLowerCase().trim());
  return texts.includes('true') && texts.includes('false');
}

/**
 * Extract inline feedback from option text (format: text // feedback)
 * Returns the clean text and optional feedback
 */
function extractInlineFeedback(text: string): { cleanText: string; feedback?: string } {
  const feedbackMatch = text.match(/^(.+?)\s*\/\/\s*(.+)$/);
  if (feedbackMatch) {
    return {
      cleanText: feedbackMatch[1].trim(),
      feedback: feedbackMatch[2].trim()
    };
  }
  return { cleanText: text };
}

/**
 * Check for correct answer markers in option text
 * Supports: **, ✓, ✔, [correct], [x]
 */
function hasCorrectMarker(text: string): boolean {
  return (
    text.includes('**') ||
    text.includes('✓') ||
    text.includes('✔') ||
    /\\?\[correct\\?\]\s*$/i.test(text) ||  // Matches [correct], \[correct], or \[correct\]
    /\\?\[x\\?\]\s*$/i.test(text)           // Matches [x], \[x], or \[x\]
  );
}

/**
 * Remove correct answer markers from text
 */
function cleanCorrectMarkers(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[✓✔]/g, '')
    .replace(/\s*\\?\[correct\\?\]\s*$/i, '')  // Removes [correct], \[correct], or \[correct\]
    .replace(/\s*\\?\[x\\?\]\s*$/i, '')        // Removes [x], \[x], or \[x\]
    .trim();
}

/**
 * Parse answer options from lines following a question
 * Handles multiple formats:
 * - 1) Answer, 2) Answer (Quarto GFM numbered)
 * - a) Answer, b) Answer (lettered)
 * - Correct markers: **Bold**, ✓, [correct], [x], * prefix
 * - Inline feedback: text // feedback comment
 */
function parseOptions(lines: string[]): AnswerOption[] {
  const options: AnswerOption[] = [];

  // Join wrapped lines (continuation lines that start with whitespace)
  const joinedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      joinedLines.push('');
      continue;
    }

    // Check if this line starts with option marker (1), a), -, =, Answer:, etc.)
    const isOptionStart = /^(\*)?([a-e]|\d+)\)\s+/i.test(trimmed) || /^-\s+/.test(trimmed) || /^(\*)?(True|False)$/i.test(trimmed) || /^=\s+/.test(trimmed) || /^Answer:\s*/i.test(trimmed);

    if (isOptionStart || joinedLines.length === 0) {
      joinedLines.push(line);
    } else {
      // This is a continuation line - join with previous
      const lastIdx = joinedLines.length - 1;
      if (lastIdx >= 0 && joinedLines[lastIdx].trim()) {
        joinedLines[lastIdx] += ' ' + trimmed;
      } else {
        joinedLines.push(line);
      }
    }
  }

  for (const line of joinedLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match numbered options: 1) Answer, 2) Answer, or *1) Answer (correct)
    const numMatch = trimmed.match(/^(\*)?(\d+)\)\s+(.+)$/s);
    if (numMatch) {
      const hasAsteriskPrefix = !!numMatch[1];
      const text = numMatch[3];
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(text);
      const isCorrect = hasAsteriskPrefix || hasCorrectMarker(textWithoutFeedback);
      const cleanText = cleanCorrectMarkers(textWithoutFeedback);
      options.push({
        id: String.fromCharCode(96 + parseInt(numMatch[2])), // 1->a, 2->b, etc.
        text: cleanText,
        isCorrect,
        feedback
      });
      continue;
    }

    // Match lettered options: a) Answer, b) Answer, or *a) Answer (correct)
    const letterMatch = trimmed.match(/^(\*)?([a-e])\)\s+(.+)$/is);
    if (letterMatch) {
      const hasAsteriskPrefix = !!letterMatch[1];
      const text = letterMatch[3];
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(text);
      const isCorrect = hasAsteriskPrefix || hasCorrectMarker(textWithoutFeedback) || textWithoutFeedback.startsWith('*');
      const cleanText = cleanCorrectMarkers(textWithoutFeedback).replace(/^\*/, '').trim();
      options.push({
        id: letterMatch[2].toLowerCase(),
        text: cleanText,
        isCorrect,
        feedback
      });
      continue;
    }

    // Match dash options: - Answer or -  **Answer** (correct)
    const dashMatch = trimmed.match(/^-\s+(.+)$/s);
    if (dashMatch) {
      const text = dashMatch[1];
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(text);
      const isCorrect = hasCorrectMarker(textWithoutFeedback);
      const cleanText = cleanCorrectMarkers(textWithoutFeedback);
      options.push({
        id: String.fromCharCode(97 + options.length), // a, b, c, ...
        text: cleanText,
        isCorrect,
        feedback
      });
      continue;
    }

    // Match short answer lines: = Answer (each line is an acceptable answer)
    const equalsMatch = trimmed.match(/^=\s+(.+)$/);
    if (equalsMatch) {
      const text = equalsMatch[1].trim();
      options.push({
        id: `answer${options.length + 1}`,
        text,
        isCorrect: true
      });
      continue;
    }

    // Match short answer lines: Answer: text (each line is an acceptable answer)
    const answerColonMatch = trimmed.match(/^Answer:\s*(.+)$/i);
    if (answerColonMatch) {
      const text = answerColonMatch[1].trim();
      options.push({
        id: `answer${options.length + 1}`,
        text,
        isCorrect: true
      });
      continue;
    }

    // Match standalone True/False options: *True, \[x\] True, True, False (for T/F questions)
    const tfMatch = trimmed.match(/^(?:\*|\\?\[x\\?\]\s*)?(True|False)$/i);
    if (tfMatch) {
      // Has leading asterisk or [x] marker
      const isCorrect = trimmed.match(/^(?:\*|\\?\[x\\?\])/i) !== null;
      const text = tfMatch[1]; // True or False
      options.push({
        id: text.toLowerCase() === 'true' ? 'a' : 'b',
        text: text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
        isCorrect
      });
      continue;
    }
  }

  return options;
}

/**
 * Extract points from title like "Question Title [2 pts]" or "[5 pts]"
 */
function extractPoints(title: string): { points: number | null; cleanTitle: string } {
  // Matches [2 pts], [2 points], \[2 pts\], etc.
  // Handle both [pts] and \[pts\] (Quarto escaping)
  const match = title.match(/\\?\[(\d+)\s*pts?\\?\]/i);
  if (match) {
    return {
      points: parseInt(match[1], 10),
      cleanTitle: title.replace(match[0], '').trim()
    };
  }
  return { points: null, cleanTitle: title };
}

/**
 * Extract distinct image paths from markdown text
 * Handles both markdown syntax ![](path) and HTML <img src="path">
 */
function extractImages(text: string): string[] {
  const images = new Set<string>();

  // Match markdown images: ![alt](path)
  const mdRegex = /!\[.*?\]\((.*?)(?:\s+".*?")?\)/g;
  let match;
  while ((match = mdRegex.exec(text)) !== null) {
    images.add(match[1]);
  }

  // Match HTML img tags: <img src="path" ...> (handles multi-line tags)
  // Use [\s\S] instead of . to match across newlines
  const htmlRegex = /<img[\s\S]*?src=["']([^"']+)["'][\s\S]*?>/gi;
  while ((match = htmlRegex.exec(text)) !== null) {
    images.add(match[1]);
  }

  return Array.from(images);
}

/**
 * Parse matching pairs from lines
 * Supports separators: :: (double colon) or => (arrow)
 * Format: - Left :: Right  OR  - Left => Right
 */
function parseMatchPairs(lines: string[]): MatchPair[] {
  const pairs: MatchPair[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match: - Left :: Right or - Left => Right (both separators)
    const matchPairRegex = /^-\s+(.+?)\s*(?:::|=>)\s*(.+)$/;
    const match = trimmed.match(matchPairRegex);
    if (match) {
      pairs.push({
        left: match[1].trim(),
        right: match[2].trim()
      });
    }
  }

  return pairs;
}

/**
 * Parse options with feedback
 * Supports:
 * - Blockquote feedback: > feedback after option
 * - Inline feedback: text // feedback
 * - General feedback: > [feedback] text
 */
function parseOptionsWithFeedback(lines: string[]): { options: AnswerOption[]; generalFeedback?: string } {
  const options: AnswerOption[] = [];
  let generalFeedback: string | undefined;
  let lastOption: AnswerOption | null = null;

  // Join wrapped lines (continuation lines that start with whitespace)
  const joinedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      joinedLines.push('');
      continue;
    }

    // Don't join feedback lines
    if (trimmed.startsWith('>')) {
      joinedLines.push(line);
      continue;
    }

    // Check if this line starts with option marker (1), a), -, =, Answer:, etc.)
    const isOptionStart = /^(\*)?([a-e]|\d+)\)\s+/i.test(trimmed) || /^-\s+/.test(trimmed) || /^(\*)?(True|False)$/i.test(trimmed) || /^=\s+/.test(trimmed) || /^Answer:\s*/i.test(trimmed);

    if (isOptionStart || joinedLines.length === 0) {
      joinedLines.push(line);
    } else {
      // This is a continuation line - join with previous (if not a feedback line)
      const lastIdx = joinedLines.length - 1;
      if (lastIdx >= 0 && joinedLines[lastIdx].trim() && !joinedLines[lastIdx].trim().startsWith('>')) {
        // Use newline between pipe-table rows to preserve table structure
        const isTableRow = /^\|.+\|$/.test(trimmed);
        const prevEndsWithTable = /\|$/.test(joinedLines[lastIdx].trimEnd());
        const isBlock = /^(`{3,}|~{3,}|\$\$)/.test(trimmed);
        const sep = isBlock ? '\n\n' : (isTableRow || prevEndsWithTable) ? '\n' : ' ';
        joinedLines[lastIdx] += sep + trimmed;
      } else {
        joinedLines.push(line);
      }
    }
  }

  for (let i = 0; i < joinedLines.length; i++) {
    const trimmed = joinedLines[i].trim();
    if (!trimmed) continue;

    // Check for feedback line (starts with >)
    if (trimmed.startsWith('>')) {
      const feedbackText = trimmed.replace(/^>\s*/, '').trim();

      // Check for general feedback marker: > [feedback] text
      if (feedbackText.match(/^\[feedback\]/i)) {
        generalFeedback = feedbackText.replace(/^\[feedback\]\s*/i, '').trim();
      } else if (generalFeedback !== undefined) {
        // Continue appending to general feedback (multi-line blockquote)
        generalFeedback += '\n' + feedbackText;
      } else if (lastOption) {
        // Attach to last option (append if already has inline feedback)
        if (lastOption.feedback) {
          lastOption.feedback += ' ' + feedbackText;
        } else {
          lastOption.feedback = feedbackText;
        }
      }
      continue;
    }

    // Match numbered options: 1) Answer, 2) Answer, or *1) Answer (correct)
    const numMatch = trimmed.match(/^(\*)?(\d+)\)\s+(.+)$/s);
    if (numMatch) {
      const hasAsteriskPrefix = !!numMatch[1];
      const [head, ...blocks] = numMatch[3].split('\n\n');
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(head);
      const isCorrect = hasAsteriskPrefix || hasCorrectMarker(textWithoutFeedback);
      const cleanText = [cleanCorrectMarkers(textWithoutFeedback), ...blocks].join('\n\n');
      lastOption = {
        id: String.fromCharCode(96 + parseInt(numMatch[2])),
        text: cleanText,
        isCorrect,
        feedback
      };
      options.push(lastOption);
      continue;
    }

    // Match lettered options: a) Answer, b) Answer, or *a) Answer (correct)
    const letterMatch = trimmed.match(/^(\*)?([a-e])\)\s+(.+)$/is);
    if (letterMatch) {
      const hasAsteriskPrefix = !!letterMatch[1];
      const [head, ...blocks] = letterMatch[3].split('\n\n');
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(head);
      const isCorrect = hasAsteriskPrefix || hasCorrectMarker(textWithoutFeedback) || textWithoutFeedback.startsWith('*');
      const cleanText = [cleanCorrectMarkers(textWithoutFeedback).replace(/^\*/, '').trim(), ...blocks].join('\n\n');
      lastOption = {
        id: letterMatch[2].toLowerCase(),
        text: cleanText,
        isCorrect,
        feedback
      };
      options.push(lastOption);
      continue;
    }

    // Match short answer lines: = Answer (each line is an acceptable answer)
    const equalsMatch = trimmed.match(/^=\s+(.+)$/);
    if (equalsMatch) {
      const text = equalsMatch[1].trim();
      lastOption = {
        id: `answer${options.length + 1}`,
        text,
        isCorrect: true
      };
      options.push(lastOption);
      continue;
    }

    // Match short answer lines: Answer: text (each line is an acceptable answer)
    const answerColonMatch = trimmed.match(/^Answer:\s*(.+)$/i);
    if (answerColonMatch) {
      const text = answerColonMatch[1].trim();
      lastOption = {
        id: `answer${options.length + 1}`,
        text,
        isCorrect: true
      };
      options.push(lastOption);
      continue;
    }

    // Match dash options: - Answer or - **Answer** (correct) (but not matching pairs)
    const dashMatch = trimmed.match(/^-\s+(.+)$/s);
    if (dashMatch && !trimmed.includes('::') && !trimmed.includes('=>')) {
      const text = dashMatch[1];
      const { cleanText: textWithoutFeedback, feedback } = extractInlineFeedback(text);
      const isCorrect = hasCorrectMarker(textWithoutFeedback);
      const cleanText = cleanCorrectMarkers(textWithoutFeedback);
      lastOption = {
        id: String.fromCharCode(97 + options.length),
        text: cleanText,
        isCorrect,
        feedback
      };
      options.push(lastOption);
      continue;
    }

    // Match standalone True/False options: *True, \[x\] True, True, False
    const tfMatch = trimmed.match(/^(?:\*|\\?\[x\\?\]\s*)?(True|False)$/i);
    if (tfMatch) {
      // Has leading asterisk or [x] marker
      const isCorrect = trimmed.match(/^(?:\*|\\?\[x\\?\])/i) !== null;
      const text = tfMatch[1];
      lastOption = {
        id: text.toLowerCase() === 'true' ? 'a' : 'b',
        text: text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
        isCorrect
      };
      options.push(lastOption);
      continue;
    }
  }

  return { options, generalFeedback };
}

/**
 * Extract blanks from stem text (format: [blank1], [blank2], etc.)
 * Also parses blank answers from lines (format: [blank1]: answer1, answer2)
 */
function parseBlanks(stem: string, lines: string[]): BlankAnswer[] {
  const blanks: BlankAnswer[] = [];

  // Find all [blankN] markers in stem
  const blankRegex = /\[blank(\d+)\]/gi;
  const blankIds = new Set<string>();
  let match;
  while ((match = blankRegex.exec(stem)) !== null) {
    blankIds.add(`blank${match[1]}`);
  }

  // Parse answers from lines: [blank1]: answer1, answer2
  for (const line of lines) {
    const trimmed = line.trim();
    const answerMatch = trimmed.match(/^\[blank(\d+)\]:\s*(.+)$/i);
    if (answerMatch) {
      const blankId = `blank${answerMatch[1]}`;
      const answers = answerMatch[2].split(',').map(a => a.trim()).filter(a => a);
      blanks.push({ blankId, answers });
    }
  }

  // For any blanks without explicit answers, add empty entry
  for (const blankId of blankIds) {
    if (!blanks.find(b => b.blankId === blankId)) {
      blanks.push({ blankId, answers: [] });
    }
  }

  return blanks.sort((a, b) => a.blankId.localeCompare(b.blankId));
}

/**
 * Parse full markdown content into structured quiz
 * Supports Quarto GFM output format
 */
export function parseMarkdown(content: string): ParsedQuiz {
  let title = 'Quiz';
  let canvas: CanvasSettings | undefined;
  let frontMatterLines = 0;

  // YAML front matter (Quarto's gfm+yaml_metadata_block writer emits the
  // document metadata here): title, canvas quiz settings, description
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontMatter) {
    const meta = parseYaml(frontMatter[1]) ?? {};
    if (typeof meta.title === 'string') title = meta.title;
    if (meta.canvas !== undefined && (typeof meta.canvas !== 'object' || meta.canvas === null || Array.isArray(meta.canvas))) {
      throw new Error('Front matter: canvas must be a mapping of quiz settings');
    }
    const unknownKeys = Object.keys(meta.canvas ?? {}).filter(k => !CANVAS_KEYS.has(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Front matter: unknown canvas setting(s): ${unknownKeys.join(', ')}`);
    }
    if (/[`*]/.test(title)) {
      throw new Error('Front matter: title must be plain text (no backticks or asterisks); it becomes an XML attribute');
    }
    const given = meta.canvas ?? {};
    const settings: CanvasSettings = { ...CANVAS_DEFAULTS, ...given };
    for (const [key, value] of Object.entries(given)) {
      const expected = CANVAS_VALUE_TYPES[key];
      const ok = value === null ? key === 'hide_results'
        : Array.isArray(expected) ? expected.includes(value as string)
        : typeof value === expected;
      if (!ok) {
        throw new Error(`Front matter: canvas.${key} must be ${Array.isArray(expected) ? 'one of ' + expected.join(', ') : 'a ' + expected}, got ${JSON.stringify(value)}`);
      }
    }
    // Canvas shows correct answers only when it also shows responses, so an
    // explicit show_correct_answers drops the hide_results default; a literal
    // null removes the element
    if (given.hide_results === null || (settings.show_correct_answers && given.hide_results === undefined)) {
      delete settings.hide_results;
    }
    if (settings.description === undefined && typeof meta.description === 'string') {
      settings.description = meta.description;
    }
    canvas = settings;
    frontMatterLines = frontMatter[0].split('\n').length - 1;
    content = content.slice(frontMatter[0].length);
  }

  const lines = content.split('\n');

  let defaultPoints = 1;
  const sections: Section[] = [];
  const questions: Question[] = [];
  
  let currentSection: Section | null = null;
  let currentQuestion: Partial<Question> | null = null;
  let currentQuestionLines: string[] = [];
  let currentQuestionLine: number = 0; // Track line number where question starts
  let questionCounter = 0;
  let inCoverPage = true; // Skip cover page content
  let inSolutionBlock = false; // Track when inside <div class="solution">...</div>
  let inFigureBlock = false; // Track when inside <div id="fig-...">...</div>
  let figureLines: string[] = []; // Collect figure content
  let pendingFigure: string | null = null; // Figure content to prepend to next question

  const finalizeQuestion = () => {
    if (!currentQuestion || !currentQuestion.stem) {
      currentQuestion = null;
      currentQuestionLines = [];
      return;
    }

    let type = currentQuestion.type || 'multiple_choice';
    let options: AnswerOption[] = [];
    let matchPairs: MatchPair[] | undefined;
    let blanks: BlankAnswer[] | undefined;
    let generalFeedback: string | undefined;

    // Handle matching questions
    if (type === 'matching') {
      matchPairs = parseMatchPairs(currentQuestionLines);
    }
    // Handle fill-in-multiple-blanks
    else if (type === 'fill_in_multiple_blanks') {
      blanks = parseBlanks(currentQuestion.stem || '', currentQuestionLines);
    }
    // Handle regular questions with potential feedback
    else {
      const parsed = parseOptionsWithFeedback(currentQuestionLines);
      options = parsed.options;
      generalFeedback = parsed.generalFeedback;

      // Auto-detect question type from options
      if (options.length > 0 && isTrueFalseQuestion(options)) {
        type = 'true_false';
      }

      // parse answer from stem if provided (e.g. -> True or → True)
      if (type === 'true_false' && options.length === 0) {
        const answerMatch = currentQuestion.stem?.match(/(?:→|->|Answer:|Ans:)\s*(True|False)/i);
        const correctAnswer = answerMatch ? answerMatch[1].toLowerCase() : null;

        options.push({ id: 'a', text: 'True', isCorrect: correctAnswer === 'true' });
        options.push({ id: 'b', text: 'False', isCorrect: correctAnswer === 'false' });

        if (answerMatch && currentQuestion.stem) {
          currentQuestion.stem = currentQuestion.stem.replace(answerMatch[0], '').trim();
        }
      }
      // If TF question has only one option (e.g., only "\[x\] True"), add the other option
      else if (type === 'true_false' && options.length === 1) {
        const existingOption = options[0];
        if (existingOption.text.toLowerCase() === 'true') {
          // Add False option
          options.push({ id: 'b', text: 'False', isCorrect: false });
        } else {
          // Add True option at the beginning
          options.unshift({ id: 'a', text: 'True', isCorrect: false });
          // Fix the existing option's id
          options[1].id = 'b';
        }
      }
      else if (options.length === 0) {
        if (type === 'multiple_choice') {
          type = 'short_answer';
        }

        if (type === 'short_answer' || type === 'fill_in_blank') {
          const answerMatch = currentQuestion.stem?.match(/(?:Answer:|Ans:)\s*(.+)$/i);
          if (answerMatch) {
            const answerText = answerMatch[1].trim();
            options.push({ id: 'answer1', text: answerText, isCorrect: true });
            if (currentQuestion.stem) {
              currentQuestion.stem = currentQuestion.stem.replace(answerMatch[0], '').trim();
            }
          }
        }
      }
    }

    // Clean the stem: remove any remaining type markers, points, and correct answer markers
    let cleanStem = currentQuestion.stem;
    // Remove type markers: \[MC\], \[TF\], etc.
    cleanStem = cleanStem.replace(/\\?\[(?:TF|MC|MA|Essay|Short|Match|FMB|Numeric|MultiAns|MultiAnswer|TrueFalse|True\/False|T\/F|MultiChoice|Multiple Choice|SelectAll|ShortAnswer|SA|FillBlank|FIB|LongAnswer|Matching|MAT|FillBlanks|MultiBlanks|FITB|Number|Numerical|Num)\\?\]/gi, '').trim();
    // Remove points markers: \[2pts\], \[2 points\], etc.
    cleanStem = cleanStem.replace(/\\?\[\d+\s*pts?\\?\]/gi, '').trim();
    // Remove standalone correct answer markers that may have leaked into stem: \[x\] True, etc.
    cleanStem = cleanStem.replace(/\\?\[x\\?\]\s*(True|False)?/gi, '').trim();

    const question: Question = {
      id: currentQuestion.id!,
      type,
      stem: cleanStem,
      options,
      points: currentQuestion.points || defaultPoints,
      section: currentSection?.id,
      images: extractImages(cleanStem),
      sourceLine: currentQuestionLine || undefined,
      matchPairs: matchPairs?.length ? matchPairs : undefined,
      blanks: blanks?.length ? blanks : undefined,
      generalFeedback,
    };

    questions.push(question);

    if (currentSection) {
      currentSection.questionIds.push(question.id);
    }

    currentQuestion = null;
    currentQuestionLines = [];
  };
  
  // Verbatim blocks (fenced code, multi-line $$ math) are collected line by line,
  // untrimmed, and appended to the stem as a unit so that lines inside them are
  // never mistaken for options, rules, or front matter
  let verbatimClose: RegExp | null = null;
  let verbatimLines: string[] = [];
  let indentedLines: string[] | null = null;
  let lastLineBlank = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (verbatimClose) {
      verbatimLines.push(line);
      if (verbatimClose.test(trimmed)) {
        verbatimClose = null;
        if (currentQuestionLines.length > 0) {
          // Belongs to the option being read (Quarto indents it inside the list item)
          const indents = verbatimLines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)![0].length);
          const indent = Math.min(...indents);
          currentQuestionLines.push(verbatimLines.map(l => l.slice(indent)).join('\n'));
        } else if (currentQuestion) {
          currentQuestion.stem += '\n\n' + verbatimLines.join('\n');
        }
        verbatimLines = [];
      }
      continue;
    }
    // Indented code (Quarto writes cell output this way): gather it, blank lines
    // included, and append it to the stem as a fence so it stays verbatim
    if (indentedLines !== null) {
      if (!trimmed || /^(?: {4}|\t)/.test(line)) {
        indentedLines.push(line);
        continue;
      }
      while (indentedLines.length > 0 && !indentedLines[indentedLines.length - 1].trim()) indentedLines.pop();
      const dedented = indentedLines.map(l => l.replace(/^(?: {4}|\t)/, ''));
      currentQuestion!.stem += '\n\n```\n' + dedented.join('\n') + '\n```';
      indentedLines = null;
    }
    if (currentQuestion && !inSolutionBlock && !inFigureBlock && currentQuestionLines.length === 0
        && trimmed && /^(?: {4}|\t)/.test(line) && lastLineBlank) {
      indentedLines = [line];
      continue;
    }
    lastLineBlank = !trimmed;

    if (currentQuestion && !inSolutionBlock && !inFigureBlock) {
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        verbatimClose = new RegExp(`^${fenceMatch[1]}\\s*$`);
        verbatimLines = [line];
        continue;
      }
      if (trimmed.startsWith('$$') && !trimmed.slice(2).includes('$$')) {
        verbatimClose = /\$\$/;
        verbatimLines = [line];
        continue;
      }
    }

    // Skip empty lines, horizontal rules, and HTML comments
    if (!trimmed || trimmed === '---' || trimmed.match(/^-{3,}$/) || trimmed.match(/^<!--.*-->$/)) {
      continue;
    }
    
    // Track solution blocks: <div class="proof solution"> ... </div>
    if (trimmed.includes('<div') && (trimmed.includes('solution') || trimmed.includes('proof'))) {
      inSolutionBlock = true;
      continue;
    }
    if (trimmed.includes('</div>') && inSolutionBlock) {
      inSolutionBlock = false;
      continue;
    }
    if (inSolutionBlock) {
      continue; // Skip all content inside solution blocks
    }

    // Track figure blocks: <div id="fig-..."> ... </div>
    if (trimmed.includes('<div') && trimmed.includes('id="fig-')) {
      inFigureBlock = true;
      figureLines = [trimmed]; // include the opening div tag
      continue;
    }
    if (trimmed.includes('</div>') && inFigureBlock) {
      inFigureBlock = false;
      const figContent = figureLines.join('\n');
      figureLines = [];
      if (currentQuestion) {
        // Figure is inside current question's body — append directly to stem
        currentQuestion.stem += '\n\n' + figContent;
      } else {
        // Figure appears before any question — pend it for the next one
        pendingFigure = figContent;
      }
      continue;
    }
    if (inFigureBlock) {
      figureLines.push(trimmed);
      continue;
    }

    // Skip callout blocks and other metadata (but NOT feedback lines starting with >)
    // Allow inline HTML with class= (like Quarto cross-references: <a href="#fig-..." class="quarto-xref">)
    // Only skip lines that are ONLY HTML div tags with class attributes
    if (trimmed.startsWith(':::') || (trimmed.startsWith('<div') && trimmed.includes('class='))) {
      continue;
    }

    // Feedback lines (> text) - collect for options if we're in a question
    if (trimmed.startsWith('>') && currentQuestion) {
      currentQuestionLines.push(trimmed);
      continue;
    }
    // Skip other blockquotes when not in a question
    if (trimmed.startsWith('>') && !currentQuestion) {
      continue;
    }

    // Quiz title: # Title (first h1)
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match && !h1Match[1].match(/^(?:Section:\s*)?(Multiple|True|Short|Essay|Multi)/i)) {
      // This is the quiz title, not a section
      if (title === 'Quiz') {
        title = h1Match[1];
      }
      continue;
    }
    
    // Section: # Multiple Choice (10 points) or # True/False (5 points)
    // Also supports: # Section: Multiple Choice
    if (h1Match && h1Match[1].match(/^(?:Section:\s*)?(Multiple|True|Short|Essay|Multi)/i)) {
      finalizeQuestion();
      inCoverPage = false; // We're past the cover page
      
      const sectionTitle = h1Match[1];
      currentSection = {
        id: slugify(sectionTitle),
        title: sectionTitle,
        questionIds: [],
      };
      sections.push(currentSection);
      continue;
    }
    
    // Question header: ## 1. Question Title [2 pts] (traditional)
    // OR: 1. Question Title [2 pts] (clean syntax - no ## header)
    const h2Match = trimmed.match(/^##\s+(\d+)\.\s+(.+)$/);
    const cleanMatch = !h2Match ? trimmed.match(/^(\d+)\.\s+(.+)$/) : null;

    // Only treat as clean syntax question if it has a type marker, points, or we're past cover page
    // This prevents matching random numbered lists
    const isCleanQuestion = cleanMatch && (
      inCoverPage === false || // Already past cover page
      /\[(?:TF|MC|MA|Essay|Short|Match|FMB|Numeric|MultiAns|TrueFalse|True\/False|SelectAll|ShortAnswer|Matching|FillBlanks)/i.test(cleanMatch[2]) ||
      /\[\d+\s*pts?\]/i.test(cleanMatch[2]) ||
      /\(\d+\s*pts?\)/i.test(cleanMatch[2])
    );

    const questionMatch = h2Match || (isCleanQuestion ? cleanMatch : null);

    if (questionMatch) {
      if (inCoverPage) inCoverPage = false; // Auto-start questions if we hit a question header
      finalizeQuestion();

      const questionNum = parseInt(questionMatch[1], 10);
      let rawTitle = questionMatch[2];

      // Extract inline type markers [TF], [Essay], [MultiAns] first
      const { type: markerType, cleanTitle: titleAfterMarker } = extractTypeMarker(rawTitle);

      // Then extract points
      const { points, cleanTitle } = extractPoints(titleAfterMarker);

      // Determine type from marker, title content, or section
      const type = markerType || parseQuestionType(cleanTitle, currentSection?.title);

      // Strip arrow markers from title (e.g., "Statement → True" becomes "Statement")
      // Handle both → (unicode) and -> (ascii)
      let stemText = cleanTitle;
      const arrowMatch = cleanTitle.match(/\s*(?:→|->)\s*(True|False)\s*$/i);
      if (arrowMatch) {
        stemText = cleanTitle.replace(arrowMatch[0], '').trim();
        // Append hidden answer marker for finalizeQuestion to pick up
        stemText += ` -> ${arrowMatch[1]}`;
      }

      questionCounter++;
      currentQuestionLine = frontMatterLines + i + 1; // 1-indexed line in the original file

      // Prepend any pending figure to the question stem
      if (pendingFigure) {
        stemText = pendingFigure + '\n\n' + stemText;
        pendingFigure = null; // Clear after use
      }

      currentQuestion = {
        id: questionNum || questionCounter,
        type,
        stem: stemText,
        points: points || defaultPoints,
      };
      continue;
    }
    
    // Sub-part header: ### Part A: Title [3 pts] - treat as separate question
    const h3Match = trimmed.match(/^###\s+Part\s+([A-D]):\s+(.+)$/i);
    if (h3Match && currentQuestion) {
      // Add as sub-question (treat parent as essay with sub-parts)
      // For QTI, we'll include this as part of the parent question's stem
      const { points, cleanTitle } = extractPoints(h3Match[2]);
      currentQuestion.stem += `\n\n**Part ${h3Match[1].toUpperCase()}:** ${cleanTitle}`;
      if (points) {
        // Sub-part has its own points - this is informational
      }
      continue;
    }
    
    // Option lines (numbered or lettered, optionally with leading asterisk for correct marker)
    if (currentQuestion && trimmed.match(/^\*?(\d+|[a-e])\)\s+/i)) {
      currentQuestionLines.push(trimmed);
      continue;
    }
    
    // Standalone True/False options (*True, \[x\] True, True, False)
    if (currentQuestion && trimmed.match(/^(?:\*|\\?\[x\\?\]\s*)?(True|False)$/i)) {
      currentQuestionLines.push(trimmed);
      continue;
    }
    
    // Dash list items as options (including matching pairs with ::)
    // But NOT negative numbers like "-0.678"
    if (currentQuestion && trimmed.startsWith('- ')) {
      currentQuestionLines.push(trimmed);
      continue;
    }

    // Short answer definitions: = answer (each line is an acceptable answer)
    if (currentQuestion && trimmed.match(/^=\s+/)) {
      currentQuestionLines.push(trimmed);
      continue;
    }

    // Short answer Answer: definitions (inline or Quarto GFM rendered form)
    // Must be caught before stem-continuation fallthrough
    if (currentQuestion && trimmed.match(/^Answer:\s*/i)) {
      currentQuestionLines.push(trimmed);
      continue;
    }

    // Blank answer definitions: [blank1]: answer1, answer2
    if (currentQuestion && trimmed.match(/^\[blank\d+\]:/i)) {
      currentQuestionLines.push(trimmed);
      continue;
    }

    // Question description/stem continuation (paragraph after ##)
    if (currentQuestion && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('[') && !trimmed.startsWith('>')) {
      // Escaped correct-answer markers from Quarto GFM line-wrapping: \[x\], \[correct\], \[✓\], \[✔\]
      // These look like LaTeX \[...\] but are escaped [x] markers — must be caught before LaTeX check
      const isEscapedCorrectMarker = /^\\\[(x|correct|✓|✔|checkmark)\\\]$/i.test(trimmed);
      // Skip LaTeX display math blocks (but not escaped correct-answer markers)
      if (!isEscapedCorrectMarker && (trimmed.startsWith('$$') || trimmed.startsWith('\\['))) {
        // Include LaTeX in stem
        currentQuestion.stem += '\n\n' + trimmed;
      } else if (!trimmed.match(/^\d+\)\s/) && !trimmed.match(/^[a-e]\)/i)) {
        // If we already have option lines, treat this as a continuation line for options
        // Otherwise, add to stem
        if (currentQuestionLines.length > 0) {
          currentQuestionLines.push(trimmed);
        } else {
          // Regular description text or image for stem
          // Use single newline between consecutive pipe-table rows to preserve table structure
          const isTableRow = /^\|.+\|$/.test(trimmed);
          const stemEndsWithTableRow = /\|$/.test((currentQuestion.stem ?? '').trimEnd());
          const separator = (isTableRow && stemEndsWithTableRow) ? '\n' : '\n\n';
          currentQuestion.stem += separator + trimmed;
        }
      }
    }
    

  }
  
  if (indentedLines !== null && currentQuestion) {
    while (indentedLines.length > 0 && !indentedLines[indentedLines.length - 1].trim()) indentedLines.pop();
    currentQuestion.stem += '\n\n```\n' + indentedLines.map(l => l.replace(/^(?: {4}|\t)/, '')).join('\n') + '\n```';
  }

  // Finalize last question
  finalizeQuestion();
  
  return { title, defaultPoints, sections, questions, canvas };
}
