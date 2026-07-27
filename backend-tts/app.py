import os
import io
from flask import Flask, request, send_file
from TTS.utils.synthesizer import Synthesizer
import tempfile

app = Flask(__name__)

# Paths in Docker
MODEL_DIR = "/app/models/ta"
FASTPITCH_MODEL = os.path.join(MODEL_DIR, "fastpitch", "best_model.pth")
FASTPITCH_CONFIG = os.path.join(MODEL_DIR, "fastpitch", "config.json")
HIFIGAN_MODEL = os.path.join(MODEL_DIR, "hifigan", "best_model.pth")
HIFIGAN_CONFIG = os.path.join(MODEL_DIR, "hifigan", "config.json")

print("Initializing AI4Bharat Tamil TTS Synthesizer...")
try:
    synthesizer = Synthesizer(
        tts_checkpoint=FASTPITCH_MODEL,
        tts_config_path=FASTPITCH_CONFIG,
        vocoder_checkpoint=HIFIGAN_MODEL,
        vocoder_config=HIFIGAN_CONFIG,
        use_cuda=False
    )
    print("TTS Synthesizer initialized successfully.")
except Exception as e:
    print(f"Error initializing Synthesizer: {e}")
    synthesizer = None

@app.route('/synthesize', methods=['POST'])
def synthesize():
    if not synthesizer:
        return {"error": "TTS Model not loaded"}, 500
        
    data = request.json
    text = data.get("text")
    if not text:
        return {"error": "No text provided"}, 400
        
    try:
        # Note: Depending on the AI4Bharat config, speaker names might vary. 
        # We try "male" first, or let it default if speaker_name is not accepted.
        try:
            wav = synthesizer.tts(text, speaker_name="male")
        except TypeError:
            # If synthesizer doesn't accept speaker_name or 'male' is invalid, fallback to default.
            wav = synthesizer.tts(text)

        # Write to a temporary file
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        
        synthesizer.save_wav(wav, path)
        return send_file(path, mimetype="audio/wav")
    except Exception as e:
        print(f"TTS Generation Error: {e}")
        return {"error": str(e)}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
