from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

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

    from .routes.harness import bp as harness_bp
    from .routes.me import bp as me_bp
    from .routes.settings import bp as settings_bp
    from .routes.setup import bp as setup_bp
    from .routes.walks import bp as walks_bp
    from .routes.tts import bp as tts_bp

    app.register_blueprint(me_bp, url_prefix="/api/me")
    app.register_blueprint(setup_bp, url_prefix="/api/setup")
    app.register_blueprint(walks_bp, url_prefix="/api/walks")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(harness_bp, url_prefix="/api/harness")
    app.register_blueprint(tts_bp, url_prefix="/api/tts")

    @app.errorhandler(HTTPException)
    def json_error(e):
        # JSON instead of Flask's HTML error page, so the app can show or speak the reason.
        return jsonify(error=e.description), e.code

    @app.get("/api/health")
    def health():
        return jsonify(
            status="ok",
            auth0=Config.auth_enabled(),
            firestore=Config.firestore_enabled(),
            gemini=bool(Config.GEMINI_API_KEY),
            elevenlabs=bool(Config.ELEVENLABS_API_KEY),
        )

    return app
