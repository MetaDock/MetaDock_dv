import os
import json
import re
import sys

def capture_usage_content(input_file, usage_output_file):
    # Read input file
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Store Usage section content
    usage_content = []
    temp_usage = ""  # Temporary string to concatenate the entire Usage section
    capturing_usage = False
    
    for line in lines:
        line = line.strip()

        # Start capturing Usage section
        if line.startswith("Usage:") or line.startswith("usage:")or line.startswith("USAGE"):
            capturing_usage = True
            temp_usage = line  # Initialize temp_usage with Usage line

        # If capturing Usage section, continue saving subsequent content
        elif capturing_usage:
            if line == "":
                # Stop capturing once an empty line is encountered
                usage_content.append(temp_usage)  # Add concatenated Usage section to content
                break
            temp_usage += " " + line  # Append subsequent content to temp_usage (space-separated)

    # Write captured Usage section content to output file in JSON format
    with open(usage_output_file, 'w', encoding='utf-8') as f:
        json.dump({"usage": usage_content}, f, ensure_ascii=False, indent=4)


def process_json(data):
    # Iterate through each entry, process short and long options, update needs_input
    for entry in data:
        short_value = entry["short"]
        long_value = entry["long"]
        description = entry["description"]

        if long_value:
            # Check number of spaces, if multiple spaces exist
            if long_value.count(' ') > 1:
                # Find first part separated by consecutive spaces
                parts = re.split(r'  | : ', long_value, maxsplit=1)
                if len(parts) > 1:
                    long_value = parts[0].strip()
                    # Move remaining content to description
                    entry["description"] = parts[1].strip() + (' ' + description if description else '')

            # Update long value
            entry["long"] = long_value

        if short_value:
            # Check number of spaces, if multiple spaces exist
            if short_value.count(' ') > 1:
                # Find first part separated by consecutive spaces
                parts = re.split(r'  | : ', short_value, maxsplit=1) 
                if len(parts) > 1:
                    short_value = parts[0].strip()
                    # Move remaining content to description
                    entry["description"] = parts[1].strip() + (' ' + description if description else '')

            # Update short value
            entry["short"] = short_value

        # Get short and long fields, replace None with empty string
        short = entry.get("short", "")
        long = entry.get("long", "")
        
        # If short or long is None, set to empty string
        if short is None:
            short = ""
        if long is None:
            long = ""

        # Check if short or long contains spaces
        if (' ' in short) or (' ' in long):
            entry["needs_input"] = True
        else:
            entry["needs_input"] = False

    return data


def parse_and_process_help_file(input_file, output_file):
    """Parse help file, extract parameter information and save as JSON"""
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    parsed_data = []
    current_category = None
    current_param = None
    description_lines = []
    num_lines = len(lines)

    # Use enumerate to ensure i increments correctly
    for i, line in enumerate(lines):
        line = line.strip()

        # Ensure it's a category: ends with ':' and next line starts with '-'
        if line.endswith(':') and i + 1 < num_lines and lines[i + 1].strip().startswith('-'):
            if current_param:
                current_param['description'] = '\n'.join(description_lines)
                parsed_data.append(current_param)
            
            current_category = line[:-1]  # Record current category
            current_param = None
            description_lines = []
        
        elif line.startswith('-'):
            if current_param:
                current_param['description'] = '\n'.join(description_lines)
                parsed_data.append(current_param)

            # Parse parameter
            current_param = {
                'category': current_category, 
                'short': None, 
                'long': None, 
                'needs_input': False, 
                'description': None
            }

            # First try comma separation
            parts = line.split(', ')
            if len(parts) == 1:
                # If no comma, try space or slash separation (must be followed by -)
                parts = re.split(r'[\s/]+(?=-)', line)
            
            previous_part = None  # Record last valid option type
            
            for part in parts:
                option = part.strip()
                
                if option.startswith('--'):
                    current_param['long'] = option
                    previous_part = 'long'
                elif option.startswith('-'):
                    current_param['short'] = option
                    previous_part = 'short'
                else:
                    if option.startswith(' '):
                        break
                    # Append to previous option
                    if previous_part == 'long' and current_param['long']:
                        current_param['long'] += ", " + option
                    elif previous_part == 'short' and current_param['short']:
                        current_param['short'] += ", " + option

            # Check if input is needed
            current_param['needs_input'] = len(parts) > 1
            description_lines = []

        else:
            description_lines.append(line)

    # Process last parameter
    if current_param:
        current_param['description'] = '\n'.join(description_lines)
        parsed_data.append(current_param)

    # Process data
    processed_data = process_json(parsed_data)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(processed_data, f, ensure_ascii=False, indent=4)

def extract_flags_from_txt(input_file, output_file):
    """Parse lines ending with ':' or starting with 'Flags' in .txt file and append to _para.json"""
    with open(input_file, 'r', encoding='utf-8') as file:
        lines = file.readlines()

    extracting = False
    current_category = None
    parameters = []

    for i, line in enumerate(lines):
        line = line.strip()

        # Identify lines ending with ':' or starting with "Flags"
        if (line.endswith(":") and "  " not in line) or line == "Flags":
            current_category = line.strip(':')
            extracting = True
            continue  

        if extracting:
            # Match parameters in key=value format
            match = re.match(r'(\S+)=([^ ]*)\s*(.*)', line)
            if match:
                short = match.group(1) + '='  
                long = match.group(2) if match.group(2) else "null"  
                description = match.group(3).strip()

                # Check for line continuation in description
                j = i + 1
                while j < len(lines) and lines[j].startswith(" "):  
                    description += " " + lines[j].strip()
                    j += 1  

                parameters.append({
                    "category": current_category,
                    "short": short,
                    "long": long,
                    "needs_input": True,
                    "description": description if description else "No description available"
                })

    # Read existing _para.json (if exists)
    if os.path.exists(output_file):
        with open(output_file, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
    else:
        existing_data = []

    # Append newly parsed data
    existing_data.extend(parameters)

    # Write updated JSON
    with open(output_file, 'w', encoding='utf-8') as outfile:
        json.dump(existing_data, outfile, ensure_ascii=False, indent=4)
        
def batch_process(input_folder, output_folder):
    """Batch process txt files in help folder"""
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    for filename in os.listdir(input_folder):
        if filename.endswith(".txt"):
            input_path = os.path.join(input_folder, filename)
            base_name = os.path.splitext(filename)[0]
            para_output_path = os.path.join(output_folder, f"{base_name}_para.json")
            usage_output_path = os.path.join(output_folder, f"{base_name}_usage.json")

            capture_usage_content(input_path, usage_output_path)
            parse_and_process_help_file(input_path, para_output_path)
            extract_flags_from_txt(input_path, para_output_path)  # Append flag information

def process_single_file(input_file, output_folder):
    """Process single file"""
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    base_name = os.path.splitext(os.path.basename(input_file))[0]
    para_output_path = os.path.join(output_folder, f"{base_name}_para.json")
    usage_output_path = os.path.join(output_folder, f"{base_name}_usage.json")

    capture_usage_content(input_file, usage_output_path)
    parse_and_process_help_file(input_file, para_output_path)
    extract_flags_from_txt(input_file, para_output_path)  # Append flag information

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python param.py <input_file> <para_output_file> <usage_output_file>")
        sys.exit(1)

    input_file = sys.argv[1]
    para_output_file = sys.argv[2]
    usage_output_file = sys.argv[3]

    # Ensure output directory exists
    os.makedirs(os.path.dirname(para_output_file), exist_ok=True)
    os.makedirs(os.path.dirname(usage_output_file), exist_ok=True)

    # Process file
    capture_usage_content(input_file, usage_output_file)
    parse_and_process_help_file(input_file, para_output_file)
    extract_flags_from_txt(input_file, para_output_file)

