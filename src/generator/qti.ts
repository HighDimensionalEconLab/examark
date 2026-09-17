/**
 * QTI XML Generator for Canvas
 * Generates QTI 1.2 format compatible with Canvas LMS import
 */

import type { ParsedQuiz, Question, AnswerOption, MatchPair, BlankAnswer } from '../parser/types.js';
import { createHash } from 'crypto';

/**
 * Generate a Canvas-style identifier (64-char hex hash)
 */
export function generateCanvasId(seed: string): string {
  // Use a deterministic hash based on the seed (unique content identifier)
  // We truncate to 32 chars to be safe, though QTI handles 64
  return createHash('sha256').update(seed).digest('hex').substring(0, 32);
}

/**
 * Optional image resolver function type
 * Takes an image path and returns a data URI or null if not resolvable
 */
export type ImageResolver = (imagePath: string) => string | null;

/**
 * Convert markdown pipe tables to HTML tables with inline styles for Canvas.
 * Handles GFM-style alignment specifiers (:---, :---:, ---:).
 * Preserves cell content as-is for downstream processing (LaTeX, code, etc.).
 */
export function convertMarkdownTablesToHtml(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if current line could be start of a table (pipe-delimited)
    if (/^\|(.+)\|$/.test(lines[i].trim())) {
      // Look ahead for separator row (must be next line for a valid table)
      const headerLine = lines[i].trim();
      if (i + 1 < lines.length && /^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|$/.test(lines[i + 1].trim())) {
        const separatorLine = lines[i + 1].trim();

        // Parse header cells
        const headerCells = headerLine.slice(1, -1).split('|').map(c => c.trim());
        const sepCells = separatorLine.slice(1, -1).split('|').map(c => c.trim());

        // Skip single-column tables (degenerate)
        if (headerCells.length < 2) {
          result.push(lines[i]);
          i++;
          continue;
        }

        // Parse alignment from separator
        const alignments: string[] = sepCells.map(cell => {
          const left = cell.startsWith(':');
          const right = cell.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          return 'left';
        });

        // Collect body rows
        const bodyRows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && /^\|(.+)\|$/.test(lines[j].trim())) {
          const rowCells = lines[j].trim().slice(1, -1).split('|').map(c => c.trim());
          bodyRows.push(rowCells);
          j++;
        }

        /**
         * Escape raw XML characters in cell content.
         * Only needed inside the table-building pipeline — LaTeX is already
         * protected as __LATEX_PLACEHOLDER__ tokens at this point, and the
         * outer escapeXmlPreserveLaTeX() won't run on table HTML (it's
         * behind a __TABLE_PLACEHOLDER__).
         */
        const escapeCell = (content: string): string => {
          return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        };

        // Build HTML table
        const cellStyle = (colIdx: number) => {
          const align = alignments[colIdx] || 'left';
          return `style="padding: 8px; border: 1px solid #ddd; text-align: ${align};"`;
        };

        let html = '<table class="ic-Table" style="border-collapse: collapse; border: 1px solid #ddd;">';
        html += '<thead><tr>';
        headerCells.forEach((cell, ci) => {
          html += `<th ${cellStyle(ci)}>${escapeCell(cell)}</th>`;
        });
        html += '</tr></thead>';

        html += '<tbody>';
        bodyRows.forEach(row => {
          html += '<tr>';
          headerCells.forEach((_, ci) => {
            const cellContent = ci < row.length ? row[ci] : '';
            html += `<td ${cellStyle(ci)}>${escapeCell(cellContent)}</td>`;
          });
          html += '</tr>';
        });
        html += '</tbody></table>';

        result.push(html);
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join('\n');
}

/**
 * Escape XML special characters while converting LaTeX delimiters for Canvas
 * Canvas expects \(...\) for inline and \[...\] for display math
 * Also converts markdown images to HTML img tags with optional base64 embedding
 */
function escapeXmlPreserveLaTeX(text: string, imageResolver?: ImageResolver): string {
  // Fenced code blocks first: their content is verbatim, so nothing below
  // (inline code, math, bold, tables) may touch it
  const fences: string[] = [];
  let result = text.replace(
    /^[ \t]*(`{3,}|~{3,})[ \t]*([\w+.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm,
    (match, fence, lang, code) => {
      const placeholder = `__FENCE_PLACEHOLDER_${fences.length}__`;
      const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const classAttr = lang ? ` class="language-${lang}"` : '';
      fences.push(`<pre><code${classAttr}>${escapedCode}</code></pre>`);
      return placeholder;
    }
  );

  // Extract and preserve markdown images as placeholders
  const images: string[] = [];
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const placeholder = `__IMG_PLACEHOLDER_${images.length}__`;
    // If we have an image resolver, try to get a data URI
    let imgSrc = src;
    if (imageResolver) {
      const resolved = imageResolver(src);
      if (resolved) {
        imgSrc = resolved;
      }
    }
    images.push(`<img src="${imgSrc}" alt="${alt}"/>`);
    return placeholder;
  });

  // Also process HTML img tags (from Quarto figure blocks)
  result = result.replace(/<img[\s\S]*?src=["']([^"']+)["'][\s\S]*?>/gi, (match, src) => {
    const placeholder = `__IMG_PLACEHOLDER_${images.length}__`;
    let imgSrc = src;
    if (imageResolver) {
      const resolved = imageResolver(src);
      if (resolved) {
        imgSrc = resolved;
      }
    }
    // Preserve other attributes from the original tag if needed, but for simplicity just use src
    images.push(`<img src="${imgSrc}" alt=""/>`);
    return placeholder;
  });

  // Drop Quarto figure div wrappers (<div id="fig-...">...</div>): they carry no
  // meaning in Canvas and would otherwise be escaped into visible text
  result = result.replace(/<div\b[^>]*\bid="fig-[^"]*"[^>]*>|<\/div>/g, '');

  // Strip Quarto cross-reference anchor tags (e.g., <a href="#fig-..." class="quarto-xref">Figure 1</a>)
  // Replace with just the link text since figures are already embedded
  result = result.replace(/<a\s+href=["']#[^"']*["']\s+class=["']quarto-xref["'][^>]*>(.*?)<\/a>/gi, '$1');

  // Extract and preserve inline code (backticks) as placeholders
  // The code content must be XML-escaped so <, >, & are valid in the QTI XML
  const codeSnippets: string[] = [];
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `__CODE_PLACEHOLDER_${codeSnippets.length}__`;
    // XML-escape code content to prevent invalid XML (e.g., `x < 5` → `<code>x &lt; 5</code>`)
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    codeSnippets.push(`<code>${escapedCode}</code>`);
    return placeholder;
  });

  // Extract LaTeX as placeholders BEFORE markdown formatting,
  // so that * inside $...$ (e.g., $z^*$) isn't treated as bold/italic
  const latexSnippets: string[] = [];
  // Display math first: $$...$$
  const escapeLatexForXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
    const placeholder = `__LATEX_PLACEHOLDER_${latexSnippets.length}__`;
    latexSnippets.push('\\[' + escapeLatexForXml(content) + '\\]');
    return placeholder;
  });
  // Inline math: $...$
  result = result.replace(/(?<!\\)\$([^\$\n]+?)\$/g, (match, content) => {
    const placeholder = `__LATEX_PLACEHOLDER_${latexSnippets.length}__`;
    latexSnippets.push('\\(' + escapeLatexForXml(content) + '\\)');
    return placeholder;
  });

  // Convert markdown formatting to HTML (bold, italic)
  result = result
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');

  // Convert markdown pipe tables to HTML tables
  result = convertMarkdownTablesToHtml(result);

  // Extract generated HTML formatting tags as placeholders (protect from XML escaping)
  const htmlTags: string[] = [];
  result = result.replace(/<(strong|em)>([\s\S]*?)<\/\1>/g, (match) => {
    const placeholder = `__HTML_PLACEHOLDER_${htmlTags.length}__`;
    htmlTags.push(match);
    return placeholder;
  });

  // Extract generated HTML tables as placeholders (protect from XML escaping)
  const tables: string[] = [];
  result = result.replace(/<table[\s\S]*?<\/table>/g, (match) => {
    const placeholder = `__TABLE_PLACEHOLDER_${tables.length}__`;
    tables.push(match);
    return placeholder;
  });

  // Remove Quarto's backslash escapes for < and > (e.g., \< and \>)
  // These should become HTML entities, not literal backslash + entity
  result = result
    .replace(/\\</g, '<')
    .replace(/\\>/g, '>');

  // Escape XML special characters
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Restore in reverse extraction order: outer containers first, inner content last.
  // Tables may contain LaTeX/HTML/code placeholders, so restore tables first.
  tables.forEach((table, i) => {
    result = result.replace(`__TABLE_PLACEHOLDER_${i}__`, table);
  });

  htmlTags.forEach((tag, i) => {
    result = result.replace(`__HTML_PLACEHOLDER_${i}__`, tag);
  });

  latexSnippets.forEach((latex, i) => {
    result = result.replace(`__LATEX_PLACEHOLDER_${i}__`, latex);
  });

  images.forEach((img, i) => {
    result = result.replace(`__IMG_PLACEHOLDER_${i}__`, img);
  });

  codeSnippets.forEach((code, i) => {
    result = result.replace(`__CODE_PLACEHOLDER_${i}__`, code);
  });

  fences.forEach((fence, i) => {
    result = result.replace(`__FENCE_PLACEHOLDER_${i}__`, fence);
  });

  return result;
}

/**
 * Map internal question type to Canvas QTI type
 */
function getCanvasQuestionType(type: string): string {
  const typeMap: Record<string, string> = {
    'multiple_choice': 'multiple_choice_question',
    'multiple_answers': 'multiple_answers_question',
    'true_false': 'true_false_question',
    'essay': 'essay_question',
    'short_answer': 'short_answer_question',
    'fill_in_blank': 'fill_in_blank_question',
    'fill_in_multiple_blanks': 'fill_in_multiple_blanks_question',
    'matching': 'matching_question',
    'numerical': 'numerical_question',
    'calculated': 'calculated_question',
  };
  return typeMap[type] || 'multiple_choice_question';
}

/**
 * Generate answer options with Canvas-style identifiers
 */
interface GeneratedOption {
  ident: string;
  option: AnswerOption;
}

function generateOptionsWithIds(options: AnswerOption[], questionSeed: string): GeneratedOption[] {
  return options.map((opt, index) => ({
    ident: generateCanvasId(`${questionSeed}_opt_${index}_${opt.text}`),
    option: opt,
  }));
}

/**
 * Generate answer options XML
 */
function generateOptionsXml(generatedOptions: GeneratedOption[]): string {
  return generatedOptions.map(({ ident, option }) =>
    `<response_label ident="${ident}">` +
    `<material>` +
    `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(option.text)}</mattext>` +
    `</material>` +
    `</response_label>`
  ).join('');
}

/**
 * Generate matching question presentation XML
 * Canvas matching uses response_lid with render_choice for each left item
 */
function generateMatchingPresentation(stem: string, matchPairs: MatchPair[], questionSeed: string, imageResolver?: ImageResolver): {
  xml: string;
  matchData: { leftId: string; rightId: string; leftText: string; rightText: string }[];
} {
  const matchData: { leftId: string; rightId: string; leftText: string; rightText: string }[] = [];

  // Generate unique IDs for right-side items (distractors)
  const rightItems = matchPairs.map((pair, i) => ({
    id: generateCanvasId(`${questionSeed}_right_${i}_${pair.right}`),
    text: pair.right
  }));

  // Generate response elements for each left item
  let responsesXml = '';
  matchPairs.forEach((pair, i) => {
    const leftId = generateCanvasId(`${questionSeed}_left_${i}_${pair.left}`);
    const rightItem = rightItems[i];

    matchData.push({
      leftId,
      rightId: rightItem.id,
      leftText: pair.left,
      rightText: pair.right
    });

    // Each left item has its own response_lid with all right items as choices
    responsesXml += `<response_lid ident="${leftId}">` +
      `<material><mattext texttype="text/html">${escapeXmlPreserveLaTeX(pair.left)}</mattext></material>` +
      `<render_choice>` +
      rightItems.map(r =>
        `<response_label ident="${r.id}">` +
        `<material><mattext texttype="text/html">${escapeXmlPreserveLaTeX(r.text)}</mattext></material>` +
        `</response_label>`
      ).join('') +
      `</render_choice>` +
      `</response_lid>`;
  });

  const xml = `<material>` +
    `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(stem, imageResolver)}</mattext>` +
    `</material>` +
    responsesXml;

  return { xml, matchData };
}

/**
 * Generate fill-in-multiple-blanks presentation XML
 */
function generateFMBPresentation(stem: string, blanks: BlankAnswer[], questionSeed: string, imageResolver?: ImageResolver): {
  xml: string;
  blankData: { blankId: string; responseId: string; answers: string[] }[];
} {
  const blankData: { blankId: string; responseId: string; answers: string[] }[] = [];

  // Generate response elements for each blank
  let responsesXml = '';
  blanks.forEach((blank, i) => {
    const responseId = generateCanvasId(`${questionSeed}_${blank.blankId}`);
    blankData.push({
      blankId: blank.blankId,
      responseId,
      answers: blank.answers
    });

    responsesXml += `<response_str ident="${responseId}" rcardinality="Single">` +
      `<render_fib><response_label ident="${blank.blankId}"/></render_fib>` +
      `</response_str>`;
  });

  const xml = `<material>` +
    `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(stem, imageResolver)}</mattext>` +
    `</material>` +
    responsesXml;

  return { xml, blankData };
}

/**
 * Generate feedback XML for options and general feedback
 */
function generateFeedbackXml(question: Question, generatedOptions: GeneratedOption[]): string {
  let feedbackXml = '';

  // Per-option feedback
  generatedOptions.forEach(({ ident, option }) => {
    if (option.feedback) {
      feedbackXml += `<itemfeedback ident="${ident}_fb">` +
        `<flow_mat><material>` +
        `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(option.feedback)}</mattext>` +
        `</material></flow_mat>` +
        `</itemfeedback>`;
    }
  });

  // General feedback
  if (question.generalFeedback) {
    feedbackXml += `<itemfeedback ident="general_fb">` +
      `<flow_mat><material>` +
      `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(question.generalFeedback)}</mattext>` +
      `</material></flow_mat>` +
      `</itemfeedback>`;
  }

  return feedbackXml;
}

/**
 * Generate response processing XML for correct answer
 * Canvas uses score of 100 for correct answers (percentage-based)
 */
function generateResprocessing(
  question: Question,
  generatedOptions: GeneratedOption[],
  matchData?: { leftId: string; rightId: string }[],
  blankData?: { blankId: string; responseId: string; answers: string[] }[]
): string {
  // Essay and Numerical (if manual) have no auto-grading
  if (question.type === 'essay' || question.type === 'numerical') {
    return `<resprocessing>` +
      `<outcomes>` +
      `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
      `</outcomes>` +
      `</resprocessing>`;
  }

  // Matching questions: each left-right pair must match
  if (question.type === 'matching' && matchData && matchData.length > 0) {
    const varequals = matchData.map(m =>
      `<varequal respident="${m.leftId}">${m.rightId}</varequal>`
    ).join('');

    return `<resprocessing>` +
      `<outcomes>` +
      `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
      `</outcomes>` +
      `<respcondition continue="No">` +
      `<conditionvar>` +
      `<and>${varequals}</and>` +
      `</conditionvar>` +
      `<setvar actoin="Set" varname="SCORE">100</setvar>` +
      `</respcondition>` +
      `</resprocessing>`;
  }

  // Fill-in-multiple-blanks: check each blank
  if (question.type === 'fill_in_multiple_blanks' && blankData && blankData.length > 0) {
    const conditions = blankData.map(b => {
      if (b.answers.length === 0) return '';
      // Use OR for multiple acceptable answers per blank
      if (b.answers.length === 1) {
        return `<varequal respident="${b.responseId}">${escapeXmlPreserveLaTeX(b.answers[0])}</varequal>`;
      }
      const orConditions = b.answers.map(a =>
        `<varequal respident="${b.responseId}">${escapeXmlPreserveLaTeX(a)}</varequal>`
      ).join('');
      return `<or>${orConditions}</or>`;
    }).filter(c => c).join('');

    if (!conditions) {
      return `<resprocessing>` +
        `<outcomes>` +
        `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
        `</outcomes>` +
        `</resprocessing>`;
    }

    return `<resprocessing>` +
      `<outcomes>` +
      `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
      `</outcomes>` +
      `<respcondition continue="No">` +
      `<conditionvar>` +
      `<and>${conditions}</and>` +
      `</conditionvar>` +
      `<setvar actoin="Set" varname="SCORE">100</setvar>` +
      `</respcondition>` +
      `</resprocessing>`;
  }

  // Short Answer / Fill in Blank: Check against TEXT value
  // Multiple acceptable answers use multiple varequal in one conditionvar (OR logic)
  if (question.type === 'short_answer' || question.type === 'fill_in_blank') {
    const correctOptions = generatedOptions.filter(go => go.option.isCorrect);

    if (correctOptions.length === 0) {
      return `<resprocessing>` +
        `<outcomes>` +
        `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
        `</outcomes>` +
        `</resprocessing>`;
    }

    const varequals = correctOptions.map(co =>
      `<varequal respident="response1">${escapeXmlPreserveLaTeX(co.option.text)}</varequal>`
    ).join('');

    return `<resprocessing>` +
      `<outcomes>` +
      `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
      `</outcomes>` +
      `<respcondition continue="No">` +
      `<conditionvar>` +
      varequals +
      `</conditionvar>` +
      `<setvar actoin="Set" varname="SCORE">100</setvar>` +
      `</respcondition>` +
      `</resprocessing>`;
  }

  const correctOptions = generatedOptions.filter(go => go.option.isCorrect);
  if (correctOptions.length === 0) return '';

  // For multiple_answers questions: correct options must be selected AND incorrect must NOT be selected
  if (question.type === 'multiple_answers' && correctOptions.length > 0) {
    const incorrectOptions = generatedOptions.filter(go => !go.option.isCorrect);

    const correctVarequals = correctOptions.map(co =>
      `<varequal respident="response1">${co.ident}</varequal>`
    ).join('');

    const incorrectNotVarequals = incorrectOptions.map(io =>
      `<not><varequal respident="response1">${io.ident}</varequal></not>`
    ).join('');

    return `<resprocessing>` +
      `<outcomes>` +
      `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
      `</outcomes>` +
      `<respcondition continue="No">` +
      `<conditionvar>` +
      `<and>${correctVarequals}${incorrectNotVarequals}</and>` +
      `</conditionvar>` +
      `<setvar actoin="Set" varname="SCORE">100</setvar>` +
      `</respcondition>` +
      `</resprocessing>`;
  }

  // Single correct answer (standard multiple choice, true/false)
  const correctOption = correctOptions[0];

  return `<resprocessing>` +
    `<outcomes>` +
    `<decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>` +
    `</outcomes>` +
    `<respcondition continue="No">` +
    `<conditionvar>` +
    `<varequal respident="response1">${correctOption.ident}</varequal>` +
    `</conditionvar>` +
    `<setvar actoin="Set" varname="SCORE">100</setvar>` +
    `</respcondition>` +
    `</resprocessing>`;
}

/**
 * Generate question metadata including Canvas-specific fields
 */
function generateItemMetadata(
  question: Question, 
  qType: string, 
  generatedOptions: GeneratedOption[],
  questionRef: string
): string {
  const originalAnswerIds = generatedOptions.map(go => go.ident).join(',');
  
  let metadata = `<itemmetadata>` +
    `<qtimetadata>` +
    `<qtimetadatafield>` +
    `<fieldlabel>question_type</fieldlabel>` +
    `<fieldentry>${qType}</fieldentry>` +
    `</qtimetadatafield>` +
    `<qtimetadatafield>` +
    `<fieldlabel>points_possible</fieldlabel>` +
    `<fieldentry>${question.points}</fieldentry>` +
    `</qtimetadatafield>`;
  
  // Add original_answer_ids for questions with options
  if (generatedOptions.length > 0) {
    metadata += `<qtimetadatafield>` +
      `<fieldlabel>original_answer_ids</fieldlabel>` +
      `<fieldentry>${originalAnswerIds}</fieldentry>` +
      `</qtimetadatafield>`;
  }
  
  // Add assessment question reference
  metadata += `<qtimetadatafield>` +
    `<fieldlabel>assessment_question_identifierref</fieldlabel>` +
    `<fieldentry>${questionRef}</fieldentry>` +
    `</qtimetadatafield>`;
  
  metadata += `</qtimetadata></itemmetadata>`;
  
  return metadata;
}

/**
 * Generate a single question item XML
 */
function generateQuestionXml(question: Question, imageResolver?: ImageResolver): string {
  const qType = getCanvasQuestionType(question.type);
  const questionSeed = `q_${question.id}_${question.stem.substring(0, 50)}`;
  const itemIdent = generateCanvasId(questionSeed);
  const questionRef = generateCanvasId(`ref_${questionSeed}`);

  // Generate options with Canvas-style identifiers
  const generatedOptions = generateOptionsWithIds(question.options, questionSeed);

  let presentationContent: string;
  let matchData: { leftId: string; rightId: string }[] | undefined;
  let blankData: { blankId: string; responseId: string; answers: string[] }[] | undefined;

  if (question.type === 'matching' && question.matchPairs) {
    // Matching question
    const result = generateMatchingPresentation(question.stem, question.matchPairs, questionSeed, imageResolver);
    presentationContent = result.xml;
    matchData = result.matchData;
  } else if (question.type === 'fill_in_multiple_blanks' && question.blanks) {
    // Fill-in-multiple-blanks question
    const result = generateFMBPresentation(question.stem, question.blanks, questionSeed, imageResolver);
    presentationContent = result.xml;
    blankData = result.blankData;
  } else if (question.type === 'essay' || question.type === 'short_answer') {
    // Essay/Short answer
    presentationContent = `<material>` +
      `<mattext texttype="text/html">${escapeXmlPreserveLaTeX(question.stem, imageResolver)}</mattext>` +
      `</material>` +
      `<response_str ident="response1" rcardinality="Single">` +
      `<render_fib>` +
      `<response_label ident="answer1"/>` +
      `</render_fib>` +
      `</response_str>`;
  } else {
    // Multiple choice, multiple answers, true/false
    const cardinality = question.type === 'multiple_answers' ? 'Multiple' : 'Single';
    const escapedStem = escapeXmlPreserveLaTeX(question.stem, imageResolver);
    presentationContent = `<material>` +
      `<mattext texttype="text/html">${escapedStem}</mattext>` +
      `</material>` +
      `<response_lid ident="response1" rcardinality="${cardinality}">` +
      `<render_choice>` +
      `${generateOptionsXml(generatedOptions)}` +
      `</render_choice>` +
      `</response_lid>`;
  }

  // Generate feedback if present
  const feedbackXml = generateFeedbackXml(question, generatedOptions);

  return `<item ident="${itemIdent}" title="Question">` +
    `${generateItemMetadata(question, qType, generatedOptions, questionRef)}` +
    `<presentation>${presentationContent}</presentation>` +
    `${generateResprocessing(question, generatedOptions, matchData, blankData)}` +
    `${feedbackXml}` +
    `</item>`;
}

/**
 * Generate complete QTI XML from parsed quiz
 * Output is compact (single line) to match Canvas export format
 * Returns both the QTI XML and the assessment identifier for manifest linking
 */
export function generateQTI(quiz: ParsedQuiz, imageResolver?: ImageResolver): { qti: string; assessmentIdent: string } {
  const assessmentIdent = generateCanvasId(`assessment_${quiz.title}`);
  
  // Generate all questions - include every question regardless of section assignment
  // Canvas puts all questions in a single root_section anyway
  const allQuestionsXml = quiz.questions.map(q => generateQuestionXml(q, imageResolver)).join('');

  // Assessment-level metadata Canvas's QTI 1.2 importer reads directly
  // (assessment_meta.xml carries the full settings; these are the fallback)
  const canvas = quiz.canvas ?? {};
  const attempts = canvas.allowed_attempts ?? 1;
  const metadataField = (label: string, entry: string) =>
    `<qtimetadatafield><fieldlabel>${label}</fieldlabel><fieldentry>${entry}</fieldentry></qtimetadatafield>`;
  let assessmentMetadata = metadataField('cc_maxattempts', attempts === -1 ? 'unlimited' : String(attempts));
  if (canvas.time_limit) {
    assessmentMetadata += metadataField('qmd_timelimit', String(canvas.time_limit));
  }

  // Build the complete QTI document (compact format like Canvas)
  const qti = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">` +
    `<assessment ident="${assessmentIdent}" title="${escapeXmlPreserveLaTeX(quiz.title)}">` +
    `<qtimetadata>${assessmentMetadata}</qtimetadata>` +
    `<section ident="root_section">` +
    `${allQuestionsXml}` +
    `</section>` +
    `</assessment>` +
    `</questestinterop>`;

  return { qti, assessmentIdent };
}

/**
 * Generate Canvas's assessment_meta.xml (quiz settings) from the front matter.
 * Canvas reads it on import when the manifest lists it as a
 * learning-application-resource at <assessment ident>/assessment_meta.xml.
 */
export function generateAssessmentMeta(quiz: ParsedQuiz, assessmentIdent: string): string {
  const canvas = quiz.canvas ?? {};
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pointsPossible = quiz.questions.reduce((sum, q) => sum + q.points, 0);

  const fields: string[] = [`<title>${escape(quiz.title)}</title>`];
  if (canvas.description !== undefined) fields.push(`<description>${escape(canvas.description)}</description>`);
  if (canvas.shuffle_answers !== undefined) fields.push(`<shuffle_answers>${canvas.shuffle_answers}</shuffle_answers>`);
  if (canvas.scoring_policy !== undefined) fields.push(`<scoring_policy>${canvas.scoring_policy}</scoring_policy>`);
  if (canvas.quiz_type !== undefined) fields.push(`<quiz_type>${canvas.quiz_type}</quiz_type>`);
  fields.push(`<points_possible>${pointsPossible}</points_possible>`);
  if (canvas.show_correct_answers !== undefined) fields.push(`<show_correct_answers>${canvas.show_correct_answers}</show_correct_answers>`);
  if (canvas.allowed_attempts !== undefined) fields.push(`<allowed_attempts>${canvas.allowed_attempts}</allowed_attempts>`);
  if (canvas.time_limit !== undefined) fields.push(`<time_limit>${canvas.time_limit}</time_limit>`);
  if (canvas.one_question_at_a_time !== undefined) fields.push(`<one_question_at_a_time>${canvas.one_question_at_a_time}</one_question_at_a_time>`);
  if (canvas.cant_go_back !== undefined) fields.push(`<cant_go_back>${canvas.cant_go_back}</cant_go_back>`);
  if (canvas.access_code !== undefined) fields.push(`<access_code>${escape(canvas.access_code)}</access_code>`);
  if (canvas.require_lockdown_browser !== undefined) fields.push(`<require_lockdown_browser>${canvas.require_lockdown_browser}</require_lockdown_browser>`);
  if (canvas.require_lockdown_browser_for_results !== undefined) fields.push(`<require_lockdown_browser_for_results>${canvas.require_lockdown_browser_for_results}</require_lockdown_browser_for_results>`);
  if (canvas.require_lockdown_browser_monitor !== undefined) fields.push(`<require_lockdown_browser_monitor>${canvas.require_lockdown_browser_monitor}</require_lockdown_browser_monitor>`);
  if (canvas.unlock_at !== undefined) fields.push(`<unlock_at>${escape(String(canvas.unlock_at))}</unlock_at>`);
  if (canvas.due_at !== undefined) fields.push(`<due_at>${escape(String(canvas.due_at))}</due_at>`);
  if (canvas.lock_at !== undefined) fields.push(`<lock_at>${escape(String(canvas.lock_at))}</lock_at>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${assessmentIdent}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  ${fields.join('\n  ')}
</quiz>
`;
}
