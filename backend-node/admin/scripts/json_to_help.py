import json
import textwrap
import difflib
import os
import re
import sys

def json_to_help(para_file, usage_file, output_file):
    try:
        # Read parameter JSON
        with open(para_file, 'r', encoding='utf-8') as f:
            params = json.load(f)
        
        # Read usage JSON
        with open(usage_file, 'r', encoding='utf-8') as f:
            usage = json.load(f)
        
        # Start building help text
        help_text = []
        
        # Add usage section
        if usage.get('usage'):
            help_text.extend(usage['usage'])
            help_text.append('')  # Add blank line
        
        # Filter out the duplicate usage entry from params
        params = [p for p in params if not (p['category'] is None and p['long'] and 'OUT_DIR [-x EXTENSION]' in p['long'])]
        
        # Group parameters by category
        params_by_category = {}
        for param in params:
            category = param['category'] or 'uncategorized'
            if category not in params_by_category:
                params_by_category[category] = []
            params_by_category[category].append(param)
        
        # Process each category
        for category, category_params in params_by_category.items():
            if category != 'uncategorized':
                help_text.append(f"{category}:")
            
            for param in category_params:
                # Build parameter line
                param_parts = []
                if param['short']:
                    param_parts.append(param['short'])
                if param['long']:
                    param_parts.append(param['long'])
                
                # Modify parameter line format
                if param_parts:
                    param_line = '  '  # Two space indentation
                    if len(param_parts) > 1:
                        param_line += f"{param_parts[0]}, {param_parts[1]}"
                    else:
                        param_line += param_parts[0]
                    help_text.append(param_line)
                
                # Add description with proper indentation
                if param['description']:
                    # Clean up description
                    desc = param['description'].replace('\n', ' ').strip()
                    # Use 24 space indentation
                    wrapped_desc = textwrap.wrap(
                        desc,
                        width=56,
                        initial_indent=' ' * 24,
                        subsequent_indent=' ' * 24
                    )
                    help_text.extend(wrapped_desc)
            
            help_text.append('')  # Add blank line between categories
        
        # Write to output file
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(help_text))
        
        return True
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        return False

def normalize_parameter(param):
    """Standardize parameter string, keeping only key information"""
    # Remove extra spaces
    param = ' '.join(param.split())
    # Keep only parameter name and its first word description (if any)
    parts = param.split(' ', 2)
    if len(parts) > 1:
        # If it's a combination of short and long parameters
        if ',' in parts[0]:
            return parts[0]  # Return format like "-x, --extension"
        return parts[0]  # Return single parameter
    return param

def extract_content_structure(text):
    """Extract content structure, focusing on parameter names and categories"""
    structure = {
        'usage': '',
        'categories': set(),
        'parameters': set(),  # Store only parameter names
        'defaults': set()
    }
    
    lines = text.splitlines()
    current_category = None
    
    for line in lines:
        line = line.strip()
        
        # Capture usage
        if line.startswith('usage:'):
            structure['usage'] = ' '.join(line.split())
            continue
            
        # Capture categories
        if line.endswith('arguments:'):
            current_category = line
            structure['categories'].add(line)
            continue
            
        # Capture parameters
        if line.startswith('--') or line.startswith('-'):
            # Standardize and store parameter name
            param = normalize_parameter(line)
            if param:
                structure['parameters'].add(param)
            
        # Capture default values
        if '(default:' in line:
            match = re.search(r'\(default:.*?\)', line)
            if match:
                structure['defaults'].add(match.group(0))
    
    return structure

def compare_help_pages(original_file, generated_help):
    """Compare core content of help pages, ignoring format differences"""
    with open(original_file, 'r', encoding='utf-8') as f:
        original = f.read()
    
    # Extract content structure
    original_structure = extract_content_structure(original)
    generated_structure = extract_content_structure(generated_help)
    
    # Compare differences
    differences = {
        'missing_parameters': [],
        'missing_categories': [],
        'missing_defaults': [],
        'content_mismatch': []
    }
    
    # Compare parameters (only parameter names)
    orig_params = {p.split()[0] for p in original_structure['parameters']}
    gen_params = {p.split()[0] for p in generated_structure['parameters']}
    
    missing = orig_params - gen_params
    if missing:
        differences['missing_parameters'] = list(missing)
    
    # Compare categories
    orig_cats = {c.strip() for c in original_structure['categories']}
    gen_cats = {c.strip() for c in generated_structure['categories']}
    missing_cats = orig_cats - gen_cats
    if missing_cats:
        differences['missing_categories'] = list(missing_cats)
    
    # Compare default values (only the values themselves)
    orig_defaults = {d.strip('()') for d in original_structure['defaults']}
    gen_defaults = {d.strip('()') for d in generated_structure['defaults']}
    missing_defaults = orig_defaults - gen_defaults
    if missing_defaults:
        differences['missing_defaults'] = list(missing_defaults)
    
    # Check required parameters in usage
    required_params = ['--genome_dir', '--batchfile', '--out_dir']
    missing_required = [p for p in required_params if p not in generated_structure['usage']]
    if missing_required:
        differences['content_mismatch'].append(f'Missing required parameters in usage: {", ".join(missing_required)}')
    
    # Remove empty difference categories
    differences = {k: v for k, v in differences.items() if v}
    
    # Check if completely identical
    is_identical = not any(differences.values())
    
    return is_identical, differences

def main():
    if len(sys.argv) != 4:
        print("Usage: python json_to_help.py <para_file> <usage_file> <output_file>")
        sys.exit(1)

    para_file = sys.argv[1]
    usage_file = sys.argv[2]
    output_file = sys.argv[3]

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    if not json_to_help(para_file, usage_file, output_file):
        sys.exit(1)

if __name__ == '__main__':
    main() 