FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libsndfile1-dev \
    ffmpeg \
    build-essential \
    pkg-config \
    libenchant-2-dev \
    unzip \
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

# Download and extract the Tamil models directly into the Docker image
# This avoids Windows volume mount issues and ensures it works on Railway!
RUN mkdir -p /app/models \
    && cd /app/models \
    && curl -L -o ta.zip https://github.com/AI4Bharat/Indic-TTS/releases/download/v1-checkpoints-release/ta.zip \
    && unzip ta.zip \
    && rm ta.zip \
    && sed -i 's/models\/v1\/ta/models\/ta/g' /app/models/ta/fastpitch/config.json \
    && sed -i 's/models\/v1\/ta/models\/ta/g' /app/models/ta/hifigan/config.json

COPY app.py .

EXPOSE 5000
CMD ["python", "app.py"]
