import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
# Force every external service into mock mode during tests.
for key in ("GOOGLE_APPLICATION_CREDENTIALS", "GEMINI_API_KEY", "ASSEMBLYAI_API_KEY", "HARNESS_KEY"):
    os.environ[key] = ""
