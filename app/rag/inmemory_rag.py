"""
InMemory RAG — fallback когда Qdrant недоступен. Требует энкодер (sentence_transformers).
В мини-сборке энкодер отсутствует — available=False.
"""
import uuid
from typing import Dict, List
from loguru import logger

try:
    import numpy as np
except ImportError:
    np = None


def _get_encoder():
    from app.rag.engine import get_encoder
    return get_encoder()


class InMemoryRAG:
    def __init__(self):
        self.documents = []
        self.encoder = _get_encoder()
        self.available = self.encoder is not None and np is not None
        if not self.available:
            logger.debug("InMemoryRAG: encoder or numpy not available (mini build)")

    def add_text(self, text: str, source: str = "user_input") -> str:
        if not self.available or not self.encoder:
            return None
        try:
            doc_id = str(uuid.uuid4())
            vector = self.encoder.encode(text)
            self.documents.append({"id": doc_id, "text": text, "source": source, "vector": vector})
            return doc_id
        except Exception as e:
            logger.error(f"Error adding text: {e}")
            return None

    def query(self, query_text: str, n_results: int = 3) -> Dict:
        if not self.available or not self.encoder or not self.documents or np is None:
            return {"documents": [[]], "metadatas": [[]]}
        try:
            qv = self.encoder.encode(query_text)
            sims = [(d, np.dot(qv, d["vector"]) / (np.linalg.norm(qv) * np.linalg.norm(d["vector"]) + 1e-9)) for d in self.documents]
            sims.sort(key=lambda x: x[1], reverse=True)
            top = sims[:n_results]
            documents = [d["text"] for d, _ in top]
            metadatas = [{"source": d["source"], "score": float(s)} for d, s in top]
            return {"documents": [documents], "metadatas": [metadatas]}
        except Exception as e:
            logger.error(f"Error querying: {e}")
            return {"documents": [[]], "metadatas": [[]]}

    def get_all_documents(self) -> List[Dict]:
        return [{"id": d["id"], "text": d["text"], "source": d["source"]} for d in self.documents]

    def delete_document(self, doc_id: str) -> bool:
        before = len(self.documents)
        self.documents = [d for d in self.documents if d.get("id") != doc_id]
        return len(self.documents) < before

    def reset_db(self):
        self.documents = []
        logger.info("InMemoryRAG reset")
