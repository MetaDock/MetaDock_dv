"""
Upgraded bioinformatics Agent - using Adaptive RAG system
Supports fast startup and offline document processing
"""

import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path

from adaptive_rag import AdaptiveRAG
from document_processor import DocumentProcessor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BioinfoAgentV2:
    """Upgraded bioinformatics tool Q&A Agent"""
    
    def __init__(self, 
                 docs_path: str = "../help_pages_for_test", 
                 vector_store_path: str = "./vector_store"):
        """
        Initialize Agent
        
        Args:
            docs_path: Document path
            vector_store_path: Vector store path
        """
        self.docs_path = docs_path
        self.vector_store_path = vector_store_path
        self.conversation_history: List[Dict[str, Any]] = []
        self.is_initialized = False
        self.available_tools: List[str] = []
        
        # Initialize document processor and RAG system
        self.document_processor = DocumentProcessor(docs_path, vector_store_path)
        self.adaptive_rag = AdaptiveRAG(vector_store_path)
        
    def ensure_vector_store(self) -> bool:
        """
        Ensure vector store exists and is up to date
        This method will automatically build or update vector store when needed
        """
        try:
            # Check if vector store needs updating
            if self.document_processor.need_update():
                logger.info("Vector store needs update, building...")
                success = self.document_processor.build_vector_store()
                if not success:
                    logger.error("Failed to build vector store")
                    return False
                logger.info("Vector store updated successfully")
            else:
                logger.info("Vector store is up to date")
            
            return True
            
        except Exception as e:
            logger.error("Error ensuring vector store: %s", str(e))
            return False
    
    def initialize(self) -> bool:
        """
        Fast initialize Agent
        Only load pre-built vector store, don't rebuild
        """
        if self.is_initialized:
            return True
        
        try:
            logger.info("Initializing BioinfoAgent V2...")
            
            # Quick check if vector store exists
            vector_store_dir = Path(self.vector_store_path)
            faiss_file = vector_store_dir / "index.faiss"
            pkl_file = vector_store_dir / "index.pkl"
            metadata_file = vector_store_dir / "metadata.json"
            
            if not (faiss_file.exists() and pkl_file.exists()):
                logger.warning("Vector store not found, please run document processing first")
                # Try to build vector store
                if not self.ensure_vector_store():
                    return False
            
            # Initialize RAG system
            if not self.adaptive_rag.initialize():
                logger.error("Failed to initialize Adaptive RAG system")
                return False
            
            # Load available tools list
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                        self.available_tools = metadata.get('available_tools', [])
                        logger.info("Loaded %d available tools", len(self.available_tools))
                except Exception as e:
                    logger.warning("Could not load metadata: %s", str(e))
            
            self.is_initialized = True
            logger.info("BioinfoAgent V2 initialized successfully!")
            return True
            
        except Exception as e:
            logger.error("Error during agent initialization: %s", str(e), exc_info=True)
            self.is_initialized = False
            return False
    
    def add_to_history(self, role: str, content: str, sources: List[Dict] = None, steps: List[str] = None):
        """Add to conversation history"""
        entry = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
        }
        
        if sources:
            entry["sources"] = sources
        if steps:
            entry["steps"] = steps
            
        self.conversation_history.append(entry)
        
        # Keep history at reasonable length
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]
    
    def ask_stream(self, question: str):
        """
        Stream process question, using Adaptive RAG system
        """
        if not self.is_initialized:
            yield json.dumps({"type": "error", "error": "Agent not initialized"})
            return
        
        self.add_to_history("user", question)
        
        try:
            # Use Adaptive RAG system for streaming response
            full_answer = ""
            sources = []
            steps = []
            
            for event in self.adaptive_rag.stream_answer(question):
                # Forward different types of events
                if event['type'] == 'step':
                    yield json.dumps(event)
                    steps.extend(event.get('steps', []))
                    
                elif event['type'] == 'sources':
                    sources = event['sources']
                    yield json.dumps(event)
                    
                elif event['type'] == 'chunk':
                    full_answer += event['content']
                    yield json.dumps(event)
                    
                elif event['type'] == 'final':
                    full_answer = event.get('answer', full_answer)
                    sources = event.get('sources', sources)
                    steps = event.get('steps', steps)
                    yield json.dumps(event)
                    
                elif event['type'] == 'error':
                    yield json.dumps(event)
                    return
            
            # Add to history
            if full_answer:
                self.add_to_history("assistant", full_answer, sources=sources, steps=steps)
                
        except Exception as e:
            logger.error("Error during stream processing: %s", str(e), exc_info=True)
            error_event = {
                "type": "error", 
                "error": f"Error occurred during processing: {str(e)}"
            }
            yield json.dumps(error_event)
    
    def ask_question(self, question: str) -> Dict[str, Any]:
        """
        Non-streaming Q&A (compatibility method)
        """
        if not self.is_initialized:
            return {
                "answer": "Agent not initialized",
                "sources": [],
                "question": question
            }
        
        try:
            result = self.adaptive_rag.ask_question(question)
            
            # Add to history
            self.add_to_history("user", question)
            if result.get("answer"):
                self.add_to_history(
                    "assistant", 
                    result["answer"],
                    sources=result.get("sources", []),
                    steps=result.get("steps", [])
                )
            
            return result
            
        except Exception as e:
            logger.error("Error processing question: %s", str(e), exc_info=True)
            return {
                "answer": f"Error occurred while processing question: {str(e)}",
                "sources": [],
                "question": question
            }
    
    def get_available_tools(self) -> List[str]:
        """Get available tools list"""
        return self.available_tools
    
    def get_conversation_history(self) -> List[Dict[str, Any]]:
        """Get conversation history"""
        return self.conversation_history
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
    
    def update_documents(self, force: bool = False) -> bool:
        """
        Update document vector store
        
        Args:
            force: Whether to force update even if no changes detected
            
        Returns:
            bool: Whether update was successful
        """
        try:
            logger.info("Updating document vector store...")
            success = self.document_processor.build_vector_store(force=force)
            
            if success:
                # Re-initialize RAG system to load new vector store
                self.adaptive_rag.initialize()
                
                # Reload tools list
                metadata_file = Path(self.vector_store_path) / "metadata.json"
                if metadata_file.exists():
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                        self.available_tools = metadata.get('available_tools', [])
                
                logger.info("Document update completed successfully")
            
            return success
            
        except Exception as e:
            logger.error("Error updating documents: %s", str(e))
            return False
    
    def get_system_status(self) -> Dict[str, Any]:
        """Get system status information"""
        status = {
            "initialized": self.is_initialized,
            "available_tools": len(self.available_tools),
            "conversation_history_length": len(self.conversation_history),
        }
        
        # Check vector store status
        try:
            metadata_file = Path(self.vector_store_path) / "metadata.json"
            if metadata_file.exists():
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                    status.update({
                        "last_update": metadata.get("last_update"),
                        "total_documents": metadata.get("total_documents", 0),
                        "total_chunks": metadata.get("total_chunks", 0),
                        "embedding_model": metadata.get("embedding_model", "unknown"),
                    })
        except:
            pass
        
        return status


# Backward compatibility - create an alias
BioinfoAgent = BioinfoAgentV2 