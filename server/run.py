from app import create_app
from app.config import Config

app = create_app()

if __name__ == "__main__":
    # 0.0.0.0 so the phone on the same Wi-Fi can reach the server.
    app.run(host="0.0.0.0", port=Config.PORT, debug=True)
