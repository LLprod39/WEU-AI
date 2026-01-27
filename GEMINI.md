# Project Overview

This project is a Python-based web application that serves as a chat interface with advanced model selection capabilities. It allows users to interact with various Large Language Models (LLMs) from different providers like Google Gemini and xAI's Grok. The application also features a Retrieval-Augmented Generation (RAG) engine that uses a Qdrant vector database to provide more contextually relevant answers.

The application is composed of two main parts:
- A Django-based web interface for the main application, including chat, settings, and knowledge base management.
- A NiceGUI-based UI for the orchestrator panel.

The architecture is designed to be modular and extensible, with clear separation between the UI, orchestration, LLM provider, and configuration layers.

## Key Technologies

- **Backend:** Python, Django, Daphne, ASGI
- **Frontend (UI):** NiceGUI, HTML, CSS
- **LLM Integration:** `google-generativeai`
- **Vector Database:** Qdrant
- **Containerization:** Docker

# Building and Running

## 1. Start the Qdrant service

The Qdrant vector database is required for the RAG engine. It can be started using Docker Compose:

```bash
docker-compose up -d
```

## 2. Install Python dependencies

The project's Python dependencies are listed in the `requirements.txt` file. It is recommended to use a virtual environment.

```bash
python -m venv venv
source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
pip install -r requirements.txt
```

## 3. Run the Django web application

The main web interface is a Django application. To run it, you first need to apply the database migrations and then start the development server.

```bash
python manage.py migrate
python manage.py runserver
```

The application will be available at `http://localhost:8000`.

## 4. Run the NiceGUI Orchestrator Panel

The orchestrator panel is a separate NiceGUI application.

```bash
python main.py
```

The orchestrator panel will be available at `http://localhost:8080`.

# Development Conventions

- **Modular Architecture:** The project follows a modular architecture with separate layers for UI, orchestration, LLM providers, and configuration. Please refer to `docs/ARCHITECTURE.md` for a detailed overview.
- **Model Configuration:** Model configurations are managed through the `app/core/model_config.py` file and the `.model_config.json` file.
- **API Keys:** API keys for LLM providers should be stored in the `.env` file.
- **RAG Engine:** The RAG engine is implemented in `app/rag/engine.py` and uses Qdrant for vector storage and retrieval.
- **Testing:** Tests are located in the `test_*.py` files.
