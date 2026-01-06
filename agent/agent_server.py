from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import logging
import sys
import json
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file in project root
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Add current directory to Python path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import modules with fallback
try:
    from agent_client import get_llm_client
except ImportError:
    try:
        from .agent_client import get_llm_client
    except ImportError:
        # Last resort - try to import from parent directory
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from agent.agent_client import get_llm_client

# Import new Agent system
try:
    from bioinfo_agent import BioinfoAgentV2 as BioinfoAgent
    from document_processor import DocumentProcessor
except ImportError:
    try:
        from .bioinfo_agent import BioinfoAgentV2 as BioinfoAgent
        from .document_processor import DocumentProcessor
    except ImportError:
        # Last resort - try to import from parent directory
        from agent.bioinfo_agent import BioinfoAgentV2 as BioinfoAgent
        from agent.document_processor import DocumentProcessor

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__) 

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

agent = None

def ensure_vector_store():
    """Ensure vector store exists, build if not"""
    try:
        # Check if vector store exists
        vector_store_path = Path("./vector_store")
        faiss_file = vector_store_path / "index.faiss"
        pkl_file = vector_store_path / "index.pkl"
        
        if not (faiss_file.exists() and pkl_file.exists()):
            logging.info("Vector store not found, building...")
            
            # Create document processor and build vector store
            processor = DocumentProcessor()
            success = processor.build_vector_store()
            
            if success:
                logging.info("Vector store built successfully!")
                return True
            else:
                logging.error("Failed to build vector store!")
                return False
        else:
            # Check if vector store needs update
            processor = DocumentProcessor()
            if processor.need_update():
                logging.info("Vector store needs update, rebuilding...")
                success = processor.build_vector_store()
                if success:
                    logging.info("Vector store updated successfully!")
                else:
                    logging.warning("Failed to update vector store, using existing one")
            
            return True
            
    except Exception as e:
        logging.error("Error ensuring vector store: %s", str(e))
        return False

def initialize_agent():
    """Initializes the BioinfoAgent."""
    global agent
    if agent is None:
        logging.info("Initializing BioinfoAgent...")
        try:
            # First ensure vector store exists
            if not ensure_vector_store():
                logging.error("Failed to ensure vector store!")
                sys.exit(1)
            
            # Initialize Agent with specified memory store path
            memory_store_path = r"D:\file\MetaDock_Agent_dev\MetaDock_dv\agent\memory_store"
            agent = BioinfoAgent(memory_store_path=memory_store_path)
            if agent.ensure_vector_store():
                logging.info("BioinfoAgent initialized successfully!")
                
                # Print system status
                status = agent.get_status()
                logging.info("System Status: %s", status)
                
            else:
                logging.error("BioinfoAgent initialization failed!")
                sys.exit(1)
                
        except Exception as e:
            logging.error("Error during BioinfoAgent initialization: %s", str(e), exc_info=True)
            sys.exit(1)

@app.route('/ask', methods=['POST'])
def ask():
    """Handles streaming questions to the agent."""
    if not request.json or 'question' not in request.json:
        return jsonify({"error": "Invalid request. 'question' is required."}), 400

    if agent is None or not agent.is_initialized:
        return jsonify({"error": "Agent is not initialized."}), 503

    question = request.json['question']
    session_id = request.json.get('sessionId')
    
    logging.info(f"Received streaming question: {question}, sessionId: {session_id}")

    def generate():
        try:
            # Handle session management
            if session_id:
                # Try to load existing session
                success = agent.load_session(session_id)
                if not success:
                    logging.warning(f"Failed to load session {session_id}, continuing with current session")
            else:
                # No session ID provided, start a new session if none exists
                if not agent.session_memory.current_session_id:
                    new_session_id = agent.start_new_session()
                    logging.info(f"Started new session: {new_session_id}")
            
            for chunk in agent.ask_stream(question):
                # Format as Server-Sent Event (SSE)
                # chunk is already a JSON string from json.dumps()
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logging.error(f"Error during stream generation: {e}", exc_info=True)
            error_message = json.dumps({"type": "error", "error": "An internal error occurred during streaming."})
            yield f"data: {error_message}\\n\\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/viz/codegen', methods=['POST'])
def viz_codegen():
    """Generate seaborn visualization code via Agent"""
    if agent is None or not agent.is_initialized:
        return jsonify({"error": "Agent is not initialized."}), 503

    data = request.json or {}
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    try:
        result = agent.generate_viz_code(data)
        if result.get("error"):
            return jsonify({"success": False, "error": result["error"]}), 500
        return jsonify({"success": True, "code": result.get("code", "")})
    except Exception as e:
        logger.error(f"Error generating viz code: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/kg/enrich', methods=['POST'])
def kg_enrich_workflow():
    """Enrich user-provided workflow (nodes/connections) with metadata via LLM"""
    if agent is None or not agent.is_initialized:
        return jsonify({"error": "Agent is not initialized."}), 503

    data = request.json or {}
    required_fields = ["id", "name", "nodes", "connections"]
    missing = [f for f in required_fields if f not in data or data[f] is None]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    try:
        client = get_llm_client()
        llm = client.get_llm()

        nodes = data.get("nodes", [])
        connections = data.get("connections", [])
        description = data.get("description", "")
        tags = data.get("tags", [])
        category = data.get("category", "metagenomics")

        prompt = f"""
You are a bioinformatics workflow knowledge graph assistant. Given a canvas workflow (nodes + connections) and basic metadata, produce a rich workflow entry compatible with the existing KG schema (similar to spades_quast_kg.json). Output strictly valid JSON with these fields:
- id (use provided id)
- name (use provided name)
- description (concise; if user provided, refine it)
- category (use provided or infer)
- complexity: one of simple | moderate | complex
- keywords: short list of relevant terms
- use_cases: list of brief use cases
- natural_language_patterns: phrases users might say to trigger this workflow
- steps: ordered list with order, tool, description (tool comes from nodes.component)
- connections: edges between steps/tools (from connections)
- resource_requirements: rough estimates (memory/cpu/runtime)
- tags: include provided tags if any
Input metadata:
id: {data.get("id")}
name: {data.get("name")}
description: {description}
category: {category}
tags: {tags}
Nodes (as JSON):
{json.dumps(nodes)}
Connections (as JSON):
{json.dumps(connections)}

Return ONLY the JSON object, no extra text, no markdown, and ensure it is parseable.
"""

        raw = llm.invoke(prompt)
        enriched = raw.content if hasattr(raw, "content") else raw
        enriched_str = str(enriched).strip()
        # Validate JSON
        enriched_json = json.loads(enriched_str)
        return jsonify({"success": True, "workflow": enriched_json})
    except Exception as e:
        logger.error("Error enriching workflow: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/kg/reload', methods=['POST'])
def kg_reload():
    """Reload custom workflows from storage without restarting the agent"""
    if agent is None or not agent.is_initialized:
        return jsonify({"error": "Agent is not initialized."}), 503
    try:
        # Prefer workflow_planner attribute (BioinfoAgentV2)
        if hasattr(agent, "workflow_planner") and hasattr(agent.workflow_planner, "_load_custom_workflows"):
            agent.workflow_planner._load_custom_workflows()
            return jsonify({"success": True, "message": "Custom workflows reloaded."})
        # Legacy fallback: planner
        if hasattr(agent, "planner") and hasattr(agent.planner, "_load_custom_workflows"):
            agent.planner._load_custom_workflows()
            return jsonify({"success": True, "message": "Custom workflows reloaded (legacy planner)."})
        return jsonify({"error": "Planner does not support reload."}), 500
    except Exception as e:
        logger.error("Error reloading custom workflows: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    if agent and agent.is_initialized:
        status = agent.get_status()
        return jsonify({"status": "ok", "message": "Agent is running.", "system_status": status})
    else:
        return jsonify({"status": "error", "message": "Agent is not initialized."}), 503

@app.route('/status', methods=['GET'])
def get_status():
    """Get detailed system status information"""
    if agent and agent.is_initialized:
        status = agent.get_status()
        return jsonify(status)
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/tools', methods=['GET'])
def get_tools():
    """Get available tool list"""
    if agent and agent.is_initialized:
        tools = agent.get_available_tools()
        return jsonify({"tools": tools})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/update-documents', methods=['POST'])
def update_documents():
    """Manually update document vector store"""
    if agent is None:
        return jsonify({"error": "Agent is not initialized."}), 503
    
    # Get force parameter
    force = request.json.get('force', False) if request.json else False
    
    try:
        logging.info(f"Updating documents (force={force})...")
        
        success = agent.update_documents(force=force)
        
        if success:
            return jsonify({"success": True, "message": "Documents updated successfully"})
        else:
            return jsonify({"success": False, "message": "Failed to update documents"}), 500
            
    except Exception as e:
        logging.error(f"Error updating documents: {e}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/history', methods=['GET'])
def get_history():
    """Get conversation history"""
    if agent and agent.is_initialized and hasattr(agent, 'get_conversation_history'):
        history = agent.get_conversation_history()
        return jsonify({"history": history})
    else:
        return jsonify({"error": "Agent is not initialized or history not available."}), 503

@app.route('/clear-history', methods=['POST'])
def clear_history():
    """Clear conversation history"""
    if agent and agent.is_initialized and hasattr(agent, 'clear_history'):
        agent.clear_history()
        return jsonify({"success": True, "message": "History cleared"})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/debug', methods=['GET'])
def debug_info():
    """Debug information endpoint"""
    debug_data = {
        "agent_v2_available": True,
        "agent_initialized": agent is not None and agent.is_initialized if agent else False,
        "vector_store_exists": False,
        "metadata_exists": False,
    }
    
    # Check vector store files
    vector_store_path = Path("./vector_store")
    debug_data["vector_store_exists"] = (
        (vector_store_path / "index.faiss").exists() and 
        (vector_store_path / "index.pkl").exists()
    )
    debug_data["metadata_exists"] = (vector_store_path / "metadata.json").exists()
    
    # Get system status
    if agent and agent.is_initialized:
        debug_data["system_status"] = agent.get_status()
    
    return jsonify(debug_data)

# === Session Management Endpoints ===

@app.route('/sessions', methods=['GET'])
def get_sessions():
    """Get list of all sessions"""
    if agent and agent.is_initialized:
        sessions = agent.get_session_list()
        return jsonify({"sessions": sessions})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/sessions/new', methods=['POST'])
def start_new_session():
    """Start a new session"""
    if agent and agent.is_initialized:
        session_id = request.json.get('session_id') if request.json else None
        new_session_id = agent.start_new_session(session_id)
        return jsonify({"success": True, "session_id": new_session_id})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/sessions/<session_id>/load', methods=['POST'])
def load_session(session_id):
    """Load an existing session"""
    if agent and agent.is_initialized:
        success = agent.load_session(session_id)
        if success:
            return jsonify({"success": True, "message": f"Session {session_id} loaded"})
        else:
            return jsonify({"success": False, "message": "Session not found"}), 404
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Delete a session"""
    if agent and agent.is_initialized:
        success = agent.delete_session(session_id)
        if success:
            return jsonify({"success": True, "message": f"Session {session_id} deleted"})
        else:
            return jsonify({"success": False, "message": "Session not found"}), 404
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/sessions/save', methods=['POST'])
def save_current_session():
    """Save the current session"""
    if agent and agent.is_initialized:
        agent.save_current_session()
        return jsonify({"success": True, "message": "Current session saved"})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/sessions/cleanup', methods=['POST'])
def cleanup_sessions():
    """Clean up old sessions"""
    if agent and agent.is_initialized:
        days_to_keep = request.json.get('days_to_keep', 30) if request.json else 30
        deleted_count = agent.cleanup_old_sessions(days_to_keep)
        return jsonify({
            "success": True, 
            "message": f"Cleaned up {deleted_count} old sessions",
            "deleted_count": deleted_count
        })
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

# === Model Management Endpoints ===

@app.route('/models', methods=['GET'])
def get_supported_models():
    """Get list of supported models"""
    try:
        from agent_client import MultiLLMClient
        models = MultiLLMClient.get_supported_models()
        
        # Add current model info
        current_client = get_llm_client()
        current_info = current_client.get_model_info()
        
        return jsonify({
            "supported_models": models,
            "current_model": current_info
        })
    except Exception as e:
        logger.error(f"Error getting models: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/switch-model', methods=['POST'])
def switch_model():
    """Switch to a different model"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        model_name = data.get('model')
        api_keys = data.get('api_keys', {})
        
        if not model_name:
            return jsonify({"error": "Model name is required"}), 400
        
        # Import here to avoid circular imports
        from agent_client import switch_global_model, get_llm_client
        
        # Switch the global model
        switch_global_model(model_name, api_keys)
        
        # Update the agent's LLM if it exists
        global agent
        if agent and agent.is_initialized:
            # Re-initialize the adaptive_rag system to use new model
            agent.adaptive_rag._initialize_llm_instances()
            
            logger.info(f"Updated agent to use model: {model_name}")
        
        # Get updated model info
        current_info = get_llm_client().get_model_info()
        
        return jsonify({
            "success": True,
            "message": f"Switched to {model_name}",
            "current_model": current_info
        })
        
    except Exception as e:
        logger.error(f"Error switching model: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/workflow-plan', methods=['GET'])
def get_workflow_plan():
    """Get current workflow plan"""
    if agent and agent.is_initialized:
        plan = agent.get_current_workflow_plan()
        if plan:
            return jsonify({"success": True, "plan": plan})
        else:
            return jsonify({"success": False, "message": "No active workflow plan"})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/workflow-plan/clear', methods=['POST'])
def clear_workflow_plan():
    """Clear current workflow planning state"""
    if agent and agent.is_initialized:
        agent.clear_workflow_planning()
        return jsonify({"success": True, "message": "Workflow planning state cleared"})
    else:
        return jsonify({"error": "Agent is not initialized."}), 503

@app.route('/test-model', methods=['POST'])
def test_model():
    """Test model connection with provided API key"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        model_name = data.get('model')
        api_key = data.get('api_key')
        
        if not model_name:
            return jsonify({"error": "Model name is required"}), 400
        
        from agent_client import MultiLLMClient
        
        model_config = MultiLLMClient.SUPPORTED_MODELS.get(model_name)
        if not model_config:
            return jsonify({"error": f"Unsupported model: {model_name}"}), 400
        
        # For Ollama models, API key is not required
        if model_config["provider"] == "ollama":
            test_client = MultiLLMClient(model_name, {})
        else:
            if not api_key:
                return jsonify({"error": "API key is required for this model"}), 400
            
            provider = model_config["provider"]
            test_client = MultiLLMClient(model_name, {provider: api_key})
        
        # Test with a simple prompt
        test_llm = test_client.get_llm()
        
        if hasattr(test_llm, 'invoke'):
            response = test_llm.invoke("Hello, please respond with 'Connection successful'")
        else:
            # For adapters
            response = test_llm.invoke("Hello, please respond with 'Connection successful'")
        
        return jsonify({
            "success": True,
            "message": "Model connection successful",
            "test_response": str(response)[:100]  # First 100 chars
        })
        
    except Exception as e:
        logger.error(f"Error testing model: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400

if __name__ == '__main__':
    initialize_agent()
    # Use a different port to avoid conflict with the Node.js server
    port = 5111
    logging.info(f"Starting agent server on http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=False) 