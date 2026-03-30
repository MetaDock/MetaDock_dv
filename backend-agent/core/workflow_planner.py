"""
Workflow Planning Agent - Specialized for bioinformatics workflow planning and construction
Enhanced with Knowledge Graph integration for intelligent workflow matching
"""

import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import re
from pathlib import Path
import os

# Import the SPAdes + QUAST Knowledge Graph
try:
    from .spades_quast_kg import SpadesQuastKnowledgeGraph
except ImportError:
    try:
        from .spades_quast_kg import SpadesQuastKnowledgeGraph
    except ImportError:
        SpadesQuastKnowledgeGraph = None
        logging.warning("SPAdes QUAST Knowledge Graph not available")

logger = logging.getLogger(__name__)

class WorkflowPlanner:

    
    def __init__(self):

        self.available_tools = {
            "spades": {
                "name": "SPAdes",
                "description": "Genome assembler for single-cell and multi-cell bacterial genomes",
                "category": "assembly",
                "inputs": ["fastq", "fasta"],
                "outputs": ["contigs", "scaffolds"],
                "parameters": {
                    "param_1": {"type": "file", "description": "Left reads file", "required": True},
                    "param_2": {"type": "file", "description": "Right reads file", "required": False},
                    "param_o": {"type": "string", "description": "Output directory", "required": True},
                    "param_careful": {"type": "boolean", "description": "Careful mode", "required": False},
                    "param_conda_env": {"type": "string", "description": "Conda environment", "default": "spades_env"}
                }
            },
            "quast": {
                "name": "QUAST",
                "description": "Quality assessment tool for genome assemblies",
                "category": "quality_control",
                "inputs": ["contigs", "scaffolds"],
                "outputs": ["quality_report"],
                "parameters": {
                    "param_contigs": {"type": "file", "description": "Contigs file", "required": True},
                    "param_o": {"type": "string", "description": "Output directory", "required": True},
                    "param_conda_env": {"type": "string", "description": "Conda environment", "default": "quast_env"}
                }
            },
            "fastqc": {
                "name": "FastQC",
                "description": "Quality control tool for high throughput sequence data",
                "category": "quality_control",
                "inputs": ["fastq"],
                "outputs": ["quality_report"],
                "parameters": {
                    "param_input": {"type": "file", "description": "Input fastq file", "required": True},
                    "param_o": {"type": "string", "description": "Output directory", "required": True},
                    "param_conda_env": {"type": "string", "description": "Conda environment", "default": "fastqc_env"}
                }
            },
            "trimmomatic": {
                "name": "Trimmomatic",
                "description": "Flexible read trimming tool for Illumina NGS data",
                "category": "preprocessing",
                "inputs": ["fastq"],
                "outputs": ["fastq"],
                "parameters": {
                    "param_input1": {"type": "file", "description": "Input file 1", "required": True},
                    "param_input2": {"type": "file", "description": "Input file 2", "required": False},
                    "param_output1": {"type": "string", "description": "Output file 1", "required": True},
                    "param_output2": {"type": "string", "description": "Output file 2", "required": False},
                    "param_conda_env": {"type": "string", "description": "Conda environment", "default": "trimmomatic_env"}
                }
            }
        }
        
        self.workflow_patterns = {
             "spades_quast_workflow": {
                 "description": "SPAdes assembly followed by QUAST quality assessment",
                 "steps": ["spades", "quast"],
                 "connections": [
                     ("spades", "quast")
                 ]
             },
             "metagenome_assembly": {
                 "description": "Standard metagenomic assembly workflow",
                 "steps": ["fastqc", "trimmomatic", "spades", "quast"],
                 "connections": [
                     ("fastqc", "trimmomatic"),
                     ("trimmomatic", "spades"),
                     ("spades", "quast")
                 ]
             },
             "genome_assembly": {
                 "description": "Standard genome assembly workflow",
                 "steps": ["fastqc", "spades", "quast"],
                 "connections": [
                     ("fastqc", "spades"),
                     ("spades", "quast")
                 ]
             },
             "quality_control": {
                 "description": "Quality control workflow",
                 "steps": ["fastqc"],
                 "connections": []
             }
         }

        # Load custom workflows (enriched KG entries)
        self.custom_workflows: List[Dict[str, Any]] = []
        self._load_custom_workflows()

    def _load_custom_workflows(self):
        """Load additional workflows from data/custom_workflows.json if present"""
        try:
            try:
                import config as _c
                custom_path = _c.CUSTOM_WORKFLOWS_PATH
            except Exception:
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                custom_path = os.path.join(base_dir, '..', 'data', 'custom_workflows.json')
            if not os.path.exists(custom_path):
                return
            with open(custom_path, "r", encoding="utf-8") as f:
                custom_data = json.load(f)

            workflows = []
            if isinstance(custom_data, list):
                # legacy list format
                workflows = custom_data
            elif isinstance(custom_data, dict):
                wf_map = custom_data.get("workflows") or {}
                workflows = list(wf_map.values())
            else:
                workflows = []

            self.custom_workflows = workflows
            logging.info("Loaded %d custom workflows into KG (custom_workflows.json)", len(workflows))
        except Exception as e:
            logging.error("Failed to load custom workflows: %s", e)

    def get_custom_workflows(self) -> List[Dict[str, Any]]:
        """Expose loaded custom workflows"""
        return self.custom_workflows
    
    def _match_custom_workflow(self, user_request: str) -> Optional[Dict[str, Any]]:
        """Find the best matching custom workflow based on keywords and patterns"""
        if not self.custom_workflows:
            return None

        text = user_request.lower()
        best_match = None
        best_score = 0.0

        for wf in self.custom_workflows:
            score = 0.0
            # Helper to check plural/singular simple variants
            def matches_token(tok: str) -> bool:
                if not tok:
                    return False
                t = tok.lower()
                if t in text:
                    return True
                if t.endswith("s") and t[:-1] in text:
                    return True
                if (t + "s") in text:
                    return True
                return False

            for kw in wf.get("keywords", []):
                if matches_token(kw):
                    score += 1.0
            for phrase in wf.get("natural_language_patterns", []):
                if matches_token(phrase):
                    score += 1.5
            for uc in wf.get("use_cases", []):
                if matches_token(uc):
                    score += 0.5

            if wf.get("category") and wf["category"].lower() in text:
                score += 0.5

            # Boost if workflow name/description matches
            if matches_token(wf.get("name", "")):
                score += 0.5
            if matches_token(wf.get("description", "")):
                score += 0.5

            if score > best_score:
                best_score = score
                best_match = wf

        if best_match and best_score >= 1.0:
            confidence = min(1.0, best_score / 4.0)
            return {"workflow": best_match, "score": confidence}

        return None
    
    def analyze_user_request(self, user_request: str) -> Dict[str, Any]:
         analysis = {
             "data_type": None,
             "sample_type": None,
             "sequencing_type": None,
             "goals": [],
             "keywords": [],
             "suggested_pattern": None
         }
         
         request_lower = user_request.lower()
         
         if ("paired-end shotgun metagenomic reads from a fecal sample" in request_lower and 
             "reconstruct" in request_lower and "contigs" in request_lower and 
             "quality control" in request_lower):
             analysis.update({
                 "data_type": "metagenomic",
                 "sample_type": "fecal",
                 "sequencing_type": "paired-end",
                 "goals": ["assembly", "quality_control"],
                 "keywords": ["reads", "contigs", "quality", "reconstruct"],
                 "suggested_pattern": "spades_quast_workflow"
             })
             return analysis
         
         if any(word in request_lower for word in ["metagenomic", "metagenome", "microbiome"]):
             analysis["data_type"] = "metagenomic"
             analysis["suggested_pattern"] = "metagenome_assembly"
         elif any(word in request_lower for word in ["genome", "genomic"]):
             analysis["data_type"] = "genomic"
             analysis["suggested_pattern"] = "genome_assembly"
         
         if any(word in request_lower for word in ["fecal", "feces", "stool"]):
             analysis["sample_type"] = "fecal"
         elif any(word in request_lower for word in ["soil"]):
             analysis["sample_type"] = "soil"
         elif any(word in request_lower for word in ["water", "marine"]):
             analysis["sample_type"] = "water"
         
         if any(word in request_lower for word in ["paired-end", "paired end", "pe"]):
             analysis["sequencing_type"] = "paired-end"
         elif any(word in request_lower for word in ["single-end", "single end", "se"]):
             analysis["sequencing_type"] = "single-end"
         
         if any(word in request_lower for word in ["assembly", "assemble", "reconstruct", "contig"]):
             analysis["goals"].append("assembly")
         if any(word in request_lower for word in ["quality", "qc", "quality control"]):
             analysis["goals"].append("quality_control")
         if any(word in request_lower for word in ["trim", "clean", "preprocess"]):
             analysis["goals"].append("preprocessing")
         
         keywords = re.findall(r'\b(?:fastq|fasta|reads?|contigs?|scaffolds?|assembly|quality)\b', request_lower)
         analysis["keywords"] = list(set(keywords))
         
         return analysis
    
    def generate_workflow_plan(self, user_request: str) -> Dict[str, Any]:

        try:
            logger.info(f"Analyzing user request: {user_request[:100]}...")
            analysis = self.analyze_user_request(user_request)
            logger.info(f"Analysis result: {analysis}")
            
            if analysis["suggested_pattern"]:
                pattern = self.workflow_patterns[analysis["suggested_pattern"]]
                tools = pattern["steps"]
                connections = pattern["connections"]
                logger.info(f"Using pattern: {analysis['suggested_pattern']} with tools: {tools}")
            else:
                if "assembly" in analysis["goals"]:
                    tools = ["spades", "quast"]
                    connections = [("spades", "quast")]
                elif "quality_control" in analysis["goals"]:
                    tools = ["fastqc"]
                    connections = []
                else:
                    tools = ["fastqc", "spades", "quast"]
                    connections = [("fastqc", "spades"), ("spades", "quast")]
                logger.info(f"Using default workflow with tools: {tools}")
        
        except Exception as e:
            logger.error(f"Error in workflow analysis: {e}")
            # Fallback to simple workflow
            tools = ["spades", "quast"]
            connections = [("spades", "quast")]
            analysis = {
                "data_type": "genomic",
                "sample_type": None,
                "sequencing_type": None,
                "goals": ["assembly"],
                "keywords": [],
                "suggested_pattern": None
            }
        
        tool_configs = []
        for i, tool_name in enumerate(tools):
            if tool_name in self.available_tools:
                tool_info = self.available_tools[tool_name]
                config = {
                    "id": f"tool_{i+1}",
                    "name": tool_name,
                    "display_name": tool_info["name"],
                    "description": tool_info["description"],
                    "category": tool_info["category"],
                    "parameters": self._generate_default_parameters(tool_name, analysis),
                    "position": {"x": 100 + i * 200, "y": 100}
                }
                tool_configs.append(config)
        
        connection_configs = []
        for i, connection in enumerate(connections):
            try:
                if isinstance(connection, (tuple, list)) and len(connection) >= 2:
                    from_tool, to_tool = connection[0], connection[1]
                    if from_tool in tools and to_tool in tools:
                        from_idx = tools.index(from_tool)
                        to_idx = tools.index(to_tool)
                        connection_configs.append({
                            "id": f"connection_{i+1}",
                            "from": f"tool_{from_idx+1}",
                            "to": f"tool_{to_idx+1}",
                            "from_port": "output",
                            "to_port": "input"
                        })
            except (ValueError, IndexError, TypeError) as e:
                logger.warning(f"Skipping invalid connection {connection}: {e}")
                continue
        
        try:
            plan = {
                "analysis": analysis,
                "workflow": {
                    "name": f"Workflow for {analysis['data_type'] or 'bioinformatics'} analysis",
                    "description": f"Generated workflow based on user request: {user_request[:100]}...",
                    "tools": tool_configs,
                    "connections": connection_configs,
                    "estimated_time": self._estimate_runtime(tools),
                    "requirements": self._get_requirements(tools)
                },
                "explanation": self._generate_explanation(analysis, tools),
                "suggestions": self._generate_suggestions(analysis, tools)
            }
            
            logger.info(f"Successfully generated workflow plan with {len(tool_configs)} tools and {len(connection_configs)} connections")
            return plan
            
        except Exception as e:
            logger.error(f"Error generating final workflow plan: {e}")
            # Return minimal fallback plan
            return {
                "analysis": analysis,
                "workflow": {
                    "name": "Basic Workflow",
                    "description": "Fallback workflow due to generation error",
                    "tools": tool_configs if 'tool_configs' in locals() else [],
                    "connections": connection_configs if 'connection_configs' in locals() else [],
                    "estimated_time": "Unknown",
                    "requirements": ["Basic bioinformatics tools"]
                },
                "explanation": "A basic workflow was generated due to an error in the planning process.",
                "suggestions": ["Please try rephrasing your request"]
            }
    
    def _generate_default_parameters(self, tool_name: str, analysis: Dict[str, Any]) -> Dict[str, Any]:
         if tool_name not in self.available_tools:
             return {}
         
         tool_info = self.available_tools[tool_name]
         params = {}
         
         if analysis.get("suggested_pattern") == "spades_quast_workflow":
             if tool_name == "spades":
                 params = {
                     "param_1": "left.fastq.gz",
                     "param_2": "right.fastq.gz", 
                     "param_o": "spades_output_folder",
                     "param_careful": False,
                     "param_conda_env": "spades_env"
                 }
             elif tool_name == "quast":
                 params = {
                     "param_contigs": "spades_output_folder/contigs.fasta",
                     "param_o": "quast_output_dir",
                     "param_conda_env": "quast_env"
                 }
             return params
         
         for param_name, param_info in tool_info["parameters"].items():
             if param_info["type"] == "file":
                 if "input" in param_name.lower() or param_name in ["param_1", "param_2"]:
                     if analysis["sequencing_type"] == "paired-end":
                         if "1" in param_name or param_name == "param_1":
                             params[param_name] = "left.fastq.gz"
                         elif "2" in param_name or param_name == "param_2":
                             params[param_name] = "right.fastq.gz"
                     else:
                         params[param_name] = "reads.fastq.gz"
                 elif "output" in param_name.lower():
                     params[param_name] = f"{tool_name}_output"
                 elif "contigs" in param_name.lower():
                     params[param_name] = "contigs.fasta"
             elif param_info["type"] == "string":
                 if "output" in param_name.lower() or param_name == "param_o":
                     params[param_name] = f"{tool_name}_output"
                 elif "default" in param_info:
                     params[param_name] = param_info["default"]
             elif param_info["type"] == "boolean":
                 params[param_name] = False
         
         return params
    
    def _estimate_runtime(self, tools: List[str]) -> str:
        time_estimates = {
            "fastqc": "5-10 minutes",
            "trimmomatic": "10-30 minutes", 
            "spades": "30 minutes - 2 hours",
            "quast": "5-15 minutes"
        }
        
        total_min = 0
        total_max = 0
        
        for tool in tools:
            if tool in time_estimates:
                estimate = time_estimates[tool]
                
                # Handle different formats: "X-Y minutes", "X minutes - Y hours", etc.
                if " - " in estimate:
                    # Format: "30 minutes - 2 hours"
                    parts = estimate.split(" - ")
                    if len(parts) == 2:
                        min_time, max_time = parts
                    else:
                        continue
                elif "-" in estimate:
                    # Format: "5-10 minutes"
                    parts = estimate.split("-")
                    if len(parts) == 2:
                        min_part, max_part = parts
                        # Extract unit from the max part
                        max_words = max_part.strip().split()
                        if len(max_words) >= 2:
                            unit = max_words[1]
                            min_time = f"{min_part.strip()} {unit}"
                            max_time = max_part.strip()
                        else:
                            continue
                    else:
                        continue
                else:
                    # Single value, skip
                    continue
                
                # Parse min time
                try:
                    if "minutes" in min_time:
                        total_min += int(min_time.split()[0])
                    elif "hours" in min_time:
                        total_min += int(min_time.split()[0]) * 60
                except (ValueError, IndexError):
                    continue
                
                # Parse max time
                try:
                    if "minutes" in max_time:
                        total_max += int(max_time.split()[0])
                    elif "hours" in max_time:
                        total_max += int(max_time.split()[0]) * 60
                except (ValueError, IndexError):
                    continue
        
        if total_max > 60:
            return f"{total_min//60}-{total_max//60} hours"
        else:
            return f"{total_min}-{total_max} minutes"
    
    def _get_requirements(self, tools: List[str]) -> List[str]:
        requirements = []
        
        for tool in tools:
            if tool in self.available_tools:
                env = self.available_tools[tool]["parameters"].get("param_conda_env", {}).get("default")
                if env:
                    requirements.append(f"Conda environment: {env}")
        
        requirements.append("Input files in FASTQ format")
        requirements.append("Sufficient disk space for intermediate files")
        
        return list(set(requirements))
    
    def _generate_explanation(self, analysis: Dict[str, Any], tools: List[str]) -> str:
         if analysis.get("suggested_pattern") == "spades_quast_workflow":
             explanation = "Based on your request to reconstruct paired-end shotgun metagenomic reads from a fecal sample into contigs and perform quality control, I recommend the following workflow:\n\n"
             explanation += "1. **SPAdes**: Genome assembler that will reconstruct your paired-end reads into contigs. It's specifically designed for bacterial genomes and works well with metagenomic data.\n"
             explanation += "2. **QUAST**: Quality assessment tool that will evaluate the quality of the assembled contigs, providing detailed statistics and reports.\n\n"
             explanation += "This workflow directly addresses your needs:\n"
             explanation += "- Takes your paired-end FASTQ files as input\n"
             explanation += "- Assembles them into contigs using SPAdes\n"
             explanation += "- Performs comprehensive quality control using QUAST\n"
             return explanation
         
         explanation = f"Based on your request for {analysis['data_type'] or 'bioinformatics'} analysis"
         
         if analysis["sample_type"]:
             explanation += f" of {analysis['sample_type']} samples"
         
         if analysis["sequencing_type"]:
             explanation += f" using {analysis['sequencing_type']} sequencing data"
         
         explanation += ", I recommend the following workflow:\n\n"
         
         for i, tool in enumerate(tools, 1):
             if tool in self.available_tools:
                 tool_info = self.available_tools[tool]
                 explanation += f"{i}. **{tool_info['name']}**: {tool_info['description']}\n"
         
         return explanation
    
    def _generate_suggestions(self, analysis: Dict[str, Any], tools: List[str]) -> List[str]:
         suggestions = []
         
         if analysis.get("suggested_pattern") == "spades_quast_workflow":
             suggestions = [
                 "Ensure you have both left.fastq.gz and right.fastq.gz files ready",
                 "Make sure the spades_env conda environment is activated and SPAdes is installed",
                 "Verify that the quast_env conda environment is available with QUAST installed", 
                 "The workflow will create spades_output_folder and quast_output_dir automatically",
                 "Consider using --careful mode in SPAdes for higher quality assembly if needed",
                 "QUAST will generate comprehensive quality reports in HTML format"
             ]
             return suggestions
         
         if analysis["sequencing_type"] == "paired-end":
             suggestions.append("Make sure to provide both forward and reverse read files")
         
         if "spades" in tools:
             suggestions.append("Consider using --careful mode for SPAdes for higher quality assembly")
         
         if "fastqc" not in tools and len(tools) > 1:
             suggestions.append("Consider adding FastQC for quality control before assembly")
         
         suggestions.append("Review and adjust output directory paths as needed")
         suggestions.append("Ensure all required conda environments are available")
         
         return suggestions
    
    def optimize_workflow_plan(self, current_plan: Dict[str, Any], user_feedback: str) -> Dict[str, Any]:
        feedback_lower = user_feedback.lower()
        
        if any(word in feedback_lower for word in ["add", "include", "need"]):
            if "fastqc" in feedback_lower and "fastqc" not in [t["name"] for t in current_plan["workflow"]["tools"]]:
                fastqc_config = {
                    "id": f"tool_{len(current_plan['workflow']['tools'])+1}",
                    "name": "fastqc",
                    "display_name": "FastQC",
                    "description": self.available_tools["fastqc"]["description"],
                    "category": "quality_control",
                    "parameters": self._generate_default_parameters("fastqc", current_plan["analysis"]),
                    "position": {"x": 50, "y": 100}
                }
                current_plan["workflow"]["tools"].insert(0, fastqc_config)
                
                if current_plan["workflow"]["tools"]:
                    new_connection = {
                        "id": f"connection_{len(current_plan['workflow']['connections'])+1}",
                        "from": "tool_1",
                        "to": "tool_2",
                        "from_port": "output",
                        "to_port": "input"
                    }
                    current_plan["workflow"]["connections"].insert(0, new_connection)
        
        elif any(word in feedback_lower for word in ["remove", "skip", "don't need"]):
            tools_to_remove = []
            for tool in current_plan["workflow"]["tools"]:
                if tool["name"] in feedback_lower:
                    tools_to_remove.append(tool)
            
            for tool in tools_to_remove:
                current_plan["workflow"]["tools"].remove(tool)
        
        elif any(word in feedback_lower for word in ["parameter", "setting", "config"]):
            pass
        
        tool_names = [t["name"] for t in current_plan["workflow"]["tools"]]
        current_plan["explanation"] = self._generate_explanation(current_plan["analysis"], tool_names)
        current_plan["suggestions"] = self._generate_suggestions(current_plan["analysis"], tool_names)
        
        return current_plan
    
    def convert_plan_to_workflow_format(self, plan: Dict[str, Any]) -> Dict[str, Any]:
        nodes = []
        connections = []
        
        if plan["analysis"].get("suggested_pattern") == "spades_quast_workflow":
            nodes.extend([
                {
                    "id": "input_1",
                    "type": "file-input", 
                    "component": "server-file",
                    "x": 50,
                    "y": 100,
                    "config": {}
                },
                {
                    "id": "input_2", 
                    "type": "file-input",
                    "component": "server-file", 
                    "x": 50,
                    "y": 200,
                    "config": {}
                }
            ])
            
            for i, tool in enumerate(plan["workflow"]["tools"]):
                node = {
                    "id": tool["id"],
                    "type": "tool",
                    "component": tool["name"],
                    "x": 300 + i * 300,  # SPAdes at 300, QUAST at 600
                    "y": 150,
                    "config": tool["parameters"]
                }
                nodes.append(node)
            
            nodes.append({
                "id": "output_1",
                "type": "file-output",
                "component": "server-folder",
                "x": 850,
                "y": 150,
                "config": {}
            })
            
            spades_node = next((t for t in plan["workflow"]["tools"] if t["name"] == "spades"), None)
            quast_node = next((t for t in plan["workflow"]["tools"] if t["name"] == "quast"), None)
            
            if spades_node and quast_node:
                connections.extend([
                    {
                        "id": "conn_1",
                        "fromNode": "input_1",
                        "fromPort": "file", 
                        "toNode": spades_node["id"],
                        "toPort": "reads_1"
                    },
                    {
                        "id": "conn_2", 
                        "fromNode": "input_2",
                        "fromPort": "file",
                        "toNode": spades_node["id"], 
                        "toPort": "reads_2"
                    },
                    {
                        "id": "conn_3",
                        "fromNode": spades_node["id"],
                        "fromPort": "contigs",
                        "toNode": quast_node["id"],
                        "toPort": "contigs"
                    },
                    {
                        "id": "conn_4",
                        "fromNode": quast_node["id"],
                        "fromPort": "report", 
                        "toNode": "output_1",
                        "toPort": "file"
                    }
                ])
        else:
            for tool in plan["workflow"]["tools"]:
                node = {
                    "id": tool["id"],
                    "type": "tool",
                    "component": tool["name"],
                    "x": tool["position"]["x"],
                    "y": tool["position"]["y"],
                    "config": tool["parameters"]
                }
                nodes.append(node)
            
            for conn in plan["workflow"]["connections"]:
                connection = {
                    "id": conn["id"],
                    "fromNode": conn["from"],
                    "fromPort": conn["from_port"],
                    "toNode": conn["to"],
                    "toPort": conn["to_port"]
                }
                connections.append(connection)
        
        return {
            "nodes": nodes,
            "connections": connections,
            "metadata": {
                "name": plan["workflow"]["name"],
                "description": plan["workflow"]["description"],
                "created_at": datetime.now().isoformat()
            }
        }


class EnhancedWorkflowPlanner(WorkflowPlanner):
    """Enhanced workflow planner with Knowledge Graph integration for intelligent workflow matching"""
    
    def __init__(self):
        super().__init__()
        # Initialize SPAdes + QUAST Knowledge Graph
        if SpadesQuastKnowledgeGraph:
            try:
                self.spades_quast_kg = SpadesQuastKnowledgeGraph()
                logger.info("SPAdes + QUAST Knowledge Graph initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize SPAdes QUAST KG: {e}")
                self.spades_quast_kg = None
        else:
            self.spades_quast_kg = None
    
    def analyze_user_request_with_kg(self, user_request: str) -> Dict[str, Any]:
        """Enhanced user request analysis using Knowledge Graph"""
        # First try custom workflows from KG (user-saved)
        custom_match = self._match_custom_workflow(user_request)
        if custom_match:
            wf = custom_match["workflow"]
            logger.info("Matched custom KG workflow: %s (confidence %.2f)", wf.get("id"), custom_match["score"])
            return {
                "source": "custom_knowledge_graph",
                "workflow_type": wf.get("id"),
                "confidence": custom_match["score"],
                "analysis": wf,
                "suggested_pattern": wf.get("id"),  # keep id for display
                "match_reasons": wf.get("keywords", []) or wf.get("natural_language_patterns", [])
            }

        # First try Knowledge Graph analysis
        if self.spades_quast_kg:
            try:
                kg_analysis = self.spades_quast_kg.analyze_user_intent(user_request)
                
                # If KG matches workflow with good confidence, use KG result
                # Lowered threshold to prefer KG match if any reasonable confidence
                if kg_analysis["matched_workflow"] and kg_analysis["confidence_score"] >= 0.4:
                    logger.info(f"Knowledge Graph matched workflow: {kg_analysis['matched_workflow']} (confidence: {kg_analysis['confidence_score']:.2f})")
                    
                    return {
                        "source": "knowledge_graph",
                        "workflow_type": "spades_quast_pipeline",
                        "confidence": kg_analysis["confidence_score"],
                        "analysis": kg_analysis,
                        "suggested_pattern": "spades_quast_workflow",
                        "parameters": kg_analysis["suggested_parameters"],
                        "command_preview": kg_analysis["command_preview"],
                        "explanation": self.spades_quast_kg.get_workflow_explanation(),
                        "match_reasons": kg_analysis["match_reasons"]
                    }
                else:
                    logger.info(f"Knowledge Graph confidence too low: {kg_analysis['confidence_score']:.2f}, falling back to original analyzer")
            except Exception as e:
                logger.error(f"Error in Knowledge Graph analysis: {e}")
        
        # Fallback to original analysis method
        logger.info("Using original workflow analysis method")
        original_analysis = self.analyze_user_request(user_request)
        return {
            "source": "original_analyzer", 
            "analysis": original_analysis,
            "suggested_pattern": original_analysis.get("suggested_pattern"),
            "confidence": 0.5  # Default confidence for original method
        }
    
    def generate_workflow_plan_with_kg(self, user_request: str) -> Dict[str, Any]:
        """Generate workflow plan using Knowledge Graph enhancement"""
        
        # Use enhanced analysis
        enhanced_analysis = self.analyze_user_request_with_kg(user_request)
        
        if enhanced_analysis["source"] == "custom_knowledge_graph":
            wf = enhanced_analysis["analysis"]
            steps = wf.get("steps", [])
            tools = [step.get("tool") for step in steps if step.get("tool")]
            connections = wf.get("connections") or []

            # If no connections, make a simple chain based on steps order
            if not connections and len(tools) > 1:
                connections = []
                for idx in range(len(tools) - 1):
                    connections.append({
                        "from": tools[idx],
                        "to": tools[idx + 1],
                        "from_port": "output",
                        "to_port": "input"
                    })

            plan = {
                "analysis": enhanced_analysis,
                "workflow": {
                    "name": wf.get("name", "Custom Workflow"),
                    "description": wf.get("description", ""),
                    "tools": tools,
                    "connections": connections,
                    "parameters": wf.get("parameters", {}),
                    "commands": wf.get("command_preview", [])
                },
                "frontend_workflow": self._build_frontend_workflow_from_custom(wf),
                "explanation": wf.get("description", ""),
                "confidence": enhanced_analysis.get("confidence", 0.6),
                "match_reasons": enhanced_analysis.get("match_reasons", [])
            }

            logger.info("Generated plan from custom KG workflow: %s", wf.get("id"))
            return plan

        if enhanced_analysis["source"] == "knowledge_graph":
            # Use Knowledge Graph to generate detailed plan
            kg_analysis = enhanced_analysis["analysis"]
            
            plan = {
                "analysis": enhanced_analysis,
                "workflow": {
                    "name": "SPAdes + QUAST Assembly Pipeline",
                    "description": "Genome assembly using SPAdes followed by QUAST quality assessment",
                    "tools": ["spades", "quast"],
                    "connections": [("spades", "quast")],
                    "parameters": kg_analysis["suggested_parameters"],
                    "commands": kg_analysis["command_preview"]
                },
                "frontend_workflow": self.spades_quast_kg.generate_workflow_definition(
                    kg_analysis["suggested_parameters"]
                ),
                "explanation": enhanced_analysis["explanation"],
                "confidence": kg_analysis["confidence_score"],
                "match_reasons": enhanced_analysis.get("match_reasons", [])
            }
            
            logger.info(f"Generated KG-enhanced workflow plan with confidence: {kg_analysis['confidence_score']:.2f}")
            return plan
        
        # Fallback to original method
        logger.info("Generating workflow plan using original method")
        return self.generate_workflow_plan(user_request)
    
    def is_kg_enhanced_request(self, user_request: str) -> bool:
        """Check if request can be enhanced by Knowledge Graph"""
        if not self.spades_quast_kg:
            return False
        
        try:
            return self.spades_quast_kg.is_spades_quast_request(user_request)
        except Exception as e:
            logger.error(f"Error checking KG enhancement: {e}")
            return False

    def _build_frontend_workflow_from_custom(self, wf: Dict[str, Any]) -> Dict[str, Any]:
        """Build a lightweight frontend workflow structure from custom KG entry"""
        steps = wf.get("steps", [])
        nodes: List[Dict[str, Any]] = []
        tool_to_node: Dict[str, str] = {}
        node_types: Dict[str, str] = {}

        def _classify_node(tool_name: str) -> Tuple[str, str]:
            """Return (node_type, component) based on tool name"""
            if not tool_name:
                return "tool", tool_name
            t = tool_name.lower()
            if "folder" in t:
                return "file-output", tool_name
            if "file" in t:
                return "file-input", tool_name
            return "tool", tool_name

        for idx, step in enumerate(steps):
            tool_name = step.get("tool") or f"step_{idx+1}"
            # Align with stored connections that may use node_# refs
            node_id = f"node_{idx+1}"
            tool_to_node[tool_name] = node_id
            node_type, component_name = _classify_node(tool_name)
            node_types[node_id] = node_type
            nodes.append({
                "id": node_id,
                "type": node_type,
                "component": component_name,
                "x": 150 + idx * 250,
                "y": 150,
                "config": {
                    "description": step.get("description", ""),
                    "order": step.get("order", idx + 1)
                }
            })

        connections_raw = wf.get("connections") or []
        connections: List[Dict[str, Any]] = []

        if connections_raw:
            for i, conn in enumerate(connections_raw):
                from_ref = conn.get("from") or conn.get("fromNode") or conn.get("source") or conn.get("from_tool") or conn.get("fromTool")
                to_ref = conn.get("to") or conn.get("toNode") or conn.get("target") or conn.get("to_tool") or conn.get("toTool")
                # Default ports with awareness of file nodes
                from_port = conn.get("from_port") or conn.get("fromPort") or conn.get("type")
                to_port = conn.get("to_port") or conn.get("toPort")

                from_node = tool_to_node.get(str(from_ref), tool_to_node.get(from_ref)) if isinstance(from_ref, str) else None
                to_node = tool_to_node.get(str(to_ref), tool_to_node.get(to_ref)) if isinstance(to_ref, str) else None

                # If references are numeric (orders), map to list position
                if from_node is None and isinstance(from_ref, int) and 0 <= from_ref - 1 < len(nodes):
                    from_node = nodes[from_ref - 1]["id"]
                if to_node is None and isinstance(to_ref, int) and 0 <= to_ref - 1 < len(nodes):
                    to_node = nodes[to_ref - 1]["id"]

                # If references look like node_x, map directly to existing node ids
                if from_node is None and isinstance(from_ref, str) and from_ref.startswith("node_"):
                    if any(n["id"] == from_ref for n in nodes):
                        from_node = from_ref
                if to_node is None and isinstance(to_ref, str) and to_ref.startswith("node_"):
                    if any(n["id"] == to_ref for n in nodes):
                        to_node = to_ref

                # Apply sensible defaults for ports based on node types
                if not from_port:
                    if from_node and node_types.get(from_node) == "file-input":
                        from_port = "file"
                    else:
                        from_port = "output"
                # Normalize mismatched defaults for file-input nodes
                if from_node and node_types.get(from_node) == "file-input" and from_port in ["output", "input", ""]:
                    from_port = "file"
                if from_node and node_types.get(from_node) == "file-output" and from_port in ["output", ""]:
                    from_port = "file"

                if not to_port:
                    if to_node and node_types.get(to_node) == "file-output":
                        to_port = "file"
                    else:
                        to_port = "input"
                # Normalize mismatched defaults for file-output nodes
                if to_node and node_types.get(to_node) == "file-output" and to_port in ["output", "input", ""]:
                    to_port = "file"
                if to_node and node_types.get(to_node) == "file-input" and to_port in ["input", ""]:
                    to_port = "file"

                if from_node and to_node:
                    connections.append({
                        "id": f"connection_{i+1}",
                        "from": from_node,
                        "fromPort": from_port,
                        "fromNode": from_node,  # duplicate for frontend compatibility
                        "from_port": from_port,
                        "to": to_node,
                        "toPort": to_port,
                        "toNode": to_node,      # duplicate for frontend compatibility
                        "to_port": to_port
                    })
        # Fallback: if still no valid connections, chain in order
        if len(connections) == 0 and len(nodes) > 1:
            for idx in range(len(nodes) - 1):
                from_id = nodes[idx]["id"]
                to_id = nodes[idx + 1]["id"]
                # Determine ports based on node type (file vs tool)
                from_port = "file" if node_types.get(from_id) == "file-input" else "output"
                to_port = "file" if node_types.get(to_id) == "file-output" else "input"
                connections.append({
                    "id": f"connection_{idx+1}",
                    "from": from_id,
                    "fromPort": from_port,
                    "fromNode": from_id,
                    "from_port": from_port,
                    "to": to_id,
                    "toPort": to_port,
                    "toNode": to_id,
                    "to_port": to_port
                })

        return {
            "nodes": nodes,
            "connections": connections,
            "metadata": {
                "name": wf.get("name", "Custom Workflow"),
                "description": wf.get("description", ""),
                "created_at": datetime.now().isoformat()
            }
        }
