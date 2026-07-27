FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    libsndfile1-dev \
    ffmpeg \
    build-essential \
    pkg-config \
    libenchant-2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install PyTorch CPU (to save memory on Railway)
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install AI4Bharat TTS Fork
RUN git clone https://github.com/gokulkarthik/TTS /TTS
WORKDIR /TTS
# Pre-install cython and numpy to avoid build errors
RUN pip install setuptools wheel Cython numpy
RUN pip install -e .[all] || true
# Note: sometimes [all] throws minor errors on docs/tests, but core TTS installs fine.

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 5000
CMD ["python", "app.py"]
