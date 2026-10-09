"""Transcribe a speech recording to text with Whisper (runs on your own computer, offline after the first model download).

Setup (once):   pip install faster-whisper
Run:            python transcribe_call.py call_recording_from_yashraj.wav
Output:         call_recording_from_yashraj.txt  (with timestamps)  - open it and check names / numbers.

Use --lang en (or ta, hi...) if you know the language; leave it out to auto-detect.
"""
import argparse
import os

from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("audio")
ap.add_argument("--lang", default=None)
ap.add_argument("--model", default="large-v3", help="large-v3 is the most accurate; use 'small' on a slow PC")
a = ap.parse_args()

model = WhisperModel(a.model, compute_type="int8")
segs, info = model.transcribe(a.audio, language=a.lang, vad_filter=True, beam_size=5)
print(f"Language: {info.language} ({info.language_probability:.0%})")
out = os.path.splitext(a.audio)[0] + ".txt"
with open(out, "w", encoding="utf-8") as f:
    for s in segs:
        line = f"[{int(s.start // 60):02d}:{int(s.start % 60):02d}] {s.text.strip()}"
        print(line)
        f.write(line + "\n")
print("Saved", out)
