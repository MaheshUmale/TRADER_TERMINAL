import pytest
from fastapi.testclient import TestClient
from backend.api.server import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "backend" in data

def test_upstox_config():
    response = client.get("/api/upstox-config")
    assert response.status_code == 200
    data = response.json()
    assert "hasToken" in data
    assert "mode" in data

@pytest.mark.asyncio
async def test_websocket_connection():
    # Simple smoke test for WS endpoint
    with client.websocket_connect("/ws") as websocket:
        # We don't necessarily expect data immediately, but connection should succeed
        assert websocket is not None
