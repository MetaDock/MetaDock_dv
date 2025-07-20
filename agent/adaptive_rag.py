"""
Adaptive RAG system based on LangGraph
Implements query routing, retrieval scoring, hallucination detection, and self-correction
"""

import json
import logging
import requests
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

from agent_client import llm

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RouteQuery(BaseModel):
    """Query routing data model"""
    datasource: Literal["vectorstore", "web_search", "general_llm"] = Field(
        ...,
        description="Choose routing to vector store, web search, or general LLM based on user question",
    )


class GradeDocuments(BaseModel):
    """Document relevance scoring data model"""
    binary_score: str = Field(
        description="Whether the document is relevant to the question, 'yes' or 'no'"
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
        
        # Initialize LLM based on support
        if self.supports_structured_output:
            try:
                self.router_llm = llm.with_structured_output(RouteQuery)
                self.doc_grader_llm = llm.with_structured_output(GradeDocuments)
                self.hallucination_grader_llm = llm.with_structured_output(GradeHallucinations)
                self.answer_grader_llm = llm.with_structured_output(GradeAnswer)
                logger.info("Using structured output LLMs")
            except Exception as e:
                logger.warning("Structured output failed, falling back to regular LLM: %s", str(e))
                self.supports_structured_output = False
        
        if not self.supports_structured_output:
            # Use regular LLM
            self.router_llm = llm
            self.doc_grader_llm = llm
            self.hallucination_grader_llm = llm
            self.answer_grader_llm = llm
            logger.info("Using regular LLM with text parsing")
        
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
        """Setup prompt templates"""
        
        # Router prompt
        if self.supports_structured_output:
            self.route_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a professional bioinformatics question routing expert. Choose the most appropriate data source based on user questions.

The vector store contains detailed documentation for the following bioinformatics tools:
- Sequence quality control tools (FastQC, Cutadapt, BBDuk, etc.)
- Assembly tools (MetaSPAdes, BBMap, etc.)
- Annotation tools (Bakta, dbCAN, etc.)
- Classification tools (MetaPhlAn, GTDB-Tk, etc.)
- Analysis tools (pyANI, etc.)

Use vector store: for specific bioinformatics tool usage, parameter descriptions, feature introductions, etc.
Use web search: for latest bioinformatics news, software version updates, newly released tools, etc.
Use general LLM: for biological concept explanations, general questions, etc."""),
                ("human", "{question}"),
            ])
        else:
            self.route_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a professional bioinformatics question routing expert. Choose the most appropriate data source based on user questions.

The vector store contains detailed documentation for the following bioinformatics tools:
- Sequence quality control tools (FastQC, Cutadapt, BBDuk, etc.)
- Assembly tools (MetaSPAdes, BBMap, etc.)
- Annotation tools (Bakta, dbCAN, etc.)
- Classification tools (MetaPhlAn, GTDB-Tk, etc.)
- Analysis tools (pyANI, etc.)

Please choose based on the user question:
- Answer "vectorstore": for specific bioinformatics tool usage, parameter descriptions, feature introductions, etc.
- Answer "web_search": for latest bioinformatics news, software version updates, newly released tools, etc.
- Answer "general_llm": for biological concept explanations, general questions, etc.

Only answer with the chosen type, no explanation needed."""),
                ("human", "{question}"),
            ])
        
        # Document grading prompt
        if self.supports_structured_output:
            self.grade_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at evaluating the relevance of retrieved documents to user questions.
If the document contains keywords or semantic content related to the user question, grade it as relevant.
This doesn't need to be a strict test. The goal is to filter out obviously wrong retrievals.
Give a binary score 'yes' or 'no' to indicate whether the document is relevant to the question."""),
                ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
            ])
        else:
            self.grade_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at evaluating the relevance of retrieved documents to user questions.
If the document contains keywords or semantic content related to the user question, grade it as relevant.
This doesn't need to be a strict test. The goal is to filter out obviously wrong retrievals.
Please answer 'yes' (relevant) or 'no' (not relevant). Only answer yes or no, no explanation needed."""),
                ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
            ])
        
        # Hallucination detection prompt
        if self.supports_structured_output:
            self.hallucination_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at detecting whether AI responses are based on provided facts.
Evaluate whether the answer is based on the provided document content, rather than fabricated information.
Give a binary score 'yes' for fact-based, 'no' for hallucination."""),
                ("human", "Documents: \n\n {documents} \n\n AI Answer: {generation}"),
            ])
        else:
            self.hallucination_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at detecting whether AI responses are based on provided facts.
Evaluate whether the answer is based on the provided document content, rather than fabricated information.
Please answer 'yes' (based on document facts) or 'no' (hallucination). Only answer yes or no, no explanation needed."""),
                ("human", "Documents: \n\n {documents} \n\n AI Answer: {generation}"),
            ])
        
        # Answer quality prompt
        if self.supports_structured_output:
            self.answer_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at evaluating answer quality.
Evaluate whether the AI-generated answer truly solves the user's problem.
Give a binary score 'yes' for problem solved, 'no' for not solved."""),
                ("human", "User question: {question} \n\n AI Answer: {generation}"),
            ])
        else:
            self.answer_prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at evaluating answer quality.
Evaluate whether the AI-generated answer truly solves the user's problem.
Please answer 'yes' (problem solved) or 'no' (not solved). Only answer yes or no, no explanation needed."""),
                ("human", "User question: {question} \n\n AI Answer: {generation}"),
            ])
        
        # Query rewriting prompt
        self.rewrite_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a question optimization expert. The user's original question may not have retrieved relevant information.
Please rephrase the question to be clearer and more specific for better document retrieval.
Focus on core functionality and use cases of bioinformatics tools."""),
            ("human", "Original question: {question}"),
        ])
        
        # General LLM prompt (for when no context is available)
        self.general_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are the MetaDock Bioinformatics Assistant, an intelligent AI agent integrated into the MetaDock platform. Your role is to help researchers and scientists with bioinformatics tools, data analysis, and computational biology workflows.

**Your Identity:**
- You are part of the MetaDock system, a comprehensive bioinformatics platform
- You specialize in helping users with bioinformatics tools like FastQC, Cutadapt, MetaSPAdes, Bakta, MetaPhlAn, GTDB-Tk, and many others
- You provide guidance on sequence analysis, genome assembly, annotation, and metagenomics
- You can help with tool selection, parameter optimization, and workflow design

**Your Capabilities:**
- Answering questions about bioinformatics tools and their usage
- Explaining computational biology concepts and methods
- Helping with data analysis workflows
- Providing guidance on best practices in bioinformatics
- Assisting with troubleshooting common issues

**Your Communication Style:**
- Professional yet approachable
- Clear and educational explanations
- Focus on practical, actionable advice
- Use examples when helpful

When users ask about your identity, introduce yourself as the MetaDock Bioinformatics Assistant and explain how you can help them with their research and analysis needs."""),
            ("human", "{question}"),
        ])
        
        # Web search prompt
        self.web_search_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are the MetaDock Bioinformatics Assistant. Answer user questions based on the following web search results.

Your answer should provide current and relevant information, especially for:
- Latest bioinformatics software updates and releases
- New tools and methods in computational biology
- Recent research developments
- Installation and troubleshooting guides
- Software compatibility and system requirements

Format your response in clear, structured Markdown with:
1. **Summary**: Brief overview of the current information
2. **Key Points**: Main findings from the search results
3. **Sources**: List the relevant URLs and publications mentioned
4. **Recommendations**: Practical advice if applicable

---

Web Search Results:
{search_results}

---

Question: {question}

---

Please provide an informative answer based on the search results above."""),
            ("human", "{question}"),
        ])
        
        # RAG generation prompt
        self.rag_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are the MetaDock Bioinformatics Assistant. Answer user questions based on the following context information from our comprehensive bioinformatics tool database.

Your answer must follow this Markdown format to ensure structured and informative content:

1. **Overview**: First, summarize the main functionality of the tool in a few sentences.
2. **Key Features**: Use numbered lists to detail the key features of the tool. For each feature, you can use sublists or paragraphs to elaborate.
3. **References**: If the context contains literature references, DOIs, or project links, list them in this section.
4. **Example Commands**: If available, provide one or more example commands using Markdown code blocks. Code blocks should be properly formatted with appropriate indentation and line breaks.

---

Context information:
{context}

---

Question: {question}

---

Please strictly follow the above format to generate the answer. If there's no information for a section (e.g., "Example Commands"), please omit that part."""),
            ("human", "{question}"),
        ])
    
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
                    return result.datasource
                else:
                    # Use text parsing
                    chain = self.route_prompt | self.router_llm | StrOutputParser()
                    result = chain.invoke({"question": question})
                    
                    # Parse text result
                    result_lower = result.lower()
                    if "vectorstore" in result_lower or "vector" in result_lower:
                        return "vectorstore"
                    elif "web_search" in result_lower or "web search" in result_lower:
                        return "web_search"
                    else:
                        return "general_llm"
                        
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
                if tool.lower() in question.lower():
                    target_tool = tool
                    break
            
            # Retrieve documents
            docs = self.vector_store.similarity_search(question, k=k)
            
            # If target tool specified, prioritize related documents
            if target_tool:
                filtered_docs = [doc for doc in docs if doc.metadata.get("tool_name") == target_tool]
                if filtered_docs:
                    return filtered_docs[:3] + [doc for doc in docs if doc not in filtered_docs][:2]
            
            return docs
            
        except Exception as e:
            logger.error(f"Error in document retrieval: {e}")
            return []
    
    def grade_documents(self, question: str, documents: List[Document]) -> List[Document]:
        """Grade and filter documents"""
        if not documents:
            return []
        
        filtered_docs = []
        
        for doc in documents:
            max_retries = 2  # Fewer retries for document grading to avoid delays
            success = False
            
            for attempt in range(max_retries):
                try:
                    if self.supports_structured_output:
                        chain = self.grade_prompt | self.doc_grader_llm
                        result = chain.invoke({
                            "question": question,
                            "document": doc.page_content
                        })
                        if result.binary_score == "yes":
                            filtered_docs.append(doc)
                    else:
                        # Use text parsing
                        chain = self.grade_prompt | self.doc_grader_llm | StrOutputParser()
                        result = chain.invoke({
                            "question": question,
                            "document": doc.page_content
                        })
                        
                        # Parse text result
                        result_lower = result.lower()
                        if "yes" in result_lower or "relevant" in result_lower:
                            filtered_docs.append(doc)
                    
                    success = True
                    break
                        
                except Exception as e:
                    logger.warning("Document grading attempt %d failed: %s", attempt + 1, str(e))
                    if attempt < max_retries - 1:
                        import time
                        time.sleep(0.5)  # Short delay for document grading
            
            # If all attempts fail, keep the document (fail-safe approach)
            if not success:
                logger.warning("Document grading failed for all attempts, keeping document")
                filtered_docs.append(doc)
        
        return filtered_docs
    
    def generate_answer(self, question: str, documents: List[Document]) -> str:
        """Generate answer based on documents"""
        if not documents:
            return "Sorry, I couldn't find relevant documents to answer your question."
        
        max_retries = 3
        retry_delay = 1
        
        for attempt in range(max_retries):
            try:
                context = "\n\n".join([doc.page_content for doc in documents])
                chain = self.rag_prompt | llm | StrOutputParser()
                
                return chain.invoke({
                    "context": context,
                    "question": question
                })
                
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
                chain = self.web_search_prompt | llm | StrOutputParser()
                answer = chain.invoke({
                    "question": question,
                    "search_results": formatted_results
                })
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
                chain = self.rewrite_prompt | llm | StrOutputParser()
                return chain.invoke({"question": question})
            except Exception as e:
                logger.warning("Question rewriting attempt %d failed: %s", attempt + 1, str(e))
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.5)
        
        # If all attempts fail, return original question
        logger.warning("Question rewriting failed for all attempts, using original question")
        return question
    
    def ask_question(self, question: str, max_iterations: int = 3) -> Dict[str, Any]:
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
                    chain = self.general_prompt | llm | StrOutputParser()
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
            answer = self.generate_answer(current_question, filtered_docs)
            
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
    
    def stream_answer(self, question: str):
        """Stream answer to question"""
        steps = []
        current_question = question
        
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
                # Use general prompt with MetaDock identity
                prompt = self.general_prompt.format(question=current_question)
                full_answer = ""
                for chunk in llm.stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
                yield {"type": "final", "answer": full_answer, "sources": [], "steps": steps}
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
                full_answer = ""
                for chunk in llm.stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
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
                context = "\n\n".join([doc.page_content for doc in filtered_docs])
                prompt = self.rag_prompt.format(context=context, question=current_question)
                
                full_answer = ""
                for chunk in llm.stream(prompt):
                    content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                    if content:
                        full_answer += content
                        yield {"type": "chunk", "content": content}
                
                yield {"type": "final", "answer": full_answer, "sources": unique_sources, "steps": steps}
                return
                
            except Exception as e:
                logger.warning("Streaming attempt %d failed: %s", attempt + 1, str(e))
                
                if attempt < max_retries - 1:
                    import time
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
    
    def initialize(self) -> bool:
        """Initialize system"""
        return self.load_vector_store() 