
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/parser/markdown';

describe('Markdown Parser', () => {
  it('should parse a standard quiz', () => {
    const input = `
# Quiz Title

# Multiple Choice

## 1. Question 1 [2 pts]
1) Option A
2) **Option B**
    `;
    const result = parseMarkdown(input);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].points).toBe(2);
    expect(result.questions[0].type).toBe('multiple_choice');
  });

  it('should parse "Section:" prefix in headers (Canvas compatibility)', () => {
    const input = `
# Statistics Exam

# Section: Multiple Choice

## 1. What is variance? [3 pts]
1) Sum of squares
2) **Average squared deviation**
    `;
    const result = parseMarkdown(input);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toContain('Multiple Choice');
    // This is expected to FAIL currently if my hypothesis is correct
    expect(result.questions).toHaveLength(1);
  });

  it('should handle escaped brackets in points (Quarto output)', () => {
    const input = `
# Quiz

# Multiple Choice

## 2. Question [2 pts]
1) A
2) **B**

## 3. Question \\[3 pts\\]
1) A
2) **B**
    `;
    const result = parseMarkdown(input);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].points).toBe(2);
    // This might fallback to default if regex fails
    // expect(result.questions[1].points).toBe(3); 
  });

  it('should extract points even when brackets are escaped (Quarto style)', () => {
    const input = `
# Quiz
## 1. Question Title \\[2 pts\\]
1) A
2) **B**
    `;
    const result = parseMarkdown(input);
    expect(result.questions[0].points).toBe(2);
    expect(result.questions[0].stem).toBe('Question Title'); // Should NOT have [2 pts]
  });

  it('should auto-generate options for True/False questions if missing', () => {
    const input = `
# Section: True/False
## 1. Simple Fact
The sky is blue. -> True

## 2. Another Fact
Water is dry. -> False
    `;
    const result = parseMarkdown(input);
    const q1 = result.questions[0];
    expect(q1.type).toBe('true_false');
    expect(q1.options.length).toBe(2);
    expect(q1.options[0].text).toBe('True');
    expect(q1.options[0].isCorrect).toBe(true);
    expect(q1.stem).not.toContain('-> True');

    const q2 = result.questions[1];
    expect(q2.options[1].text).toBe('False');
    expect(q2.options[1].isCorrect).toBe(true);
  });

  // NEW: Test for checkmark stripping (Canvas compatibility)
  it('should strip ✓ checkmarks from options and mark them correct', () => {
    const input = `
# Multiple Choice

## 1. What is variance?
1) Sum of squares
2) Average squared deviation from mean ✓
3) Standard deviation
4) Range
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    // The ✓ should be stripped from option text
    expect(q.options[1].text).toBe('Average squared deviation from mean');
    expect(q.options[1].text).not.toContain('✓');
    // And the option should be marked correct
    expect(q.options[1].isCorrect).toBe(true);
  });

  // NEW: Test for solution block skipping
  it('should skip HTML solution blocks entirely', () => {
    const input = `
# Multiple Choice

## 1. What is variance?
1) Sum of squares
2) **Average squared deviation**

<div class="proof solution">

<span class="proof-title">*Solution*. </span>Variance measures the
average squared deviation from the mean. The formula divides by N for
population variance.

</div>

## 2. Second question
1) A
2) **B**
    `;
    const result = parseMarkdown(input);
    const q1 = result.questions[0];
    
    // Solution text should NOT appear in stem
    expect(q1.stem).not.toContain('deviation from the mean');
    expect(q1.stem).not.toContain('Solution');
    expect(q1.stem).not.toContain('population variance');
    
    // Both questions should parse correctly
    expect(result.questions).toHaveLength(2);
  });

  // NEW: Ensure → True marker is removed from T/F stems
  it('should clean arrow markers from True/False question stems', () => {
    const input = `
# Section: True/False

## 1. R squared can range from 0 to 1. → True
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    // The → True should be stripped from the stem
    expect(q.stem).not.toContain('→');
    expect(q.stem).not.toContain('True');
    expect(q.stem).toBe('R squared can range from 0 to 1.');
    
    // But the answer should be captured
    expect(q.options[0].text).toBe('True');
    expect(q.options[0].isCorrect).toBe(true);
  });

  // NEW: Test for *a) asterisk prefix marking correct answer
  it('should recognize *a) asterisk prefix as correct answer marker', () => {
    const input = `
# Multiple Choice

## 1. What is the slope in regression?
*a) The coefficient β₁
b) The intercept
c) The error term
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    expect(q.options[0].isCorrect).toBe(true);
    expect(q.options[0].text).toBe('The coefficient β₁');
    expect(q.options[1].isCorrect).toBe(false);
    expect(q.options[2].isCorrect).toBe(false);
  });

  // NEW: Test for [TF] inline type marker
  it('should parse [TF] marker to set true_false type', () => {
    const input = `
# Quiz

## 3. [TF] The coefficient R² can never be negative.
*True
False
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    expect(q.type).toBe('true_false');
    expect(q.stem).not.toContain('[TF]');
    expect(q.stem).toBe('The coefficient R² can never be negative.');
  });

  // NEW: Test for [MultiAns] type marker
  it('should parse [MultiAns] marker for multiple answer questions', () => {
    const input = `
# Quiz

## 6. [MultiAns] Which are measures of central tendency?
*a) Mean
*b) Median
c) Standard deviation
*d) Mode
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    expect(q.type).toBe('multiple_answers');
    expect(q.options[0].isCorrect).toBe(true);
    expect(q.options[1].isCorrect).toBe(true);
    expect(q.options[2].isCorrect).toBe(false);
    expect(q.options[3].isCorrect).toBe(true);
  });

  // NEW: Test for [Essay, 10pts] combined marker
  it('should parse [Essay, 10pts] combined type and points marker', () => {
    const input = `
# Quiz

## 5. [Essay, 10pts] Explain the difference between correlation and causation.
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    expect(q.type).toBe('essay');
    expect(q.stem).not.toContain('[Essay');
    expect(q.stem).toBe('Explain the difference between correlation and causation.');
  });

  // NEW: Test for ASCII arrow (->) vs Unicode (→) equivalence
  it('should handle both ASCII (->) and Unicode (→) arrows for T/F', () => {
    const input = `
# Section: True/False

## 1. Water is wet. -> True

## 2. Fire is cold. → False
    `;
    const result = parseMarkdown(input);
    
    expect(result.questions[0].options[0].isCorrect).toBe(true); // True
    expect(result.questions[1].options[1].isCorrect).toBe(true); // False
    expect(result.questions[0].stem).toBe('Water is wet.');
    expect(result.questions[1].stem).toBe('Fire is cold.');
  });

  // NEW: Test for [correct] suffix marker (Quarto-friendly)
  it('should recognize [correct] suffix as correct answer marker', () => {
    const input = `
# Quiz

## 1. Which statement is true about R?
a) R is a spreadsheet
b) R is a programming language [correct]
c) R is a database
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];
    
    expect(q.options[1].isCorrect).toBe(true);
    expect(q.options[1].text).toBe('R is a programming language');
    expect(q.options[1].text).not.toContain('[correct]');
    expect(q.options[0].isCorrect).toBe(false);
  });
  // NEW: Test for Short Answer text extraction provided in stem
  it('should extract Short Answer text defined in stem', () => {
    const input = `
# Quiz
## 1. [Short] Capital City
The capital of France is...

Answer: Paris
    `;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.type).toBe('short_answer');
    expect(q.options).toHaveLength(1);
    expect(q.options[0].text).toBe('Paris');
    expect(q.options[0].isCorrect).toBe(true);
    // Ensure "Answer: Paris" is stripped from the displayed stem
    expect(q.stem).not.toContain('Answer: Paris');
    expect(q.stem).toContain('The capital of France is...');
  });

  // NEW: Test for sourceLine tracking
  it('should track source line numbers for questions', () => {
    const input = `# Quiz

## 1. First Question [1 pt]
1) A
2) **B**

## 2. Second Question [2 pts]
1) X
2) **Y**

## 3. Third Question [1 pt]
1) P
2) **Q**
`;
    const result = parseMarkdown(input);

    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].sourceLine).toBe(3);  // "## 1." is on line 3
    expect(result.questions[1].sourceLine).toBe(7);  // "## 2." is on line 7
    expect(result.questions[2].sourceLine).toBe(11); // "## 3." is on line 11
  });

  // NEW: Test for matching questions
  it('should parse [Match] questions with :: pairs', () => {
    const input = `# Quiz

## 1. [Match] Match the statistic to its formula
- Mean :: Σx/n
- Variance :: Σ(x-μ)²/n
- Standard Deviation :: √Variance
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.type).toBe('matching');
    expect(q.matchPairs).toHaveLength(3);
    expect(q.matchPairs![0].left).toBe('Mean');
    expect(q.matchPairs![0].right).toBe('Σx/n');
    expect(q.matchPairs![1].left).toBe('Variance');
    expect(q.matchPairs![2].left).toBe('Standard Deviation');
  });

  // NEW: Test for fill-in-multiple-blanks
  it('should parse [FMB] questions with blanks', () => {
    const input = `# Quiz

## 2. [FMB] Complete the sentence
The correlation coefficient r ranges from [blank1] to [blank2].

[blank1]: -1
[blank2]: 1, +1
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.type).toBe('fill_in_multiple_blanks');
    expect(q.blanks).toHaveLength(2);
    expect(q.blanks![0].blankId).toBe('blank1');
    expect(q.blanks![0].answers).toContain('-1');
    expect(q.blanks![1].blankId).toBe('blank2');
    expect(q.blanks![1].answers).toContain('1');
    expect(q.blanks![1].answers).toContain('+1');
  });

  // NEW: Test for answer feedback
  it('should parse feedback lines after options', () => {
    const input = `# Quiz

## 3. A p-value of 0.03 means:
1) There's a 3% chance the null is true
> Incorrect. P-value is P(data|H₀), not P(H₀|data).
2) **If H₀ is true, there's 3% chance of this extreme result**
> Correct! This is the definition of p-value.
3) The effect size is 0.03
> Incorrect. P-value ≠ effect size.

> [feedback] Remember: p-value is about probability of data, not hypotheses.
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.options[0].feedback).toBe('Incorrect. P-value is P(data|H₀), not P(H₀|data).');
    expect(q.options[1].feedback).toBe('Correct! This is the definition of p-value.');
    expect(q.options[2].feedback).toBe('Incorrect. P-value ≠ effect size.');
    expect(q.generalFeedback).toBe('Remember: p-value is about probability of data, not hypotheses.');
  });

  // NEW: Test that feedback doesn't interfere with normal questions
  it('should handle questions without feedback normally', () => {
    const input = `# Quiz

## 1. Simple question
1) Wrong
2) **Right**
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.options[0].feedback).toBeUndefined();
    expect(q.options[1].feedback).toBeUndefined();
    expect(q.generalFeedback).toBeUndefined();
  });

  // NEW: Test for [x] correct answer marker
  it('should recognize [x] suffix as correct answer marker', () => {
    const input = `# Quiz

## 1. What is variance?
a) Sum of values
b) Average squared deviation [x]
c) Standard deviation
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.options[1].isCorrect).toBe(true);
    expect(q.options[1].text).toBe('Average squared deviation');
    expect(q.options[1].text).not.toContain('[x]');
    expect(q.options[0].isCorrect).toBe(false);
    expect(q.options[2].isCorrect).toBe(false);
  });

  // NEW: Test for case-insensitive [X] marker
  it('should handle [X] marker case-insensitively', () => {
    const input = `# Quiz

## 1. Question
a) Wrong
b) Right [X]
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].options[1].isCorrect).toBe(true);
    expect(result.questions[0].options[1].text).toBe('Right');
  });

  // NEW: Test for // inline feedback
  it('should parse // inline feedback comments', () => {
    const input = `# Quiz

## 1. What is the mean?
a) Σx/n [x] // Correct! This is the definition.
b) Σ(x-μ)²/n // This is variance, not mean.
c) √Variance // This is standard deviation.
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.options[0].isCorrect).toBe(true);
    expect(q.options[0].text).toBe('Σx/n');
    expect(q.options[0].feedback).toBe('Correct! This is the definition.');
    expect(q.options[1].feedback).toBe('This is variance, not mean.');
    expect(q.options[2].feedback).toBe('This is standard deviation.');
  });

  // NEW: Test for type marker aliases (case-insensitive)
  it('should accept [TrueFalse] as alias for [TF]', () => {
    const input = `# Quiz

## 1. [TrueFalse] The sky is blue.
a) True [x]
b) False
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('true_false');
    expect(result.questions[0].stem).toBe('The sky is blue.');
  });

  it('should accept [True/False] as alias for [TF]', () => {
    const input = `# Quiz

## 1. [True/False] Water is wet.
a) True [x]
b) False
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('true_false');
  });

  it('should accept [MultiAnswer] as alias for [MultiAns]', () => {
    const input = `# Quiz

## 1. [MultiAnswer] Select all that apply:
a) Mean [x]
b) Median [x]
c) Range
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('multiple_answers');
  });

  it('should accept [SelectAll] as alias for multiple answers', () => {
    const input = `# Quiz

## 1. [SelectAll] Which are correct?
a) A [x]
b) B [x]
c) C
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('multiple_answers');
  });

  it('should accept [SA] and [ShortAnswer] as aliases for [Short]', () => {
    const input = `# Quiz

## 1. [SA] What is the capital of France?
Answer: Paris

## 2. [ShortAnswer] What is 2+2?
Answer: 4
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('short_answer');
    expect(result.questions[1].type).toBe('short_answer');
  });

  it('should accept [Matching] as alias for [Match]', () => {
    const input = `# Quiz

## 1. [Matching] Match terms to definitions
- Mean => Σx/n
- Variance => Σ(x-μ)²/n
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('matching');
    expect(result.questions[0].matchPairs).toHaveLength(2);
  });

  it('should accept [FillBlanks] and [FITB] as aliases for [FMB]', () => {
    const input = `# Quiz

## 1. [FillBlanks] Complete: r ranges from [blank1] to [blank2].
[blank1]: -1
[blank2]: 1
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('fill_in_multiple_blanks');
  });

  // NEW: Test for => matching separator
  it('should parse matching pairs with => separator', () => {
    const input = `# Quiz

## 1. [Match] Match the terms
- Mean => Σx/n
- Variance => Σ(x-μ)²/n
- SD => √Variance
`;
    const result = parseMarkdown(input);
    const q = result.questions[0];

    expect(q.matchPairs).toHaveLength(3);
    expect(q.matchPairs![0].left).toBe('Mean');
    expect(q.matchPairs![0].right).toBe('Σx/n');
    expect(q.matchPairs![2].left).toBe('SD');
  });

  // NEW: Test that :: separator still works
  it('should still support :: separator for matching', () => {
    const input = `# Quiz

## 1. [Match] Match terms
- A :: 1
- B :: 2
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].matchPairs).toHaveLength(2);
    expect(result.questions[0].matchPairs![0].left).toBe('A');
    expect(result.questions[0].matchPairs![0].right).toBe('1');
  });

  // NEW: Test case-insensitive type markers
  it('should handle type markers case-insensitively', () => {
    const input = `# Quiz

## 1. [tf] lowercase marker
a) True [x]
b) False

## 2. [ESSAY] uppercase marker
Explain your answer.

## 3. [Match] mixed case
- A => 1
`;
    const result = parseMarkdown(input);
    expect(result.questions[0].type).toBe('true_false');
    expect(result.questions[1].type).toBe('essay');
    expect(result.questions[2].type).toBe('matching');
  });

  // NEW: Clean syntax tests (no ## headers)
  describe('Clean Syntax (no ## headers)', () => {
    it('should parse questions with N. format and type marker', () => {
      const input = `# Quiz

1. [TF] The sky is blue. [2pts]
a) True [x]
b) False

2. [MC] What is 2+2? [1pt]
a) 3
b) 4 [x]
c) 5
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].type).toBe('true_false');
      expect(result.questions[0].stem).toBe('The sky is blue.');
      expect(result.questions[0].points).toBe(2);
      expect(result.questions[1].type).toBe('multiple_choice');
    });

    it('should parse questions with N. format and points only', () => {
      const input = `# Statistics Quiz

1. What is variance? [3pts]
a) Sum of squares
b) Average squared deviation [x]
c) Range
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].points).toBe(3);
      expect(result.questions[0].stem).toBe('What is variance?');
    });

    it('should not treat numbered lists as questions on cover page', () => {
      const input = `# Course Info

This syllabus covers:
1. Introduction to statistics
2. Descriptive analysis
3. Inferential methods

# Section: Multiple Choice

## 1. What is variance?
a) Sum [x]
b) Product
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].stem).toBe('What is variance?');
    });

    it('should parse matching with clean syntax', () => {
      const input = `# Quiz

1. [Match] Match statistics to formulas [4pts]
- Mean => Σx/n
- Variance => Σ(x-μ)²/n
`;
      const result = parseMarkdown(input);
      expect(result.questions[0].type).toBe('matching');
      expect(result.questions[0].matchPairs).toHaveLength(2);
    });

    it('should mix clean and traditional syntax', () => {
      const input = `# Quiz

## 1. Traditional header question
a) A
b) B [x]

2. [TF] Clean syntax question [2pts]
a) True [x]
b) False
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].stem).toBe('Traditional header question');
      expect(result.questions[1].stem).toBe('Clean syntax question');
      expect(result.questions[1].points).toBe(2);
    });
  });

  describe('Quarto GFM Compatibility', () => {
    it('should handle escaped brackets in correct answer markers', () => {
      const input = `# Quiz

## 1. Question with escaped bracket marker
a) Wrong
b) Right \\[x\\]
c) Wrong
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].options).toHaveLength(3);
      expect(result.questions[0].options[0].isCorrect).toBe(false);
      expect(result.questions[0].options[1].isCorrect).toBe(true);
      expect(result.questions[0].options[1].text).toBe('Right');
      expect(result.questions[0].options[2].isCorrect).toBe(false);
    });

    it('should handle wrapped option text with escaped markers', () => {
      const input = `# Quiz

## 1. Question with wrapped text
1) Short answer
2) This is a very long answer that spans multiple lines
   and continues here \\[x\\]
3) Another option
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].options).toHaveLength(3);
      expect(result.questions[0].options[1].isCorrect).toBe(true);
      expect(result.questions[0].options[1].text).toContain('continues here');
      expect(result.questions[0].options[1].text).not.toContain('\\[x\\]');
    });

    it('should skip HTML comments inserted by Quarto', () => {
      const input = `# Quiz

1. [MC] Question text [1pt]

<!-- -->

a) Option A
b) Option B \\[x\\]
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].options).toHaveLength(2);
      expect(result.questions[0].options[1].isCorrect).toBe(true);
    });

    it('should handle numbered lists with escaped markers (Quarto GFM)', () => {
      const input = `# Quiz

1. \\[MC\\] Question one \\[1pt\\]

1) Wrong
2) Right \\[x\\]
3) Wrong
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].type).toBe('multiple_choice');
      expect(result.questions[0].points).toBe(1);
      expect(result.questions[0].options[1].isCorrect).toBe(true);
    });

    it('should handle mixed escaped and unescaped markers', () => {
      const input = `# Quiz

## 1. Unescaped marker
a) A [x]
b) B

## 2. Escaped marker
a) A
b) B \\[x\\]

## 3. Partially escaped
a) A \\[x]
b) B
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(3);
      expect(result.questions[0].options[0].isCorrect).toBe(true);
      expect(result.questions[1].options[1].isCorrect).toBe(true);
      expect(result.questions[2].options[0].isCorrect).toBe(true);
    });

    it('should handle option continuation lines correctly', () => {
      const input = `# Quiz

1. \\[MC\\] Question with wrapped option

a) First option
b) Second option that is
   very long and wraps \\[x\\]
c) Third option

> Feedback here
`;
      const result = parseMarkdown(input);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].options).toHaveLength(3);
      expect(result.questions[0].options[1].isCorrect).toBe(true);
      expect(result.questions[0].options[1].text).toContain('very long and wraps');
      // Make sure feedback isn't included in option text
      expect(result.questions[0].options[2].feedback).toContain('Feedback here');
    });
  });
});


describe('canvas front matter validation', () => {
  it('rejects a scalar canvas block', () => {
    expect(() => parseMarkdown('---\ntitle: T\ncanvas: assignment\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n')).toThrow(/canvas must be a mapping/);
  });
  it('rejects unknown keys by name', () => {
    expect(() => parseMarkdown('---\ncanvas:\n  time_limt: 30\n  quiz_type: assignment\n---\n\n## 1. Q [1 pts]\n\na) x [correct]\n')).toThrow(/unknown canvas setting\(s\): time_limt/);
  });
});
