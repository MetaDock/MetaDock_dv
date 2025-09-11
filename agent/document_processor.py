#!/usr/bin/env python3
"""
Offline document processor - for building and updating vector database
Only re-embeds when documents in help_pages_for_test directory change
"""

import os
import json
import hashlib
from datetime import datetime
from typing import List, Dict, Any
from pathlib import Path

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.schema import Document


class DocumentProcessor:
    def __init__(self, 
                 docs_path: List[str] = ["../help_pages_for_test", "../docs"], 
                 vector_store_path: str = "./vector_store"):
        """
        Initialize document processor
        
        Args:
            docs_path: List of document paths
            vector_store_path: Vector store path
        """
        # Fix path parsing
        self.docs_paths = []
        for path in docs_path:
            if path.startswith("../"):
                self.docs_paths.append(Path(__file__).parent.parent / path[3:])
            else:
                self.docs_paths.append(Path(path))
            
        self.vector_store_path = Path(vector_store_path)
        self.vector_store_path.mkdir(exist_ok=True)
        
        # Metadata file path
        self.metadata_file = self.vector_store_path / "metadata.json"
        
        # Initialize components
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        
        self.embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'}
        )
    
    def calculate_docs_hash(self) -> str:
        """Calculate hash of all documents for change detection"""
        all_content = []
        
        for doc_path in self.docs_paths:
            if not doc_path.exists():
                continue
            
            files = sorted(list(doc_path.glob("*.txt"))) + sorted(list(doc_path.glob("*.md")))
            
            for file_path in files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    all_content.append(f"{file_path.name}:{content}")
                except Exception as e:
                    print(f"Error reading {file_path}: {e}")
        
        # Calculate MD5 hash of all content
        combined_content = "\n".join(all_content)
        return hashlib.md5(combined_content.encode()).hexdigest()
    
    def load_metadata(self) -> Dict[str, Any]:
        """Load metadata"""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading metadata: {e}")
        
        return {
            "last_update": None,
            "docs_hash": "",
            "total_documents": 0,
            "total_chunks": 0,
            "available_tools": []
        }
    
    def save_metadata(self, metadata: Dict[str, Any]):
        """Save metadata"""
        try:
            with open(self.metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
        except Exception as e:
                print(f"Error saving metadata: {e}")
    
    def need_update(self) -> bool:
        """Check if vector database needs updating"""
        current_hash = self.calculate_docs_hash()
        metadata = self.load_metadata()
        
        # Check if vector store files exist
        faiss_file = self.vector_store_path / "index.faiss"
        pkl_file = self.vector_store_path / "index.pkl"
        
        if not (faiss_file.exists() and pkl_file.exists()):
            print("Vector store files not found, need to create")
            return True
        
        if current_hash != metadata.get("docs_hash", ""):
            print("Documents have changed, need to update")
            return True
        
        print("No changes detected, vector store is up to date")
        return False
    
    def load_documents(self) -> List[Document]:
        """Load all documents"""
        documents = []
        
        for doc_path in self.docs_paths:
            print(f"Looking for documents in: {doc_path.absolute()}")
            
            if not doc_path.exists():
                print(f"Error: Document path does not exist: {doc_path}")
                continue
            
            files = list(doc_path.glob("*.txt")) + list(doc_path.glob("*.md"))
            print(f"Found {len(files)} files in {doc_path}")
            
            for file_path in files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if not content.strip():
                        print(f"Warning: Empty file skipped: {file_path.name}")
                        continue
                        
                    # Parse tool name and version
                    if file_path.suffix == ".txt":
                        parts = file_path.stem.split('_')
                        tool_name = parts[0] if parts else "unknown"
                        version = parts[1] if len(parts) > 1 else "unknown"
                    elif file_path.suffix == ".md":
                        tool_name = "MetaDock-Platform"
                        version = "1.0" # or derive from somewhere else if available
                    else:
                        tool_name = "unknown"
                        version = "unknown"
                    
                    doc = Document(
                        page_content=content,
                        metadata={
                            "source": file_path.name,
                            "tool_name": tool_name,
                            "version": version,
                            "file_path": str(file_path),
                            "last_modified": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
                        }
                    )
                    documents.append(doc)
                    print(f"Loaded: {file_path.name} ({len(content)} characters)")
                    
                except Exception as e:
                    print(f"Error loading {file_path}: {e}")
        
        print(f"Total documents loaded: {len(documents)}")
        return documents
    
    def build_vector_store(self, force: bool = False) -> bool:
        """Build vector database"""
        if not force and not self.need_update():
            return True
        
        print("Building vector store...")
        
        # Load documents
        documents = self.load_documents()
        if not documents:
            print("No documents to process")
            return False
        
        # Split documents
        print("Splitting documents...")
        texts = self.text_splitter.split_documents(documents)
        print(f"Split into {len(texts)} chunks")
        
        if not texts:
            print("No text chunks created")
            return False
        
        # Create vector store
        print("Creating embeddings and vector store...")
        vector_store = FAISS.from_documents(texts, self.embeddings)
        
        # Save vector store
        vector_store.save_local(str(self.vector_store_path))
        print(f"Vector store saved to {self.vector_store_path}")
        
        # Extract tool list
        available_tools = list(set([doc.metadata.get("tool_name", "unknown") for doc in documents]))
        available_tools = [tool for tool in available_tools if tool != "unknown"]
        
        # Save metadata
        metadata = {
            "last_update": datetime.now().isoformat(),
            "docs_hash": self.calculate_docs_hash(),
            "total_documents": len(documents),
            "total_chunks": len(texts),
            "available_tools": sorted(available_tools),
            "embedding_model": "sentence-transformers/all-MiniLM-L6-v2"
        }
        self.save_metadata(metadata)
        
        print(f"Vector store built successfully!")
        print(f"   - Documents: {len(documents)}")
        print(f"   - Chunks: {len(texts)}")
        print(f"   - Tools: {len(available_tools)}")
        
        return True


def main():
    """Main function - can be run as standalone script"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Build or update vector store")
    parser.add_argument("--force", action="store_true", help="Force rebuild even if no changes detected")
    parser.add_argument("--docs-path", nargs='+', default=["../help_pages_for_test", "../docs"], help="Path to documents")
    parser.add_argument("--vector-store-path", default="./vector_store", help="Path to vector store")
    
    args = parser.parse_args()
    
    processor = DocumentProcessor(
        docs_path=args.docs_path,
        vector_store_path=args.vector_store_path
    )
    
    success = processor.build_vector_store(force=args.force)
    
    if success:
        print("Document processing completed successfully!")
    else:
        print("Document processing failed!")
        exit(1)


if __name__ == "__main__":
    main() 