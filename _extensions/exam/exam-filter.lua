-- Quarto Exam Extension - Unified Lua Filter
-- Handles PDF, HTML, and QTI output with shared options

-- Read exam options from metadata
local exam_options = {}
local format_name = ""
local input_file = ""
local output_dir = ""

-- Get input file path from Quarto
function get_input_file()
  -- QUARTO_PROJECT_INPUT_FILES or quarto.doc.input_file
  local input = os.getenv("QUARTO_DOCUMENT_INPUT")
  if input then return input end

  -- Try to get from quarto.doc if available
  if quarto and quarto.doc and quarto.doc.input_file then
    return quarto.doc.input_file
  end

  return nil
end

function Meta(meta)
  -- Detect output format
  format_name = quarto.doc.is_format("html") and "html" or 
                quarto.doc.is_format("pdf") and "pdf" or
                quarto.doc.is_format("docx") and "docx" or "other"
  
  -- Read exam options
  if meta.exam then
    for k, v in pairs(meta.exam) do
      if type(v) == "table" then
        exam_options[k] = {}
        for k2, v2 in pairs(v) do
          exam_options[k][pandoc.utils.stringify(k2)] = pandoc.utils.stringify(v2)
        end
      else
        exam_options[k] = pandoc.utils.stringify(v)
      end
    end
  end
  
  -- Inject CSS variables for HTML
  if format_name == "html" then
    local fonts = exam_options.fonts or {}
    local css = string.format([[
<style>
:root {
  --exam-font-size: %s;
  --exam-question-size: %s;
  --exam-section-size: %s;
  --exam-question-weight: %s;
}
%s
</style>
]], 
      fonts["size"] or "11pt",
      fonts["question-size"] or "1em",
      fonts["section-size"] or "1.2em",
      fonts["question-weight"] or "600",
      exam_options.solutions == "true" and "body { class: solutions-enabled; }" or ""
    )
    
    quarto.doc.include_text("in-header", css)
  end
  
  return meta
end

-- Markdown output keeps the [correct] and → True/False markers for examark;
-- every other student-facing format drops them
local function keep_answer_markers()
  return exam_options.solutions == "true"
    or quarto.doc.is_format("gfm") or quarto.doc.is_format("markdown")
end

-- Strip a trailing [correct] from each answer choice
local function strip_correct(el)
  if keep_answer_markers() then
    return el
  end
  for _, item in ipairs(el.content) do
    for _, block in ipairs(item) do
      if block.t == "Plain" or block.t == "Para" then
        local inlines = block.content
        if #inlines > 0 and inlines[#inlines].t == "Str"
            and inlines[#inlines].text == "[correct]" then
          inlines:remove(#inlines)
          while #inlines > 0 and inlines[#inlines].t == "Space" do
            inlines:remove(#inlines)
          end
        end
      end
    end
  end
  return el
end

function OrderedList(el)
  return strip_correct(el)
end

-- Process headers (questions and sections)
function Header(el)
  -- Section headers (# = level 1)
  if el.level == 1 then
    local text = pandoc.utils.stringify(el.content)
    if text:match("^Section:") then
      el.classes:insert("exam-section")
    end
    return el
  end
  
  -- Question headers (## = level 2)
  if el.level == 2 then
    local text = pandoc.utils.stringify(el.content)
    
    -- Extract points: [N pts]
    local points = text:match("%[(%d+)%s*pts?%]")
    if points then
      el.attributes["data-points"] = points
      el.classes:insert("exam-question")
    end
    
    -- Detect T/F answer in header: → True or → False
    local tf_answer = text:match("→%s*(%w+)$")
    if tf_answer then
      el.attributes["data-answer"] = tf_answer:lower()
      el.classes:insert("tf-question")
      if not keep_answer_markers() then
        local content = el.content
        content:remove(#content)
        while #content > 0 and (content[#content].t == "Space"
            or (content[#content].t == "Str" and content[#content].text == "→")) do
          content:remove(#content)
        end
      end
    end
    
    return el
  end
  
  return el
end

-- Process solution divs (hide when solutions=false)
-- Note: .callout-tip is handled by Quarto natively
function Div(el)
  if el.classes:includes("solution") then
    local show_solutions = exam_options.solutions == "true"
    
    if show_solutions then
      -- Let it render normally
      el.classes:insert("solution-visible")
      return el
    else
      -- Hide solutions
      return {}
    end
  end
  
  -- Handle callout-tip: hide when solutions=false 
  if el.classes:includes("callout-tip") then
    local show_solutions = exam_options.solutions == "true"
    if not show_solutions then
      return {}
    end
  end
  
  return el
end

-- Quarto converts ::: {.solution} into its Proof custom node before this
-- filter runs, so Div above never sees it; hide it here when solutions=false
function Proof(el)
  if el.type:lower() == "solution" and exam_options.solutions ~= "true" then
    return {}
  end
  return el
end

-- Canvas keeps inline styles but strips stylesheets, so markdown output carries
-- every code block as raw HTML with Quarto's arrow-light highlight theme inlined
-- on each token span. Canvas drops font-weight, so bold and italic are <b>/<i>
local token_styles = {
  kw = {color = "#003B4F", bold = true}, cf = {color = "#003B4F", bold = true},
  ot = {color = "#003B4F"},
  dt = {color = "#AD0000"}, dv = {color = "#AD0000"}, bn = {color = "#AD0000"},
  fl = {color = "#AD0000"}, er = {color = "#AD0000"}, al = {color = "#AD0000"},
  pp = {color = "#AD0000"},
  st = {color = "#20794D"}, ch = {color = "#20794D"}, ss = {color = "#20794D"},
  vs = {color = "#20794D"},
  co = {color = "#5E5E5E"}, an = {color = "#5E5E5E"}, ["in"] = {color = "#5E5E5E"},
  op = {color = "#5E5E5E"}, sc = {color = "#5E5E5E"},
  cv = {color = "#5E5E5E", italic = true}, ["do"] = {color = "#5E5E5E", italic = true},
  wa = {color = "#5E5E5E", italic = true},
  fu = {color = "#4758AB"},
  im = {color = "#00769E"},
  cn = {color = "#8f5902"},
  at = {color = "#657422"},
  va = {color = "#111111"},
}

local code_block_style = "color: #003B4F; background-color: #f8f8f8; border: 1px solid #ddd; "
  .. "border-radius: 4px; padding: 8px 12px; white-space: pre; overflow-x: auto;"

function CodeBlock(el)
  if not quarto.doc.is_format("gfm") then
    return el
  end
  local attr = {}
  for _, class in ipairs(el.classes) do
    if not class:match("^cell%-") then
      attr = {class = class}
      break
    end
  end
  local html = pandoc.write(pandoc.Pandoc({pandoc.CodeBlock(el.text, attr)}), "html")
  local body = html:match("<code[^>]*>(.-)</code>")
  local lines = {}
  for line in (body .. "\n"):gmatch("(.-)\n") do
    -- Each highlighted line is wrapped in <span id="cbN-M"><a ...></a>...</span>
    local wrapped
    line, wrapped = line:gsub('^<span id="cb%d+%-%d+"><a [^>]*></a>', "")
    if wrapped > 0 then
      line = line:gsub("</span>$", "")
    end
    -- Token spans never nest, so each one closes before the next opens
    line = line:gsub('<span class="(%w+)">(.-)</span>', function(class, text)
      local style = token_styles[class]
      if not style then
        return text
      end
      local open, close = '<span style="color: ' .. style.color .. '">', "</span>"
      if style.bold then
        open, close = open .. "<b>", "</b>" .. close
      end
      if style.italic then
        open, close = open .. "<i>", "</i>" .. close
      end
      return open .. text .. close
    end)
    lines[#lines + 1] = line
  end
  return pandoc.RawBlock("html", '<pre style="' .. code_block_style .. '"><code>'
    .. table.concat(lines, "\n") .. "</code></pre>")
end

-- Remove vspace when solutions are shown
function RawBlock(el)
  if exam_options.solutions == "true" then
    -- Remove vspace commands when showing solutions
    if el.format == "latex" and el.text:match("\\vspace") then
      return {}
    end
  end
  return el
end

-- Process bullet lists (answer choices)
function BulletList(el)
  local has_correct = false
  
  for i, item in ipairs(el.content) do
    local text = pandoc.utils.stringify(item)
    
    -- Check for correct answer markers: ** or ✓
    if text:match("%*%*.*%*%*") or text:match("✓") then
      has_correct = true
      
      -- If solutions disabled, strip the markers
      if exam_options.solutions ~= "true" then
        -- Walk through and remove Strong elements
        item = pandoc.walk_block(pandoc.Div(item), {
          Strong = function(s)
            return s.content
          end,
          Str = function(s)
            if s.text == "✓" then
              return {}
            end
            return s
          end
        })
        el.content[i] = item.content
      end
    end
  end
  
  if has_correct then
    el.classes = el.classes or {}
    el.classes:insert("answer-choices")
  end
  
  return strip_correct(el)
end

-- Generate QTI package if exam.qti is enabled
-- This runs after all document processing
function Pandoc(doc)
  -- Check if QTI generation is requested
  local qti_enabled = exam_options.qti == "true"
  local solutions_enabled = exam_options.solutions == "true"
  local is_gfm = quarto.doc.is_format("gfm")

  -- Show friendly informative message about current settings (for GFM format only)
  if is_gfm then
    quarto.log.output("")
    quarto.log.output("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    quarto.log.output("📋 Exam Configuration")
    quarto.log.output("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    if qti_enabled then
      quarto.log.output("  📦 QTI Generation:  ✓ Enabled")
    else
      quarto.log.output("  📦 QTI Generation:  ✗ Disabled")
    end

    if solutions_enabled then
      quarto.log.output("  📝 Solutions:       ✓ Visible (answer key shown)")
    else
      quarto.log.output("  📝 Solutions:       ✗ Hidden (student version)")
    end

    quarto.log.output("")

    -- Helpful tip if QTI enabled but solutions hidden
    if qti_enabled and not solutions_enabled then
      quarto.log.output("  💡 Tip: Enable solutions to preview answers before")
      quarto.log.output("     finalizing your exam:")
      quarto.log.output("")
      quarto.log.output("     exam:")
      quarto.log.output("       solutions: true")
      quarto.log.output("")
    end

    -- Tip if neither enabled
    if not qti_enabled and not solutions_enabled then
      quarto.log.output("  💡 Tip: To generate QTI for Canvas, set:")
      quarto.log.output("     exam:")
      quarto.log.output("       qti: true")
      quarto.log.output("")
    end

    quarto.log.output("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    quarto.log.output("")
  end

  if not qti_enabled then
    return doc
  end

  -- Get the input file path from Quarto environment
  input_file = quarto.doc.input_file
  if not input_file then
    quarto.log.warning("exam.qti: Could not determine input file path")
    return doc
  end

  -- Derive output filenames
  local base_name = input_file:match("(.+)%.[^.]+$") or input_file
  local md_output = base_name .. ".md"
  local qti_output = base_name .. ".qti.zip"

  -- For GFM format, the .md file will be created by Quarto
  -- We can't run examark here because the file isn't written yet
  -- Instead, we register a post-render action

  -- Check if we're outputting to markdown/gfm
  local is_md_output = quarto.doc.is_format("gfm") or quarto.doc.is_format("markdown")

  if is_md_output then
    -- For markdown output, tell user or try to schedule post-render
    -- The post-render.js script will check for qti-export-requested
    doc.meta["qti-export-requested"] = pandoc.MetaInlines({pandoc.Str("true")})
    doc.meta["qti-output-file"] = pandoc.MetaInlines({pandoc.Str(qti_output)})
    doc.meta["qti-input-file"] = pandoc.MetaInlines({pandoc.Str(md_output)})

    quarto.log.output("")
    quarto.log.output("📦 QTI Export: After render completes, run:")
    quarto.log.output("   examark " .. md_output .. " -o " .. qti_output)
    quarto.log.output("")
  else
    -- For non-markdown formats (HTML, PDF), user needs to render to GFM first
    quarto.log.output("")
    quarto.log.output("📦 QTI Export: To generate QTI, render to exam-gfm format:")
    quarto.log.output("   quarto render " .. input_file .. " --to exam-gfm")
    quarto.log.output("   examark " .. md_output .. " -o " .. qti_output)
    quarto.log.output("")
  end

  return doc
end

-- Return filter functions in correct order
return {
  {Meta = Meta},
  {Header = Header},
  {Div = Div, Proof = Proof, CodeBlock = CodeBlock},
  {BulletList = BulletList, OrderedList = OrderedList},
  {Pandoc = Pandoc}
}
