"""
Upgraded bioinformatics Agent - using Adaptive RAG system
Supports fast startup and offline document processing
Enhanced with Knowledge Graph integration for intelligent workflow matching
"""

import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path

from adaptive_rag import AdaptiveRAG
from document_processor import DocumentProcessor
from session_memory import SessionMemory
from workflow_planner import WorkflowPlanner, EnhancedWorkflowPlanner
from agent_client import get_llm_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BioinfoAgentV2:
    """Upgraded bioinformatics tool Q&A Agent with Knowledge Graph integration"""
    
    def __init__(self, 
                 docs_path: List[str] = None, 
                 vector_store_path: str = "./vector_store",
                 memory_store_path: str = "./memory_store"):
        """
        Initialize Agent
        
        Args:
            docs_path: List of document paths (optional, uses default from DocumentProcessor)
            vector_store_path: Vector store path
            memory_store_path: Memory store path
        """
        self.docs_path = docs_path
        self.vector_store_path = vector_store_path
        self.memory_store_path = memory_store_path
        self.is_initialized = False
        self.available_tools: List[str] = []
        
        # Initialize document processor and RAG system
        if docs_path:
            self.document_processor = DocumentProcessor(docs_path, vector_store_path)
        else:
            self.document_processor = DocumentProcessor(vector_store_path=vector_store_path)
        self.adaptive_rag = AdaptiveRAG(vector_store_path)
        
        # Initialize session memory system
        self.session_memory = SessionMemory(memory_store_path)
        
        # Initialize enhanced workflow planner with Knowledge Graph
        self.workflow_planner = EnhancedWorkflowPlanner()
        logger.info("Enhanced workflow planner with Knowledge Graph initialized")
        
        # Current workflow planning state
        self.current_workflow_plan = None
        self.planning_mode = False
        self.current_session_id: Optional[str] = None
        
    def ensure_vector_store(self) -> bool:
        """
        Ensure vector store is available
        
        Returns:
            bool: True if vector store is ready, False otherwise
        """
        try:
            if not self.is_initialized:
                logger.info("Initializing vector store...")
                success = self.document_processor.build_vector_store()
                if success:
                    self.adaptive_rag.initialize()
                    self.available_tools = self.document_processor.get_available_tools()
                    self.adaptive_rag.available_tools = self.available_tools
                    self.is_initialized = True
                    logger.info(f"Vector store initialized successfully with {len(self.available_tools)} tools")
                else:
                    logger.error("Failed to initialize vector store")
                return success
            return True
        except Exception as e:
            logger.error(f"Error ensuring vector store: {e}")
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """Get agent status"""
        return {
            "initialized": self.is_initialized,
            "available_tools": len(self.available_tools),
            "vector_store_path": str(self.vector_store_path),
            "memory_store_path": str(self.memory_store_path),
            "planning_mode": self.planning_mode,
            "has_current_plan": self.current_workflow_plan is not None
        }
    
    def get_available_tools(self) -> List[str]:
        """Get list of available tools"""
        return self.available_tools.copy()
    
    def set_session_id(self, session_id: str):
        """Set current session ID"""
        self.current_session_id = session_id
        logger.info(f"Session ID set to: {session_id}")
    
    def add_to_history(self, role: str, content: str):
        """Add message to conversation history"""
        if self.current_session_id:
            self.session_memory.add_conversation_turn(role, content)
    
    def stream_response(self, question: str, session_id: str = None):
        """
        Stream response to user question with enhanced workflow planning
        
        Args:
            question: User question
            session_id: Session ID for conversation tracking
            
        Yields:
            JSON responses for streaming
        """
        if session_id:
            self.set_session_id(session_id)
        
        if not self.ensure_vector_store():
            yield json.dumps({
                "type": "error", 
                "content": "Failed to initialize knowledge base. Please try again later."
            })
            return
        
        self.add_to_history("user", question)
        
        try:
            # Check if this is a workflow planning request
            if self._is_workflow_request(question):
                yield from self._handle_workflow_planning_stream(question)
                return
            
            # Check if this is workflow feedback
            if self.planning_mode and self.current_workflow_plan:
                yield from self._handle_workflow_feedback_stream(question)
                return
            
            # Regular Q&A using Adaptive RAG
            # Get conversation history for context
            conversation_context = self.session_memory.get_conversation_history()
            
            # Stream response from adaptive RAG
            for response_chunk in self.adaptive_rag.stream_answer(question, conversation_context):
                yield json.dumps(response_chunk)
            
            # Add response to history
            self.add_to_history("assistant", "Provided information using knowledge base")
            
        except Exception as e:
            logger.error(f"Error in stream_response: {e}")
            yield json.dumps({
                "type": "error",
                "content": f"An error occurred while processing your request: {str(e)}"
            })
    
    def ask_stream(self, question: str, session_id: str = None):
        """
        Stream response to user question (alias for stream_response)
        
        Args:
            question: User question
            session_id: Session ID for conversation tracking
            
        Yields:
            JSON responses for streaming
        """
        yield from self.stream_response(question, session_id)
    
    def _is_workflow_request(self, question: str) -> bool:
        """Detect if this is a workflow planning request"""
        workflow_keywords = [
            "workflow", "pipeline", "analysis", "assemble", "assembly",
            "quality control", "qc", "reconstruct", "contigs", "reads",
            "metagenomic", "genomic", "build", "create workflow"
        ]
        
        question_lower = question.lower()
        
        # Check for workflow-related keywords
        has_workflow_keywords = any(keyword in question_lower for keyword in workflow_keywords)
        
        # Check for request-type phrases
        is_request = any(phrase in question_lower for phrase in [
            "i want", "i need", "i have", "help me", "can you", "how to",
            "create", "build", "design", "plan"
        ])
        
        return has_workflow_keywords and is_request
    
    def _handle_workflow_planning_stream(self, question: str):
        """Handle workflow planning requests with enhanced Knowledge Graph integration"""
        try:
            # Send initial planning message
            yield json.dumps({
                "type": "message",
                "content": "🔬 I'll help you design a bioinformatics workflow. Let me analyze your requirements using our knowledge graph..."
            })
            
            import time
            time.sleep(0.5)
            
            # Use enhanced workflow planner with Knowledge Graph
            logger.info(f"Generating enhanced workflow plan for question: {question}")
            plan = self.workflow_planner.generate_workflow_plan_with_kg(question)
            
            # Safe logging for different plan structures
            if plan.get('analysis', {}).get('source') == 'knowledge_graph':
                tools_count = len(plan.get('workflow', {}).get('tools', []))
                logger.info(f"Generated KG-enhanced plan with {tools_count} tools")
            else:
                tools_count = len(plan.get('workflow', {}).get('tools', []))
                logger.info(f"Generated standard plan with {tools_count} tools")
            
            self.current_workflow_plan = plan
            self.planning_mode = True
            
            time.sleep(0.3)
            
            # Send analysis results based on source
            if plan.get('analysis', {}).get('source') == 'knowledge_graph':
                kg_analysis = plan['analysis']['analysis']
                
                yield json.dumps({
                    "type": "message",
                    "content": f"\n\n📊 **Intelligent Analysis Results** (Confidence: {kg_analysis['confidence_score']:.1%})"
                })
                
                time.sleep(0.3)
                
                # Send match reasons
                if kg_analysis.get('match_reasons'):
                    yield json.dumps({
                        "type": "message",
                        "content": "\n🎯 **Match Reasons:**"
                    })
                    
                    for reason in kg_analysis['match_reasons']:
                        yield json.dumps({
                            "type": "message",
                            "content": f"\n- {reason}"
                        })
                        time.sleep(0.1)
                
                time.sleep(0.3)
                
                # Send recommended workflow
                yield json.dumps({
                    "type": "message", 
                    "content": f"\n🧬 **Recommended Workflow:** SPAdes + QUAST Assembly Pipeline"
                })
                
                time.sleep(0.3)
                
                # Send command preview
                if kg_analysis.get('command_preview'):
                    yield json.dumps({
                        "type": "message",
                        "content": "\n💻 **Command Preview:**"
                    })
                    
                    for i, cmd in enumerate(kg_analysis['command_preview'], 1):
                        yield json.dumps({
                            "type": "message",
                            "content": f"\n**Step {i}:**\n```bash\n{cmd}\n```"
                        })
                        time.sleep(0.2)
                
                time.sleep(0.3)
                
                # Send detailed explanation
                if plan.get('explanation'):
                    explanation_lines = plan['explanation'].split('\n')
                    for line in explanation_lines:
                        if line.strip():
                            yield json.dumps({
                                "type": "message",
                                "content": f"\n{line}"
                            })
                            time.sleep(0.1)
                
            elif plan.get("analysis", {}).get("source") == "custom_knowledge_graph":
                wf_meta = plan.get("workflow", {}) or {}
                # If frontend_workflow carries nodes with ids, use them for counts
                frontend = plan.get("frontend_workflow") or {}
                nodes = frontend.get("nodes", [])
                conns = frontend.get("connections", [])
                steps_count = len(wf_meta.get("steps", [])) if wf_meta.get("steps") else len(nodes)
                conn_count = len(wf_meta.get("connections", [])) if wf_meta.get("connections") else len(conns)

                yield json.dumps({
                    "type": "message",
                    "content": "\n\n📋 **Matched Custom Knowledge Graph Workflow:**"
                })
                time.sleep(0.2)
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Workflow ID:** {wf_meta.get('id', 'unknown')}"
                })
                time.sleep(0.1)
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Name:** {wf_meta.get('name', 'Unnamed workflow')}"
                })
                time.sleep(0.1)
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Category:** {wf_meta.get('category', 'custom')}  |  **Complexity:** {wf_meta.get('complexity', 'moderate')}"
                })
                time.sleep(0.1)
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Steps:** {steps_count}  |  **Connections:** {conn_count}"
                })
                if wf_meta.get("keywords"):
                    time.sleep(0.1)
                    yield json.dumps({
                        "type": "message",
                        "content": f"\n- **Keywords:** {', '.join(wf_meta.get('keywords', []))}"
                    })
                time.sleep(0.2)
                yield json.dumps({
                    "type": "message",
                    "content": "\n\n📊 **Recommendation:** Use the matched custom workflow above."
                })
            else:
                # Original analysis method
                analysis = plan.get("analysis", {})
                yield json.dumps({
                    "type": "message",
                    "content": "\n\n📋 **Analysis Results:**"
                })
                
                time.sleep(0.2)
                
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Data type:** {analysis.get('data_type', 'Not specified')}"
                })
                
                time.sleep(0.1)
                
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Sample type:** {analysis.get('sample_type', 'Not specified')}"
                })
                
                time.sleep(0.1)
                
                yield json.dumps({
                    "type": "message",
                    "content": f"\n- **Goals:** {', '.join(analysis.get('goals', ['General analysis']))}"
                })
                
                time.sleep(0.5)
                
                # Send workflow recommendation
                yield json.dumps({
                    "type": "message",
                    "content": f"\n\n📊 **Recommended Pattern:** {analysis.get('suggested_pattern', 'Default workflow')}"
                })
            
            time.sleep(0.5)
            
            # Send confirmation request
            yield json.dumps({
                "type": "message",
                "content": "\n\n✅ Does this workflow meet your requirements?\n\nReply **'yes'** or **'build it'** to automatically build the workflow on the canvas."
            })
            
        except Exception as e:
            logger.error(f"Error in enhanced workflow planning: {e}")
            yield json.dumps({
                "type": "error",
                "content": f"Error generating workflow plan: {str(e)}"
            })
    
    def _handle_workflow_feedback_stream(self, feedback: str):
        """Handle user feedback on workflow plans with enhanced KG support"""
        try:
            feedback_lower = feedback.lower().strip()
            
            if any(word in feedback_lower for word in ['yes', 'ok', 'build', 'create', 'accept', 'looks good']):
                # User accepts the plan, build workflow
                yield json.dumps({
                    "type": "message",
                    "content": "🚀 Great! I'll build this workflow for you now..."
                })
                
                import time
                time.sleep(0.5)
                
                # Check if this is a KG-enhanced workflow
                source = self.current_workflow_plan.get('analysis', {}).get('source')

                if source in ['knowledge_graph', 'custom_knowledge_graph']:
                    # Use KG-generated frontend workflow definition
                    workflow_data = self.current_workflow_plan.get('frontend_workflow')
                    
                    yield json.dumps({
                        "type": "build_workflow",
                        "workflow_data": workflow_data
                    })
                    
                    success_name = self.current_workflow_plan.get('analysis', {}).get('name') or 'workflow'
                    yield json.dumps({
                        "type": "message", 
                        "content": f"✅ {success_name} has been built on the canvas! You can configure parameters or run it directly."
                    })
                    
                else:
                    # Use original workflow conversion method
                    workflow_data = self.workflow_planner.convert_plan_to_workflow_format(self.current_workflow_plan)
                    
                    yield json.dumps({
                        "type": "build_workflow",
                        "workflow": workflow_data
                    })
                    
                    yield json.dumps({
                        "type": "message",
                        "content": "\n\n🎉 **Workflow built successfully!**"
                    })
                
                time.sleep(0.3)
                
                yield json.dumps({
                    "type": "message",
                    "content": "\n\nYou can now:\n- Configure tool parameters\n- Run the workflow\n- Make modifications as needed"
                })
                
                # Reset planning state
                self.planning_mode = False
                self.current_workflow_plan = None
                
            else:
                # Handle other feedback
                yield json.dumps({
                    "type": "message",
                    "content": "I understand. Please let me know how you'd like to modify the workflow, or provide more details about your requirements."
                })
                
                # Keep planning mode active for further modifications
        
        except Exception as e:
            logger.error(f"Error handling workflow feedback: {e}")
            yield json.dumps({
                "type": "error",
                "content": f"Error processing your feedback: {str(e)}"
            })
    
    def _generate_title_if_needed(self, question: str, answer: str):
        """Generate title after first conversation"""
        if not self.current_session_id:
            return
            
        try:
            # Get conversation history
            history = self.session_memory.get_conversation_history()
            current_title = self.session_memory.current_session_title
            
            # Only generate title if we have exactly one user-assistant pair and no title yet
            user_agent_pairs = []
            for i in range(0, len(history), 2):
                if i + 1 < len(history) and history[i]['role'] == 'user' and history[i + 1]['role'] == 'assistant':
                    user_agent_pairs.append((history[i], history[i + 1]))
            
            if len(user_agent_pairs) == 1 and (not current_title or current_title.startswith("Session")):
                logger.info("Generating session title for first conversation")
                
                # Use the adaptive RAG system to generate a title
                title_prompt = f"Generate a concise, descriptive title (max 6 words) for this conversation:\nUser: {question}\nAssistant: {answer[:200]}..."
                
                try:
                    # Generate title using the RAG system
                    title_response = ""
                    for chunk in self.adaptive_rag.stream_answer(title_prompt):
                        if chunk.get("type") == "answer":
                            title_response += chunk.get("content", "")
                    
                    # Clean up the title
                    title = title_response.strip().strip('"').strip("'")
                    if len(title) > 50:
                        title = title[:47] + "..."
                    
                    if title and len(title) > 5:
                        self.session_memory.update_session_title(title)
                        logger.info(f"Generated session title: {title}")
                    
                except Exception as title_error:
                    logger.error(f"Error generating title: {title_error}")
                    # Fallback to simple title
                    simple_title = question[:30] + "..." if len(question) > 30 else question
                    self.session_memory.update_session_title(simple_title)
                
                else:
                    logger.warning("First two messages are not user-assistant pair, skipping title generation")
            else:
                logger.info(f"Title generation skipped: user_agent_pairs={len(user_agent_pairs)}, title='{current_title}'")
        except Exception as e:
            logger.error(f"Error generating session title: {e}", exc_info=True)
    
    # === Session Management Methods ===
    
    def get_conversation_history(self, limit: int = None):
        """Get conversation history from session memory"""
        return self.session_memory.get_conversation_history(limit)
    
    def clear_history(self):
        """Clear conversation history"""
        self.session_memory.clear_current_session()
    
    def get_session_list(self):
        """Get list of all sessions"""
        return self.session_memory.get_session_list()
    
    def start_new_session(self, session_id: str = None) -> str:
        """Start a new session"""
        new_session_id = self.session_memory.start_new_session(session_id)
        self.current_session_id = new_session_id
        return new_session_id
    
    def load_session(self, session_id: str) -> bool:
        """Load an existing session"""
        success = self.session_memory.load_session(session_id)
        if success:
            self.current_session_id = session_id
        return success
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session"""
        return self.session_memory.delete_session(session_id)
    
    def save_current_session(self):
        """Save the current session"""
        self.session_memory.save_current_session()
    
    def cleanup_old_sessions(self, days_to_keep: int = 30) -> int:
        """Clean up old sessions"""
        return self.session_memory.cleanup_old_sessions(days_to_keep)
    
    # === Workflow Planning Methods ===
    
    def get_current_workflow_plan(self):
        """Get current workflow plan"""
        return self.current_workflow_plan
    
    def clear_workflow_planning(self):
        """Clear current workflow planning state"""
        self.current_workflow_plan = None
        self.planning_mode = False


    # === Visualization Code Generation ===
    def generate_viz_code(self, viz_request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate seaborn visualization code based on user request.
        Returns a dict with 'code' for downstream usage.
        """
        try:
            client = get_llm_client()
            llm = client.get_llm()

            file_path = viz_request.get("file_path", "")
            chart_type = viz_request.get("chart_type", "scatter")
            x_col = viz_request.get("x") or viz_request.get("x_col") or ""
            y_col = viz_request.get("y") or viz_request.get("y_col") or ""
            hue = viz_request.get("hue", "")
            style = viz_request.get("style", "")
            title = viz_request.get("title", "Seaborn Plot")
            width = viz_request.get("width", 10)
            height = viz_request.get("height", 6)
            detected_columns = viz_request.get("detected_columns") or []
            file_head = viz_request.get("file_head") or ""
            user_prompt = viz_request.get("prompt", "").strip()
            viz_lib = viz_request.get("viz_lib", "seaborn").lower()

            logger.info("[viz_codegen] model=%s file=%s cols_hint=%s", client.model_name, file_path, detected_columns)

            if viz_lib == "bokeh":
                lib_instruction = f"""
Use Bokeh to create ONE plot and save to OUTPUT_PATH as HTML (not PNG).
- Use pandas to read the file {file_path!r}. If .tsv/.txt then sep="\\t", else sep=",".
- Use columns x={x_col!r}, y={y_col!r}, hue/group={hue!r}, style={style!r} if provided (ignore empty).
- Create a figure with width={int(width*70)} height={int(height*70)} (~{width}x{height} inches).
- Use output_file(OUTPUT_PATH) and save(fig).
- Do NOT use show(), do NOT use plt.
- If hue/group is provided, build a palette safely:
  from bokeh.palettes import Category10, Category20
  groups = sorted(df[{hue!r}].unique()) if {bool(hue)} else []
  if len(groups) <= 10: palette = Category10[10][:len(groups)] if len(groups)>0 else []
  else: palette = Category20[20][:len(groups)]
  map group -> color; if hue is empty, just use a single color.
- If style/sample is provided, vary marker type; add legend_label only (no legend_field/legend_group).
- Title: {title!r}.
- Validate required columns; if missing, raise ValueError listing missing columns.
Return ONLY the Python code (no markdown, no fences, no extra text)."""
            elif viz_lib == "matplotlib":
                lib_instruction = f"""
Use pure matplotlib (no seaborn) to create ONE plot and save to OUTPUT_PATH (PNG).
- import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; import pandas as pd.
- Read file {file_path!r} (sep="\\t" if .tsv/.txt else ",").
- Plot using plt.plot/plt.scatter as appropriate; use x={x_col!r}, y={y_col!r}; if hue provided, plot per group with legend; if style provided, vary marker/linestyle.
- figsize=({width}, {height}); title={title!r}; savefig(OUTPUT_PATH, dpi=300, bbox_inches="tight"); no plt.show().
- Validate required columns; if missing, raise ValueError listing missing columns.
Return ONLY the Python code (no markdown, no fences, no extra text)."""
            else:
                lib_instruction = f"""
Use pandas + seaborn + matplotlib (Agg) to create ONE plot and save to OUTPUT_PATH (PNG).
- sns.set_theme(); figsize=({width}, {height}); read {file_path!r} (sep="\\t" if .tsv/.txt else ",").
- Use columns x={x_col!r}, y={y_col!r}, hue={hue!r}, style={style!r} (ignore if blank).
- Chart type: {chart_type}; prefer lineplot/scatterplot/barplot/boxplot/kdeplot/histplot/pairplot as appropriate.
- Title: {title!r}; savefig(OUTPUT_PATH, dpi=300, bbox_inches="tight"); no plt.show().
- Validate required columns; if missing, raise ValueError listing missing columns.
Return ONLY the Python code (no markdown, no fences, no extra text)."""

            prompt = f"""
You are a Python data viz assistant. User requirement: {user_prompt}
Available columns: {detected_columns}
File head preview:
{file_head}

Instructions:
{lib_instruction}
"""

            raw_code = llm.invoke(prompt)
            # llm.invoke may return string or message; normalize to string
            if hasattr(raw_code, "content"):
                raw_code = raw_code.content
            code = str(raw_code).strip()
            logger.info("[viz_codegen] generated code length=%d", len(code))
            logger.debug("[viz_codegen] prompt preview: %s", prompt[:500].replace("\n", "\\n"))
            return {"code": code}
        except Exception as e:
            logger.error(f"Error generating viz code: {e}", exc_info=True)
            return {"code": "", "error": str(e)}
