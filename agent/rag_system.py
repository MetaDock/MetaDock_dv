import os
import json
from typing import List, Dict, Any
from pathlib import Path

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.schema import Document
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

from agent_client import llm


class RAGSystem:
    def __init__(self, docs_path: str = "../help_pages_for_test", vector_store_path: str = "./vector_store"):
        """
        initialize the RAG system
        
        Args:
            docs_path: path to the documents
            vector_store_path: path to the vector store
        """
        # fix the path parsing problem
        if docs_path.startswith("../"):
            # from the agent directory to the project root directory
            self.docs_path = Path(__file__).parent.parent / docs_path[3:]
        else:
            self.docs_path = Path(docs_path)
            
        self.vector_store_path = Path(vector_store_path)
        self.vector_store_path.mkdir(exist_ok=True)
        
        # initialize the text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        
        # initialize the embedding model
        self.embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'}
        )
        
        self.vector_store = None
        self.qa_chain = None
        
    def load_documents(self) -> List[Document]:
        """load all documents"""
        documents = []
        
        print(f"Looking for documents in: {self.docs_path.absolute()}")
        
        # check if the path exists
        if not self.docs_path.exists():
            print(f"Error: Document path does not exist: {self.docs_path}")
            return documents
        
        # find all txt files
        txt_files = list(self.docs_path.glob("*.txt"))
        print(f"Found {len(txt_files)} .txt files")
        
        for file_path in txt_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # check if the content is empty
                if not content.strip():
                    print(f"Warning: Empty file skipped: {file_path.name}")
                    continue
                    
                # create a Document object, including metadata
                doc = Document(
                    page_content=content,
                    metadata={
                        "source": file_path.name,
                        "tool_name": file_path.stem.split('_')[0],
                        "version": file_path.stem.split('_')[1] if '_' in file_path.stem else "unknown"
                    }
                )
                documents.append(doc)
                print(f"Loaded: {file_path.name} ({len(content)} characters)")
                
            except Exception as e:
                print(f"Error loading {file_path}: {e}")
        
        print(f"Total documents loaded: {len(documents)}")
        return documents
    
    def create_vector_store(self, documents: List[Document]) -> FAISS:
        """create the vector store"""
        if not documents:
            raise ValueError("No documents loaded! Please check the document path and file contents.")
        
        print("Splitting documents...")
        texts = self.text_splitter.split_documents(documents)
        print(f"Split into {len(texts)} chunks")
        
        if not texts:
            raise ValueError("No text chunks created! Please check document content and text splitter settings.")
        
        print("Creating vector store...")
        vector_store = FAISS.from_documents(texts, self.embeddings)
        
        # save the vector store
        vector_store.save_local(str(self.vector_store_path))
        print(f"Vector store saved to {self.vector_store_path}")
        
        return vector_store
    
    def load_vector_store(self) -> FAISS:
        """load the vector store"""
        vector_store_dir = self.vector_store_path / "index.faiss"
        if vector_store_dir.exists():
            print("Loading existing vector store...")
            try:
                return FAISS.load_local(
                    str(self.vector_store_path), 
                    self.embeddings,
                    allow_dangerous_deserialization=True
                )
            except Exception as e:
                print(f"Failed to load existing vector store: {e}")
                print("Creating new vector store...")
                documents = self.load_documents()
                return self.create_vector_store(documents)
        else:
            print("Creating new vector store...")
            documents = self.load_documents()
            return self.create_vector_store(documents)
    
    def setup_qa_chain(self):
        """set up the question-answering chain"""
        # custom prompt template
        template = """You are a professional bioinformatics tool assistant. Please answer the user's question based on the following context information.

Your answer must follow the following Markdown format, ensuring the content is structured and informative:

1.  **Overview**: First, use a few sentences to summarize the main functionality of the tool.
2.  **Key Features**: Use numbered lists to detail the key features of the tool. For each feature, you can use sublists or paragraphs to elaborate.
3.  **References**: If the context contains literature references, DOIs, or project links, list them in this section.
4.  **Example Commands**: If there are any, provide one or more example commands and format them using Markdown code blocks. The code blocks should be formatted correctly, with proper indentation and line breaks.

---

Context information:
{context}

---

Question: {question}   

---

Please strictly follow the above format to generate the answer. If there is no information in the context (e.g., "Example Commands"), please omit that part.

Answer:"""

        prompt = PromptTemplate(
            template=template,
            input_variables=["context", "question"]
        )
        
        # create the retriever
        retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 5}
        )
        
        # create the question-answering chain
        self.qa_chain = RetrievalQA.from_chain_type(
            llm=llm,
            chain_type="stuff",
            retriever=retriever,
            chain_type_kwargs={"prompt": prompt},
            return_source_documents=True
        )
    
    def initialize(self):
        """initialize the RAG system"""
        print("Initializing RAG system...")
        self.vector_store = self.load_vector_store()
        self.setup_qa_chain()
        print("RAG system initialized successfully!")
    
    def get_available_tools(self) -> List[str]:
        """Scans the docs path and returns a list of unique tool names."""
        if not self.docs_path.exists():
            return []
        
        tool_names = set()
        txt_files = list(self.docs_path.glob("*.txt"))
        for file_path in txt_files:
            # Assumes format like 'toolname_v1.2.3.txt'
            tool_name = file_path.stem.split('_')[0]
            tool_names.add(tool_name)
        return list(tool_names)

    def ask_question(self, question: str, target_tool: str = None) -> Dict[str, Any]:
        """
        ask a question and get the answer.
        if a target tool is provided, filter the sources for relevance.
        also, deduplicate the sources.
        """
        if not self.qa_chain:
            raise ValueError("RAG system not initialized. Call initialize() first.")
        
        try:
            result = self.qa_chain({"query": question})
            
            source_docs = result.get("source_documents", [])
            
            # 1. If a target tool is specified, filter sources for relevance.
            if target_tool:
                filtered_docs = [doc for doc in source_docs if doc.metadata.get("tool_name") == target_tool]
                # If filtering keeps at least one doc, use the filtered list.
                if filtered_docs:
                    source_docs = filtered_docs

            # 2. Deduplicate the final list of sources based on the 'source' filename.
            unique_sources_metadata = []
            seen_sources = set()
            for doc in source_docs:
                source_filename = doc.metadata.get("source")
                if source_filename and source_filename not in seen_sources:
                    unique_sources_metadata.append(doc.metadata)
                    seen_sources.add(source_filename)

            return {
                "answer": result.get("result", ""),
                "sources": unique_sources_metadata,
                "question": question
            }
        except Exception as e:
            return {
                "answer": f"Sorry, an error occurred while processing your question: {str(e)}",
                "sources": [],
                "question": question
            }
    
    def stream_answer_with_context(self, question: str, target_tool: str = None):
        """
        Retrieves context, then streams the answer from the LLM.
        Yields events for sources, chunks, and completion.
        """
        if not self.vector_store or not self.qa_chain:
            raise ValueError("RAG system not initialized. Call initialize() first.")

        # 1. Retrieve relevant documents
        retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 5}
        )
        source_docs = retriever.get_relevant_documents(question)

        # 2. Filter and deduplicate sources
        if target_tool:
            filtered_docs = [doc for doc in source_docs if doc.metadata.get("tool_name") == target_tool]
            if filtered_docs:
                source_docs = filtered_docs
        
        if not source_docs:
            yield {"type": "no_context"}
            return

        unique_sources_metadata = []
        seen_sources = set()
        for doc in source_docs:
            source_filename = doc.metadata.get("source")
            if source_filename and source_filename not in seen_sources:
                unique_sources_metadata.append(doc.metadata)
                seen_sources.add(source_filename)
        
        # 3. Yield sources and start streaming the answer
        yield {
            "type": "sources",
            "sources": unique_sources_metadata
        }

        # 4. Construct context and prompt
        context = "\\n\\n".join([doc.page_content for doc in source_docs])
        prompt_template = self.qa_chain.combine_documents_chain.llm_chain.prompt
        prompt = prompt_template.format(context=context, question=question)

        # 5. Stream the response from the LLM
        full_answer = ""
        for chunk in llm.stream(prompt):
            content = chunk.content if hasattr(chunk, 'content') else str(chunk)
            if content:
                full_answer += content
                yield {
                    "type": "chunk",
                    "content": content
                }
        
        # 6. Yield final data with full answer
        yield {
            "type": "final_data",
            "answer": full_answer,
            "sources": unique_sources_metadata
        }

    def search_similar(self, query: str, k: int = 5) -> List[Dict]:
        """search for similar documents"""
        if not self.vector_store:
            raise ValueError("Vector store not loaded. Call initialize() first.")
        
        docs = self.vector_store.similarity_search(query, k=k)
        return [
            {
                "content": doc.page_content[:500] + "...",
                "metadata": doc.metadata
            }
            for doc in docs
        ]

