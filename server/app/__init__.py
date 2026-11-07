from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .live import init_live
from .store import init_store


def create_app(testing: bool = False) -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = testing
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # frames + voice clips

    CORS(app, origins=Config.CORS_ORIGINS)
    init_store(app, force_memory=testing)
    init_live(app)

    from .routes.dashboard import bp as dashboard_bp
    from .routes.harness import bp as harness_bp
    from .routes.settings import bp as settings_bp
    from .routes.walks import bp as walks_bp

    app.register_blueprint(walks_bp, url_prefix="/api/walks")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(harness_bp, url_prefix="/api/harness")

    if not Config.firebase_enabled():
        from .routes.dev import bp as dev_bp

        app.register_blueprint(dev_bp, url_prefix="/api/dev")

    @app.get("/api/health")
    def health():
        return jsonify(
            status="ok",
            firebase=Config.firebase_enabled(),
            gemini=bool(Config.GEMINI_API_KEY),
            assemblyai=bool(Config.ASSEMBLYAI_API_KEY),
        )

    return app
