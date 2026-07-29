import os
import io
import torch
from flask import Flask, request, send_file
from TTS.utils.synthesizer import Synthesizer
import soundfile as sf

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

def do_tts(text):
    """Run TTS inference with torch.no_grad() for ~30% faster CPU inference."""
    with torch.no_grad():
        try:
            return synthesizer.tts(text, speaker_name="male")
        except TypeError:
            return synthesizer.tts(text)

@app.route('/health', methods=['GET'])
def health():
    return {"status": "ok", "model_loaded": synthesizer is not None}

@app.route('/synthesize', methods=['POST'])
def synthesize():
    if not synthesizer:
        return {"error": "TTS Model not loaded"}, 500

    data = request.json
    text = data.get("text", "").strip()
    if not text:
        return {"error": "No text provided"}, 400

    # Pad very short texts to avoid PyTorch CNN kernel size crash
    if len(text) < 3:
        text = text + " . . ."

    # Hard cap at 200 chars for fast CPU response times (Node sends first sentence only)
    if len(text) > 200:
        text = text[:200]

    try:
        try:
            wav = do_tts(text)
        except RuntimeError as e:
            if "Kernel size can't be greater than actual input size" in str(e):
                print("Retrying with extra padding...")
                wav = do_tts(text + " , , , ")
            else:
                raise e

        # Serve audio directly from memory (no disk write = faster!)
        buf = io.BytesIO()
        sf.write(buf, wav, synthesizer.output_sample_rate, format="WAV")
        buf.seek(0)
        return send_file(buf, mimetype="audio/wav")

    except Exception as e:
        print(f"TTS Generation Error: {e}")
        return {"error": str(e)}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
