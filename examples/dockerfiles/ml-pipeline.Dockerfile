# Machine Learning training pipeline - large image
# Expect: medium score, warnings about image size and layers
FROM nvidia/cuda:12.4.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3.11-venv python3-pip \
    git wget curl unzip \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev \
    libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel

WORKDIR /workspace

COPY requirements-cuda.txt .
RUN pip install --no-cache-dir -r requirements-cuda.txt

COPY requirements-ml.txt .
RUN pip install --no-cache-dir -r requirements-ml.txt

COPY requirements-app.txt .
RUN pip install --no-cache-dir -r requirements-app.txt

COPY configs/ ./configs/
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY models/ ./models/

RUN mkdir -p /workspace/data /workspace/outputs /workspace/checkpoints /workspace/logs

ENV TRANSFORMERS_CACHE=/workspace/.cache/huggingface
ENV TORCH_HOME=/workspace/.cache/torch
ENV WANDB_DIR=/workspace/logs
ENV NCCL_DEBUG=INFO
ENV CUDA_VISIBLE_DEVICES=all

EXPOSE 8888 6006 5000

VOLUME ["/workspace/data", "/workspace/outputs", "/workspace/checkpoints"]

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import torch; assert torch.cuda.is_available()" || exit 1

ENTRYPOINT ["python", "-m"]
CMD ["src.train", "--config", "configs/default.yaml"]
