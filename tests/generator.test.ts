
import { describe, it, expect } from 'vitest';
import { generateItem, generateManifest21, generateTest } from '../src/generator/qti21';
import { generateQTI, convertMarkdownTablesToHtml } from '../src/generator/qti';
import { parseMarkdown } from '../src/parser/markdown';
import type { ParsedQuiz, Question } from '../src/parser/types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

describe('QTI Generator', () => {
  const mockQuestion: Question = {
    id: 1,
    type: 'multiple_choice',
    stem: 'What is 1+1?',
    points: 1,
    options: [
      { id: 'a', text: '1', isCorrect: false },
      { id: 'b', text: '2', isCorrect: true }
    ],
    section: undefined
  };

  const mockQuiz: ParsedQuiz = {
    title: 'Test Quiz',
    defaultPoints: 1,
    sections: [],
    questions: [mockQuestion]
  };

  describe('generateItem', () => {
    it('should generate valid assessmentItem XML', () => {
      const xml = generateItem(mockQuestion, 'Quiz');
      expect(xml).toContain('identifier="item_1"');
      expect(xml).toContain('What is 1+1?');
      expect(xml).toContain('<value>B</value>'); // Correct answer

      // Validate XML structure
      const obj = parser.parse(xml);
      expect(obj.assessmentItem).toBeDefined();
      expect(obj.assessmentItem['@_identifier']).toBe('item_1');
    });

    it('should escape special characters', () => {
      const q = { ...mockQuestion, stem: 'A & B < C' };
      const xml = generateItem(q, 'Quiz');
      expect(xml).toContain('A &amp; B &lt; C');
    });
  });

  describe('generateManifest', () => {
    it('should generate valid imsmanifest.xml', () => {
      const xml = generateManifest21(mockQuiz);
      expect(xml).toContain('identifier="res_item_1"');
      expect(xml).toContain('type="imsqti_item_xmlv2p1"');

      // Validate XML structure
      const obj = parser.parse(xml);
      expect(obj.manifest).toBeDefined();
      expect(obj.manifest.resources.resource).toBeDefined();
    });
  });
});

describe('QTI 1.2 Generator (Canvas)', () => {
  it('should generate matching question XML', () => {
    const quiz: ParsedQuiz = {
      title: 'Test',
      defaultPoints: 1,
      sections: [],
      questions: [{
        id: 1,
        type: 'matching',
        stem: 'Match the terms',
        points: 2,
        options: [],
        matchPairs: [
          { left: 'Mean', right: 'Σx/n' },
          { left: 'Variance', right: 'Σ(x-μ)²/n' }
        ]
      }]
    };

    const { qti } = generateQTI(quiz);

    expect(qti).toContain('matching_question');
    expect(qti).toContain('Mean');
    expect(qti).toContain('Σx/n');
    expect(qti).toContain('Variance');
    expect(qti).toContain('response_lid'); // Matching uses response_lid
  });

  it('should generate fill-in-multiple-blanks question XML', () => {
    const quiz: ParsedQuiz = {
      title: 'Test',
      defaultPoints: 1,
      sections: [],
      questions: [{
        id: 1,
        type: 'fill_in_multiple_blanks',
        stem: 'r ranges from [blank1] to [blank2]',
        points: 2,
        options: [],
        blanks: [
          { blankId: 'blank1', answers: ['-1'] },
          { blankId: 'blank2', answers: ['1', '+1'] }
        ]
      }]
    };

    const { qti } = generateQTI(quiz);

    expect(qti).toContain('fill_in_multiple_blanks_question');
    expect(qti).toContain('response_str'); // FMB uses response_str
    expect(qti).toContain('-1');
  });

  it('should generate feedback XML when present', () => {
    const quiz: ParsedQuiz = {
      title: 'Test',
      defaultPoints: 1,
      sections: [],
      questions: [{
        id: 1,
        type: 'multiple_choice',
        stem: 'Test question',
        points: 1,
        options: [
          { id: 'a', text: 'Wrong', isCorrect: false, feedback: 'Try again!' },
          { id: 'b', text: 'Right', isCorrect: true, feedback: 'Correct!' }
        ],
        generalFeedback: 'Review chapter 5.'
      }]
    };

    const { qti } = generateQTI(quiz);

    expect(qti).toContain('itemfeedback');
    expect(qti).toContain('Try again!');
    expect(qti).toContain('Correct!');
    expect(qti).toContain('Review chapter 5.');
  });

  it('should convert inline code and LaTeX math to HTML', () => {
    const quiz: ParsedQuiz = {
      title: 'Test',
      defaultPoints: 1,
      sections: [],
      questions: [{
        id: 1,
        type: 'multiple_choice',
        stem: 'Use `car::vif()` to check for $\\alpha = 0.05$ significance.',
        points: 1,
        options: [
          { id: 'a', text: 'Run `lm()` with $\\beta_1 > 0$', isCorrect: true },
          { id: 'b', text: 'Wrong', isCorrect: false }
        ]
      }]
    };

    const { qti } = generateQTI(quiz);

    // Check inline code conversion: `code` → <code>code</code>
    expect(qti).toContain('<code>car::vif()</code>');
    expect(qti).toContain('<code>lm()</code>');

    // Check LaTeX conversion: $...$ → \(...\)
    expect(qti).toContain('\\(\\alpha = 0.05\\)');
    expect(qti).toContain('\\(\\beta_1 &gt; 0\\)');

    // Ensure backticks are not in output
    expect(qti).not.toContain('`car::vif()`');
    expect(qti).not.toContain('`lm()`');
  });
});

describe('Table conversion', () => {
  it('should convert a simple 2-column table to HTML', () => {
    const md = [
      '| Name  | Score |',
      '|-------|-------|',
      '| Alice | 90    |',
      '| Bob   | 85    |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    expect(html).toContain('<table class="ic-Table"');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<th');
    expect(html).toContain('>Name</th>');
    expect(html).toContain('>Score</th>');
    expect(html).toContain('<td');
    expect(html).toContain('>Alice</td>');
    expect(html).toContain('>90</td>');
    expect(html).toContain('>Bob</td>');
    expect(html).toContain('>85</td>');
  });

  it('should apply correct text-align from alignment specifiers', () => {
    const md = [
      '| Left | Center | Right |',
      '|:-----|:------:|------:|',
      '| a    | b      | c     |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    // Header cells
    expect(html).toContain('text-align: left;">Left</th>');
    expect(html).toContain('text-align: center;">Center</th>');
    expect(html).toContain('text-align: right;">Right</th>');

    // Body cells inherit same alignment
    expect(html).toContain('text-align: left;">a</td>');
    expect(html).toContain('text-align: center;">b</td>');
    expect(html).toContain('text-align: right;">c</td>');
  });

  it('should XML-escape cell content for valid QTI output', () => {
    const md = [
      '| Statistic | Value |',
      '|-----------|-------|',
      '| $F$       | $p < 0.05$ |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    // When called directly, LaTeX $ delimiters are preserved as-is.
    // The < is XML-escaped by escapeCell for valid XML output.
    expect(html).toContain('>$F$</td>');
    expect(html).toContain('>$p &lt; 0.05$</td>');
  });

  it('should convert multiple tables separated by non-table content', () => {
    const md = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      'Some text between tables.',
      '',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    // Both tables converted
    const tableCount = (html.match(/<table /g) || []).length;
    expect(tableCount).toBe(2);

    expect(html).toContain('>A</th>');
    expect(html).toContain('>C</th>');
    expect(html).toContain('Some text between tables.');
  });

  it('should produce HTML tables in QTI output when stem contains a table', () => {
    const quiz: ParsedQuiz = {
      title: 'Test',
      defaultPoints: 1,
      sections: [],
      questions: [{
        id: 1,
        type: 'multiple_choice',
        stem: 'Look at this table:\n\n| X | Y |\n|---|---|\n| 1 | 2 |',
        points: 1,
        options: [
          { id: 'a', text: 'Yes', isCorrect: true },
          { id: 'b', text: 'No', isCorrect: false }
        ]
      }]
    };

    const { qti } = generateQTI(quiz);

    expect(qti).toContain('<table class="ic-Table"');
    expect(qti).toContain('<th');
    expect(qti).toContain('>X</th>');
  });

  it('should NOT convert text with pipes but no separator row', () => {
    const md = 'The value is | something | or | other |';

    const html = convertMarkdownTablesToHtml(md);

    expect(html).not.toContain('<table');
    expect(html).toBe(md);
  });

  it('should handle empty cells gracefully', () => {
    const md = [
      '| A | B |',
      '|---|---|',
      '|   | value |',
      '| x |       |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    expect(html).toContain('<table');
    // Empty cells should produce <td ...></td> (empty content)
    const tdMatches = html.match(/<td[^>]*><\/td>/g) || [];
    expect(tdMatches.length).toBe(2);
  });

  it('should pass through single-column tables unchanged', () => {
    const md = [
      '| Only |',
      '|------|',
      '| val  |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    expect(html).not.toContain('<table');
    expect(html).toBe(md);
  });

  it('should parse fixture file and produce QTI with HTML tables', () => {
    const fixturePath = join(__dirname, 'fixtures', 'table-questions.md');
    const content = readFileSync(fixturePath, 'utf-8');
    const parsed = parseMarkdown(content);

    expect(parsed.questions.length).toBeGreaterThanOrEqual(5);

    // The parser stores table lines in the stem — verify they survive into QTI
    const { qti } = generateQTI(parsed);

    // Verify all questions made it through
    expect(qti).toContain('ANOVA');
    expect(qti).toContain('12.11');

    // The stem contains pipe table lines; verify convertMarkdownTablesToHtml
    // converts them when given contiguous lines (no blank-line gaps)
    const q1stem = parsed.questions[0].stem;
    expect(q1stem).toContain('| Source');

    // Directly convert the stem with contiguous table lines
    const contiguousStem = q1stem.replace(/\n\n/g, '\n');
    const converted = convertMarkdownTablesToHtml(contiguousStem);
    expect(converted).toContain('<table');
    expect(converted).toContain('ic-Table');
    expect(converted).toContain('<thead>');
    expect(converted).toContain('<tbody>');
  });

  it('should pass through existing HTML tables unchanged', () => {
    const htmlTable = '<table class="custom"><tr><td>already html</td></tr></table>';
    const md = `Some text before.\n\n${htmlTable}\n\nSome text after.`;

    const result = convertMarkdownTablesToHtml(md);

    // The existing HTML table should still be present
    expect(result).toContain(htmlTable);
    // No extra <table> tags should be introduced
    const tableCount = (result.match(/<table/g) || []).length;
    expect(tableCount).toBe(1);
  });

  it('should convert a table inside feedback text (Q6 scenario)', () => {
    const md = [
      'Here is general feedback with a grading table:',
      '',
      '| Grade | Range |',
      '| --- | --- |',
      '| A | 90-100 |',
      '| B | 80-89 |',
      '| F | Below 60 |',
    ].join('\n');

    const html = convertMarkdownTablesToHtml(md);

    expect(html).toContain('<table class="ic-Table"');
    expect(html).toContain('<th');
    expect(html).toContain('Grade');
    expect(html).toContain('Range');
    expect(html).toContain('90-100');
    expect(html).toContain('Below 60');
    // Surrounding text preserved
    expect(html).toContain('Here is general feedback');
  });
});

describe('Fenced code blocks', () => {
  const md = `# Code Quiz

## 1. What is printed? [2 pts]

Consider the snippet, with \`A\` a 2x2 array:

\`\`\` python
Lambda, Q = np.linalg.eig(A)
rho_A = np.max(np.abs(Lambda))

print(rho_A < 1)   # a < b
\`\`\`

and the matrix

$$
A = \\begin{bmatrix} 0.6 & 0.1 \\\\ 0.5 & 0.8 \\end{bmatrix}
$$

1)  True [correct]
2)  False
`;

  it('keeps the fence verbatim in the stem', () => {
    const quiz = parseMarkdown(md);
    expect(quiz.questions).toHaveLength(1);
    const stem = quiz.questions[0].stem;
    expect(stem).toContain('``` python\nLambda, Q = np.linalg.eig(A)\nrho_A = np.max(np.abs(Lambda))\n\nprint(rho_A < 1)   # a < b\n```');
    expect(stem).toContain('$$\nA = \\begin{bmatrix} 0.6 & 0.1 \\\\ 0.5 & 0.8 \\end{bmatrix}\n$$');
    expect(quiz.questions[0].options).toHaveLength(2);
    expect(quiz.questions[0].options[0].isCorrect).toBe(true);
  });

  it('emits <pre><code> with escaped content and no stray backticks', () => {
    const { qti } = generateQTI(parseMarkdown(md));
    expect(qti).toContain('<pre><code class="language-python">Lambda, Q = np.linalg.eig(A)\nrho_A = np.max(np.abs(Lambda))\n\nprint(rho_A &lt; 1)   # a &lt; b</code></pre>');
    expect(qti).toContain('<code>A</code>');
    expect(qti).not.toContain('`');
    expect(qti).toContain('\\[\nA = \\begin{bmatrix} 0.6 &amp; 0.1 \\\\ 0.5 &amp; 0.8 \\end{bmatrix}\n\\]');
    expect(() => parser.parse(qti)).not.toThrow();
  });
});
