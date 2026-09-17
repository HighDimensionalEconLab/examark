#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, dirname, resolve, extname } from 'path';
import { parseMarkdown } from './parser/markdown.js';
import { generateQTI, generateAssessmentMeta, generateCanvasId, ImageResolver } from './generator/qti.js';
import { generateText, TextExportOptions } from './generator/text.js';
import { QtiValidator } from './diagnostic/validator.js';
import { lintMarkdown } from './diagnostic/linter.js';
import { loadConfig } from './config.js';
import { execSync } from 'child_process';
import { globSync } from 'glob';

const program = new Command();

program
  .name('examark')
  .description('Create exams from Markdown and export to Canvas QTI format')
  .version('0.7.0');

interface VerifyOptions {
  strict?: boolean;
}

program
  .command('verify')
  .description('Verify a QTI package')
  .argument('<path>', 'Path to QTI zip or directory')
  .option('--strict', 'Enable strict validation for New Quizzes compatibility')
  .action(async (path: string, options: VerifyOptions) => {
    const mode = options.strict ? 'strict mode' : 'standard mode';
    console.log(`Verifying package: ${path} (${mode})...`);
    const validator = new QtiValidator({ strict: options.strict });
    const report = await validator.validatePackage(path);
    
    if (report.isValid) {
      console.log('✓ Validation PASSED');
      console.log(`  • Items: ${report.details.itemCount}`);
      console.log(`  • Resources: ${report.details.resourceCount}`);
      if (report.details.testFound) console.log('  • Test/Assessment: Found');
      
      if (report.warnings.length > 0) {
        console.log('\nWarnings:');
        report.warnings.forEach(w => console.warn(`  ! ${w}`));
      }
    } else {
      console.error('✗ Validation FAILED');
      report.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
  });

program
  .command('emulate-canvas')
  .description('Simulate Canvas LMS import and predict success/failure')
  .argument('<path>', 'Path to QTI zip or directory')
  .option('--strict', 'Enable strict validation for New Quizzes compatibility')
  .action(async (path: string, options: VerifyOptions) => {
    console.log(`\n🎓 Canvas Import Emulator\n`);
    console.log(`Analyzing: ${path}${options.strict ? ' (strict mode for New Quizzes)' : ''}\n`);

    const validator = new QtiValidator({ strict: options.strict });
    const report = await validator.validatePackage(path);
    
    // Canvas-specific analysis
    const canvasErrors = report.errors.filter(e => 
      e.includes('No correct answer') || 
      e.includes('Unsupported Canvas') ||
      e.includes('Missing image') ||
      e.includes('Mismatch: Cardinality')
    );
    
    const canvasWarnings = report.warnings.filter(w =>
      w.includes('responseProcessing') ||
      w.includes('limited Canvas support')
    );

    const quartoWarnings = report.warnings.filter(w =>
      w.includes('Quarto GFM') ||
      w.includes('escaped HTML') ||
      w.includes('unconverted math') ||
      w.includes('Dollar signs detected')
    );

    console.log(`📊 Analysis Results:`);
    console.log(`   Items scanned: ${report.details.itemCount}`);
    console.log(`   Resources: ${report.details.resourceCount}`);
    console.log(`   Has test structure: ${report.details.testFound ? 'Yes' : 'No'}`);

    if (canvasErrors.length === 0 && report.errors.length === 0) {
      console.log(`\n✅ PREDICTION: Canvas import will likely SUCCEED`);

      if (quartoWarnings.length > 0) {
        console.log(`\n📝 Quarto GFM Compatibility:`);
        quartoWarnings.forEach(w => console.log(`   ${w}`));
      }

      if (canvasWarnings.length > 0) {
        console.log(`\n⚠️  Warnings (may need attention):`);
        canvasWarnings.forEach(w => console.log(`   • ${w}`));
      }
    } else {
      console.log(`\n❌ PREDICTION: Canvas import will likely FAIL`);
      
      console.log(`\n🔴 Canvas Import Blockers:`);
      canvasErrors.forEach(e => console.log(`   • ${e}`));
      
      // Provide actionable fixes
      console.log(`\n🔧 Suggested Fixes:`);
      
      if (canvasErrors.some(e => e.includes('No correct answer'))) {
        console.log(`   → Mark correct answers with [correct], ✓, or **bold**`);
      }
      if (canvasErrors.some(e => e.includes('Unsupported Canvas'))) {
        console.log(`   → Use choiceInteraction (MC/TF) or textEntryInteraction (short answer)`);
      }
      if (canvasErrors.some(e => e.includes('Missing image'))) {
        console.log(`   → Ensure all image files are bundled in the items/ folder`);
        console.log(`   → For R/Python figures, verify they are generated before conversion`);
      }
      if (canvasErrors.some(e => e.includes('Mismatch: Cardinality'))) {
        console.log(`   → Fix cardinality/maxChoices mismatch in response declarations`);
      }
      
      if (report.errors.length > canvasErrors.length) {
        console.log(`\n🔴 Other Errors:`);
        report.errors.filter(e => !canvasErrors.includes(e))
          .forEach(e => console.log(`   • ${e}`));
      }
      
      process.exit(1);
    }
  });

program
  .command('check')
  .alias('lint')
  .description('Lint a Markdown/Text file for syntax errors')
  .argument('<input>', 'Input file')
  .action((input: string) => {
    console.log(`Checking file: ${input}...`);
    
    try {
      const content = readFileSync(input, 'utf-8');
      const errors = lintMarkdown(content);
      
      if (errors.length === 0) {
        console.log('✓ No issues found. Ready for conversion.');
      } else {
        const errorCount = errors.filter(e => e.severity === 'error').length;
        const warningCount = errors.filter(e => e.severity === 'warning').length;
        
        console.log(`Found ${errorCount} errors and ${warningCount} warnings:\n`);
        
        errors.forEach(e => {
          const icon = e.severity === 'error' ? '✗' : '!';
          const colorFn = e.severity === 'error' ? console.error : console.warn;
          const loc = e.line ? `Line ${e.line}: ` : '';
          
          colorFn(`${icon} ${loc}${e.message}`);
          if (e.context) colorFn(`  Context: ${e.context}`);
        });
        
        if (errorCount > 0) process.exit(1);
      }
    } catch (error) {
       console.error(`Error reading file: ${error instanceof Error ? error.message : error}`);
       process.exit(1);
    }
  });

// Type definitions for CLI options
interface ConvertOptions {
  output?: string;
  validate?: boolean;
  preview?: boolean;
  points?: string;
  title?: string;
  format?: 'qti' | 'text';
  answers?: boolean;
}

/**
 * Convert a single file to the specified format
 */
async function convertFile(
  input: string,
  options: ConvertOptions,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const content = readFileSync(input, 'utf-8');
  const parsed = parseMarkdown(content);

  // Apply config/CLI overrides
  const defaultPoints = options.points ? parseInt(options.points, 10) : config.defaultPoints;
  if (defaultPoints && defaultPoints > 0) {
    parsed.defaultPoints = defaultPoints;
    parsed.questions.forEach(q => {
      if (q.points === 1) {
        q.points = defaultPoints;
      }
    });
  }

  // Override title if specified
  const titleOverride = options.title || config.title;
  if (titleOverride) {
    parsed.title = titleOverride;
  }

  // Merge validate option (CLI overrides config)
  const shouldValidate = options.validate ?? config.validate;

  if (options.preview) {
    console.log('Parsed Questions:');
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  const format = options.format || 'qti';

  // Plain text export
  if (format === 'text') {
    const textOptions: TextExportOptions = {
      showAnswers: options.answers !== false,
      showPoints: true,
    };
    const textOutput = generateText(parsed, textOptions);

    let outputPath = options.output || input.replace(/\.(md|txt)$/, '.exam.txt');
    if (!options.output && config.outputDir) {
      const filename = basename(input).replace(/\.(md|txt)$/, '.exam.txt');
      outputPath = join(config.outputDir, filename);
    }

    writeFileSync(outputPath, textOutput);
    console.log(`✓ Generated Plain Text Exam: ${outputPath}`);
    console.log(`  • ${parsed.questions.length} questions`);
    console.log(`  • Answer key: ${options.answers !== false ? 'included' : 'excluded'}`);
    return;
  }

  // QTI export (default)
  const tempDir = mkdtempSync(join(tmpdir(), 'qti12-'));
  const inputDir = dirname(resolve(input));
  const imagesDir = join(tempDir, 'images');

  const bundledImages: { path: string; filename: string }[] = [];

  const imageResolver: ImageResolver = (imagePath: string) => {
    try {
      const fullPath = join(inputDir, imagePath);
      if (!existsSync(fullPath)) {
        console.warn(`Warning: Image not found: ${fullPath}`);
        return null;
      }

      if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
      }

      const imgFilename = basename(fullPath);
      const destPath = join(imagesDir, imgFilename);
      copyFileSync(fullPath, destPath);

      bundledImages.push({ path: `images/${imgFilename}`, filename: imgFilename });
      return `images/${imgFilename}`;
    } catch (error) {
      console.warn(`Warning: Failed to process image ${imagePath}:`, error);
      return null;
    }
  };

  try {
    const { qti, assessmentIdent } = generateQTI(parsed, imageResolver);

    // Canvas export layout: <ident>/<ident>.xml plus <ident>/assessment_meta.xml,
    // which Canvas looks up by the assessment ident on import
    mkdirSync(join(tempDir, assessmentIdent));
    const qtiFilename = `${assessmentIdent}/${assessmentIdent}.xml`;
    writeFileSync(join(tempDir, qtiFilename), qti);

    let metaDependency = '';
    let metaResource = '';
    if (parsed.canvas) {
      const metaFilename = `${assessmentIdent}/assessment_meta.xml`;
      const metaIdent = generateCanvasId(`meta_${assessmentIdent}`);
      writeFileSync(join(tempDir, metaFilename), generateAssessmentMeta(parsed, assessmentIdent));
      metaDependency = `
      <dependency identifierref="${metaIdent}"/>`;
      metaResource = `
    <resource identifier="${metaIdent}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${metaFilename}">
      <file href="${metaFilename}"/>
    </resource>`;
    }

    const manifestId = `MANIFEST_${Date.now()}`;
    const imageResources = bundledImages.map((img, i) =>
      `    <resource identifier="IMG_${i}" type="webcontent" href="${img.path}">
      <file href="${img.path}"/>
    </resource>`
    ).join('\n');

    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestId}"
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1</schemaversion>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="${assessmentIdent}" type="imsqti_xmlv1p2" href="${qtiFilename}">
      <file href="${qtiFilename}"/>${metaDependency}
    </resource>${metaResource}
${imageResources}
  </resources>
</manifest>`;

    writeFileSync(join(tempDir, 'imsmanifest.xml'), manifest);

    let outputZip = options.output || input.replace(/\.(md|txt)$/, '.qti.zip');
    if (!options.output && config.outputDir) {
      const filename = basename(input).replace(/\.(md|txt)$/, '.qti.zip');
      outputZip = join(config.outputDir, filename);
    }
    const absoluteOutputZip = resolve(outputZip);

    // zip -r appends to an existing archive, which would keep a stale <ident>/ directory
    rmSync(absoluteOutputZip, { force: true });
    execSync(`cd "${tempDir}" && zip -r "${absoluteOutputZip}" .`, { stdio: 'pipe' });

    console.log(`✓ Generated QTI 1.2 Package: ${outputZip}`);
    console.log(`  • ${parsed.questions.length} questions`);
    console.log(`  • ${parsed.sections.length} sections`);
    console.log(`  • ${bundledImages.length} images bundled`);
    console.log(`  • Format: Canvas Classic Quizzes compatible`);

    if (shouldValidate) {
      console.log('\nValidating output...');
      const validator = new QtiValidator();
      const report = await validator.validatePackage(absoluteOutputZip);
      if (report.isValid) {
        console.log('✓ Validation PASSED');
      } else {
        console.error('✗ Validation FAILED');
        report.errors.forEach(e => console.error(`  - ${e}`));
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Expand glob patterns to file list
 */
function expandInputs(patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Glob pattern
      const matches = globSync(pattern, { nodir: true });
      files.push(...matches.filter(f => /\.(md|txt)$/i.test(f)));
    } else if (existsSync(pattern)) {
      files.push(pattern);
    } else {
      console.warn(`Warning: File not found: ${pattern}`);
    }
  }
  return [...new Set(files)]; // Deduplicate
}

// Default command (convert)
program
  .argument('[input...]', 'Input file(s) or glob pattern (e.g., *.md, exams/*.md)')
  .option('-o, --output <file>', 'Output file (for single file) or directory (for batch)')
  .option('-v, --validate', 'Validate output structure')
  .option('--preview', 'Preview parsed questions without generating file')
  .option('-p, --points <number>', 'Default points per question')
  .option('-t, --title <title>', 'Quiz title override')
  .option('-f, --format <type>', 'Output format: qti (default) or text', 'qti')
  .option('--no-answers', 'Exclude answer key from text export')
  .action(async (inputs: string[], options: ConvertOptions) => {
    if (!inputs || inputs.length === 0) {
      program.help();
      return;
    }

    // Expand glob patterns
    const files = expandInputs(inputs);

    if (files.length === 0) {
      console.error('Error: No matching files found');
      process.exit(1);
    }

    // Batch mode: multiple files
    if (files.length > 1) {
      console.log(`Processing ${files.length} files...\n`);

      // If output is specified, treat as directory for batch
      let outputDir = options.output;
      if (outputDir && !existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      let successCount = 0;
      let errorCount = 0;

      for (const file of files) {
        try {
          const config = loadConfig(resolve(file));

          // For batch mode, override output to use directory
          const batchOptions = { ...options };
          if (outputDir) {
            const ext = options.format === 'text' ? '.exam.txt' : '.qti.zip';
            batchOptions.output = join(outputDir, basename(file).replace(/\.(md|txt)$/, ext));
          } else {
            delete batchOptions.output; // Use default naming
          }

          await convertFile(file, batchOptions, config);
          successCount++;
        } catch (error) {
          console.error(`✗ Error processing ${file}: ${error instanceof Error ? error.message : error}`);
          errorCount++;
        }
        console.log(''); // Blank line between files
      }

      console.log(`\nBatch complete: ${successCount} succeeded, ${errorCount} failed`);
      if (errorCount > 0) process.exit(1);
      return;
    }

    // Single file mode
    const input = files[0];
    const config = loadConfig(resolve(input));

    try {
      await convertFile(input, options, config);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
