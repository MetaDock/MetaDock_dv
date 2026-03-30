"""
Adaptive RAG system based on LangGraph
Implements query routing, retrieval scoring, hallucination detection, and self-correction
"""

import json
import logging
import requests
import threading
from typing import Dict, List, Any, Optional, Literal
from datetime import datetime
import time
import re
from urllib.parse import quote_plus

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.schema import Document
from pydantic import BaseModel, Field

# Try importing LangGraph, provide fallback if not available
try:
    from langgraph.graph import END, StateGraph, START
    LANGGRAPH_AVAILABLE = True
except ImportError:
    logging.warning("LangGraph not available, using simplified implementation")
    LANGGRAPH_AVAILABLE = False

from infra.agent_client import get_llm_client
from prompt_loader import load_prompts, load_prompts_with_variants

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# NOTE: This module now includes comprehensive LLM output logging for debugging
# All major LLM interactions will print their prompts and raw outputs to console
# Look for the following debugging markers in logs:
# 🤖 RAG ANSWER - Document-based responses
# 🤖 GENERAL LLM - Direct LLM responses
# 🤖 WEB SEARCH LLM - Web search-based responses  
# 🤖 TITLE GENERATION - Session title creation
# 🤖 ROUTING DECISION - Query routing decisions
# 📚 DOCUMENT RETRIEVAL - Vector store searches
# 📄 Document grading - Document relevance scoring


class RouteQuery(BaseModel):
    """Query routing data model"""
    datasource: Literal["vectorstore", "web_search", "general_llm"] = Field(
        ...,
        description="Choose routing to vector store, web search, or general LLM based on user question",
    )


class GradeDocuments(BaseModel):
    """Document relevance scoring data model"""
    score: float = Field(
        description="Relevance score between 0.0 (not relevant) and 1.0 (very relevant)."
    )


class GradeHallucinations(BaseModel):
    """Hallucination detection data model"""
    binary_score: str = Field(
        description="Whether the generated answer is based on document facts, 'yes' or 'no'"
    )


class GradeAnswer(BaseModel):
    """Answer quality scoring data model"""
    binary_score: str = Field(
        description="Whether the answer solves the problem, 'yes' or 'no'"
    )


class GraphState(BaseModel):
    """Graph state data model"""
    question: str
    generation: str = ""
    documents: List[Document] = []
    steps: List[str] = []


class AdaptiveRAG:
    """Adaptive RAG system"""
    
    def __init__(self, vector_store_path: str = "./vector_store"):
        """
        Initialize adaptive RAG system
        
        Args:
            vector_store_path: Vector store path
        """
        self.vector_store_path = vector_store_path
        self.vector_store = None
        self.embeddings = None
        self.available_tools = []
        
        # Check if LLM supports structured output
        self.supports_structured_output = self._check_structured_output_support()
        
        # Initialize LLM instances - will be set during initialize()
        self.router_llm = None
        self.doc_grader_llm = None
        self.hallucination_grader_llm = None
        self.answer_grader_llm = None
        
        # Initialize prompt templates
        self._setup_prompts()
        
        # Initialize graph if LangGraph is available
        if LANGGRAPH_AVAILABLE:
            self.graph = None
            self._build_graph()
    
    def _check_structured_output_support(self) -> bool:
        """Check if LLM supports structured output"""
        # Force disable structured output for Qwen models to avoid API compatibility issues
        # Qwen models require 'json' keyword in messages when using structured output
        logger.info("Structured output disabled for maximum compatibility with Qwen models")
        return False
    
    def _setup_prompts(self):
        """Setup prompt templates from backend-agent/prompts/*.yaml (see docs/prompt-assets.md)."""
        # Router: routing.yaml
        route_structured, route_text = load_prompts_with_variants("routing", "routing")
        self.route_prompt = route_structured if self.supports_structured_output else route_text

        # Document grading, hallucination, answer quality: grading.yaml
        grade_s, grade_t = load_prompts_with_variants("grading", "grade_document")
        self.grade_prompt = grade_s if self.supports_structured_output else grade_t
        hall_s, hall_t = load_prompts_with_variants("grading", "hallucination")
        self.hallucination_prompt = hall_s if self.supports_structured_output else hall_t
        ans_s, ans_t = load_prompts_with_variants("grading", "grade_answer")
        self.answer_prompt = ans_s if self.supports_structured_output else ans_t

        # RAG general: rag_general.yaml
        self.rewrite_prompt = load_prompts("rag_general", subkey="rewrite")
        self.general_prompt = load_prompts("rag_general", subkey="general_llm")
        self.web_search_prompt = load_prompts("rag_general", subkey="web_search")
        self.rag_prompt = load_prompts("rag_general", subkey="rag")
    
    def load_vector_store(self):
        """Load vector store"""
        try:
            self.embeddings = HuggingFaceEmbeddings(
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                model_kwargs={'device': 'cpu'}
            )
            
            self.vector_store = FAISS.load_local(
                self.vector_store_path,
                self.embeddings,
                allow_dangerous_deserialization=True
            )
            
            # Load metadata
            metadata_file = f"{self.vector_store_path}/metadata.json"
            try:
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                    self.available_tools = metadata.get('available_tools', [])
            except:
                self.available_tools = []
                
            logger.info(f"Vector store loaded successfully. Available tools: {len(self.available_tools)}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load vector store: {e}")
            return False
    
    def route_question(self, question: str) -> str:
        """Route question to appropriate data source"""
        max_retries = 3
        retry_delay = 1  # seconds
        
        for attempt in range(max_retries):
            try:
                if self.supports_structured_output:
                    chain = self.route_prompt | self.router_llm
                    result = chain.invoke({"question": question})
                    
                    # Print routing for debugging
                    logger.info("=" * 80)
                    logger.info("🤖 ROUTING DECISION - Structured Output:")
                    logger.info("Question: %s", question)
                    logger.info("Raw LLM Result: %s", result)
                    logger.info("Selected Datasource: %s", result.datasource)
                    logger.info("=" * 80)
                    
                    return result.datasource
                else:
                    # Use text parsing
                    chain = self.route_prompt | self.router_llm | StrOutputParser()
                    result = chain.invoke({"question": question})
                    
                    # Parse text result
                    result_lower = result.lower()
                    if "vectorstore" in result_lower or "vector" in result_lower:
                        final_route = "vectorstore"
                    elif "web_search" in result_lower or "web search" in result_lower:
                        final_route = "web_search"
                    else:
                        final_route = "general_llm"
                    
                    # Print routing for debugging
                    logger.info("=" * 80)
                    logger.info("🤖 ROUTING DECISION - Text Parsing:")
                    logger.info("Question: %s", question)
                    logger.info("Raw LLM Result: '%s'", result)
                    logger.info("Parsed Route: %s", final_route)
                    logger.info("=" * 80)
                    
                    return final_route
                        
            except Exception as e:
                logger.warning("Question routing attempt %d failed: %s", attempt + 1, str(e))
                
                if attempt < max_retries - 1:
                    # Wait before retry
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    # Final attempt failed, fall back to vectorstore
                    logger.error("All question routing attempts failed, defaulting to vectorstore")
                    return "vectorstore"
    
    def retrieve_documents(self, question: str, k: int = 5) -> List[Document]:
        """Retrieve relevant documents"""
        if not self.vector_store:
            return []
        
        try:
            # Check if specific tool is mentioned
            target_tool = None
            for tool in self.available_tools:
                # Use word boundaries to avoid partial matches (e.g., 'ani' in 'pyani')
                if re.search(r'\b' + re.escape(tool.lower()) + r'\b', question.lower()):
                    target_tool = tool
                    break
            
            # Apply metadata filter if a specific tool is mentioned
            search_filter = None
            if target_tool:
                search_filter = {'tool_name': target_tool}
                logger.info(f"Applying metadata filter for tool '{target_tool}'")

            # Adjust k for local models to reduce context length
            if self._is_local_model():
                k = min(k, 3)  # Limit to 3 documents for local models
                logger.info(f"🏠 Local model detected, limiting to {k} documents")
            
            # Retrieve documents using the filter
            docs = self.vector_store.similarity_search(question, k=k, filter=search_filter)
            
            # If the filtered search returns no results, try a broader search as a fallback
            if not docs and target_tool:
                logger.warning(f"Filtered search for tool '{target_tool}' yielded no results. Performing a broader search.")
                docs = self.vector_store.similarity_search(question, k=k)

            # Print document retrieval for debugging
            logger.info("=" * 60)
            logger.info("📚 DOCUMENT RETRIEVAL:")
            logger.info("Question: %s", question)
            logger.info("Retrieved %d documents", len(docs))
            if target_tool:
                logger.info("Target tool detected: %s", target_tool)
            for i, doc in enumerate(docs):
                logger.info("  Doc %d: %s... (source: %s)", i+1, 
                           doc.page_content[:100], 
                           doc.metadata.get("source", "unknown"))
            logger.info("=" * 60)
            
            # If target tool specified, prioritize related documents
            if target_tool:
                filtered_docs = [doc for doc in docs if doc.metadata.get("tool_name") == target_tool]
                if filtered_docs:
                    final_docs = filtered_docs[:3] + [doc for doc in docs if doc not in filtered_docs][:2]
                    logger.info("🎯 Prioritized docs for tool %s: %d tool-specific + %d general", 
                               target_tool, len(filtered_docs[:3]), len(final_docs) - len(filtered_docs[:3]))
                    return final_docs
            
            return docs
            
        except Exception as e:
            logger.error(f"Error in document retrieval: {e}")
            return []
    
    def grade_documents(self, question: str, documents: List[Document]) -> List[Document]:
        """Grade and filter documents based on a relevance score"""
        if not documents:
            return []
        
        relevance_threshold = 0.8  # Set a relevance threshold
        filtered_docs = []
        
        for doc in documents:
            max_retries = 2
            success = False
            
            for attempt in range(max_retries):
                try:
                    if self.supports_structured_output:
                        chain = self.grade_prompt | self.doc_grader_llm
                        result = chain.invoke({
                            "question": question,
                            "document": doc.page_content
                        })
                        score = result.score
                        logger.info("=" * 60)
                        logger.info("====== DOCUMENT RELEVANCE SCORE ======")
                        logger.info(f"  - Question: {question}")
                        logger.info(f"  - Document: {doc.metadata.get('source', 'unknown')}")
                        logger.info(f"  - Score: {score:.4f}")
                        if score >= relevance_threshold:
                            filtered_docs.append(doc)
                            logger.info("  - Decision: RELEVANT")
                        else:
                            logger.info("  - Decision: NOT RELEVANT")
                        logger.info("=" * 60)
                    else:
                        # Use text parsing
                        chain = self.grade_prompt | self.doc_grader_llm | StrOutputParser()
                        result_str = chain.invoke({
                            "question": question,
                            "document": doc.page_content
                        })
                        
                        # Parse float score from text result
                        try:
                            score_match = re.search(r"(\d\.\d+)", result_str)
                            if score_match:
                                score = float(score_match.group(1))
                            else:
                                score = 0.0 # Default to not relevant if no score found
                        except (ValueError, IndexError):
                            score = 0.0
                            logger.warning(f"Could not parse score from LLM output: '{result_str}'")

                        logger.info("=" * 60)
                        logger.info("====== DOCUMENT RELEVANCE SCORE ======")
                        logger.info(f"  - Question: {question}")
                        logger.info(f"  - Document: {doc.metadata.get('source', 'unknown')}")
                        logger.info(f"  - Raw LLM Output: '{result_str.strip()}'")
                        logger.info(f"  - Parsed Score: {score:.4f}")
                        if score >= relevance_threshold:
                            filtered_docs.append(doc)
                            logger.info("  - Decision: RELEVANT")
                        else:
                            logger.info("  - Decision: NOT RELEVANT")
                        logger.info("=" * 60)
                    
                    success = True
                    break
                        
                except Exception as e:
                    logger.warning("Document grading attempt %d failed: %s", attempt + 1, str(e))
                    if attempt < max_retries - 1:
                        import time
                        time.sleep(0.5)
            
            # If all attempts fail, discard the document
            if not success:
                logger.warning("Document grading failed for all attempts, discarding document")
        
        return filtered_docs
    
    def generate_answer(self, question: str, documents: List[Document], conversation_history: List[Dict] = None) -> str:
        """Generate answer based on documents"""
        if not documents:
            return "Sorry, I couldn't find relevant documents to answer your question."
        
        max_retries = 3
        retry_delay = 1
        
        for attempt in range(max_retries):
            try:
                # Optimize context for local models
                if self._is_local_model():
                    max_doc_length = 300
                    context_parts = []
                    for doc in documents:
                        content = doc.page_content
                        if len(content) > max_doc_length:
                            content = content[:max_doc_length] + "..."
                        context_parts.append(content)
                    context = "\n\n".join(context_parts)
                    logger.info(f"🏠 Optimized context for local model: {len(context)} chars")
                else:
                    context = "\n\n".join([doc.page_content for doc in documents])
                
                # Format conversation history for prompt
                history_text = ""
                if conversation_history:
                    history_text = "Previous conversation:\n"
                    for turn in conversation_history[-5:]:  # Last 5 turns for context
                        role = turn.get('role', 'user')
                        content = turn.get('content', '')
                        history_text += f"{role.title()}: {content}\n"
                    history_text += "\nCurrent question:\n"
                else:
                    history_text = "No previous conversation.\n\nQuestion:\n"
                
                chain = self.rag_prompt | self._get_current_llm() | StrOutputParser()
                
                answer = chain.invoke({
                    "context": context,
                    "question": question,
                    "conversation_history": history_text
                })
                
                # Print raw LLM output to console for debugging
                logger.info("=" * 80)
                logger.info("🤖 RAG ANSWER - Raw LLM Output:")
                logger.info("Question: %s", question[:100] + "..." if len(question) > 100 else question)
                logger.info("Answer Length: %d characters", len(answer))
                logger.info("Raw Answer:")
                logger.info("%s", answer)
                logger.info("=" * 80)
                
                return answer
                
            except Exception as e:
                logger.warning("Answer generation attempt %d failed: %s", attempt + 1, str(e))
                
                if attempt < max_retries - 1:
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    logger.error("All answer generation attempts failed")
                    return f"Sorry, I encountered connection issues while generating the answer. Please try again."
    
    def check_hallucination(self, documents: List[Document], generation: str) -> bool:
        """Check for hallucinations"""
        if not documents or not generation:
            return True
        
        max_retries = 2
        
        for attempt in range(max_retries):
            try:
                docs_text = "\n\n".join([doc.page_content for doc in documents])
                
                if self.supports_structured_output:
                    chain = self.hallucination_prompt | self.hallucination_grader_llm
                    result = chain.invoke({
                        "documents": docs_text,
                        "generation": generation
                    })
                    return result.binary_score == "yes"
                else:
                    # Use text parsing
                    chain = self.hallucination_prompt | self.hallucination_grader_llm | StrOutputParser()
                    result = chain.invoke({
                        "documents": docs_text,
                        "generation": generation
                    })
                    
                    # Parse text result
                    result_lower = result.lower()
                    return "yes" in result_lower or "grounded" in result_lower
                
            except Exception as e:
                logger.warning("Hallucination check attempt %d failed: %s", attempt + 1, str(e))
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.5)
        
        # If all attempts fail, assume content is grounded (fail-safe)
        logger.warning("Hallucination check failed for all attempts, assuming content is grounded")
        return True
    
    def grade_answer(self, question: str, generation: str) -> bool:
        """Evaluate answer quality"""
        if not generation:
            return False
        
        max_retries = 2
        
        for attempt in range(max_retries):
            try:
                if self.supports_structured_output:
                    chain = self.answer_prompt | self.answer_grader_llm
                    result = chain.invoke({
                        "question": question,
                        "generation": generation
                    })
                    return result.binary_score == "yes"
                else:
                    # Use text parsing
                    chain = self.answer_prompt | self.answer_grader_llm | StrOutputParser()
                    result = chain.invoke({
                        "question": question,
                        "generation": generation
                    })
                    
                    # Parse text result
                    result_lower = result.lower()
                    return "yes" in result_lower or "good" in result_lower
                
            except Exception as e:
                logger.warning("Answer grading attempt %d failed: %s", attempt + 1, str(e))
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.5)
        
        # If all attempts fail, assume answer is good (fail-safe)
        logger.warning("Answer grading failed for all attempts, assuming answer is acceptable")
        return True
    
    def web_search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        """Perform web search with comprehensive fallback"""
        try:
            # First try DuckDuckGo instant answer API
            search_url = f"https://api.duckduckgo.com/?q={quote_plus(query)}&format=json&no_html=1&skip_disambig=1"
            
            headers = {
                'User-Agent': 'MetaDock-Bioinformatics-Assistant/1.0'
            }
            
            response = requests.get(search_url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                results = []
                
                # Get instant answer if available
                if data.get('AbstractText'):
                    results.append({
                        'title': data.get('Heading', 'Instant Answer'),
                        'snippet': data.get('AbstractText', ''),
                        'url': data.get('AbstractURL', ''),
                        'source': data.get('AbstractSource', 'DuckDuckGo')
                    })
                
                # Get related topics
                if data.get('RelatedTopics'):
                    for topic in data.get('RelatedTopics', [])[:max_results-1]:
                        if isinstance(topic, dict) and topic.get('Text'):
                            results.append({
                                'title': topic.get('Text', '')[:100] + '...' if len(topic.get('Text', '')) > 100 else topic.get('Text', ''),
                                'snippet': topic.get('Text', ''),
                                'url': topic.get('FirstURL', ''),
                                'source': 'DuckDuckGo Related'
                            })
                
                # If we got results, return them
                if results:
                    return results[:max_results]
            
            # If DuckDuckGo didn't work, use intelligent fallback
            return self._create_intelligent_fallback(query)
            
        except Exception as e:
            logger.warning("Web search failed: %s", str(e))
            return self._create_intelligent_fallback(query)
    
    def _create_intelligent_fallback(self, query: str) -> List[Dict[str, str]]:
        """Create intelligent fallback responses based on query content"""
        results = []
        
        # Analyze query for bioinformatics tools and provide specific guidance
        query_lower = query.lower()
        
        # Common bioinformatics tools and their resources
        tool_resources = {
            'fastqc': {
                'title': 'FastQC Quality Control Tool',
                'snippet': 'FastQC is a quality control tool for high throughput sequence data. The latest versions and documentation are available on the official Babraham Bioinformatics website.',
                'url': 'https://www.bioinformatics.babraham.ac.uk/projects/fastqc/',
                'source': 'Babraham Bioinformatics'
            },
            'cutadapt': {
                'title': 'Cutadapt Adapter Trimming Tool',
                'snippet': 'Cutadapt removes adapter sequences from DNA sequencing reads. Check the official documentation and PyPI for the latest versions.',
                'url': 'https://cutadapt.readthedocs.io/',
                'source': 'Official Documentation'
            },
            'metaspades': {
                'title': 'MetaSPAdes Metagenome Assembler',
                'snippet': 'MetaSPAdes is a metagenomic assembler that is part of the SPAdes toolkit. Latest releases are available on GitHub.',
                'url': 'https://github.com/ablab/spades',
                'source': 'GitHub Repository'
            },
            'bakta': {
                'title': 'Bakta Genome Annotation Tool',
                'snippet': 'Bakta is a rapid & standardized annotation tool for bacterial genomes. Check the official repository for updates.',
                'url': 'https://github.com/oschwengers/bakta',
                'source': 'GitHub Repository'
            },
            'metaphlan': {
                'title': 'MetaPhlAn Metagenomic Profiling',
                'snippet': 'MetaPhlAn is a computational tool for profiling the composition of microbial communities. Available through Bioconda and GitHub.',
                'url': 'https://github.com/biobakery/MetaPhlAn',
                'source': 'BioBakery'
            },
            'gtdb': {
                'title': 'GTDB-Tk Taxonomic Classification',
                'snippet': 'GTDB-Tk is a software toolkit for assigning objective taxonomic classifications to bacterial and archaeal genomes.',
                'url': 'https://github.com/Ecogenomics/GTDBTk',
                'source': 'Ecogenomics'
            }
        }
        
        # Check if query mentions specific tools
        for tool_key, tool_info in tool_resources.items():
            if tool_key in query_lower:
                results.append(tool_info)
        
        # If no specific tools matched, provide general guidance
        if not results:
            if 'latest' in query_lower or 'version' in query_lower or 'update' in query_lower:
                results.append({
                    'title': 'Finding Latest Bioinformatics Tool Versions',
                    'snippet': 'For the most current versions of bioinformatics tools, check: 1) Official project websites and GitHub repositories, 2) Bioconda package manager, 3) Bioinformatics journals and preprint servers like bioRxiv.',
                    'url': 'https://bioconda.github.io/',
                    'source': 'Bioconda Community'
                })
            elif 'new' in query_lower or '2024' in query_lower or 'recent' in query_lower:
                results.append({
                    'title': 'Recent Bioinformatics Developments',
                    'snippet': 'Stay updated with new bioinformatics tools through: Nature Biotechnology, Bioinformatics journal, bioRxiv preprints, and specialized conferences like ISMB.',
                    'url': 'https://academic.oup.com/bioinformatics',
                    'source': 'Academic Resources'
                })
            else:
                results.append({
                    'title': 'Bioinformatics Resource Recommendation',
                    'snippet': f'For information about "{query}", consider checking official tool documentation, GitHub repositories, Bioconda packages, or consulting the Galaxy Project for workflow guidance.',
                    'url': 'https://usegalaxy.org/',
                    'source': 'Galaxy Project'
                })
        
        return results[:5]
    
    def generate_web_search_answer(self, question: str, search_results: List[Dict[str, str]]) -> str:
        """Generate answer based on web search results"""
        if not search_results:
            return "I couldn't find current web information for this question. Please try rephrasing your query or check official documentation directly."
        
        # Format search results for the prompt
        formatted_results = ""
        for i, result in enumerate(search_results, 1):
            formatted_results += f"{i}. **{result['title']}**\n"
            formatted_results += f"   Source: {result['source']}\n"
            formatted_results += f"   Content: {result['snippet']}\n"
            if result['url']:
                formatted_results += f"   URL: {result['url']}\n"
            formatted_results += "\n"
        
        max_retries = 2
        for attempt in range(max_retries):
            try:
                chain = self.web_search_prompt | self._get_current_llm() | StrOutputParser()
                answer = chain.invoke({
                    "question": question,
                    "search_results": formatted_results
                })
                
                # Print web search answer generation for debugging
                logger.info("=" * 80)
                logger.info("🤖 WEB SEARCH ANSWER - Raw LLM Output:")
                logger.info("Question: %s", question[:100] + "..." if len(question) > 100 else question)
                logger.info("Search Results Count: %d", len(search_results))
                logger.info("Answer Length: %d characters", len(answer))
                logger.info("Raw Answer:")
                logger.info("%s", answer)
                logger.info("=" * 80)
                
                return answer
            except Exception as e:
                logger.warning("Web search answer generation attempt %d failed: %s", attempt + 1, str(e))
                if attempt < max_retries - 1:
                    time.sleep(0.5)
        
        # Fallback response
        return f"Based on web search results:\n\n{formatted_results}\n\nPlease refer to the sources above for the most current information."
    
    def rewrite_question(self, question: str) -> str:
        """Rewrite question"""
        max_retries = 2
        
        for attempt in range(max_retries):
            try:
                chain = self.rewrite_prompt | self._get_current_llm() | StrOutputParser()
                rewritten_question = chain.invoke({"question": question})
                
                # Print question rewriting for debugging
                logger.info("=" * 80)
                logger.info("🤖 QUESTION REWRITING - Raw LLM Output:")
                logger.info("Original Question: %s", question)
                logger.info("Rewritten Question:")
                logger.info("%s", rewritten_question)
                logger.info("=" * 80)
                
                return rewritten_question
            except Exception as e:
                logger.warning("Question rewriting attempt %d failed: %s", attempt + 1, str(e))
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.5)
        
        # If all attempts fail, return original question
        logger.warning("Question rewriting failed for all attempts, using original question")
        return question
    
    def generate_session_title(self, first_question: str, first_answer: str) -> str:
        """
        Generate session title based on first conversation
        
        Args:
            first_question: User's first question
            first_answer: Agent's first answer
            
        Returns:
            Generated session title
        """
        try:
            logger.info(f"Generating title for question: '{first_question[:50]}...'")
            logger.info(f"Answer summary for title: '{first_answer[:100]}...'")
            
            # Title generation prompt from backend-agent/prompts/rag_general.yaml
            title_prompt = load_prompts("rag_general", subkey="title_generation")
            
            # Take the first 200 characters of the answer as summary
            answer_summary = first_answer[:200] + "..." if len(first_answer) > 200 else first_answer
            
            logger.info(f"Calling LLM for title generation...")
            
            try:
                # Get LLM response first
                llm_response = self._get_current_llm().invoke(title_prompt.format(
                    question=first_question,
                    answer_summary=answer_summary
                ))
                
                # Handle None or invalid response from some models
                if llm_response is None or not isinstance(llm_response, str) or not llm_response.strip():
                    title = "New Chat"
                else:
                    title = llm_response.strip()
                    
            except Exception as e:
                logger.warning(f"Title generation failed: {e}")
                title = "New Chat"
            
            # Print title generation for debugging
            logger.info("=" * 80)
            logger.info("🤖 TITLE GENERATION - Raw LLM Output:")
            logger.info("Question: %s", first_question[:100] + "..." if len(first_question) > 100 else first_question)
            logger.info("Answer Summary: %s", answer_summary[:100] + "..." if len(answer_summary) > 100 else answer_summary)
            logger.info("Raw Title Generated:")
            logger.info("'%s'", title)
            logger.info("Title Length: %d characters", len(title))
            logger.info("=" * 80)
            
            logger.info(f"LLM returned title: '{title}'")
            
            # Clean title, remove extra quotes and punctuation
            title = title.strip().strip('"').strip("'").strip("。").strip("！").strip("？")
            
            # If title is too long, let LLM summarize it instead of truncating
            if len(title) > 20:
                logger.info(f"Title too long ({len(title)} chars): '{title}', asking LLM to summarize")
                title = self._summarize_long_title(title, first_question)
            
            final_title = title or "New Chat"
            logger.info(f"Final processed title: '{final_title}'")
            
            return final_title
            
        except Exception as e:
            logger.error(f"Error generating session title: {e}", exc_info=True)
            return "New Chat"
    
    def _summarize_long_title(self, long_title: str, user_question: str) -> str:
        """
        Summarize a long title to make it concise
        
        Args:
            long_title: The original long title
            user_question: User's original question for context
            
        Returns:
            Summarized title within 20 characters
        """
        try:
            logger.info(f"Summarizing long title: '{long_title}'")
            
            # Title summarization from backend-agent/prompts/rag_general.yaml
            summarize_prompt = load_prompts("rag_general", subkey="title_summarize")
            
            chain = summarize_prompt | self._get_current_llm() | StrOutputParser()
            short_title = chain.invoke({
                "long_title": long_title,
                "user_question": user_question[:100]  # First 100 chars for context
            })
            
            # Print title summarization for debugging
            logger.info("=" * 80)
            logger.info("🤖 TITLE SUMMARIZATION - Raw LLM Output:")
            logger.info("Original Long Title: '%s' (%d chars)", long_title, len(long_title))
            logger.info("User Question Context: %s", user_question[:100] + "..." if len(user_question) > 100 else user_question)
            logger.info("Raw Summarized Title:")
            logger.info("'%s'", short_title)
            logger.info("Summary Length: %d characters", len(short_title))
            logger.info("=" * 80)
            
            # Clean the result
            short_title = short_title.strip().strip('"').strip("'").strip("。").strip("！").strip("？")
            
            # Final safety check - if still too long, truncate
            if len(short_title) > 20:
                logger.warning(f"LLM summary still too long: '{short_title}', truncating")
                short_title = short_title[:20]
            
            logger.info(f"Summarized title: '{long_title}' → '{short_title}'")
            return short_title
            
        except Exception as e:
            logger.error(f"Error summarizing title: {e}", exc_info=True)
            # Fallback: simple truncation if LLM fails
            return long_title[:20]
    
    def ask_question(self, question: str, max_iterations: int = 3, conversation_history: List[Dict] = None) -> Dict[str, Any]:
        """Ask question (simplified version, without LangGraph)"""
        steps = []
        current_question = question
        
        for iteration in range(max_iterations):
            steps.append(f"Iteration {iteration + 1}")
            
            # 1. Routing decision
            route = self.route_question(current_question)
            steps.append(f"Route: {route}")
            
            if route == "general_llm":
                # Use LLM with MetaDock identity
                try:
                    chain = self.general_prompt | self._get_current_llm() | StrOutputParser()
                    answer = chain.invoke({"question": current_question})
                    return {
                        "answer": answer,
                        "sources": [],
                        "steps": steps,
                        "question": question
                    }
                except Exception as e:
                    return {
                        "answer": f"Error generating answer: {str(e)}",
                        "sources": [],
                        "steps": steps,
                        "question": question
                    }
            
            elif route == "web_search":
                # Use web search
                try:
                    search_results = self.web_search(current_question)
                    steps.append(f"Found {len(search_results)} web search results")
                    
                    answer = self.generate_web_search_answer(current_question, search_results)
                    
                    # Format sources from search results
                    sources = []
                    for result in search_results:
                        if result.get('url') and result['url'].strip():
                            sources.append({
                                'title': result.get('title', 'Web Result'),
                                'url': result['url'],
                                'source': result.get('source', 'Web Search')
                            })
                    
                    return {
                        "answer": answer,
                        "sources": sources,
                        "steps": steps,
                        "question": question
                    }
                except Exception as e:
                    return {
                        "answer": f"Error performing web search: {str(e)}",
                        "sources": [],
                        "steps": steps,
                        "question": question
                    }
            
            # 2. Retrieve documents
            documents = self.retrieve_documents(current_question)
            steps.append(f"Retrieved {len(documents)} documents")
            
            if not documents:
                if iteration < max_iterations - 1:
                    current_question = self.rewrite_question(current_question)
                    steps.append("No documents found, rewriting question")
                    continue
                else:
                    return {
                        "answer": "Sorry, I couldn't find relevant documents to answer your question.",
                        "sources": [],
                        "steps": steps,
                        "question": question
                    }
            
            # 3. Grade documents
            filtered_docs = self.grade_documents(current_question, documents)
            steps.append(f"Filtered to {len(filtered_docs)} relevant documents")
            
            if not filtered_docs:
                if iteration < max_iterations - 1:
                    current_question = self.rewrite_question(current_question)
                    steps.append("No relevant documents, rewriting question")
                    continue
                else:
                    # Use original documents to generate answer
                    filtered_docs = documents
            
            # 4. Generate answer
            answer = self.generate_answer(current_question, filtered_docs, conversation_history)
            
            # 5. Check hallucination
            is_grounded = self.check_hallucination(filtered_docs, answer)
            steps.append(f"Hallucination check: {'passed' if is_grounded else 'failed'}")
            
            if not is_grounded and iteration < max_iterations - 1:
                steps.append("Answer not grounded, retrying")
                continue
            
            # 6. Evaluate answer quality
            is_useful = self.grade_answer(current_question, answer)
            steps.append(f"Answer quality: {'good' if is_useful else 'poor'}")
            
            if not is_useful and iteration < max_iterations - 1:
                current_question = self.rewrite_question(current_question)
                steps.append("Answer quality poor, rewriting question")
                continue
            
            # Return result
            sources = self._deduplicate_sources(filtered_docs)
            return {
                "answer": answer,
                "sources": sources,
                "steps": steps,
                "question": question
            }
        
        # If all iterations fail, return last answer
        sources = self._deduplicate_sources(filtered_docs) if 'filtered_docs' in locals() else []
        return {
            "answer": answer if 'answer' in locals() else "Sorry, unable to generate a satisfactory answer.",
            "sources": sources,
            "steps": steps,
            "question": question
        }
    
    def stream_answer(self, question: str, conversation_history: List[Dict] = None):
        """Stream answer to question"""
        steps = []
        current_question = question
        start_ts = time.time()
        
        yield {"type": "step", "content": "Analyzing question...", "steps": steps}
        
        # Routing decision with retry
        route = None
        for attempt in range(3):
            try:
                route = self.route_question(current_question)
                break
            except Exception as e:
                logger.warning("Routing attempt %d failed: %s", attempt + 1, str(e))
                if attempt == 2:
                    route = "vectorstore"  # Default fallback
        
        steps.append(f"Routing decision: {route}")
        yield {"type": "step", "content": f"Route to: {route}", "steps": steps}
        
        if route == "general_llm":
            yield {"type": "step", "content": "Using MetaDock Assistant...", "steps": steps}
            try:
                # Format conversation history for prompt
                history_text = ""
                if conversation_history:
                    history_text = "Previous conversation:\n"
                    for turn in conversation_history[-10:]:  # Last 10 turns
                        role = turn.get('role', 'user')
                        content = turn.get('content', '')
                        history_text += f"{role.title()}: {content}\n"
                    history_text += "\nCurrent question:\n"
                else:
                    history_text = "No previous conversation.\n\nQuestion:\n"
                
                # Use general prompt with MetaDock identity and conversation history
                prompt = self.general_prompt.format(
                    question=current_question,
                    conversation_history=history_text
                )
                
                # Print prompt for debugging
                logger.info("=" * 80)
                logger.info("🤖 GENERAL LLM - Prompt:")
                logger.info("Question: %s", current_question[:100] + "..." if len(current_question) > 100 else current_question)
                logger.info("Prompt Length: %d characters", len(prompt))
                logger.info("Full Prompt:")
                logger.info("%s", prompt)
                logger.info("-" * 40)
                
                full_answer = ""
                for chunk in self._get_current_llm().stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
                # Print final answer for debugging
                logger.info("🤖 GENERAL LLM - Final Answer:")
                logger.info("Answer Length: %d characters", len(full_answer))
                logger.info("Raw Answer:")
                logger.info("%s", full_answer)
                logger.info("=" * 80)
                
                yield {"type": "final", "answer": full_answer, "sources": [], "steps": steps}
                self._launch_tail_eval(route, current_question, [], full_answer, steps, start_ts, [])
                return
            except Exception as e:
                logger.error("General LLM streaming failed: %s", str(e))
                yield {"type": "error", "error": f"Connection error while using general LLM: {str(e)}"}
                return
        
        elif route == "web_search":
            yield {"type": "step", "content": "Performing web search...", "steps": steps}
            try:
                # Perform web search
                search_results = self.web_search(current_question)
                steps.append(f"Found {len(search_results)} web search results")
                yield {"type": "step", "content": f"Found {len(search_results)} web search results", "steps": steps}
                
                # Generate streaming answer based on search results
                yield {"type": "step", "content": "Generating answer from web results...", "steps": steps}
                
                # Format search results for the prompt
                formatted_results = ""
                for i, result in enumerate(search_results, 1):
                    formatted_results += f"{i}. **{result['title']}**\n"
                    formatted_results += f"   Source: {result['source']}\n"
                    formatted_results += f"   Content: {result['snippet']}\n"
                    if result['url']:
                        formatted_results += f"   URL: {result['url']}\n"
                    formatted_results += "\n"
                
                # Stream the web search answer
                prompt = self.web_search_prompt.format(
                    question=current_question,
                    search_results=formatted_results
                )
                
                # Print web search prompt for debugging
                logger.info("=" * 80)
                logger.info("🤖 WEB SEARCH LLM - Prompt:")
                logger.info("Question: %s", current_question[:100] + "..." if len(current_question) > 100 else current_question)
                logger.info("Search Results Count: %d", len(search_results))
                logger.info("Prompt Length: %d characters", len(prompt))
                logger.info("Full Prompt:")
                logger.info("%s", prompt[:1000] + "..." if len(prompt) > 1000 else prompt)
                logger.info("-" * 40)
                
                full_answer = ""
                for chunk in self._get_current_llm().stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
                # Print web search final answer for debugging
                logger.info("🤖 WEB SEARCH LLM - Final Answer:")
                logger.info("Answer Length: %d characters", len(full_answer))
                logger.info("Raw Answer:")
                logger.info("%s", full_answer)
                logger.info("=" * 80)
                
                # Format sources from search results
                sources = []
                for result in search_results:
                    if result.get('url') and result['url'].strip():
                        sources.append({
                            'title': result.get('title', 'Web Result'),
                            'url': result['url'],
                            'source': result.get('source', 'Web Search')
                        })
                
                yield {"type": "final", "answer": full_answer, "sources": sources, "steps": steps}
                self._launch_tail_eval(route, current_question, [], full_answer, steps, start_ts, sources)
                return
                
            except Exception as e:
                logger.error("Web search streaming failed: %s", str(e))
                yield {"type": "error", "error": f"Connection error while performing web search: {str(e)}"}
                return
        
        # Retrieve documents
        yield {"type": "step", "content": "Retrieving relevant documents...", "steps": steps}
        documents = self.retrieve_documents(current_question)
        steps.append(f"Retrieved {len(documents)} documents")
        
        if not documents:
            yield {"type": "step", "content": "No relevant documents found", "steps": steps}
            yield {"type": "final", "answer": "Sorry, no relevant documents found.", "sources": [], "steps": steps}
            return
        
        # Grade documents
        yield {"type": "step", "content": "Evaluating document relevance...", "steps": steps}
        filtered_docs = self.grade_documents(current_question, documents)
        steps.append(f"Filtered to {len(filtered_docs)} relevant documents")
        
        if not filtered_docs:
            filtered_docs = documents  # Fallback
        
        # Extract source information and deduplicate
        unique_sources = self._deduplicate_sources(filtered_docs)
        yield {"type": "sources", "sources": unique_sources}
        
        # Generate answer with retry
        yield {"type": "step", "content": "Generating answer...", "steps": steps}
        
        max_retries = 3
        retry_delay = 1
        
        for attempt in range(max_retries):
            try:
                # Optimize context for local models
                if self._is_local_model():
                    max_doc_length = 200  # Further reduce for better compatibility
                    context_parts = []
                    for doc in filtered_docs:
                        content = doc.page_content
                        if len(content) > max_doc_length:
                            content = content[:max_doc_length] + "..."
                        context_parts.append(content)
                    context = "\n\n".join(context_parts)
                    logger.info(f"🏠 Optimized RAG context for local model: {len(context)} chars")
                    
                    # If context is still too long, use only the first document
                    if len(context) > 800:
                        context = context_parts[0] if context_parts else ""
                        logger.info(f"🏠 Further reduced context to first document only: {len(context)} chars")
                else:
                    context = "\n\n".join([doc.page_content for doc in filtered_docs])
                
                # Format conversation history for prompt
                history_text = ""
                if conversation_history:
                    history_text = "Previous conversation:\n"
                    for turn in conversation_history[-5:]:  # Last 5 turns for context
                        role = turn.get('role', 'user')
                        content = turn.get('content', '')
                        history_text += f"{role.title()}: {content}\n"
                    history_text += "\nCurrent question:\n"
                else:
                    history_text = "No previous conversation.\n\nQuestion:\n"
                
                prompt = self.rag_prompt.format(
                    context=context, 
                    question=current_question,
                    conversation_history=history_text
                )
                
                # Print RAG streaming prompt for debugging
                logger.info("=" * 80)
                logger.info("🤖 RAG STREAMING - Prompt:")
                logger.info("Question: %s", current_question[:100] + "..." if len(current_question) > 100 else current_question)
                logger.info("Context Length: %d characters", len(context))
                logger.info("Documents Used: %d", len(filtered_docs))
                logger.info("Prompt Length: %d characters", len(prompt))
                logger.info("Full Prompt (first 1000 chars):")
                logger.info("%s", prompt[:1000] + "..." if len(prompt) > 1000 else prompt)
                logger.info("-" * 40)
                
                full_answer = ""
                for chunk in self._get_current_llm().stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
                # Print RAG streaming final answer for debugging
                logger.info("🤖 RAG STREAMING - Final Answer:")
                logger.info("Answer Length: %d characters", len(full_answer))
                logger.info("Raw Answer:")
                logger.info("%s", full_answer)
                logger.info("=" * 80)
                
                # Check if local model returned None or empty response
                if self._is_local_model() and (not full_answer or full_answer.strip().lower() in ['none', 'null', '']):
                    logger.warning("🏠 Local model RAG failed, falling back to general LLM")
                    yield {"type": "step", "content": "Local model struggling with RAG, switching to simpler approach...", "steps": steps}
                    
                    try:
                        # Fallback to general LLM without RAG context
                        fallback_chain = self.general_prompt | self._get_current_llm()
                        fallback_answer = ""
                        
                        # Format simple conversation history for fallback
                        simple_history = ""
                        if conversation_history:
                            simple_history = "Previous conversation:\n"
                            for turn in conversation_history[-3:]:  # Only last 3 turns for local model
                                role = turn.get('role', 'user')
                                content = turn.get('content', '')[:100] + "..." if len(turn.get('content', '')) > 100 else turn.get('content', '')
                                simple_history += f"{role.title()}: {content}\n"
                            simple_history += "\nCurrent question:\n"
                        else:
                            simple_history = "No previous conversation.\n\nQuestion:\n"
                        
                        # Use the chain to get response with conversation history
                        fallback_response = fallback_chain.invoke({
                            "question": current_question,
                            "conversation_history": simple_history
                        })
                        
                        # Simulate streaming for consistency
                        if fallback_response and str(fallback_response).strip():
                            fallback_answer = str(fallback_response)
                            # Split into chunks for streaming effect
                            chunk_size = 50
                            for i in range(0, len(fallback_answer), chunk_size):
                                chunk_content = fallback_answer[i:i + chunk_size]
                                yield {"type": "chunk", "content": chunk_content}
                        
                        logger.info("🏠 Fallback to general LLM successful")
                        yield {"type": "final", "answer": fallback_answer, "sources": [], "steps": steps}
                        self._launch_tail_eval(route, current_question, filtered_docs, fallback_answer, steps, start_ts, [])
                        return
                        
                    except Exception as fallback_error:
                        logger.error(f"🏠 Fallback also failed: {fallback_error}")
                        error_msg = "I apologize, but I'm having trouble processing your request with the current local model. Please try switching to a cloud-based model for better performance."
                        yield {"type": "final", "answer": error_msg, "sources": [], "steps": steps}
                        return
                
                yield {"type": "final", "answer": full_answer, "sources": unique_sources, "steps": steps}
                self._launch_tail_eval(route, current_question, filtered_docs, full_answer, steps, start_ts, unique_sources)
                return
                
            except Exception as e:
                logger.warning("Streaming attempt %d failed: %s", attempt + 1, str(e))
                
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    retry_delay *= 2
                    yield {"type": "step", "content": f"Connection issue, retrying... (attempt {attempt + 2})", "steps": steps}
                else:
                    logger.error("All streaming attempts failed")
                    yield {"type": "error", "error": f"Connection error after {max_retries} attempts. Please check your network and try again."}
    
    def _build_graph(self):
        """Build LangGraph graph (if available)"""
        if not LANGGRAPH_AVAILABLE:
            return
        
        # Can implement complete LangGraph workflow here
        # Currently using simplified version, skipping for now
        pass
    
    def _deduplicate_sources(self, documents: List[Document]) -> List[Dict]:
        """Deduplicate sources based on filename"""
        unique_sources = []
        seen_sources = set()
        for doc in documents:
            source_filename = doc.metadata.get("source")
            if source_filename and source_filename not in seen_sources:
                unique_sources.append(doc.metadata)
                seen_sources.add(source_filename)
        return unique_sources
    
    def _launch_tail_eval(self, route: str, question: str, docs: List[Document], answer: str, steps: List[str], start_ts: float, sources: List[Dict]):
        """Fire-and-forget tail evaluation to avoid blocking streaming output"""
        try:
            threading.Thread(
                target=self._run_tail_eval,
                args=(route, question, docs, answer, steps, start_ts, sources),
                daemon=True,
            ).start()
        except Exception as e:
            logger.warning("Tail eval launch failed: %s", str(e))
    
    def _run_tail_eval(self, route: str, question: str, docs: List[Document], answer: str, steps: List[str], start_ts: float, sources: List[Dict]):
        """Tail evaluation: hallucination + answer quality (internal only)"""
        try:
            is_grounded = self.check_hallucination(docs, answer)
        except Exception as e:
            logger.warning("Tail eval hallucination check failed: %s", str(e))
            is_grounded = None
        
        try:
            is_useful = self.grade_answer(question, answer)
        except Exception as e:
            logger.warning("Tail eval answer grading failed: %s", str(e))
            is_useful = None
        
        durations = {"total_ms": int((time.time() - start_ts) * 1000)}
        self._record_eval_metrics(route, question, docs, answer, is_grounded, is_useful, steps, durations, sources)
    
    def _record_eval_metrics(self, route: str, question: str, docs: List[Document], answer: str,
                             is_grounded: Optional[bool], is_useful: Optional[bool],
                             steps: List[str], durations: Dict[str, Any], sources: List[Dict]):
        """Record internal eval metrics for later analysis"""
        try:
            doc_sources = []
            for doc in docs or []:
                meta = getattr(doc, "metadata", {}) or {}
                src = meta.get("source")
                if src:
                    doc_sources.append(src)
            question_snippet = (question or "").replace("\n", " ")[:120]
            logger.info(
                "📊 RAG EVAL route=%s grounded=%s useful=%s docs=%d duration_ms=%s question=%.120s sources=%s",
                route,
                is_grounded,
                is_useful,
                len(doc_sources),
                durations.get("total_ms"),
                question_snippet,
                [s.get("source") or s.get("title") for s in (sources or [])],
            )
        except Exception as e:
            logger.warning("Failed to record eval metrics: %s", str(e))
    
    def _get_current_llm(self):
        """Get current LLM from global client"""
        client = get_llm_client()
        llm_instance = client.get_llm()
        logger.info(f"🔄 Using LLM: {client.model_name} (provider: {client.SUPPORTED_MODELS[client.model_name]['provider']})")
        return llm_instance
    
    def _is_local_model(self):
        """Check if current model is a local model (Ollama)"""
        client = get_llm_client()
        return client.SUPPORTED_MODELS[client.model_name]['provider'] == 'ollama'
    
    def _initialize_llm_instances(self):
        """Initialize LLM instances with current global client"""
        # Get current LLM from global client
        current_llm = self._get_current_llm()
        
        # Initialize LLM based on support
        if self.supports_structured_output:
            try:
                self.router_llm = current_llm.with_structured_output(RouteQuery)
                self.doc_grader_llm = current_llm.with_structured_output(GradeDocuments)
                self.hallucination_grader_llm = current_llm.with_structured_output(GradeHallucinations)
                self.answer_grader_llm = current_llm.with_structured_output(GradeAnswer)
                logger.info("Using structured output LLMs")
            except Exception as e:
                logger.warning("Structured output failed, falling back to regular LLM: %s", str(e))
                self.supports_structured_output = False
        
        if not self.supports_structured_output:
            # Use regular LLM
            self.router_llm = current_llm
            self.doc_grader_llm = current_llm
            self.hallucination_grader_llm = current_llm
            self.answer_grader_llm = current_llm
            logger.info("Using regular LLM with text parsing")
    
    def initialize(self) -> bool:
        """Initialize system"""
        # Initialize LLM instances with current global client
        self._initialize_llm_instances()
        
        return self.load_vector_store() 