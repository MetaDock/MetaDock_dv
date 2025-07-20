from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import logging
import sys
import json
import os
from pathlib import Path

# Import new Agent system
from bioinfo_agent import BioinfoAgent
from document_processor import DocumentProcessor

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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
            
            # Initialize Agent
            agent = BioinfoAgent()
            if agent.initialize():
                logging.info("BioinfoAgent initialized successfully!")
                
                # Print system status
                status = agent.get_system_status()
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
    logging.info(f"Received streaming question: {question}")

    def generate():
        try:
            for chunk in agent.ask_stream(question):
                # Format as Server-Sent Event (SSE)
                yield f"data: {chunk}\\n\\n"
        except Exception as e:
            logging.error(f"Error during stream generation: {e}", exc_info=True)
            error_message = json.dumps({"type": "error", "error": "An internal error occurred during streaming."})
            yield f"data: {error_message}\\n\\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    if agent and agent.is_initialized:
        status = agent.get_system_status()
        return jsonify({"status": "ok", "message": "Agent is running.", "system_status": status})
    else:
        return jsonify({"status": "error", "message": "Agent is not initialized."}), 503

@app.route('/status', methods=['GET'])
def get_status():
    """Get detailed system status information"""
    if agent and agent.is_initialized:
        status = agent.get_system_status()
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
        debug_data["system_status"] = agent.get_system_status()
    
    return jsonify(debug_data)

if __name__ == '__main__':
    initialize_agent()
    # Use a different port to avoid conflict with the Node.js server
    port = 5111
    logging.info(f"Starting agent server on http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=False) 