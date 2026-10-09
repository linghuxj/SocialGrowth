FROM python:3.12-slim-bookworm
ARG ARTEMIS_REVISION=351ca8422f7b5b54e80a9c1ce03a222e02415b6b
LABEL org.opencontainers.image.source=https://github.com/google/artemis
LABEL socialgrowth.artemis.upstream=$ARTEMIS_REVISION
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates adb aapt apksigner default-jre-headless ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
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

# Modern Play packages use signing-key rotation. Bookworm's apksigner predates
# those formats. The optional source override supports an offline operator cache;
# the fixed SHA-256 is mandatory for every source.
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r36_linux.zip
RUN ANDROID_BUILD_TOOLS_URL="$ANDROID_BUILD_TOOLS_URL" python -c 'import hashlib,io,os,urllib.request,zipfile; data=urllib.request.urlopen(os.environ["ANDROID_BUILD_TOOLS_URL"],timeout=120).read(); assert hashlib.sha256(data).hexdigest()=="5d9ac77fb6ff43d9da518a337b4fcf8f9097113df531d99ccefe80ef7ce8250b", "BUILD_TOOLS_CHECKSUM_MISMATCH"; z=zipfile.ZipFile(io.BytesIO(data)); root="/opt/android/build-tools/36.0.0"; os.makedirs(root,exist_ok=True); [(os.makedirs(os.path.dirname(root+"/"+n.removeprefix("android-16/")),exist_ok=True),open(root+"/"+n.removeprefix("android-16/"),"wb").write(z.read(n))) for n in z.namelist() if n.startswith("android-16/") and not n.endswith("/")]' && chmod 755 /opt/android/build-tools/36.0.0/aapt /opt/android/build-tools/36.0.0/apksigner && /opt/android/build-tools/36.0.0/apksigner version

# Client-only Google egress; dependencies and Android tools remain unchanged.
COPY google_proxy.py /opt/artemis/artemis/llm/socialgrowth_google_proxy.py
COPY google-client.patch /tmp/google-client.patch
RUN git apply --check /tmp/google-client.patch && git apply /tmp/google-client.patch && rm /tmp/google-client.patch && .venv/bin/python -c 'from artemis.llm.router import ModelFactory; from artemis.llm.socialgrowth_google_proxy import google_proxy_client_args'

# Remote helper health probes need a configurable round-trip budget.
COPY helper-timeout.patch /tmp/helper-timeout.patch
RUN git apply --check /tmp/helper-timeout.patch && git apply /tmp/helper-timeout.patch && rm /tmp/helper-timeout.patch

# Bound initial planning only in the Web-authorized phone initialization task.
COPY planner-budget.patch /tmp/planner-budget.patch
RUN git apply --check /tmp/planner-budget.patch && git apply /tmp/planner-budget.patch && rm /tmp/planner-budget.patch

# Enforce local proxy readiness before SFA actions in phone initialization only.
COPY phone-network.patch /tmp/phone-network.patch
RUN git apply --check /tmp/phone-network.patch && git apply /tmp/phone-network.patch && rm /tmp/phone-network.patch && .venv/bin/python -m py_compile artemis/tools/socialgrowth_supervision.py
