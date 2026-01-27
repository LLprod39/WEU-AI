"""
File processing utilities for extracting text from various file types
"""
import os
import io
from pathlib import Path
from typing import Optional, Dict, Any
from loguru import logger

try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    logger.warning("Pillow not available, image processing disabled")

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    logger.warning("pytesseract not available, OCR disabled")

try:
    from docx import Document
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False
    logger.warning("python-docx not available, DOCX processing disabled")

try:
    import PyPDF2
    PDF2_AVAILABLE = True
except ImportError:
    PDF2_AVAILABLE = False
    logger.warning("PyPDF2 not available, PDF processing disabled")

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    logger.warning("pdfplumber not available, advanced PDF processing disabled")


class FileProcessor:
    """Process various file types and extract text content"""
    
    # Supported file extensions
    SUPPORTED_EXTENSIONS = {
        '.txt': 'text',
        '.md': 'text',
        '.pdf': 'pdf',
        '.docx': 'docx',
        '.doc': 'docx',  # Will try to process as docx
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image',
        '.bmp': 'image',
        '.webp': 'image',
    }
    
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    
    @classmethod
    def is_supported(cls, filename: str) -> bool:
        """Check if file type is supported"""
        ext = Path(filename).suffix.lower()
        return ext in cls.SUPPORTED_EXTENSIONS
    
    @classmethod
    def get_file_type(cls, filename: str) -> Optional[str]:
        """Get file type category"""
        ext = Path(filename).suffix.lower()
        return cls.SUPPORTED_EXTENSIONS.get(ext)
    
    @classmethod
    def process_file(cls, file_path: str, filename: str) -> Dict[str, Any]:
        """
        Process file and extract text content
        
        Returns:
            dict with keys: text, metadata, error
        """
        if not cls.is_supported(filename):
            return {
                'text': '',
                'metadata': {'error': f'Unsupported file type: {filename}'},
                'error': f'Unsupported file type'
            }
        
        # Check file size
        try:
            file_size = os.path.getsize(file_path)
            if file_size > cls.MAX_FILE_SIZE:
                return {
                    'text': '',
                    'metadata': {'error': f'File too large: {file_size} bytes'},
                    'error': 'File too large'
                }
        except Exception as e:
            logger.error(f"Error checking file size: {e}")
            return {
                'text': '',
                'metadata': {'error': str(e)},
                'error': str(e)
            }
        
        file_type = cls.get_file_type(filename)
        metadata = {
            'filename': filename,
            'file_type': file_type,
            'file_size': file_size
        }
        
        try:
            if file_type == 'text':
                text = cls._process_text_file(file_path)
            elif file_type == 'pdf':
                text = cls._process_pdf(file_path)
            elif file_type == 'docx':
                text = cls._process_docx(file_path)
            elif file_type == 'image':
                text = cls._process_image(file_path)
            else:
                text = ''
                metadata['error'] = 'Unknown file type'
            
            return {
                'text': text,
                'metadata': metadata,
                'error': None
            }
        except Exception as e:
            logger.error(f"Error processing file {filename}: {e}")
            return {
                'text': '',
                'metadata': {**metadata, 'error': str(e)},
                'error': str(e)
            }
    
    @classmethod
    def _process_text_file(cls, file_path: str) -> str:
        """Extract text from plain text files"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # Try with different encoding
            with open(file_path, 'r', encoding='latin-1') as f:
                return f.read()
    
    @classmethod
    def _process_pdf(cls, file_path: str) -> str:
        """Extract text from PDF files"""
        text_parts = []
        
        # Try pdfplumber first (better extraction)
        if PDFPLUMBER_AVAILABLE:
            try:
                with pdfplumber.open(file_path) as pdf:
                    for page in pdf.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(page_text)
                if text_parts:
                    return '\n\n'.join(text_parts)
            except Exception as e:
                logger.warning(f"pdfplumber failed: {e}, trying PyPDF2")
        
        # Fallback to PyPDF2
        if PDF2_AVAILABLE:
            try:
                with open(file_path, 'rb') as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    for page in pdf_reader.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(page_text)
                return '\n\n'.join(text_parts)
            except Exception as e:
                logger.error(f"PyPDF2 failed: {e}")
                return ''
        
        return ''
    
    @classmethod
    def _process_docx(cls, file_path: str) -> str:
        """Extract text from DOCX files"""
        if not DOCX_AVAILABLE:
            return ''
        
        try:
            doc = Document(file_path)
            paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
            return '\n\n'.join(paragraphs)
        except Exception as e:
            logger.error(f"Error processing DOCX: {e}")
            return ''
    
    @classmethod
    def _process_image(cls, file_path: str) -> str:
        """Extract text from images using OCR"""
        if not PILLOW_AVAILABLE:
            return ''
        
        try:
            image = Image.open(file_path)
            
            # Try OCR if available
            if TESSERACT_AVAILABLE:
                try:
                    text = pytesseract.image_to_string(image, lang='rus+eng')
                    return text.strip()
                except Exception as e:
                    logger.warning(f"OCR failed: {e}")
                    return ''
            
            # If no OCR, return metadata about image
            return f"Image file: {Path(file_path).name}, Size: {image.size}, Mode: {image.mode}"
        except Exception as e:
            logger.error(f"Error processing image: {e}")
            return ''
