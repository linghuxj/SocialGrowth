"""Build the isolated Android NSD probe using an existing SDK/JDK, without downloads."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, timeout=120)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, default=Path.home() / "Library/Android/sdk")
    parser.add_argument("--java-home", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    classes, dex = output / "classes", output / "dex"
    classes.mkdir(exist_ok=True)
    dex.mkdir(exist_ok=True)
    # Remove only outputs produced by this build so removed anonymous classes cannot linger.
    for directory, pattern in [(classes, "*.class"), (dex, "*.dex")]:
        for generated in directory.rglob(pattern):
            generated.unlink()
    os.environ["JAVA_HOME"] = str(args.java_home)
    os.environ["PATH"] = str(args.java_home / "bin") + os.pathsep + os.environ["PATH"]
    platform = args.sdk / "platforms/android-36/android.jar"
    build_tools = args.sdk / "build-tools/36.0.0"
    java_files = sorted((source / "src").rglob("*.java"))
    run([str(args.java_home / "bin/javac"), "-encoding", "UTF-8", "-source", "8", "-target", "8",
         "-classpath", str(platform), "-d", str(classes), *map(str, java_files)])
    run([str(build_tools / "d8"), "--lib", str(platform), "--min-api", "34", "--output", str(dex),
         *map(str, sorted(classes.rglob("*.class")))])
    unsigned = output / "unsigned.apk"
    run([str(build_tools / "aapt2"), "link", "-I", str(platform), "--manifest", str(source / "AndroidManifest.xml"),
         "-o", str(unsigned)])
    with zipfile.ZipFile(unsigned, "a", compression=zipfile.ZIP_DEFLATED) as apk:
        for entry in sorted(dex.glob("*.dex")):
            apk.write(entry, entry.name)
    aligned = output / "aligned.apk"
    run([str(build_tools / "zipalign"), "-f", "4", str(unsigned), str(aligned)])
    key = output / "probe-debug.p12"
    if not key.exists():
        previous_umask = os.umask(0o077)
        try:
            run([str(args.java_home / "bin/keytool"), "-genkeypair", "-keystore", str(key), "-storetype", "PKCS12",
                 "-storepass", "android", "-keypass", "android", "-alias", "probe", "-keyalg", "RSA",
                 "-keysize", "2048", "-validity", "3650", "-dname", "CN=SocialGrowth Diagnostic"])
        finally:
            os.umask(previous_umask)
    key.chmod(0o600)
    artifact = output / "endpoint-probe.apk"
    run([str(build_tools / "apksigner"), "sign", "--ks", str(key), "--ks-key-alias", "probe",
         "--ks-pass", "pass:android", "--out", str(artifact), str(aligned)])
    run([str(build_tools / "apksigner"), "verify", str(artifact)])
    inputs = [source / "AndroidManifest.xml", source / "build.py", source / "run.py", *java_files]
    receipt = {"apk": str(artifact), "apkSha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
               "compileSdk": 36, "minSdk": 34, "targetSdk": 36, "buildTools": "36.0.0",
               "inputs": {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}}
    (output / "build.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
