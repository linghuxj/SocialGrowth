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

# Debian bookworm adb 29 predates Android wireless TLS pairing. Pin Google's
# platform-tools archive and verify bytes before extracting it.
RUN python -c 'import hashlib,io,urllib.request,zipfile; data=urllib.request.urlopen("https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip",timeout=60).read(); assert hashlib.sha256(data).hexdigest()=="d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1", "PLATFORM_TOOLS_CHECKSUM_MISMATCH"; zipfile.ZipFile(io.BytesIO(data)).extractall("/opt/android")' && chmod 755 /opt/android/platform-tools/adb && /opt/android/platform-tools/adb version
ENV PATH=/opt/android/platform-tools:$PATH
