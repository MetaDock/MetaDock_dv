#!/usr/bin/env python3
"""
LLM-based Parameter Extractor for Command-line Tools
Extracts parameters from help text using Large Language Models
"""

import os
import json
import re
import sys
import argparse
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from dotenv import load_dotenv
import difflib
from llm_client import get_llm_client

# Load environment variables
load_dotenv()


class LLMParameterExtractor:
    def __init__(self, api_key: Optional[str] = None, model: str = "qwen-plus"):
        """Initialize the LLM Parameter Extractor"""
        self.llm_client = get_llm_client(api_key=api_key, model=model)
        self.model = model
        
    def extract_usage(self, help_text: str, tool_name: str) -> Dict:
        """Extract usage information from help text"""
        prompt = f"""
Extract the usage/syntax line(s) from this command-line tool help text for {tool_name}.

LOOK FOR MULTIPLE USAGE PATTERNS:
1. Traditional format: "usage:", "Usage:", "USAGE:"
2. Direct syntax: Lines showing command syntax without "usage:" prefix
3. Example format: Lines starting with tool name showing syntax
4. Description format: Usage information embedded in description paragraphs

CRITICAL REQUIREMENTS:
1. Extract usage lines EXACTLY as they appear in the help text
2. Include ALL lines that are part of the usage syntax (including continuation lines)
3. Handle different formats:
   - "Usage: tool [options]"
   - "tool.sh in=<input> out=<output>"
   - "Description: ... Usage: ..."
   - Multi-line usage blocks
4. Do not modify, shorten, or rewrite the usage lines
5. Preserve all spacing, indentation, and formatting exactly as shown
6. Include the complete usage block from start to end
7. If multiple usage examples exist, include all of them

COMMON USAGE INDICATORS:
- Lines containing "usage:", "Usage:", "USAGE:"
- Lines starting with the tool name followed by parameters
- Lines in format: "tool [options] arguments"
- Lines showing command syntax patterns
- Example command lines

Help text:
{help_text}

Return a JSON object with this format:
{{
    "usage": ["usage line 1", "usage line 2", ...]
}}

Each line should be copied exactly as it appears in the help text, including all spaces and indentation.
If no clear usage lines are found, return an empty array.
"""
        
        try:
            response = self.llm_client.chat_completion([
                {"role": "system", "content": "You are a precise tool for extracting command-line usage information. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ])
            
            result = response.choices[0].message.content.strip()
            # Remove any markdown code block markers
            result = re.sub(r'```json\n?|```\n?', '', result)
            
            usage_data = json.loads(result)
            return usage_data
            
        except json.JSONDecodeError as e:
            print(f"JSON parsing error in usage: {e}")
            return {"usage": []}
        except Exception as e:
            print(f"Error extracting usage: {e}")
            return {"usage": []}

    def _split_large_text(self, text: str, max_chars: int = 12000) -> List[str]:
        """Split large text into smaller chunks for processing"""
        if len(text) <= max_chars:
            return [text]
        
        # Try to split by sections first
        sections = re.split(r'\n\n(?=[A-Z][^:\n]*:)', text)
        chunks = []
        current_chunk = ""
        
        for section in sections:
            if len(current_chunk) + len(section) <= max_chars:
                current_chunk += section + "\n\n"
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = section + "\n\n"
        
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks

    def extract_parameters(self, help_text: str, tool_name: str) -> List[Dict]:
        """Extract parameters from help text using LLM"""
        # Check if file is too large and needs splitting
        if len(help_text) > 12000:
            chunks = self._split_large_text(help_text)
            all_parameters = []
            
            for i, chunk in enumerate(chunks):
                chunk_params = self._extract_parameters_from_chunk(chunk, tool_name, i+1)
                all_parameters.extend(chunk_params)
            
            return all_parameters
        else:
            return self._extract_parameters_from_chunk(help_text, tool_name)
    
    def _extract_parameters_from_chunk(self, help_text: str, tool_name: str, chunk_num: int = None) -> List[Dict]:
        """Extract parameters from a single chunk of help text"""
        chunk_info = f" (chunk {chunk_num})" if chunk_num else ""
        prompt = f"""
Analyze this command-line tool help text for {tool_name} and extract ALL parameters/options EXACTLY as they appear in the help text.

CRITICAL REQUIREMENTS:
1. Extract parameters in the EXACT SAME ORDER as they appear in the help text
2. Handle MULTIPLE parameter formats:
   - Traditional: --option, -o, --output FILE
   - Key-value: option=value, in=<file>, threads=auto
   - Positional: <genome>, <input>, [optional]
   - Java flags: -Xmx, -da, -eoom
3. Copy descriptions EXACTLY as written - do not modify, shorten, or rewrite
4. Preserve all line breaks and formatting in descriptions
5. Do not add any parameters that don't exist in the help text
6. Do not skip any parameters that are present in the help text

For each parameter, identify:

1. category: The exact section name from help text (e.g., "Input parameters", "Output parameters", "Processing parameters", "positional arguments", etc.)
   - If no clear section, use null
   - Use the exact heading text from the help document
2. short: The shorter form of the parameter or null if none
   - For key=value format: use "key=" (e.g., "in=", "threads=")
   - For traditional format: use short option (e.g., "-h", "-o")
   - For Java flags: use the flag (e.g., "-Xmx", "-da")
3. long: The longer form or value placeholder, or null if none
   - For key=value format: use the value part (e.g., "<file>", "auto", "<seq,seq>")
   - For traditional format: use long option (e.g., "--help", "--output")
   - For positional: use the exact placeholder (e.g., "<genome>", "<input>")
4. needs_input: true if the parameter requires a value, false if it's a flag
   - true for: key=<value>, --option VALUE, positional arguments
   - false for: flags like --verbose, -h, -da
5. description: The COMPLETE description text exactly as it appears in help text

PARAMETER FORMAT EXAMPLES:
- "in=<file>" → short: "in=", long: "<file>", needs_input: true
- "--help" → short: null, long: "--help", needs_input: false
- "-o OUTPUT" → short: "-o", long: "OUTPUT", needs_input: true
- "threads=auto" → short: "threads=", long: "auto", needs_input: true
- "<genome>" → short: null, long: "<genome>", needs_input: true
- "-Xmx" → short: "-Xmx", long: null, needs_input: false

SPECIAL HANDLING FOR KEY=VALUE FORMAT (like bbduk):
- Look for lines starting with parameter names followed by "="
- The part before "=" is the parameter name (use as short with "=" suffix)
- The part after "=" is the value type/default (use as long)
- Description usually follows on the same line after spaces
- Example: "in=<file>           Main input. in=stdin.fq will pipe from stdin."
  → short: "in=", long: "<file>", description: "Main input. in=stdin.fq will pipe from stdin."

Important rules:
- Maintain the exact order from the help text
- Include ALL parameters from ALL sections
- Handle mixed parameter formats within the same tool
- Preserve exact capitalization and punctuation
- Copy descriptions with all formatting, line breaks, and whitespace

WHAT TO EXTRACT (include these):
- Lines with key=value format (e.g., "in=<file>", "threads=auto")
- Traditional options (e.g., "--help", "-v", "--output FILE")
- Java flags (e.g., "-Xmx", "-da", "-eoom")
- Positional arguments (e.g., "<genome>", "<input>")

WHAT NOT TO EXTRACT (skip these):
- Pure description lines without parameter names
- Section headers ending with ":"
- Example usage lines that are just demonstrations
- Lines that are part of multi-line descriptions
- Lines starting with "You can also use" or "Can also be"
- Lines that are explanatory text, not parameter definitions

Help text:
{help_text}

Return a JSON array of objects with this exact format:
[
    {{
        "category": "Input parameters",
        "short": "in=",
        "long": "<file>",
        "needs_input": true,
        "description": "Main input. in=stdin.fq will pipe from stdin."
    }},
    {{
        "category": "Java Parameters",
        "short": "-Xmx",
        "long": null,
        "needs_input": false,
        "description": "This will be passed to Java to set memory usage, overriding the program's automatic memory detection."
    }}
]
"""

        try:
            response = self.llm_client.chat_completion([
                {"role": "system", "content": "You are an expert at analyzing command-line tool documentation. Extract parameters with perfect accuracy and return only valid JSON."},
                {"role": "user", "content": prompt}
            ])
            
            result = response.choices[0].message.content.strip()
            # Remove any markdown code block markers
            result = re.sub(r'```json\n?|```\n?', '', result)
            
            # Parse JSON
            parameters = json.loads(result)
            return parameters
            
        except json.JSONDecodeError as e:
            print(f"JSON parsing error: {e}")
            return []
        except Exception as e:
            print(f"Error extracting parameters: {e}")
            return []

    def validate_parameters(self, parameters: List[Dict]) -> Tuple[bool, List[str]]:
        """Validate extracted parameters"""
        errors = []
        required_fields = ["category", "short", "long", "needs_input", "description"]
        
        for i, param in enumerate(parameters):
            # Check required fields
            for field in required_fields:
                if field not in param:
                    errors.append(f"Parameter {i}: Missing field '{field}'")
            
            # Check field types
            if "needs_input" in param and not isinstance(param["needs_input"], bool):
                errors.append(f"Parameter {i}: 'needs_input' must be boolean")
                
            # Check that at least short or long is provided
            if not param.get("short") and not param.get("long"):
                errors.append(f"Parameter {i}: Must have either 'short' or 'long' option")
                
        return len(errors) == 0, errors

    def process_help_file(self, help_file: Path, tool_name: str, output_dir: Path) -> bool:
        """Process a help file and generate parameter and usage JSON files"""
        try:
            # Read help file
            with open(help_file, 'r', encoding='utf-8') as f:
                help_text = f.read()
            
            # Extract usage
            usage_data = self.extract_usage(help_text, tool_name)
            
            # Extract parameters
            parameters = self.extract_parameters(help_text, tool_name)
            
            # Validate parameters
            is_valid, errors = self.validate_parameters(parameters)
            if not is_valid:
                for error in errors:
                    print(f"Validation error: {error}")
            
            # Create output directory if it doesn't exist
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # Write parameter file
            param_file = output_dir / f"{tool_name}_para.json"
            with open(param_file, 'w', encoding='utf-8') as f:
                json.dump(parameters, f, ensure_ascii=False, indent=4)
            
            # Write usage file
            usage_file = output_dir / f"{tool_name}_usage.json"
            with open(usage_file, 'w', encoding='utf-8') as f:
                json.dump(usage_data, f, ensure_ascii=False, indent=4)
            
            print(f"Generated files:")
            print(f"  - {param_file}")
            print(f"  - {usage_file}")
            
            return True
            
        except Exception as e:
            print(f"Error processing help file: {e}")
            return False
    


def main():
    parser = argparse.ArgumentParser(description="Extract parameters from command-line tool help text using LLM")
    parser.add_argument("help_file", type=Path, help="Path to the help text file")
    parser.add_argument("tool_name", help="Name of the tool (e.g., 'bakta_v1.11.0')")
    parser.add_argument("-o", "--output", type=Path, default=Path("output"), 
                       help="Output directory for generated JSON files")
    parser.add_argument("--model", default="qwen-plus", 
                       help="Model to use (qwen-plus, qwen-turbo, qwen-max)")
    parser.add_argument("--api-key", help="DashScope API key (or set DASHSCOPE_API_KEY env var)")
    
    args = parser.parse_args()
    
    # Check if help file exists
    if not args.help_file.exists():
        print(f"Error: Help file '{args.help_file}' not found")
        return 1
    
    try:
        # Initialize extractor
        extractor = LLMParameterExtractor(
            api_key=args.api_key, 
            model=args.model
        )
        
        # Process the help file
        success = extractor.process_help_file(args.help_file, args.tool_name, args.output)
        
        if success:
            print(f"Successfully processed {args.help_file}")
            return 0
        else:
            print(f"Failed to process {args.help_file}")
            return 1
            
    except Exception as e:
        print(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())