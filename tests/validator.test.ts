
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QtiValidator } from '../src/diagnostic/validator.js'; // Use .js extension for TS import resolution in Node if needed, or .ts if ts-node/vitest handles it. Vitest handles .ts.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('QtiValidator', () => {
  let tempDir: string;
  let validator: QtiValidator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'qti-test-'));
    validator = new QtiValidator();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should fail if path does not exist', async () => {
    const report = await validator.validatePackage(join(tempDir, 'non-existent'));
    expect(report.isValid).toBe(false);
    expect(report.errors[0]).toContain('File not found');
  });

  it('should validate a valid folder structure with XML content', async () => {
    // Setup valid structure
    mkdirSync(join(tempDir, 'items'), { recursive: true });
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    
    // Valid Manifest
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="manifest_1" xmlns="...">
        <resources>
          <resource identifier="res_item_1" type="imsqti_item_xmlv2p1" href="items/item_1.xml">
            <file href="items/item_1.xml"/>
          </resource>
          <resource identifier="res_test_1" type="imsqti_test_xmlv2p1" href="tests/test.xml">
            <file href="tests/test.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    // Valid Item
    writeFileSync(join(tempDir, 'items', 'item_1.xml'), `
      <assessmentItem identifier="item_1">
        <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
           <defaultValue><value>1</value></defaultValue>
        </outcomeDeclaration>
        <itemBody><p>This is a valid test question.</p></itemBody>
      </assessmentItem>
    `);
    
    // Valid Test
    writeFileSync(join(tempDir, 'tests', 'test.xml'), `
      <assessmentTest identifier="test_1">
        <testPart identifier="part_1">
           <assessmentSection identifier="sec_1">
             <assessmentItemRef identifier="ref_1" href="items/item_1.xml"/>
           </assessmentSection>
        </testPart>
      </assessmentTest>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(true);
    expect(report.details.manifestFound).toBe(true);
    expect(report.details.itemCount).toBe(1);
    expect(report.details.testFound).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('should fail if resource file is missing', async () => {
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/missing.xml">
            <file href="items/missing.xml"/>
          </resource>
        </resources>
      </manifest>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Resource main file not found'))).toBe(true);
  });
  
  it('should fail if XML is invalid', async () => {
    mkdirSync(join(tempDir, 'items'));
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/bad.xml">
            <file href="items/bad.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    writeFileSync(join(tempDir, 'items', 'bad.xml'), 'Not XML');

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    // fast-xml-parser might not throw on plain text, but will return object missing root
    expect(report.errors.some(e => 
      e.includes('Invalid XML content') || e.includes('Invalid Item XML')
    )).toBe(true);
  });
  
  it('should fail if Item XML is missing assessmentItem', async () => {
    mkdirSync(join(tempDir, 'items'));
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/wrong_root.xml">
            <file href="items/wrong_root.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    writeFileSync(join(tempDir, 'items', 'wrong_root.xml'), '<wrongRoot></wrongRoot>');

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Invalid Item XML'))).toBe(true);
  });

  it('should fail if Test references missing item', async () => {
    mkdirSync(join(tempDir, 'items'));
    mkdirSync(join(tempDir, 'tests'));
    
    // Manifest lists the test, and maybe the item, but let's say test refs it and check fails
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="test_1" type="imsqti_test_xmlv2p1" href="tests/test.xml">
            <file href="tests/test.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    writeFileSync(join(tempDir, 'tests', 'test.xml'), `
      <assessmentTest identifier="test_1">
        <testPart identifier="part_1">
           <assessmentSection identifier="sec_1">
             <assessmentItemRef identifier="ref_1" href="items/missing_ref.xml"/>
           </assessmentSection>
        </testPart>
      </assessmentTest>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Test references missing item file'))).toBe(true);
  });

  it('should fail if duplicate identifiers exist', async () => {
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test_dupe" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/item_1.xml">
            <file href="items/item_1.xml"/>
          </resource>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/item_2.xml">
            <file href="items/item_2.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes("Duplicate identifier used: 'item_1'"))).toBe(true);
  });

  it('should fail if interaction mismatches cardinality', async () => {
    mkdirSync(join(tempDir, 'items'));
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/mismatch.xml">
            <file href="items/mismatch.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    // Cardinality single but maxChoices > 1 (should be mismatch)
    writeFileSync(join(tempDir, 'items', 'mismatch.xml'), `
      <assessmentItem identifier="item_1">
        <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>1</value></defaultValue></outcomeDeclaration>
        <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
           <correctResponse><value>A</value></correctResponse>
        </responseDeclaration>
        <itemBody>
           <p>Valid question text here</p>
           <choiceInteraction responseIdentifier="RESPONSE" maxChoices="2" shuffle="true">
             <simpleChoice identifier="A">A</simpleChoice>
             <simpleChoice identifier="B">B</simpleChoice>
           </choiceInteraction>
        </itemBody>
      </assessmentItem>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes("Mismatch: Cardinality 'single'"))).toBe(true);
  });

  // NEW: Canvas-specific validation tests
  it('should fail if choice item has no correct answer defined', async () => {
    mkdirSync(join(tempDir, 'items'));
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/no_answer.xml">
            <file href="items/no_answer.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    // Item with choiceInteraction but no correctResponse value
    writeFileSync(join(tempDir, 'items', 'no_answer.xml'), `
      <assessmentItem identifier="item_1">
        <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>1</value></defaultValue></outcomeDeclaration>
        <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
           <!-- Missing correctResponse! -->
        </responseDeclaration>
        <itemBody>
           <p>Valid question text here</p>
           <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
             <simpleChoice identifier="A">Option A</simpleChoice>
             <simpleChoice identifier="B">Option B</simpleChoice>
           </choiceInteraction>
        </itemBody>
      </assessmentItem>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('No correct answer defined'))).toBe(true);
  });

  it('should error on unsupported Canvas interaction types', async () => {
    mkdirSync(join(tempDir, 'items'));
    writeFileSync(join(tempDir, 'imsmanifest.xml'), `
      <manifest identifier="test" xmlns="...">
        <resources>
          <resource identifier="item_1" type="imsqti_item_xmlv2p1" href="items/unsupported.xml">
            <file href="items/unsupported.xml"/>
          </resource>
        </resources>
      </manifest>
    `);
    
    // Item with unsupported orderInteraction
    writeFileSync(join(tempDir, 'items', 'unsupported.xml'), `
      <assessmentItem identifier="item_1">
        <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>1</value></defaultValue></outcomeDeclaration>
        <itemBody>
           <p>Valid question text here</p>
           <orderInteraction responseIdentifier="RESPONSE">
             <simpleChoice identifier="A">First</simpleChoice>
             <simpleChoice identifier="B">Second</simpleChoice>
           </orderInteraction>
        </itemBody>
      </assessmentItem>
    `);

    const report = await validator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes("Unsupported Canvas interaction 'orderInteraction'"))).toBe(true);
  });
});

describe('QtiValidator Strict Mode', () => {
  let tempDir: string;
  let strictValidator: QtiValidator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'qti-strict-test-'));
    strictValidator = new QtiValidator({ strict: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should pass strict validation for compliant QTI 1.2', async () => {
    // Create a fully compliant QTI 1.2 file
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test_assessment" title="Compliant Quiz">
          <section ident="root_section">
            <item ident="item_1" title="Question 1">
              <itemmetadata>
                <qtimetadata>
                  <qtimetadatafield>
                    <fieldlabel>question_type</fieldlabel>
                    <fieldentry>multiple_choice_question</fieldentry>
                  </qtimetadatafield>
                  <qtimetadatafield>
                    <fieldlabel>points_possible</fieldlabel>
                    <fieldentry>2</fieldentry>
                  </qtimetadatafield>
                </qtimetadata>
              </itemmetadata>
              <presentation>
                <material><mattext texttype="text/html">What is 2 + 2?</mattext></material>
                <response_lid ident="response1" rcardinality="Single">
                  <render_choice>
                    <response_label ident="a"><material><mattext>Three</mattext></material></response_label>
                    <response_label ident="b"><material><mattext>Four</mattext></material></response_label>
                  </render_choice>
                </response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100"/></outcomes>
                <respcondition continue="No">
                  <conditionvar><varequal respident="response1">b</varequal></conditionvar>
                  <setvar varname="SCORE" action="Set">100</setvar>
                </respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(true);
    expect(report.details.itemCount).toBe(1);
  });

  it('should fail strict validation if assessment missing ident', async () => {
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment title="Missing Ident Quiz">
          <section ident="root">
            <item ident="q1" title="Q1">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal"/></outcomes>
                <respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Strict: Assessment missing required "ident"'))).toBe(true);
  });

  it('should fail strict validation if item missing points_possible', async () => {
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test" title="Test">
          <section ident="root">
            <item ident="q1" title="Q1">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
                <!-- Missing points_possible -->
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal"/></outcomes>
                <respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Strict: Item q1 missing "points_possible"'))).toBe(true);
  });

  it('should fail strict validation if item missing question_type', async () => {
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test" title="Test">
          <section ident="root">
            <item ident="q1" title="Q1">
              <itemmetadata><qtimetadata>
                <!-- Missing question_type -->
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal"/></outcomes>
                <respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Strict: Item q1 missing "question_type"'))).toBe(true);
  });

  it('should fail strict validation if item missing itemmetadata', async () => {
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test" title="Test">
          <section ident="root">
            <item ident="q1" title="Q1">
              <!-- Missing itemmetadata entirely -->
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal"/></outcomes>
                <respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Strict: Item q1 missing <itemmetadata>'))).toBe(true);
  });

  it('should fail strict validation if item missing resprocessing', async () => {
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test" title="Test">
          <section ident="root">
            <item ident="q1" title="Q1">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <!-- Missing resprocessing -->
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    const report = await strictValidator.validatePackage(tempDir);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Strict: Item q1 missing required <resprocessing>'))).toBe(true);
  });

  it('should pass standard validation but show warnings in strict mode', async () => {
    const standardValidator = new QtiValidator();

    // Item without title attribute (passes standard, warns in strict)
    writeFileSync(join(tempDir, 'quiz.xml'), `<?xml version="1.0" encoding="UTF-8"?>
      <questestinterop>
        <assessment ident="test" title="Test">
          <section ident="root">
            <item ident="q1">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext>Test?</mattext></material>
                <response_lid ident="r1"><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <outcomes><decvar varname="SCORE" vartype="Decimal"/></outcomes>
                <respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`);

    // Standard validation should pass with no warnings
    const standardReport = await standardValidator.validatePackage(tempDir);
    expect(standardReport.isValid).toBe(true);

    // Strict validation should pass but with warnings
    const strictReport = await strictValidator.validatePackage(tempDir);
    expect(strictReport.isValid).toBe(true);
    expect(strictReport.warnings.some(w => w.includes('Strict: Item q1 missing "title"'))).toBe(true);
  });
});

describe('QtiValidator Canvas export layout', () => {
  let dir: string;
  const ident = 'abc123';
  const qti = (img: string) => `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
<assessment ident="${ident}" title="Layout Quiz"><qtimetadata></qtimetadata><section ident="root_section">
<item ident="item1" title="Question"><itemmetadata><qtimetadata>
<qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
</qtimetadata></itemmetadata>
<presentation><material><mattext texttype="text/html">See <img src="${img}" alt=""/></mattext></material>
<response_lid ident="response1" rcardinality="Single"><render_choice>
<response_label ident="a"><material><mattext texttype="text/html">yes</mattext></material></response_label>
<response_label ident="b"><material><mattext texttype="text/html">no</mattext></material></response_label>
</render_choice></response_lid></presentation>
<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
<respcondition continue="No"><conditionvar><varequal respident="response1">a</varequal></conditionvar>
<setvar actoin="Set" varname="SCORE">100</setvar></respcondition></resprocessing>
</item></section></assessment></questestinterop>`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-layout-'));
    mkdirSync(join(dir, ident));
    mkdirSync(join(dir, 'images'));
    writeFileSync(join(dir, 'images', 'plot.png'), 'png');
    writeFileSync(join(dir, ident, 'assessment_meta.xml'), `<quiz identifier="${ident}"><title>Layout Quiz</title></quiz>`);
    writeFileSync(join(dir, 'imsmanifest.xml'), `<manifest identifier="m"><resources>
      <resource identifier="${ident}" type="imsqti_xmlv1p2" href="${ident}/${ident}.xml"><file href="${ident}/${ident}.xml"/><dependency identifierref="meta"/></resource>
      <resource identifier="meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${ident}/assessment_meta.xml"><file href="${ident}/assessment_meta.xml"/></resource>
    </resources></manifest>`);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the QTI 1.2 file under <ident>/ and accepts bundled images', async () => {
    writeFileSync(join(dir, ident, `${ident}.xml`), qti('images/plot.png'));
    const report = await new QtiValidator().validatePackage(dir);
    expect(report.errors).toEqual([]);
    expect(report.isValid).toBe(true);
    expect(report.details.itemCount).toBe(1);
    expect(report.details.testFound).toBe(true);
  });

  it('reports an image missing from the package', async () => {
    writeFileSync(join(dir, ident, `${ident}.xml`), qti('images/missing.png'));
    const report = await new QtiValidator().validatePackage(dir);
    expect(report.isValid).toBe(false);
    expect(report.errors).toEqual([`Missing image file 'images/missing.png' referenced in ${ident}.xml`]);
  });
});

describe('QtiValidator manifest resolution', () => {
  it('validates the assessment the manifest points at, not a stale one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qti-manifest-'));
    const item = (ok: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="x" title="T"><qtimetadata></qtimetadata><section ident="root_section">
<item ident="i" title="Question"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
<presentation><material><mattext texttype="text/html">Which answer is the correct one here?</mattext></material><response_lid ident="response1" rcardinality="Single"><render_choice>
<response_label ident="a"><material><mattext texttype="text/html">first</mattext></material></response_label>
<response_label ident="b"><material><mattext texttype="text/html">second</mattext></material></response_label></render_choice></response_lid></presentation>
${ok ? '<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar><varequal respident="response1">a</varequal></conditionvar><setvar actoin="Set" varname="SCORE">100</setvar></respcondition></resprocessing>' : ''}
</item></section></assessment></questestinterop>`;
    mkdirSync(join(dir, 'aaa')); mkdirSync(join(dir, 'bbb'));
    writeFileSync(join(dir, 'aaa', 'aaa.xml'), item(false));
    writeFileSync(join(dir, 'bbb', 'bbb.xml'), item(true));
    writeFileSync(join(dir, 'imsmanifest.xml'), `<manifest identifier="m"><resources><resource identifier="bbb" type="imsqti_xmlv1p2" href="bbb/bbb.xml"><file href="bbb/bbb.xml"/></resource></resources></manifest>`);
    const report = await new QtiValidator().validatePackage(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(report.errors).toEqual([]);
    expect(report.isValid).toBe(true);
  });
});

describe('QtiValidator code operators', () => {
  it('does not warn about comparison operators inside code blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qti-code-'));
    writeFileSync(join(dir, 'q.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="x" title="T"><qtimetadata></qtimetadata><section ident="root_section">
<item ident="i" title="Question"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
<presentation><material><mattext texttype="text/html"><p>What prints here for a small value?</p><pre><code>print(rho &lt; 1)</code></pre></mattext></material><response_lid ident="response1" rcardinality="Single"><render_choice>
<response_label ident="a"><material><mattext texttype="text/html">True</mattext></material></response_label>
<response_label ident="b"><material><mattext texttype="text/html">False</mattext></material></response_label></render_choice></response_lid></presentation>
<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar><varequal respident="response1">a</varequal></conditionvar><setvar actoin="Set" varname="SCORE">100</setvar></respcondition></resprocessing>
</item></section></assessment></questestinterop>`);
    const report = await new QtiValidator().validatePackage(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(report.isValid).toBe(true);
    expect(report.warnings.filter(w => w.includes('Unescaped comparison operator'))).toEqual([]);
  });
});
