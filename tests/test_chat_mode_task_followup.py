from app.core.modes.chat_mode import ChatMode


def test_extract_last_task_payload_from_history():
    history = [
        {"role": "assistant", "content": "plain text"},
        {
            "role": "assistant",
            "content": 'Сводка\nWEU_TASKS_JSON:{"type":"task_board","source_tool":"tasks_list","summary":{"has_more":true}}',
        },
    ]
    payload = ChatMode._extract_last_task_payload(history)
    assert payload.get("type") == "task_board"
    assert payload.get("summary", {}).get("has_more") is True


def test_more_tasks_request_detector():
    assert ChatMode._is_more_tasks_request("А еще есть?")
    assert ChatMode._is_more_tasks_request("Show more tasks")
    assert not ChatMode._is_more_tasks_request("Создай задачу")


def test_task_list_request_detector():
    assert ChatMode._is_task_list_request("Дай краткую сводку по активным задачам")
    assert ChatMode._is_task_list_request("Какие просроченные задачи есть?")
    assert not ChatMode._is_task_list_request("Как выполнить эту задачу?")
