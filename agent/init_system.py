#!/usr/bin/env python3
"""
System initialization script
For pre-building vector database, checking dependencies and preparing runtime environment
"""

import sys
import os
import subprocess
import logging
from pathlib import Path

# Add current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_dependencies():
    """Check necessary dependencies"""
    required_packages = [
        ('langchain', 'langchain'),
        ('langchain-community', 'langchain_community'), 
        ('langchain-core', 'langchain_core'),
        ('sentence-transformers', 'sentence_transformers'),
        ('faiss-cpu', 'faiss'),
        ('flask', 'flask'),
        ('flask-cors', 'flask_cors'),
        ('pydantic', 'pydantic')
    ]
    
    missing_packages = []
    
    for package_name, import_name in required_packages:
        try:
            __import__(import_name)
            logger.info("[OK] %s", package_name)
        except ImportError:
            missing_packages.append(package_name)
            logger.warning("[MISSING] %s", package_name)
    
    if missing_packages:
        logger.error("Missing packages: %s", missing_packages)
        logger.info("Please install missing packages:")
        logger.info("pip install %s", ' '.join(missing_packages))
        return False
    
    logger.info("All required packages are available")
    return True


def check_llm_client():
    """Check LLM client configuration"""
    try:
        from agent_client import llm
        logger.info("LLM client configured successfully")
        return True
    except Exception as e:
        logger.error("LLM client configuration error: %s", str(e))
        logger.info("Please check your agent_client.py configuration")
        return False


def check_documents():
    """Check document directory"""
    docs_path = Path(__file__).parent.parent / "help_pages_for_test"
    
    if not docs_path.exists():
        logger.error("Documents directory not found: %s", docs_path)
        return False
    
    txt_files = list(docs_path.glob("*.txt"))
    
    if not txt_files:
        logger.error("No .txt files found in: %s", docs_path)
        return False
    
    logger.info("Found %d document files", len(txt_files))
    for file in txt_files[:5]:  # Show first 5 files
        logger.info("   - %s", file.name)
    
    if len(txt_files) > 5:
        logger.info("   ... and %d more files", len(txt_files) - 5)
    
    return True


def build_vector_store():
    """Build vector store"""
    try:
        logger.info("Building vector store...")
        
        from document_processor import DocumentProcessor
        
        processor = DocumentProcessor()
        
        # Check if update needed
        if not processor.need_update():
            logger.info("Vector store is already up to date")
            return True
        
        # Build vector store
        success = processor.build_vector_store()
        
        if success:
            logger.info("Vector store built successfully!")
            
            # Show build information
            metadata = processor.load_metadata()
            logger.info("Build Summary:")
            logger.info("   - Documents: %d", metadata.get('total_documents', 0))
            logger.info("   - Chunks: %d", metadata.get('total_chunks', 0))
            logger.info("   - Tools: %d", len(metadata.get('available_tools', [])))
            logger.info("   - Last Update: %s", metadata.get('last_update', 'Unknown'))
            
            return True
        else:
            logger.error("Failed to build vector store")
            return False
            
    except Exception as e:
        logger.error("Error building vector store: %s", str(e))
        return False


def test_adaptive_rag():
    """Test Adaptive RAG system"""
    try:
        logger.info("Testing Adaptive RAG system...")
        
        from adaptive_rag import AdaptiveRAG
        
        rag_system = AdaptiveRAG()
        
        if not rag_system.initialize():
            logger.error("Failed to initialize Adaptive RAG")
            return False
        
        # Simple test
        test_question = "What is FastQC?"
        result = rag_system.ask_question(test_question)
        
        if result and result.get('answer'):
            logger.info("Adaptive RAG system working correctly")
            logger.info("   Test answer length: %d characters", len(result['answer']))
            logger.info("   Sources found: %d", len(result.get('sources', [])))
            return True
        else:
            logger.error("Adaptive RAG test failed")
            return False
            
    except Exception as e:
        logger.error("Error testing Adaptive RAG: %s", str(e))
        return False


def test_agent():
    """Test Agent system"""
    try:
        logger.info("Testing BioinfoAgent...")
        
        from bioinfo_agent import BioinfoAgent
        
        agent = BioinfoAgent()
        
        if not agent.initialize():
            logger.error("Failed to initialize Agent")
            return False
        
        # Get system status
        status = agent.get_system_status()
        logger.info("Agent initialized successfully")
        logger.info("Agent Status: %s", status)
        
        return True
        
    except Exception as e:
        logger.error("Error testing Agent: %s", str(e))
        return False


def main():
    """Main initialization workflow"""
    logger.info("Starting MetaDock Agent System Initialization...")
    logger.info("=" * 60)
    
    # Step 1: Check dependencies
    logger.info("1. Checking dependencies...")
    if not check_dependencies():
        logger.error("Dependency check failed")
        return False
    
    # Step 2: Check LLM client
    logger.info("\n2. Checking LLM client...")
    if not check_llm_client():
        logger.error("LLM client check failed")
        return False
    
    # Step 3: Check documents
    logger.info("\n3. Checking documents...")
    if not check_documents():
        logger.error("Document check failed")
        return False
    
    # Step 4: Build vector store
    logger.info("\n4. Building vector store...")
    if not build_vector_store():
        logger.error("Vector store build failed")
        return False
    
    # Step 5: Test Adaptive RAG
    logger.info("\n5. Testing Adaptive RAG...")
    if not test_adaptive_rag():
        logger.error("Adaptive RAG test failed")
        return False
    
    # Step 6: Test Agent
    logger.info("\n6. Testing Agent...")
    if not test_agent():
        logger.error("Agent test failed")
        return False
    
    logger.info("\n" + "=" * 60)
    logger.info("System initialization completed successfully!")
    logger.info("Your MetaDock Agent system is ready to use!")
    logger.info("\nNext steps:")
    logger.info("  - Run 'python agent_server.py' to start the agent server")
    logger.info("  - Or run 'node server.js' from the project root to start the full application")
    
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 