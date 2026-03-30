"""
SPAdes + QUAST Knowledge Graph Manager
Provides intelligent workflow matching and generation based on natural language input
"""

import json
import re
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class SpadesQuastKnowledgeGraph:
    """SPAdes + QUAST specialized knowledge graph for intelligent workflow generation"""
    
    def __init__(self, kg_file: str = None):
        if kg_file is None:
            try:
                import config as _c
                kg_file = _c.KG_FILE
            except Exception:
                kg_file = str(Path(__file__).resolve().parent.parent.parent / 'data' / 'spades_quast_kg.json')
        self.kg_file = Path(kg_file)
        self.kg_data = self._load_knowledge_graph()
        
    def _load_knowledge_graph(self) -> Dict[str, Any]:
        """Load knowledge graph data from JSON file"""
        try:
            if self.kg_file.exists():
                with open(self.kg_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                logger.warning(f"Knowledge graph file not found: {self.kg_file}")
                return self._create_default_kg()
        except Exception as e:
            logger.error(f"Error loading knowledge graph: {e}")
            return self._create_default_kg()
    
    def _create_default_kg(self) -> Dict[str, Any]:
        """Create minimal default knowledge graph structure"""
        return {
            "metadata": {"version": "1.0", "description": "Default SPAdes + QUAST KG"},
            "tools": {},
            "workflows": {},
            "knowledge_context": {"semantic_mappings": {"user_intent_to_workflow": {}}}
        }
    
    def analyze_user_intent(self, user_query: str) -> Dict[str, Any]:
        """Analyze user intent and match against SPAdes + QUAST workflow patterns"""
        query_lower = user_query.lower()
        
        # Initialize intent analysis structure
        intent_analysis = {
            "has_assembly_intent": False,
            "has_quality_intent": False,
            "has_data_context": False,
            "confidence_score": 0.0,
            "matched_workflow": None,
            "suggested_parameters": {},
            "command_preview": [],
            "match_reasons": []
        }
        
        try:
            semantic_mappings = self.kg_data["knowledge_context"]["semantic_mappings"]["user_intent_to_workflow"]
            
            # Check for assembly intent
            assembly_keywords = semantic_mappings.get("assembly_keywords", [])
            if any(keyword in query_lower for keyword in assembly_keywords):
                intent_analysis["has_assembly_intent"] = True
                intent_analysis["confidence_score"] += 0.4
                intent_analysis["match_reasons"].append("Detected genome assembly intent")
            
            # Check for quality assessment intent
            quality_keywords = semantic_mappings.get("quality_keywords", [])
            if any(keyword in query_lower for keyword in quality_keywords):
                intent_analysis["has_quality_intent"] = True
                intent_analysis["confidence_score"] += 0.3
                intent_analysis["match_reasons"].append("Detected quality assessment intent")
            
            # Check for data context (paired-end, fastq, etc.)
            data_keywords = semantic_mappings.get("data_keywords", [])
            if any(keyword in query_lower for keyword in data_keywords):
                intent_analysis["has_data_context"] = True
                intent_analysis["confidence_score"] += 0.2
                intent_analysis["match_reasons"].append("Detected sequencing data context")
            
            # Check for organism context
            organism_keywords = semantic_mappings.get("organism_keywords", [])
            if any(keyword in query_lower for keyword in organism_keywords):
                intent_analysis["confidence_score"] += 0.1
                intent_analysis["match_reasons"].append("Detected bacterial/genome context")
            
            # Match workflow based on intents
            if intent_analysis["has_assembly_intent"] and intent_analysis["has_quality_intent"]:
                intent_analysis["matched_workflow"] = "spades_quast_pipeline"
                intent_analysis["confidence_score"] += 0.2
                intent_analysis["match_reasons"].append("Perfect match for SPAdes + QUAST pipeline")
            elif intent_analysis["has_assembly_intent"]:
                intent_analysis["matched_workflow"] = "spades_quast_pipeline"  # Default includes quality assessment
                intent_analysis["match_reasons"].append("Assembly request - including quality assessment by default")
            
            # Generate parameters and command preview if workflow matched
            if intent_analysis["matched_workflow"]:
                intent_analysis["suggested_parameters"] = self._generate_default_parameters()
                intent_analysis["command_preview"] = self._generate_command_preview(intent_analysis["suggested_parameters"])
            
        except Exception as e:
            logger.error(f"Error in intent analysis: {e}")
            intent_analysis["confidence_score"] = 0.0
        
        return intent_analysis
    
    def _generate_default_parameters(self) -> Dict[str, Any]:
        """Generate default parameters for SPAdes + QUAST workflow"""
        return {
            "spades": {
                "left_reads": "left.fastq.gz",
                "right_reads": "right.fastq.gz", 
                "output_dir": "spades_output_folder",
                "threads": 16,
                "conda_env": "spades_env"
            },
            "quast": {
                "contigs": "spades_output_folder/contigs.fasta",
                "output_dir": "quast_output_dir",
                "threads": 4,
                "conda_env": "quast_env"
            }
        }
    
    def _generate_command_preview(self, parameters: Dict[str, Any]) -> List[str]:
        """Generate command preview for the workflow"""
        commands = []
        
        try:
            # SPAdes command
            spades_params = parameters["spades"]
            spades_cmd = f"conda activate {spades_params['conda_env']} && spades.py -1 {spades_params['left_reads']} -2 {spades_params['right_reads']} -o {spades_params['output_dir']} -t {spades_params['threads']}"
            commands.append(spades_cmd)
            
            # QUAST command
            quast_params = parameters["quast"]
            quast_cmd = f"conda activate {quast_params['conda_env']} && quast.py {quast_params['contigs']} -o {quast_params['output_dir']} -t {quast_params['threads']}"
            commands.append(quast_cmd)
            
        except Exception as e:
            logger.error(f"Error generating command preview: {e}")
            commands = ["Error generating commands"]
        
        return commands
    
    def generate_workflow_definition(self, parameters: Dict[str, Any] = None) -> Dict[str, Any]:
        """Generate frontend workflow definition for the workflow builder"""
        if not parameters:
            parameters = self._generate_default_parameters()
        
        workflow_def = {
            "nodes": [
                # Input file nodes
                {
                    "id": "input_left_reads",
                    "type": "file-input",
                    "component": "server-file",
                    "x": 50,
                    "y": 100,
                    "config": {
                        "filename": parameters["spades"]["left_reads"],
                        "label": "Left Reads (R1)"
                    }
                },
                {
                    "id": "input_right_reads", 
                    "type": "file-input",
                    "component": "server-file",
                    "x": 50,
                    "y": 200,
                    "config": {
                        "filename": parameters["spades"]["right_reads"],
                        "label": "Right Reads (R2)"
                    }
                },
                
                # SPAdes tool node
                {
                    "id": "spades_tool",
                    "type": "tool",
                    "component": "spades",
                    "x": 300,
                    "y": 150,
                    "config": {
                        "param_1": parameters["spades"]["left_reads"],
                        "param_2": parameters["spades"]["right_reads"],
                        "param_o": parameters["spades"]["output_dir"],
                        "param_t": parameters["spades"]["threads"],
                        "param_conda_env": parameters["spades"]["conda_env"]
                    }
                },
                
                # QUAST tool node
                {
                    "id": "quast_tool",
                    "type": "tool", 
                    "component": "quast",
                    "x": 600,
                    "y": 150,
                    "config": {
                        "param_contigs": parameters["quast"]["contigs"],
                        "param_o": parameters["quast"]["output_dir"],
                        "param_t": parameters["quast"]["threads"],
                        "param_conda_env": parameters["quast"]["conda_env"]
                    }
                },
                
                # Output folder node
                {
                    "id": "output_folder",
                    "type": "file-output",
                    "component": "server-folder", 
                    "x": 850,
                    "y": 150,
                    "config": {
                        "output_path": parameters["quast"]["output_dir"],
                        "label": "Analysis Results"
                    }
                }
            ],
            
            "connections": [
                {
                    "id": "conn_1",
                    "fromNode": "input_left_reads",
                    "fromPort": "file",
                    "toNode": "spades_tool", 
                    "toPort": "reads_1"
                },
                {
                    "id": "conn_2",
                    "fromNode": "input_right_reads",
                    "fromPort": "file",
                    "toNode": "spades_tool",
                    "toPort": "reads_2"
                },
                {
                    "id": "conn_3", 
                    "fromNode": "spades_tool",
                    "fromPort": "contigs",
                    "toNode": "quast_tool",
                    "toPort": "contigs"
                },
                {
                    "id": "conn_4",
                    "fromNode": "quast_tool",
                    "fromPort": "report", 
                    "toNode": "output_folder",
                    "toPort": "file"
                }
            ]
        }
        
        return workflow_def
    
    def get_workflow_explanation(self) -> str:
        """Get detailed workflow explanation for user"""
        try:
            workflow = self.kg_data["workflows"]["spades_quast_pipeline"]
            
            explanation = f"""🧬 **{workflow['name']}**

📋 **Workflow Description:**
{workflow['description']}

🔄 **Execution Steps:**
1. **SPAdes Assembly**: Use SPAdes to assemble paired-end reads into genome contigs
2. **QUAST Quality Assessment**: Use QUAST to evaluate assembly quality and generate reports

📊 **Expected Outputs:**
- Assembled contigs file (contigs.fasta)
- Assembled scaffolds file (scaffolds.fasta)  
- Quality assessment report (report.html, report.txt)

⏱️ **Estimated Runtime:** {workflow['estimated_runtime']}
💾 **Resource Requirements:** {workflow['resource_requirements']['total_memory_gb']}GB memory, {workflow['resource_requirements']['total_cpu_cores']} CPU cores

🎯 **Use Cases:**
{', '.join(workflow['use_cases'])}"""
            
            return explanation.strip()
            
        except Exception as e:
            logger.error(f"Error generating workflow explanation: {e}")
            return "SPAdes + QUAST Assembly Pipeline: Genome assembly followed by quality assessment"
    
    def get_workflow_info(self) -> Dict[str, Any]:
        """Get structured workflow information"""
        try:
            return self.kg_data["workflows"]["spades_quast_pipeline"]
        except Exception as e:
            logger.error(f"Error getting workflow info: {e}")
            return {
                "name": "SPAdes + QUAST Pipeline",
                "description": "Genome assembly with quality assessment",
                "estimated_runtime": "60-90 minutes"
            }
    
    def is_spades_quast_request(self, user_query: str) -> bool:
        """Quick check if user query is requesting SPAdes + QUAST workflow"""
        analysis = self.analyze_user_intent(user_query)
        return analysis["matched_workflow"] == "spades_quast_pipeline" and analysis["confidence_score"] > 0.5
