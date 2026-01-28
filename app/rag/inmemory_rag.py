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
    """Per-user in-memory document store: self.documents[user_id] = list of docs."""

    def __init__(self):
        self.documents = {}  # user_id -> list of {"id", "text", "source", "vector"}
        self.encoder = _get_encoder()
        self.available = self.encoder is not None and np is not None
        if not self.available:
            logger.debug("InMemoryRAG: encoder or numpy not available (mini build)")

    def _docs_for_user(self, user_id):
        if user_id not in self.documents:
            self.documents[user_id] = []
        return self.documents[user_id]

    def add_text(self, text: str, source: str = "user_input", user_id=None) -> str:
        if not self.available or not self.encoder or user_id is None:
            return None
        try:
            doc_id = str(uuid.uuid4())
            vector = self.encoder.encode(text)
            docs = self._docs_for_user(user_id)
            docs.append({"id": doc_id, "text": text, "source": source, "vector": vector})
            return doc_id
        except Exception as e:
            logger.error(f"Error adding text: {e}")
            return None

    def query(self, query_text: str, n_results: int = 3, user_id=None) -> Dict:
        if not self.available or not self.encoder or np is None or user_id is None:
            return {"documents": [[]], "metadatas": [[]]}
        docs = self._docs_for_user(user_id)
        if not docs:
            return {"documents": [[]], "metadatas": [[]]}
        try:
            qv = self.encoder.encode(query_text)
            sims = [(d, np.dot(qv, d["vector"]) / (np.linalg.norm(qv) * np.linalg.norm(d["vector"]) + 1e-9)) for d in docs]
            sims.sort(key=lambda x: x[1], reverse=True)
            top = sims[:n_results]
            documents = [d["text"] for d, _ in top]
            metadatas = [{"source": d["source"], "score": float(s)} for d, s in top]
            return {"documents": [documents], "metadatas": [metadatas]}
        except Exception as e:
            logger.error(f"Error querying: {e}")
            return {"documents": [[]], "metadatas": [[]]}

    def get_all_documents(self, user_id=None) -> List[Dict]:
        if user_id is None:
            return []
        docs = self._docs_for_user(user_id)
        return [{"id": d["id"], "text": d["text"], "source": d["source"]} for d in docs]

    def delete_document(self, doc_id: str, user_id=None) -> bool:
        if user_id is None:
            return False
        docs = self._docs_for_user(user_id)
        before = len(docs)
        self.documents[user_id] = [d for d in docs if d.get("id") != doc_id]
        return len(self.documents[user_id]) < before

    def reset_db(self, user_id=None):
        if user_id is not None:
            self.documents[user_id] = []
            logger.info("InMemoryRAG reset for user_id=%s", user_id)
