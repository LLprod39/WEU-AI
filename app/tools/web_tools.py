"""
Web Tools for Internet Search and Data Retrieval
"""
import httpx
from bs4 import BeautifulSoup
from loguru import logger
from typing import List, Dict, Any
from app.tools.base import BaseTool, ToolMetadata, ToolParameter


class WebSearchTool(BaseTool):
    """Search the web using DuckDuckGo"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="web_search",
            description="Search the web for information",
            category="web",
            parameters=[
                ToolParameter(name="query", type="string", description="Search query"),
                ToolParameter(name="num_results", type="number", description="Number of results", required=False, default=5),
            ]
        )
    
    async def execute(self, query: str, num_results: int = 5) -> str:
        """Execute web search"""
        try:
            # Using DuckDuckGo HTML (simpler than API)
            url = f"https://html.duckduckgo.com/html/?q={query}"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=10.0)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                results = []
                for result in soup.find_all('div', class_='result', limit=num_results):
                    title_elem = result.find('a', class_='result__a')
                    snippet_elem = result.find('a', class_='result__snippet')
                    
                    if title_elem:
                        title = title_elem.text
                        link = title_elem.get('href', '')
                        snippet = snippet_elem.text if snippet_elem else ""
                        
                        results.append(f"**{title}**\n{snippet}\nURL: {link}\n")
                
                if results:
                    return "\n---\n".join(results)
                else:
                    return "No results found."
                    
        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return f"Error performing web search: {str(e)}"


class FetchWebpageTool(BaseTool):
    """Fetch and extract text from a webpage"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="fetch_webpage",
            description="Fetch and extract text content from a webpage",
            category="web",
            parameters=[
                ToolParameter(name="url", type="string", description="URL to fetch"),
            ]
        )
    
    async def execute(self, url: str) -> str:
        """Fetch webpage content"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=15.0, follow_redirects=True)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                
                # Get text
                text = soup.get_text()
                
                # Clean up whitespace
                lines = (line.strip() for line in text.splitlines())
                chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
                text = '\n'.join(chunk for chunk in chunks if chunk)
                
                # Limit to first 5000 characters
                if len(text) > 5000:
                    text = text[:5000] + "\n\n[Content truncated...]"
                
                logger.info(f"Fetched webpage: {url}")
                return text
                
        except Exception as e:
            logger.error(f"Webpage fetch failed: {e}")
            return f"Error fetching webpage: {str(e)}"
