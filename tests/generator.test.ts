
import { describe, it, expect } from 'vitest';
import { generateItem, generateManifest21, generateTest } from '../src/generator/qti21';
import { generateQTI, generateAssessmentMeta, convertMarkdownTablesToHtml } from '../src/generator/qti';
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

describe('Canvas quiz settings from front matter', () => {
  const md = `---
title: Practice Quiz 1
description: Covers eigenvalues and least squares.
canvas:
  quiz_type: practice_quiz
  time_limit: 30
  allowed_attempts: -1
  scoring_policy: keep_highest
  shuffle_answers: true
  show_correct_answers: true
  require_lockdown_browser: true
  unlock_at: 2026-09-25T09:00:00-07:00
  due_at: 2026-10-02T23:59:00-07:00
---

## 1. Two plus two [3 pts]

a) 3
b) 4 [correct]
`;

  it('reads title and canvas settings and strips the front matter', () => {
    const quiz = parseMarkdown(md);
    expect(quiz.title).toBe('Practice Quiz 1');
    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0].stem).toBe('Two plus two');
    expect(quiz.canvas).toMatchObject({
      quiz_type: 'practice_quiz',
      time_limit: 30,
      allowed_attempts: -1,
      require_lockdown_browser: true,
      unlock_at: '2026-09-25T09:00:00-07:00',
      description: 'Covers eigenvalues and least squares.',
    });
  });

  it('emits assessment_meta.xml fields and qtimetadata fallbacks', () => {
    const quiz = parseMarkdown(md);
    const { qti, assessmentIdent } = generateQTI(quiz);
    expect(qti).toContain('<fieldlabel>cc_maxattempts</fieldlabel><fieldentry>unlimited</fieldentry>');
    expect(qti).toContain('<fieldlabel>qmd_timelimit</fieldlabel><fieldentry>30</fieldentry>');

    const meta = generateAssessmentMeta(quiz, assessmentIdent);
    const json = parser.parse(meta);
    expect(json.quiz['@_identifier']).toBe(assessmentIdent);
    expect(json.quiz.title).toBe('Practice Quiz 1');
    expect(json.quiz.quiz_type).toBe('practice_quiz');
    expect(json.quiz.time_limit).toBe(30);
    expect(json.quiz.allowed_attempts).toBe(-1);
    expect(json.quiz.scoring_policy).toBe('keep_highest');
    expect(json.quiz.shuffle_answers).toBe(true);
    expect(json.quiz.require_lockdown_browser).toBe(true);
    expect(json.quiz.unlock_at).toBe('2026-09-25T09:00:00-07:00');
    expect(json.quiz.due_at).toBe('2026-10-02T23:59:00-07:00');
    expect(json.quiz.points_possible).toBe(3);
    expect(json.quiz.description).toBe('Covers eigenvalues and least squares.');
    expect(json.quiz.lock_at).toBeUndefined();
  });

  it('keeps upstream defaults without a canvas block', () => {
    const quiz = parseMarkdown('# Plain Quiz\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(quiz.canvas).toBeUndefined();
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<fieldlabel>cc_maxattempts</fieldlabel><fieldentry>1</fieldentry>');
    expect(qti).not.toContain('qmd_timelimit');
  });
});

describe('Quarto figure blocks', () => {
  it('emits the image and caption without the div wrapper', () => {
    const quiz = parseMarkdown(`# Q

## 1. Which curve grows? [2 pts]

<div id="fig-norms">

<img src="q_files/figure-gfm/fig-norms-output-1.png"
id="fig-norms" />

Figure 1: Norms of the iterates.

</div>

a) I
b) II [correct]
`);
    expect(quiz.questions[0].stem).toContain('<div id="fig-norms">');
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<img src="q_files/figure-gfm/fig-norms-output-1.png" alt=""/>');
    expect(qti).toContain('Figure 1: Norms of the iterates.');
    expect(qti).not.toContain('&lt;div');
    expect(qti).not.toContain('&lt;/div');
  });
});

describe('Placeholder restoration', () => {
  it('does not interpret $-patterns in restored code, math, or fences', () => {
    const quiz = parseMarkdown(`# Q

## 1. Shell [1 pts]

Inline \`echo $1 $& $'\` and math $x = \\$1$ then

\`\`\`bash
echo "pid=$$"
sed -E "s/x/$&/"
\`\`\`

a) yes [correct]
b) no
`);
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<code>echo $1 $&amp; $\'</code>');
    expect(qti).toContain('echo "pid=$$"\nsed -E "s/x/$&amp;/"');
    expect(qti).not.toContain('PLACEHOLDER');
  });
});

describe('Figure div removal', () => {
  it('keeps a literal </div> in code and pairs figure closings with openings', () => {
    const quiz = parseMarkdown(`# Q

## 1. What does \`</div>\` close? [1 pts]

<div id="fig-a" class="quarto-figure">

<img src="a.png" />

Figure 1: A.

</div>

a) a block [correct]
b) an inline \`</div>\` tag
`);
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<code>&lt;/div&gt;</code>');
    expect(qti).toContain('<img src="a.png" alt=""/>');
    expect(qti).toContain('Figure 1: A.');
    expect(qti).not.toContain('&lt;div');
    expect(qti).not.toContain('&lt;/div&gt;\n');
  });
});

describe('Stem paragraphs', () => {
  it('wraps title, text, image, and caption in their own <p>, leaves fences bare', () => {
    const quiz = parseMarkdown(`# Q

## 1. Spectral radius from a plot [2 pts]

The figure shows the norms.

\`\`\`python
print(1)
\`\`\`

<div id="fig-norms">

<img src="a.png"
id="fig-norms" />

Figure 1: Norms.

</div>

Which matrix grows?

a) I
b) II [correct]
`);
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<p>Spectral radius from a plot</p>\n<p>The figure shows the norms.</p>\n<pre><code class="language-python">print(1)</code></pre>\n<p><img src="a.png" alt=""/></p>\n<p>Figure 1: Norms.</p>\n<p>Which matrix grows?</p>');
    expect(qti).toContain('<mattext texttype="text/html">I</mattext>');
    expect(qti).toContain('<mattext texttype="text/html">II</mattext>');
  });

  it('does not wrap short-answer match strings', () => {
    const quiz = parseMarkdown('# Q\n\n## 1. [Short] Capital of France [1 pts]\n\nAnswer: Paris\n');
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<varequal respident="response1">Paris</varequal>');
    expect(qti).toContain('<p>Capital of France</p>');
  });
});

describe('Indented cell output', () => {
  it('keeps Quarto printed output as a code block, including lines starting with [', () => {
    const quiz = parseMarkdown(`# Q

## 1. Moduli [2 pts]

The cell prints the moduli.

\`\`\` python
print(np.round(np.abs(Lambda), 3))
\`\`\`

    [0.455 0.945]
    second line

The plot follows.

![](q_files/figure-commonmark/cell-7-output-1.png)

Which one?

1)  first [correct]
2)  second
    continued option text
`);
    const stem = quiz.questions[0].stem;
    expect(stem).toContain('```\n[0.455 0.945]\nsecond line\n```');
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('<pre><code class="language-python">print(np.round(np.abs(Lambda), 3))</code></pre>\n<pre><code>[0.455 0.945]\nsecond line</code></pre>\n<p>The plot follows.</p>');
    expect(quiz.questions[0].options).toHaveLength(2);
    expect(quiz.questions[0].options[1].text).toBe('second continued option text');
  });
});

describe('Canvas defaults', () => {
  it('fills absent keys with the exam defaults and keeps explicit values', () => {
    const quiz = parseMarkdown('---\ntitle: T\ncanvas:\n  time_limit: 90\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    const { assessmentIdent, qti } = generateQTI(quiz);
    const json = parser.parse(generateAssessmentMeta(quiz, assessmentIdent));
    expect(json.quiz.quiz_type).toBe('assignment');
    expect(json.quiz.time_limit).toBe(90);
    expect(json.quiz.allowed_attempts).toBe(1);
    expect(json.quiz.shuffle_answers).toBe(false);
    expect(json.quiz.hide_results).toBe('always');
    expect(json.quiz.show_correct_answers).toBe(false);
    expect(json.quiz.one_question_at_a_time).toBe(true);
    expect(json.quiz.cant_go_back).toBe(false);
    expect(json.quiz.require_lockdown_browser).toBe(true);
    expect(json.quiz.require_lockdown_browser_for_results).toBe(true);
    expect(json.quiz.unlock_at).toBeUndefined();
    expect(qti).toContain('<fieldlabel>qmd_timelimit</fieldlabel><fieldentry>90</fieldentry>');
  });

  it('applies the defaults to front matter with no canvas block', () => {
    const quiz = parseMarkdown('---\ntitle: T\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(quiz.canvas?.require_lockdown_browser).toBe(true);
    expect(quiz.canvas?.time_limit).toBe(50);
  });
});

describe('Review round 2', () => {
  it('omits hide_results when correct answers are shown, and on explicit null', () => {
    const shown = parseMarkdown('---\ntitle: T\ncanvas:\n  show_correct_answers: true\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(shown.canvas?.hide_results).toBeUndefined();
    expect(generateAssessmentMeta(shown, 'id')).not.toContain('hide_results');
    const nulled = parseMarkdown('---\ntitle: T\ncanvas:\n  hide_results: null\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(generateAssessmentMeta(nulled, 'id')).not.toContain('hide_results');
    const hidden = parseMarkdown('---\ntitle: T\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(generateAssessmentMeta(hidden, 'id')).toContain('<hide_results>always</hide_results>');
  });

  it('rejects markdown in the title and escapes it plainly', () => {
    expect(() => parseMarkdown('---\ntitle: "Quiz on `numpy`"\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n')).toThrow(/title must be plain text/);
    const quiz = parseMarkdown('---\ntitle: "A & B <2>"\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('title="A &amp; B &lt;2&gt;"');
    expect(() => parser.parse(qti)).not.toThrow();
  });

  it('rejects bad canvas values by name', () => {
    expect(() => parseMarkdown('---\ncanvas:\n  time_limit: fifty\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n')).toThrow(/canvas.time_limit must be a number/);
    expect(() => parseMarkdown('---\ncanvas:\n  quiz_type: exam\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n')).toThrow(/canvas.quiz_type must be one of/);
  });

  it('emits lockdown sub-settings only when the browser is required', () => {
    const off = parseMarkdown('---\ncanvas:\n  require_lockdown_browser: false\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(generateAssessmentMeta(off, 'id')).not.toContain('require_lockdown_browser_for_results');
    const on = parseMarkdown('---\ntitle: T\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n');
    expect(generateAssessmentMeta(on, 'id')).toContain('<require_lockdown_browser_for_results>true</require_lockdown_browser_for_results>');
  });

  it('resolves images in options and feedback', () => {
    const quiz = parseMarkdown('# Q\n\n## 1. Which plot decays? [1 pts]\n\na) ![first](a.png) [correct] // See ![hint](h.png)\nb) ![second](b.png)\n');
    const seen: string[] = [];
    const { qti } = generateQTI(quiz, src => { seen.push(src); return `images/${src}`; });
    expect(seen.sort()).toEqual(['a.png', 'b.png', 'h.png']);
    expect(qti).toContain('<img src="images/a.png" alt="first"/>');
    expect(qti).toContain('<img src="images/h.png" alt="hint"/>');
  });

  it('keeps a code block and display math inside an option, Quarto list-item shape', () => {
    const quiz = parseMarkdown(`# Q

## 1. Which snippet is right? [2 pts]

Pick one.

1)  This one: [correct]

    \`\`\` python
    y = x // 2  # floor
    \`\`\`

2)  Or this, with $x \\in \\mathbb{R}$:

    $$
    y = \\frac{x}{2}
    $$

3)  Neither
`);
    const q = quiz.questions[0];
    expect(q.stem).toBe('Which snippet is right?\n\nPick one.');
    expect(q.options).toHaveLength(3);
    expect(q.options[0].isCorrect).toBe(true);
    expect(q.options[0].feedback).toBeUndefined();
    expect(q.options[0].text).toBe('This one:\n\n``` python\ny = x // 2  # floor\n```');
    expect(q.options[1].text).toBe('Or this, with $x \\in \\mathbb{R}$:\n\n$$\ny = \\frac{x}{2}\n$$');
    const { qti } = generateQTI(quiz);
    expect(qti).toContain('This one:\n\n<pre><code class="language-python">y = x // 2  # floor</code></pre></mattext>');
    expect(qti).toContain('Or this, with \\(x \\in \\mathbb{R}\\):\n\n\\[\ny = \\frac{x}{2}\n\\]</mattext>');
  });

  it('reports source lines relative to the original file', () => {
    const quiz = parseMarkdown('---\ntitle: T\ncanvas:\n  time_limit: 10\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n');
    expect(quiz.questions[0].sourceLine).toBe(7);
  });
});
