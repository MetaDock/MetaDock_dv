import json
import os
from pathlib import Path
import textwrap
import difflib
from datetime import datetime
import sys

def check_content_issues(para_file, usage_file):
    """Check content issues in JSON files"""
    issues = []
    
    # Check usage.json
    try:
        with open(usage_file, 'r', encoding='utf-8') as f:
            usage = json.load(f)
            if not usage or not usage.get('usage') or (
                isinstance(usage.get('usage'), list) and 
                (len(usage['usage']) == 0 or 
                 (len(usage['usage']) == 1 and not usage['usage'][0].strip()))
            ):
                issues.append(f"Warning: {usage_file} - Usage content is empty")
    except FileNotFoundError:
        issues.append(f"Warning: {usage_file} - File not found")
    except json.JSONDecodeError:
        issues.append(f"Warning: {usage_file} - Invalid JSON format")
    
    # Check para.json
    try:
        with open(para_file, 'r', encoding='utf-8') as f:
            params = json.load(f)
            if not params:
                issues.append(f"Warning: {para_file} - Parameter file is empty")
            else:
                # Check null attributes for each parameter
                for i, param in enumerate(params, 1):
                    param_name = param.get('short') or param.get('long') or f"Parameter #{i}"
                    
                    # Only warn when both short and long are null
                    if param['short'] is None and param['long'] is None:
                        issues.append(f"Warning: {para_file} - {param_name} has both short and long names as null")
                    
                    # Check other required attributes
                    if param['category'] is None:
                        issues.append(f"Warning: {para_file} - {param_name} has null category")
                    if param['description'] is None:
                        issues.append(f"Warning: {para_file} - {param_name} has null description")
    except FileNotFoundError:
        issues.append(f"Warning: {para_file} - File not found")
    except json.JSONDecodeError:
        issues.append(f"Warning: {para_file} - Invalid JSON format")
    
    return issues

def normalize_text(text):
    """Normalize text, remove extra whitespace and newlines while maintaining basic format"""
    if not text:
        return ''
    
    # Split text into lines and remove leading/trailing whitespace
    lines = [line.rstrip() for line in text.split('\n')]
    normalized_lines = []
    
    # Track current processing state
    in_usage = False
    current_param = None
    
    for line in lines:
        # Process usage line
        if line.startswith('usage:'):
            in_usage = True
            # Normalize usage line, maintain basic structure but remove extra spaces
            parts = line.split()
            # Ensure program name is not duplicated
            if len(parts) >= 2:
                prog_name = parts[1]
                remaining_parts = []
                skip_next = False
                for i in range(2, len(parts)):
                    if skip_next:
                        skip_next = False
                        continue
                    if parts[i] == prog_name:
                        skip_next = True
                        continue
                    remaining_parts.append(parts[i])
                normalized_lines.append(f"usage: {prog_name} {' '.join(remaining_parts)}")
            continue
        
        # Process usage continuation
        if in_usage and line.strip():
            if not line.strip().startswith('usage:'):
                # Remove extra spaces but maintain basic indentation
                normalized_lines.append(' ' * 13 + ' '.join(line.strip().split()))
            continue
        elif in_usage and not line.strip():
            in_usage = False
            normalized_lines.append('')
            continue
        
        # Process parameter lines
        if line.strip().startswith('-'):
            # Add empty line if there was a previous parameter
            if current_param is not None:
                normalized_lines.append('')
            
            # Separate parameter name and description
            parts = line.split('  ', 1)
            if len(parts) > 1:
                # Normalize parameter name part
                param_parts = parts[0].split(',')
                # Extract all options
                opts = []
                for p in param_parts:
                    p = p.strip()
                    if p:
                        opts.append(p)
                # No need to sort, maintain original order
                param_name = ', '.join(opts)
                
                # Normalize description part
                description = ' '.join(parts[1].split())
                current_param = [f"  {param_name}"]
                if description:
                    current_param.append(' ' * 24 + description)
            else:
                current_param = [' '.join(line.split())]
            continue
        
        # Process parameter description continuation
        if line.startswith('  ') and current_param is not None:
            # Normalize description text
            description = ' '.join(line.split())
            if description:
                current_param.append(' ' * 24 + description)
            continue
        
        # Process empty lines or new paragraphs
        if not line.strip():
            if current_param is not None:
                normalized_lines.extend(current_param)
                normalized_lines.append('')
                current_param = None
            elif not normalized_lines or normalized_lines[-1] != '':
                normalized_lines.append('')
            continue
        
        # Process other lines (category titles etc.)
        if current_param is not None:
            normalized_lines.extend(current_param)
            normalized_lines.append('')
            current_param = None
        
        # Normalize regular lines
        normalized_lines.append(line.strip())
    
    # Process last parameter (if any)
    if current_param is not None:
        normalized_lines.extend(current_param)
    
    # Remove leading and trailing empty lines
    while normalized_lines and not normalized_lines[0]:
        normalized_lines.pop(0)
    while normalized_lines and not normalized_lines[-1]:
        normalized_lines.pop()
    
    return '\n'.join(normalized_lines)

def normalize_for_comparison(text):
    """Normalize text for comparison, remove all format differences"""
    if not text:
        return ''
    
    # Split text into lines
    lines = text.split('\n')
    normalized_lines = []
    current_param = None
    current_desc = []
    in_usage = False
    
    for line in lines:
        line = line.strip()
        
        # Process usage line
        if line.startswith('usage:'):
            in_usage = True
            # Normalize usage line, remove extra spaces
            parts = line.split()
            if len(parts) >= 2:
                prog_name = parts[1]
                remaining_parts = []
                skip_next = False
                for i in range(2, len(parts)):
                    if skip_next:
                        skip_next = False
                        continue
                    if parts[i] == prog_name:
                        skip_next = True
                        continue
                    remaining_parts.append(parts[i])
                normalized_lines.append(f"usage: {prog_name} {' '.join(remaining_parts)}")
            continue
        
        # Process usage continuation
        if in_usage and line:
            if not line.startswith('usage:'):
                # Remove extra spaces, keep parameters
                normalized_lines.append(' '.join(line.split()))
            continue
        
        # Process empty lines
        if not line:
            if current_param:
                # Normalize parameter and description
                param_parts = current_param.split(',')
                # Extract all options and sort (ignore order differences)
                opts = []
                for p in param_parts:
                    p = p.strip()
                    if p:
                        opts.append(p)
                # Sort by length (short options first, long options last)
                opts.sort(key=lambda x: (len(x), x))
                param_text = ', '.join(opts)
                
                # Normalize description text
                desc_text = ' '.join(' '.join(current_desc).split())
                
                # Combine parameter and description
                normalized_lines.append(f"{param_text} {desc_text}".strip())
                current_param = None
                current_desc = []
            elif not in_usage:
                in_usage = False
            continue
        
        # Process parameter lines
        if line.startswith('-'):
            if current_param:
                # Process previous parameter
                param_parts = current_param.split(',')
                opts = []
                for p in param_parts:
                    p = p.strip()
                    if p:
                        opts.append(p)
                opts.sort(key=lambda x: (len(x), x))
                param_text = ', '.join(opts)
                desc_text = ' '.join(' '.join(current_desc).split())
                normalized_lines.append(f"{param_text} {desc_text}".strip())
            
            # Separate parameter name and description
            parts = line.split('  ', 1)
            if len(parts) > 1:
                current_param = parts[0].strip()
                current_desc = [' '.join(parts[1].split())]
            else:
                current_param = line.strip()
                current_desc = []
            continue
        
        # Process description lines
        if line.startswith(' ') and current_param:
            current_desc.append(' '.join(line.split()))
            continue
        
        # Process other lines (category titles etc.)
        if not line.startswith('usage:'):
            if current_param:
                # Process previous parameter
                param_parts = current_param.split(',')
                opts = []
                for p in param_parts:
                    p = p.strip()
                    if p:
                        opts.append(p)
                opts.sort(key=lambda x: (len(x), x))
                param_text = ', '.join(opts)
                desc_text = ' '.join(' '.join(current_desc).split())
                normalized_lines.append(f"{param_text} {desc_text}".strip())
                current_param = None
                current_desc = []
            normalized_lines.append(line)
    
    # Process last parameter
    if current_param:
        param_parts = current_param.split(',')
        opts = []
        for p in param_parts:
            p = p.strip()
            if p:
                opts.append(p)
        opts.sort(key=lambda x: (len(x), x))
        param_text = ', '.join(opts)
        desc_text = ' '.join(' '.join(current_desc).split())
        normalized_lines.append(f"{param_text} {desc_text}".strip())
    
    # Return normalized text
    return '\n'.join(normalized_lines)

def split_into_blocks(text):
    """Split text into meaningful blocks, split by paragraphs and categories"""
    blocks = []
    current_block = []
    in_usage = False
    
    for line in text.split('\n'):
        line_stripped = line.rstrip()
        
        # Check if it's usage part
        if line_stripped.startswith('usage:'):
            if current_block:
                blocks.append('\n'.join(current_block))
            current_block = [line_stripped]
            in_usage = True
            continue
        
        # Process usage part continuation
        if in_usage:
            if line_stripped:
                if line_stripped.startswith(' '):
                    current_block.append(line_stripped)
                else:
                    # If you encounter a non-indented line, it's a new part (like program description)
                    blocks.append('\n'.join(current_block))
                    current_block = [line_stripped]
                    in_usage = False
            else:
                if current_block:
                    blocks.append('\n'.join(current_block))
                current_block = []
                in_usage = False
            continue
        
        # Process category title
        if line_stripped.endswith(':') and not line_stripped.startswith(' '):
            if current_block:
                blocks.append('\n'.join(current_block))
            current_block = [line_stripped]
            continue
        
        # Process parameter lines
        if line_stripped.startswith('  ') and (line_stripped[2:].startswith('-')):
            if current_block:
                blocks.append('\n'.join(current_block))
            current_block = [line_stripped]
            continue
        
        # Process parameter description or other indented lines
        if line_stripped.startswith('  ') and current_block:
            current_block.append(line_stripped)
            continue
        
        # Process empty lines
        if not line_stripped:
            if current_block:
                blocks.append('\n'.join(current_block))
            current_block = []
            continue
        
        # Process other non-indented lines (like program description)
        if not line_stripped.startswith(' '):
            if current_block:
                blocks.append('\n'.join(current_block))
            current_block = [line_stripped]
            continue
    
    # Add last block
    if current_block:
        blocks.append('\n'.join(current_block))
    
    # Remove empty blocks and duplicate blocks
    blocks = [block for block in blocks if block.strip()]
    unique_blocks = []
    seen = set()
    for block in blocks:
        normalized = normalize_for_comparison(block)
        if normalized not in seen:
            unique_blocks.append(block)
            seen.add(normalized)
    
    return unique_blocks

def generate_help_text(para_file, usage_file):
    """Generate help text from JSON"""
    help_text = []
    
    # Read usage
    try:
        with open(usage_file, 'r', encoding='utf-8') as f:
            usage = json.load(f)
            if usage.get('usage'):
                # Process usage text, maintain original format
                usage_text = usage['usage'][0]
                if not usage_text.startswith('usage:'):
                    usage_text = 'usage: ' + usage_text
                
                # Split long lines into multiple lines, indent each line to the appropriate position
                lines = []
                current_line = ''
                words = usage_text.split()
                first_line = True
                indent = ' ' * 13  # Adjust indentation based on original format
                
                # Process first line (contains usage: and program name)
                if len(words) >= 2:
                    # Ensure program name is not duplicated
                    prog_name = words[1]
                    remaining_words = []
                    skip_next = False
                    for i in range(2, len(words)):
                        if skip_next:
                            skip_next = False
                            continue
                        if words[i] == prog_name:
                            skip_next = True
                            continue
                        remaining_words.append(words[i])
                    
                    # Rebuild usage text
                    current_line = f"usage: {prog_name}"
                    for word in remaining_words:
                        if len(current_line + ' ' + word) <= 70:
                            current_line += ' ' + word
                        else:
                            lines.append(current_line)
                            current_line = indent + word
                            first_line = False
                
                if current_line:
                    lines.append(current_line)
                help_text.extend(lines)
                help_text.append('')  # Add empty line
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    
    # Read parameters
    try:
        with open(para_file, 'r', encoding='utf-8') as f:
            params = json.load(f)
            
            # Filter out invalid parameters (short and long are null cases)
            params = [p for p in params if not (p['short'] is None and p['long'] is None)]
            
            # Group parameters by category, while maintaining category order
            params_by_category = {}
            category_order = []  # Used to record original category order
            for param in params:
                category = param['category'] or 'uncategorized'
                if category not in params_by_category:
                    params_by_category[category] = []
                    category_order.append(category)  # Record order of new categories
                params_by_category[category].append(param)
            
            # Process each category in original order
            for category in category_order:
                category_params = params_by_category[category]
                # Add category title
                help_text.append(f"{category}:")
                help_text.append('')  # Add empty line after category title
                
                # Process all parameters in the category
                for param in category_params:
                    # Build parameter line
                    param_parts = []
                    if param['short'] is not None:
                        param_parts.append(param['short'])
                    if param['long'] is not None:
                        param_parts.append(param['long'])
                    
                    param_line = '  ' + ', '.join(param_parts)
                    if param.get('metavar'):
                        param_line += f" {param['metavar']}"
                    help_text.append(param_line)
                    
                    # Add description (with appropriate indentation)
                    if param['description']:
                        desc = param['description'].replace('\n', ' ').strip()
                        # Use textwrap to process description text
                        wrapped_desc = textwrap.wrap(
                            desc,
                            width=50,  # Adjust width to match original format
                            initial_indent=' ' * 24,
                            subsequent_indent=' ' * 24,
                            break_on_hyphens=False,  # Avoid breaking at hyphens
                            break_long_words=True
                        )
                        help_text.extend(wrapped_desc)
                    
                    help_text.append('')  # Add empty line after each parameter
                
                help_text.append('')  # Add empty line between categories
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    
    return '\n'.join(help_text)

def split_help_into_parts(help_text):
    """Split help text into comparable parts"""
    parts = []
    current_part = []
    
    for line in help_text.split('\n'):
        if not line.strip() and current_part:  # Empty line as separator
            parts.append('\n'.join(current_part))
            current_part = []
        else:
            current_part.append(line)
    
    if current_part:  # Add last part
        parts.append('\n'.join(current_part))
    
    return parts

def create_html_comparison(original_file, generated_help, issues):
    """Create HTML format comparison report"""
    try:
        with open(original_file, 'r', encoding='utf-8') as f:
            original_text = f.read()
    except FileNotFoundError:
        return "Original file not found"
    
    # Split into blocks
    original_blocks = split_into_blocks(original_text)
    generated_blocks = split_into_blocks(generated_help)
    
    # Generate unique ID for each block
    block_ids = {}
    for i, block in enumerate(original_blocks):
        block_ids[block] = f"section_{i}"
    
    # HTML header
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Help Comparison Report</title>
    <style>
        body {{
            font-family: 'Consolas', monospace;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 20px;
        }}
        .header {{
            background: #2c3e50;
            color: white;
            padding: 20px;
            border-radius: 8px 8px 0 0;
            margin: -20px -20px 20px -20px;
        }}
        .issues {{
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
            border-left: 5px solid #ffeeba;
        }}
        .comparison {{
            display: flex;
            margin-bottom: 10px;
            border: 1px solid #eee;
            border-radius: 4px;
            position: relative;
        }}
        .original, .generated {{
            flex: 1;
            padding: 10px;
            white-space: pre-wrap;
            font-size: 14px;
            line-height: 1.5;
        }}
        .original {{
            background: #fff8f8;
            border-right: 1px solid #eee;
        }}
        .generated {{
            background: #f8fff8;
        }}
        .diff-header {{
            background: #f8f9fa;
            padding: 10px;
            margin: -10px -10px 10px -10px;
            border-bottom: 1px solid #eee;
            font-weight: bold;
        }}
        .timestamp {{
            color: #6c757d;
            font-size: 0.9em;
            margin-top: 5px;
        }}
        .empty {{
            color: #999;
            font-style: italic;
            padding: 20px;
            text-align: center;
            background: #f8f9fa;
        }}
        .match {{
            background: #e8f5e9;
        }}
        .nomatch {{
            background: #ffebee;
        }}
        .section-actions {{
            position: absolute;
            right: 10px;
            top: 10px;
            display: flex;
            gap: 8px;
            opacity: 0;
            transition: opacity 0.2s;
        }}
        .comparison:hover .section-actions {{
            opacity: 1;
        }}
        .btn {{
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            color: white;
            transition: opacity 0.2s;
        }}
        .btn:hover {{
            opacity: 0.9;
        }}
        .btn-add {{
            background: #28a745;
        }}
        .btn-modify {{
            background: #17a2b8;
        }}
        .btn-delete {{
            background: #dc3545;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Help Comparison Report</h1>
            <div class="timestamp">Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
        </div>
"""

    # Add problem report (if any)
    if issues:
        html += '<div class="issues">\n'
        html += '<h2>Content Issues</h2>\n'
        html += '<ul>\n'
        for issue in issues:
            html += f'<li>{issue}</li>\n'
        html += '</ul>\n'
        html += '</div>\n'

    # Use difflib to find best matching block
    matcher = difflib.SequenceMatcher(None, original_blocks, generated_blocks)
    
    # Process each matching block
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        # For each block separately create comparison area
        for i in range(i1, i2):
            original_block = original_blocks[i] if i < len(original_blocks) else ''
            
            # Find best matching generated block
            best_match = None
            best_match_ratio = 0
            best_match_index = -1
            for j in range(j1, j2):
                if j < len(generated_blocks):
                    ratio = difflib.SequenceMatcher(None, 
                        normalize_for_comparison(original_block),
                        normalize_for_comparison(generated_blocks[j])).ratio()
                    if ratio > best_match_ratio:
                        best_match_ratio = ratio
                        best_match = generated_blocks[j]
                        best_match_index = j
            
            # Create comparison block
            section_id = block_ids.get(original_block, f"section_{i}")
            html += f'<div class="comparison" data-section-id="{section_id}">\n'
            
            # Original text
            html += '<div class="original">\n'
            html += '<div class="diff-header">Original</div>\n'
            if original_block:
                html += f'<div class="{"match" if best_match_ratio > 0.8 else "nomatch"}">{original_block}</div>\n'
            else:
                html += '<div class="empty">(Empty)</div>\n'
            html += '</div>\n'
            
            # Generated text
            html += '<div class="generated">\n'
            html += '<div class="diff-header">Generated</div>\n'
            if best_match:
                html += f'<div class="{"match" if best_match_ratio > 0.8 else "nomatch"}">{best_match}</div>\n'
                # Mark matched block
                if best_match_index >= 0:
                    generated_blocks[best_match_index] = None
            else:
                html += '<div class="empty">(Empty)</div>\n'
            html += '</div>\n'
            
            html += '</div>\n'
        
        # Process unmatched blocks in generated text
        for j in range(j1, j2):
            if j >= len(generated_blocks) or generated_blocks[j] is None:
                continue
            
            generated_block = generated_blocks[j]
            section_id = f"section_new_{j}"
            
            # Create new comparison block
            html += f'<div class="comparison" data-section-id="{section_id}">\n'
            
            # Original text (empty)
            html += '<div class="original">\n'
            html += '<div class="diff-header">Original</div>\n'
            html += '<div class="empty">(Empty)</div>\n'
            html += '</div>\n'
            
            # Generated text
            html += '<div class="generated">\n'
            html += '<div class="diff-header">Generated</div>\n'
            html += f'<div class="nomatch">{generated_block}</div>\n'
            html += '</div>\n'
            
            html += '</div>\n'
    
    # HTML footer
    html += """    </div>
</body>
</html>"""
    
    return html

def process_help_file(help_file, generated_help_file, output_file):
    """Process single help file"""
    try:
        # Check content issues
        para_file = help_file.replace('_help.txt', '_para.json').replace('help', 'parameters')
        usage_file = help_file.replace('_help.txt', '_usage.json').replace('help', 'parameters')
        
        issues = check_content_issues(para_file, usage_file)
        
        # Read generated help text
        with open(generated_help_file, 'r', encoding='utf-8') as f:
            generated_help = f.read()
        
        # Generate HTML report
        html_report = create_html_comparison(help_file, generated_help, issues)
        
        # Save report
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_report)
        
        return True
        
    except Exception as e:
        print(f"Error processing {help_file}: {str(e)}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) != 4:
        print("Usage: python compare_help_html.py <original_help_file> <generated_help_file> <output_html_file>")
        sys.exit(1)

    original_help_file = sys.argv[1]
    generated_help_file = sys.argv[2]
    output_html_file = sys.argv[3]

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_html_file), exist_ok=True)

    if not process_help_file(original_help_file, generated_help_file, output_html_file):
        sys.exit(1)

if __name__ == '__main__':
    main() 