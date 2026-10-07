FROM python:3.12-slim-bookworm
ARG ARTEMIS_REVISION=351ca8422f7b5b54e80a9c1ce03a222e02415b6b
LABEL org.opencontainers.image.source=https://github.com/google/artemis
LABEL socialgrowth.artemis.upstream=$ARTEMIS_REVISION
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates adb ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.5.11
WORKDIR /opt/artemis
RUN git init && git remote add origin https://github.com/google/artemis.git && git fetch --depth 1 origin "$ARTEMIS_REVISION" && git checkout --detach FETCH_HEAD
COPY socialgrowth.patch /tmp/socialgrowth.patch
RUN git apply --check /tmp/socialgrowth.patch && git apply /tmp/socialgrowth.patch && rm /tmp/socialgrowth.patch
RUN uv sync --frozen --no-dev
ENV PATH=/opt/artemis/.venv/bin:$PATH
RUN .venv/bin/python -c 'import artemis; from artemis.llm.router import ModelFactory; import mcp_server'
# Secrets, user model config and all execution state are runtime bind mounts.
